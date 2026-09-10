import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { ProfileDetail, ProfileRight, UpsertProfile } from '@flow/contracts';
import { eq, inArray, profileRights, profiles, sql } from '@flow/db';
import { DatabaseService } from '../database/database.service.js';
import { RightsService } from '../auth/rights.service.js';
import { RightsCatalogService } from './rights-catalog.service.js';

interface LigneProfil extends Record<string, unknown> {
  id: number;
  name: string;
  comment: string | null;
  isDefault: boolean;
  usageCount: number;
}

/**
 * Administration des profils.
 *
 * Un profil est un referentiel **global a l'installation** : il n'a pas
 * d'entite, et deux branches qui utilisent le meme profil partagent ses droits.
 * Modifier un profil modifie donc ce que peuvent faire des gens qu'on ne
 * connait pas.
 *
 * C'est assume, et c'est la raison pour laquelle `profile:update` ne propose que
 * la portee `all` : laisser choisir `entity` ferait croire a un cloisonnement
 * qui n'existe pas. Le compteur d'usage sert a le rendre visible avant qu'on
 * enregistre -- « ce profil sert a douze habilitations » est l'information qui
 * manque au moment ou l'on decoche une case.
 */
@Injectable()
export class ProfilesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly catalogue: RightsCatalogService,
    private readonly rights: RightsService,
  ) {}

  async list(): Promise<ProfileDetail[]> {
    const lignes = await this.db.asUser(async (tx) => {
      const resultat = await tx.execute<LigneProfil>(sql`
        SELECT
          p.id        AS "id",
          p.name      AS "name",
          p.comment   AS "comment",
          p.is_default AS "isDefault",
          -- Compte les habilitations VISIBLES : la politique s applique a la
          -- table des habilitations, si bien que le chiffre dit « ce profil
          -- sert a tant d habilitations chez vous », et non dans toute
          -- l installation.
          (SELECT count(*)::int FROM authorizations a WHERE a.profile_id = p.id) AS "usageCount"
        FROM profiles p
        ORDER BY p.name
      `);

      return resultat.rows;
    });

    const droits = await this.rightsFor(lignes.map((ligne) => ligne.id));

    return lignes.map((ligne) => ({
      id: ligne.id,
      name: ligne.name,
      comment: ligne.comment,
      isDefault: ligne.isDefault,
      usageCount: ligne.usageCount,
      rights: droits.get(ligne.id) ?? [],
    }));
  }

  async get(id: number): Promise<ProfileDetail> {
    const profil = (await this.list()).find((candidat) => candidat.id === id);

    if (!profil) throw new NotFoundException("Ce profil n'existe pas.");

    return profil;
  }

  async create(donnees: UpsertProfile): Promise<ProfileDetail> {
    this.assertDroitsConnus(donnees.rights);

    const id = await this.db.asUser(async (tx) => {
      const [cree] = await tx
        .insert(profiles)
        .values({ name: donnees.name, comment: donnees.comment ?? null, isDefault: false })
        .returning({ id: profiles.id });

      if (!cree) throw new BadRequestException("Le profil n'a pas pu etre cree.");

      if (donnees.rights.length > 0) {
        await tx
          .insert(profileRights)
          .values(donnees.rights.map((droit) => ({ profileId: cree.id, ...droit })));
      }

      return cree.id;
    });

    return this.get(id);
  }

  /**
   * Remplace le profil et l'integralite de ses droits.
   *
   * Remplacement et non fusion : une matrice se soumet entiere, et un droit
   * absent de l'envoi est un droit retire. Fusionner obligerait l'interface a
   * envoyer des suppressions explicites, et un retrait perdu en chemin
   * laisserait un droit accorde sans que personne ne le voie.
   */
  async update(id: number, donnees: UpsertProfile): Promise<ProfileDetail> {
    const avant = await this.get(id);

    this.assertDroitsConnus(donnees.rights);

    await this.db.asUser(async (tx) => {
      await tx
        .update(profiles)
        .set({ name: donnees.name, comment: donnees.comment ?? null, updatedAt: new Date() })
        .where(eq(profiles.id, avant.id));

      await tx.delete(profileRights).where(eq(profileRights.profileId, avant.id));

      if (donnees.rights.length > 0) {
        await tx
          .insert(profileRights)
          .values(donnees.rights.map((droit) => ({ profileId: avant.id, ...droit })));
      }
    });

    // Le cache des droits est indexe par profil : sans cette invalidation, les
    // sessions deja ouvertes garderaient les anciens droits jusqu'a leur fin --
    // y compris ceux qu'on vient de retirer.
    this.rights.invalidate(avant.id);

    return this.get(id);
  }

  /**
   * Supprime un profil inutilise.
   *
   * Une suppression en cascade retirerait silencieusement leurs droits a des
   * comptes d'autres branches, que celui qui supprime ne voit meme pas.
   */
  async remove(id: number): Promise<void> {
    const profil = await this.get(id);

    if (profil.isDefault) {
      throw new BadRequestException(
        'Ce profil est celui attribue par defaut : designez-en un autre avant de le supprimer.',
      );
    }

    // Compte les usages **reels**, pas les usages visibles : le profil peut
    // servir dans une branche que celui qui supprime ne voit pas.
    const total = await this.db.asOwner(async (tx) => {
      const resultat = await tx.execute<{ total: number }>(sql`
        SELECT count(*)::int AS total FROM authorizations WHERE profile_id = ${profil.id}
      `);

      return resultat.rows[0]?.total ?? 0;
    });

    if (total > 0) {
      throw new BadRequestException(
        `Ce profil sert encore a ${String(total)} habilitation(s) : retirez-les d'abord.`,
      );
    }

    await this.db.asUser((tx) => tx.delete(profiles).where(eq(profiles.id, profil.id)));
    this.rights.invalidate(profil.id);
  }

  /**
   * Refuse un droit que l'application ne declare pas.
   *
   * Sans ce controle, la table accepterait n'importe quel couple objet/action --
   * y compris une faute de frappe -- et le droit resterait a l'ecran, coche,
   * sans que rien ne le consulte jamais.
   */
  private assertDroitsConnus(droits: ProfileRight[]): void {
    const inconnus = droits.filter(
      (droit) => !this.catalogue.accepts(droit.object, droit.action, droit.scope),
    );

    if (inconnus.length > 0) {
      const liste = inconnus
        .map((droit) => `${droit.object}:${droit.action}=${droit.scope}`)
        .join(', ');

      throw new BadRequestException(`Droits inconnus ou portee inapplicable : ${liste}.`);
    }
  }

  private async rightsFor(profileIds: number[]): Promise<Map<number, ProfileRight[]>> {
    const parProfil = new Map<number, ProfileRight[]>();

    if (profileIds.length === 0) return parProfil;

    const lignes = await this.db.asUser(async (tx) => {
      const resultat = await tx.execute<
        {
          profileId: number;
          object: string;
          action: string;
          scope: ProfileRight['scope'];
        } & Record<string, unknown>
      >(sql`
        SELECT profile_id AS "profileId", object, action, scope
        FROM profile_rights
        -- inArray plutot que ANY : Drizzle developpe un tableau JavaScript
        -- en parametres separes, et ANY recevrait alors un scalaire.
        WHERE ${inArray(profileRights.profileId, profileIds)}
        ORDER BY object, action
      `);

      return resultat.rows;
    });

    for (const ligne of lignes) {
      const liste = parProfil.get(ligne.profileId) ?? [];

      liste.push({ object: ligne.object, action: ligne.action, scope: ligne.scope });
      parProfil.set(ligne.profileId, liste);
    }

    return parProfil;
  }
}
