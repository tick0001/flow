import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  Authorization,
  CreateUser,
  GrantAuthorization,
  UpdateUser,
  UserSummary,
} from '@flow/contracts';
import { and, authorizations, eq, inArray, sql, users } from '@flow/db';
import { displayNameOf } from '../common/display-name.js';
import { requireContext } from '../common/request-context.js';
import { DatabaseService } from '../database/database.service.js';
import { PasswordService } from '../auth/password.service.js';
import { ScopeService } from '../auth/scope.service.js';

interface LigneCompte extends Record<string, unknown> {
  id: number;
  username: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  locale: string | null;
  isActive: boolean;
  mustChangePassword: boolean;
  authSource: 'local' | 'ldap';
  lastLoginAt: Date | null;
}

/**
 * Administration des comptes.
 *
 * **`users` n'a pas de politique de Row-Level Security**, et ne peut pas en
 * avoir : un compte n'a pas d'entite -- il en a autant que d'habilitations. La
 * question « a quelle organisation appartient cette personne » n'a pas de
 * reponse pour quelqu'un habilite sur deux branches.
 *
 * La visibilite passe donc par une **jointure sur `authorizations`**, qui est
 * protegee, elle. Un compte est visible s'il possede au moins une habilitation
 * dans le perimetre de travail courant.
 *
 * Consequence a garder en tete : **toute lecture de `users` doit joindre**. Un
 * `SELECT` seul sur cette table rendrait l'installation entiere, sans erreur et
 * sans que rien ne le signale. C'est la contrepartie assumee de l'absence de
 * politique, et c'est pourquoi ce service est le seul endroit qui lit cette
 * table pour l'administration.
 */
@Injectable()
export class UsersService {
  constructor(
    private readonly db: DatabaseService,
    private readonly passwords: PasswordService,
    private readonly scopes: ScopeService,
  ) {}

  /** Les comptes habilites quelque part dans le perimetre courant. */
  async list(): Promise<UserSummary[]> {
    const lignes = await this.db.asUser(async (tx) => {
      const resultat = await tx.execute<LigneCompte>(sql`
        SELECT DISTINCT
          u.id                   AS "id",
          u.username::text       AS "username",
          u.first_name           AS "firstName",
          u.last_name            AS "lastName",
          u.email::text          AS "email",
          u.locale               AS "locale",
          u.is_active            AS "isActive",
          u.must_change_password AS "mustChangePassword",
          u.auth_source          AS "authSource",
          u.last_login_at        AS "lastLoginAt"
        FROM users u
        -- La jointure EST le filtre : la table des habilitations porte la
        -- politique, celle des comptes n a pas. La retirer rendrait toute
        -- l installation, sans erreur et sans que rien ne le signale.
        JOIN authorizations a ON a.user_id = u.id
        WHERE u.deleted_at IS NULL
        ORDER BY "username"
      `);

      return resultat.rows;
    });

    const habilitations = await this.authorizationsFor(lignes.map((ligne) => ligne.id));

    return lignes.map((ligne) => ({
      id: ligne.id,
      username: ligne.username,
      displayName: displayNameOf(ligne),
      email: ligne.email,
      locale: ligne.locale === 'fr' || ligne.locale === 'en' ? ligne.locale : null,
      isActive: ligne.isActive,
      mustChangePassword: ligne.mustChangePassword,
      authSource: ligne.authSource,
      lastLoginAt: ligne.lastLoginAt,
      authorizations: habilitations.get(ligne.id) ?? [],
    }));
  }

  async get(id: number): Promise<UserSummary> {
    const compte = (await this.list()).find((candidat) => candidat.id === id);

    // Invisible et inexistant rendent la meme reponse : distinguer les deux
    // confirmerait l'existence d'un compte d'une autre organisation.
    if (!compte) throw new NotFoundException("Ce compte n'existe pas.");

    return compte;
  }

  /**
   * Cree un compte avec son habilitation initiale, en une transaction.
   *
   * L'habilitation n'est pas optionnelle : un compte qui n'en a aucune est
   * invisible de tout le monde, y compris de qui vient de le creer, puisque la
   * liste passe par la jointure. Le rattraper demanderait du SQL.
   */
  async create(donnees: CreateUser): Promise<UserSummary> {
    await this.assertPeutHabiliter(donnees.authorization);

    const condensat = await this.passwords.hash(donnees.password);

    const id = await this.db.asUser(async (tx) => {
      const [cree] = await tx
        .insert(users)
        .values({
          username: donnees.username,
          passwordHash: condensat,
          firstName: donnees.firstName ?? null,
          lastName: donnees.lastName ?? null,
          email: donnees.email ?? null,
          locale: donnees.locale ?? null,
          authSource: 'local',
          isActive: true,
          // Le mot de passe a ete choisi par quelqu'un d'autre et transmis de
          // vive voix ou par messagerie : il n'est pas un secret.
          mustChangePassword: true,
          defaultEntityId: donnees.authorization.entityId,
        })
        .returning({ id: users.id });

      if (!cree) throw new BadRequestException("Le compte n'a pas pu etre cree.");

      await tx.insert(authorizations).values({
        userId: cree.id,
        profileId: donnees.authorization.profileId,
        entityId: donnees.authorization.entityId,
        isRecursive: donnees.authorization.isRecursive,
        isDynamic: false,
      });

      return cree.id;
    });

    return this.get(id);
  }

  async update(id: number, donnees: UpdateUser): Promise<UserSummary> {
    const avant = await this.get(id);

    if (donnees.isActive === false) this.assertPasSoiMeme(id, 'desactiver');

    await this.db.asUser((tx) =>
      tx
        .update(users)
        .set({
          ...(donnees.firstName === undefined ? {} : { firstName: donnees.firstName }),
          ...(donnees.lastName === undefined ? {} : { lastName: donnees.lastName }),
          ...(donnees.email === undefined ? {} : { email: donnees.email }),
          ...(donnees.locale === undefined ? {} : { locale: donnees.locale }),
          ...(donnees.isActive === undefined ? {} : { isActive: donnees.isActive }),
          updatedAt: new Date(),
        })
        .where(eq(users.id, avant.id)),
    );

    return this.get(id);
  }

  /**
   * Pose un nouveau mot de passe, et impose son changement.
   *
   * Un administrateur ne connait jamais le mot de passe de quelqu'un : celui-ci
   * est transitoire, et le compte doit en choisir un des la connexion suivante.
   */
  async resetPassword(id: number, motDePasse: string): Promise<void> {
    const compte = await this.get(id);

    if (compte.authSource === 'ldap') {
      throw new BadRequestException(
        "Ce compte s'authentifie sur un annuaire : son mot de passe s'y change.",
      );
    }

    const condensat = await this.passwords.hash(motDePasse);

    await this.db.asUser((tx) =>
      tx
        .update(users)
        .set({ passwordHash: condensat, mustChangePassword: true, updatedAt: new Date() })
        .where(eq(users.id, compte.id)),
    );
  }

  /**
   * Retire un compte, sans effacer ce qu'il a fait.
   *
   * Suppression logique : les executions passees le referencent, et les effacer
   * priverait l'historique de son auteur -- c'est-a-dire de la moitie de son
   * interet.
   */
  async remove(id: number): Promise<void> {
    const compte = await this.get(id);

    this.assertPasSoiMeme(compte.id, 'supprimer');

    await this.db.asUser((tx) =>
      tx
        .update(users)
        .set({ deletedAt: new Date(), isActive: false, updatedAt: new Date() })
        .where(eq(users.id, compte.id)),
    );
  }

  /** Accorde une habilitation supplementaire. */
  async grant(id: number, habilitation: GrantAuthorization): Promise<UserSummary> {
    const compte = await this.get(id);

    await this.assertPeutHabiliter(habilitation);

    await this.db.asUser((tx) =>
      tx
        .insert(authorizations)
        .values({
          userId: compte.id,
          profileId: habilitation.profileId,
          entityId: habilitation.entityId,
          isRecursive: habilitation.isRecursive,
          isDynamic: false,
        })
        .onConflictDoUpdate({
          target: [authorizations.userId, authorizations.profileId, authorizations.entityId],
          set: { isRecursive: habilitation.isRecursive },
        }),
    );

    return this.get(id);
  }

  /**
   * Retire une habilitation.
   *
   * Refuse la derniere : un compte sans habilitation disparait de toutes les
   * listes, et il faudrait du SQL pour le retrouver. Le supprimer est une
   * decision explicite qui a sa propre commande.
   */
  async revoke(id: number, entityId: number, profileId: number): Promise<UserSummary> {
    const compte = await this.get(id);

    const visee = compte.authorizations.find(
      (candidate) => candidate.entity.id === entityId && candidate.profile.id === profileId,
    );

    if (!visee) throw new NotFoundException("Cette habilitation n'existe pas.");

    if (visee.isDynamic) {
      throw new BadRequestException(
        "Cette habilitation vient d'un annuaire : elle se retire en modifiant les regles d'affectation.",
      );
    }

    // Compte les habilitations **reelles**, pas celles visibles : le compte peut
    // en avoir ailleurs, hors du perimetre courant. Le refus ne doit pas
    // dependre de qui regarde.
    const total = await this.db.asOwner(async (tx) => {
      const resultat = await tx.execute<{ total: number }>(sql`
        SELECT count(*)::int AS total FROM authorizations WHERE user_id = ${compte.id}
      `);

      return resultat.rows[0]?.total ?? 0;
    });

    if (total <= 1) {
      throw new BadRequestException(
        "C'est la derniere habilitation de ce compte : le retirer le rendrait invisible. Supprimez le compte a la place.",
      );
    }

    if (compte.id === requireContext().userId) {
      // Se retirer sa propre habilitation sur l'entite active revient a se
      // fermer la porte pendant qu'on est dedans.
      this.assertPasSoiMeme(compte.id, 'retirer une habilitation a');
    }

    await this.db.asUser((tx) =>
      tx
        .delete(authorizations)
        .where(
          and(
            eq(authorizations.userId, compte.id),
            eq(authorizations.entityId, entityId),
            eq(authorizations.profileId, profileId),
          ),
        ),
    );

    return this.get(id);
  }

  /**
   * Verifie que l'entite et le profil vises sont accessibles a celui qui accorde.
   *
   * Sans cette verification, un administrateur d'une branche pourrait accorder
   * une habilitation sur une autre -- et s'y faire entrer en se l'accordant a
   * lui-meme. L'ecriture serait pourtant refusee par la politique ; ce controle
   * existe pour rendre un message clair plutot qu'un echec muet.
   */
  private async assertPeutHabiliter(habilitation: GrantAuthorization): Promise<void> {
    const context = requireContext();
    const accessibles = await this.scopes.authorizedEntities(context.userId);

    const dansLePerimetre = accessibles.some(
      (candidate) => candidate.entityId === habilitation.entityId,
    );

    if (!dansLePerimetre) {
      throw new ForbiddenException("Cette entite n'est pas dans votre perimetre.");
    }
  }

  /**
   * Refuse une action sur son propre compte.
   *
   * Se desactiver ou se supprimer soi-meme ferme la porte de l'interieur : sur
   * une installation a un seul administrateur, cela demande une intervention en
   * base pour se rouvrir.
   */
  private assertPasSoiMeme(userId: number, action: string): void {
    if (requireContext().userId === userId) {
      throw new BadRequestException(`Vous ne pouvez pas vous ${action} vous-meme.`);
    }
  }

  /** Habilitations visibles, par compte. */
  private async authorizationsFor(userIds: number[]): Promise<Map<number, Authorization[]>> {
    const parCompte = new Map<number, Authorization[]>();

    if (userIds.length === 0) return parCompte;

    const lignes = await this.db.asUser(async (tx) => {
      const resultat = await tx.execute<
        {
          userId: number;
          entityId: number;
          entityName: string;
          entityCompleteName: string;
          entityPath: string;
          entityParentId: number | null;
          profileId: number;
          profileName: string;
          isRecursive: boolean;
          isDynamic: boolean;
        } & Record<string, unknown>
      >(sql`
        SELECT
          authorizations.user_id  AS "userId",
          e.id             AS "entityId",
          e.name           AS "entityName",
          e.complete_name  AS "entityCompleteName",
          e.path::text     AS "entityPath",
          e.parent_id      AS "entityParentId",
          p.id             AS "profileId",
          p.name           AS "profileName",
          authorizations.is_recursive AS "isRecursive",
          authorizations.is_dynamic   AS "isDynamic"
        -- Sans alias sur la table des habilitations : inArray genere une
        -- reference qualifiee par le nom reel de la table, qu un alias
        -- rendrait introuvable pour PostgreSQL.
        FROM authorizations
        JOIN entities e ON e.id = authorizations.entity_id
        JOIN profiles p ON p.id = authorizations.profile_id
        -- inArray plutot que ANY : Drizzle developpe un tableau JavaScript
        -- en parametres separes, si bien que ANY recevrait un scalaire et que
        -- PostgreSQL refuserait « requires array on right side ».
        WHERE ${inArray(authorizations.userId, userIds)}
        ORDER BY "entityPath", "profileName"
      `);

      return resultat.rows;
    });

    for (const ligne of lignes) {
      const liste = parCompte.get(ligne.userId) ?? [];

      liste.push({
        entity: {
          id: ligne.entityId,
          name: ligne.entityName,
          completeName: ligne.entityCompleteName,
          path: ligne.entityPath,
          level: ligne.entityPath.split('.').length - 1,
          parentId: ligne.entityParentId,
        },
        profile: { id: ligne.profileId, name: ligne.profileName },
        isRecursive: ligne.isRecursive,
        isDynamic: ligne.isDynamic,
      });

      parCompte.set(ligne.userId, liste);
    }

    return parCompte;
  }
}
