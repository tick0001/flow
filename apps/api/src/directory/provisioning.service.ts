import { Injectable, Logger } from '@nestjs/common';
import { and, eq, sql, users, type Transaction } from '@flow/db';
import type { DirectoryTrace } from '@flow/contracts';
import type { IdentiteExterne } from '@flow/plugin-sdk';
import { DatabaseService } from '../database/database.service.js';

/** Un compte tel que la connexion en a besoin apres provisionnement. */
export interface ComptePourvu {
  id: number;
  username: string;
  isActive: boolean;
  mustChangePassword: boolean;
  defaultEntityId: number | null;
}

/**
 * Ce que fait le coeur d'une identite rendue par un plugin.
 *
 * Le partage des roles est la decision qui structure tout l'annuaire : **le
 * plugin dit qui est la personne et a quels groupes elle appartient ; le coeur
 * decide de ce que cela vaut.** Laisser chaque source externe resoudre
 * elle-meme un profil et une entite aurait donne autant de lectures des droits
 * qu'il y a de plugins, et une erreur dans l'un serait une elevation de
 * privileges dans toute l'installation.
 *
 * Tout passe par le role proprietaire : personne n'est encore connecte, il n'y a
 * donc aucun perimetre a poser. C'est le seul endroit de l'application ou des
 * habilitations s'ecrivent sans qu'un acteur les demande, et c'est pour cela que
 * les regles, elles, sont cloisonnees a l'ecriture.
 */
@Injectable()
export class ProvisioningService {
  private readonly logger = new Logger(ProvisioningService.name);

  constructor(private readonly db: DatabaseService) {}

  /**
   * Cree ou met a jour le compte, puis applique les regles d'affectation.
   *
   * Rend `null` quand un compte **local** porte deja cet identifiant. Le refus
   * est delibere : la base locale a ete interrogee en premier et n'a pas
   * reconnu la personne, ce qui veut dire que le mot de passe etait faux.
   * Laisser l'annuaire prendre la main ici permettrait a quiconque controle une
   * branche de l'annuaire de s'emparer d'un compte local -- y compris celui
   * d'administration.
   */
  async pourvoir(
    identite: IdentiteExterne,
  ): Promise<{ compte: ComptePourvu; trace: DirectoryTrace } | null> {
    return this.db.asOwner(async (tx) => {
      const existant = await this.lire(tx, identite.username);

      if (existant && existant.authSource === 'local') {
        this.logger.warn(
          `${identite.username} existe en local : l'annuaire ne prend pas la main dessus.`,
        );

        return null;
      }

      const compte = existant
        ? await this.mettreAJour(tx, existant.id, identite)
        : await this.creer(tx, identite);

      const trace = await this.appliquerLesRegles(tx, compte.id, identite);

      return { compte, trace: { ...trace, username: identite.username } };
    });
  }

  private async lire(
    tx: Transaction,
    username: string,
  ): Promise<{ id: number; authSource: string } | undefined> {
    const [ligne] = await tx
      .select({ id: users.id, authSource: users.authSource })
      .from(users)
      .where(and(eq(users.username, username), sql`${users.deletedAt} IS NULL`));

    return ligne;
  }

  private async creer(tx: Transaction, identite: IdentiteExterne): Promise<ComptePourvu> {
    const [ligne] = await tx
      .insert(users)
      .values({
        username: identite.username,
        email: identite.email ?? null,
        // Le nom d'affichage de l'annuaire est pose en prenom faute de mieux :
        // le decouper en prenom et nom demanderait de deviner l'ordre, qui
        // varie d'un annuaire et d'un pays a l'autre.
        firstName: identite.displayName ?? null,
        passwordHash: null,
        authSource: 'ldap',
        ldapDn: identite.externalId,
        isActive: true,
      })
      .returning({
        id: users.id,
        username: users.username,
        isActive: users.isActive,
        mustChangePassword: users.mustChangePassword,
        defaultEntityId: users.defaultEntityId,
      });

    if (!ligne) throw new Error(`Creation du compte ${identite.username} impossible.`);

    this.logger.log(`${identite.username} provisionne depuis l'annuaire.`);

    return ligne;
  }

  private async mettreAJour(
    tx: Transaction,
    id: number,
    identite: IdentiteExterne,
  ): Promise<ComptePourvu> {
    const [ligne] = await tx
      .update(users)
      .set({
        email: identite.email ?? null,
        firstName: identite.displayName ?? null,
        ldapDn: identite.externalId,
        updatedAt: new Date(),
      })
      .where(eq(users.id, id))
      .returning({
        id: users.id,
        username: users.username,
        isActive: users.isActive,
        mustChangePassword: users.mustChangePassword,
        defaultEntityId: users.defaultEntityId,
      });

    if (!ligne) throw new Error(`Mise a jour du compte ${identite.username} impossible.`);

    return ligne;
  }

  /**
   * Remplace les habilitations **dynamiques** du compte par celles que ses
   * groupes lui donnent.
   *
   * Seules les dynamiques : celles saisies a la main survivent a chaque
   * connexion. Sans cette distinction, une synchronisation effacerait le travail
   * d'un administrateur, et personne ne saurait dire quand ni pourquoi -- l'acces
   * aurait simplement disparu entre deux connexions.
   *
   * Le compte qui quitte un groupe perd l'habilitation correspondante a sa
   * connexion suivante. C'est le sens meme de la revocation par l'annuaire, et
   * c'est pour cela que le remplacement est complet plutot qu'additif.
   */
  private async appliquerLesRegles(
    tx: Transaction,
    userId: number,
    identite: IdentiteExterne,
  ): Promise<Omit<DirectoryTrace, 'username'>> {
    const groupes = [...new Set(identite.groups.map((groupe) => groupe.trim()).filter(Boolean))];

    if (groupes.length === 0) {
      await tx.execute(
        sql`DELETE FROM authorizations WHERE user_id = ${userId} AND is_dynamic = true`,
      );

      return { groups: [], matched: [], granted: 0 };
    }

    // Un parametre par nom, et non un tableau lie en bloc : Drizzle transmet un
    // tableau JavaScript tel quel, et PostgreSQL recoit alors « Exploitation » la
    // ou il attend « {Exploitation} » -- « malformed array literal », sur une
    // requete qui a l'air juste.
    const noms = sql.join(
      groupes.map((groupe) => sql`${groupe}`),
      sql`, `,
    );

    const correspondantes = await tx.execute<{
      profileId: number;
      entityId: number;
      isRecursive: boolean;
      groupName: string;
    }>(sql`
      SELECT profile_id AS "profileId",
             entity_id  AS "entityId",
             is_recursive AS "isRecursive",
             group_name::text AS "groupName"
        FROM directory_rules
       WHERE group_name IN (${noms})
    `);

    await tx.execute(
      sql`DELETE FROM authorizations WHERE user_id = ${userId} AND is_dynamic = true`,
    );

    for (const regle of correspondantes.rows) {
      // `ON CONFLICT DO NOTHING` : une habilitation saisie a la main sur le meme
      // couple existe peut-etre deja. La regle ne la remplace pas -- elle est
      // deja plus forte, puisqu'aucune synchronisation ne l'effacera.
      await tx.execute(sql`
        INSERT INTO authorizations (user_id, profile_id, entity_id, is_recursive, is_dynamic)
        VALUES (${userId}, ${regle.profileId}, ${regle.entityId}, ${regle.isRecursive}, true)
        ON CONFLICT (user_id, profile_id, entity_id) DO NOTHING
      `);
    }

    const touches = [...new Set(correspondantes.rows.map((regle) => regle.groupName))];

    return { groups: groupes, matched: touches, granted: correspondantes.rows.length };
  }
}
