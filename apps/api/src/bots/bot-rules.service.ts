import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { sql } from '@flow/db';
import type { BotRule, CreateBotRule } from '@flow/contracts';
import { DatabaseService } from '../database/database.service.js';

interface LigneRegle extends Record<string, unknown> {
  id: number;
  botId: string;
  isRecursive: boolean;
  createdAt: string;
  profileId: number | null;
  profileName: string | null;
  entityId: number;
  entityName: string;
  entityCompleteName: string;
  entityPath: string;
  entityParentId: number | null;
}

function versRegle(ligne: LigneRegle): BotRule {
  return {
    id: ligne.id,
    botId: ligne.botId,
    isRecursive: ligne.isRecursive,
    createdAt: new Date(ligne.createdAt),
    profile:
      ligne.profileId === null || ligne.profileName === null
        ? null
        : { id: ligne.profileId, name: ligne.profileName },
    entity: {
      id: ligne.entityId,
      name: ligne.entityName,
      completeName: ligne.entityCompleteName,
      path: ligne.entityPath,
      level: ligne.entityPath.split('.').length - 1,
      parentId: ligne.entityParentId,
    },
  };
}

/**
 * Code SQLSTATE d'un refus de PostgreSQL.
 *
 * Drizzle enveloppe l'erreur du pilote dans une `DrizzleQueryError` qui ne
 * reprend pas son `code` : le lire sur l'objet de tete rend `undefined`, et tout
 * refus de contrainte devient une 500 au lieu du 400 qu'il devrait etre. Il faut
 * descendre dans `cause`.
 */
function codeSql(erreur: unknown): string | undefined {
  const direct = (erreur as { code?: string }).code;

  if (direct !== undefined) return direct;

  const cause = (erreur as { cause?: unknown }).cause;

  return cause === undefined ? undefined : (cause as { code?: string }).code;
}

const PROJECTION = sql`
  SELECT r.id,
         r.bot_id       AS "botId",
         r.is_recursive AS "isRecursive",
         to_char(r.created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "createdAt",
         r.profile_id   AS "profileId",
         p.name         AS "profileName",
         e.id   AS "entityId",
         e.name AS "entityName",
         e.complete_name AS "entityCompleteName",
         e.path::text    AS "entityPath",
         e.parent_id     AS "entityParentId"
    FROM bot_rules r
    JOIN entities e ON e.id = r.entity_id
    LEFT JOIN profiles p ON p.id = r.profile_id
`;

/**
 * Les regles de mise a disposition des bots.
 *
 * Deux usages, et deux roles de base distincts. Ce n'est pas un detail
 * d'implementation : l'un des deux se tromperait silencieusement.
 *
 *  - **La gestion** -- lister, poser, retirer -- passe par le role applicatif,
 *    donc par la politique de `bot_rules` : l'administrateur d'une branche ne
 *    voit et ne pose que les regles de sa branche. Une regle de bot decide quel
 *    code s'executera chez qui, et l'ouvrir a la branche du voisin doit lui
 *    etre refuse.
 *
 *  - **La resolution** -- ce bot est-il ouvert ici ? -- passe par le role
 *    proprietaire, et doit y passer. Une regle posee sur la racine, recursive,
 *    ouvre le bot a toute l'installation ; quelqu'un qui travaille trois niveaux
 *    plus bas ne voit pas cette ligne-la, puisqu'elle est au-dessus de son
 *    perimetre. Resoudre sous le role applicatif conclurait donc « ferme » pour
 *    exactement les bots ouverts le plus largement. C'est un calcul de droit, au
 *    meme titre que la resolution du perimetre, et les calculs de droit lisent
 *    au-dessus de soi.
 */
@Injectable()
export class BotRulesService {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Les bots ouverts a ce profil, dans cette entite.
   *
   * **L'entite active, et non le perimetre de travail.** Une execution nait dans
   * l'entite active : un bot ouvert seulement sur une entite fille ne doit pas
   * etre proposable depuis le parent, ou son lancement creerait une trace dans
   * une entite ou il n'est pas ouvert.
   */
  async disponibles(profileId: number, entityPath: string): Promise<Set<string>> {
    return this.db.asOwner(async (tx) => {
      const resultat = await tx.execute<{ botId: string }>(sql`
        SELECT DISTINCT r.bot_id AS "botId"
          FROM bot_rules r
          JOIN entities e ON e.id = r.entity_id
         WHERE (r.profile_id IS NULL OR r.profile_id = ${profileId})
           AND (
                 e.path = ${entityPath}::ltree
              OR (r.is_recursive AND e.path @> ${entityPath}::ltree)
               )
           AND e.deleted_at IS NULL
      `);

      return new Set(resultat.rows.map((ligne) => ligne.botId));
    });
  }

  /** Le meme calcul, pour un seul bot. */
  async estDisponible(botId: string, profileId: number, entityPath: string): Promise<boolean> {
    const ouverts = await this.disponibles(profileId, entityPath);

    return ouverts.has(botId);
  }

  async list(): Promise<BotRule[]> {
    return this.db.asUser(async (tx) => {
      const resultat = await tx.execute<LigneRegle>(
        sql`${PROJECTION} ORDER BY r.bot_id, e.complete_name, p.name NULLS FIRST`,
      );

      return resultat.rows.map(versRegle);
    });
  }

  async create(demande: CreateBotRule): Promise<BotRule> {
    return this.db.asUser(async (tx) => {
      const insere = await tx
        .execute<{ id: number }>(
          sql`
            INSERT INTO bot_rules (bot_id, entity_id, is_recursive, profile_id)
            VALUES (
              ${demande.botId},
              ${demande.entityId},
              ${demande.isRecursive},
              ${demande.profileId ?? null}
            )
            RETURNING id
          `,
        )
        .catch((erreur: unknown) => {
          throw this.traduire(erreur);
        });

      const id = insere.rows[0]?.id;

      if (id === undefined) throw new BadRequestException("La regle n'a pas pu etre creee.");

      const resultat = await tx.execute<LigneRegle>(sql`${PROJECTION} WHERE r.id = ${id}`);
      const ligne = resultat.rows[0];

      if (!ligne) throw new NotFoundException('Regle introuvable.');

      return versRegle(ligne);
    });
  }

  async remove(id: number): Promise<void> {
    await this.db.asUser(async (tx) => {
      const supprimee = await tx.execute<{ id: number }>(
        sql`DELETE FROM bot_rules WHERE id = ${id} RETURNING id`,
      );

      // Zero ligne : la regle n'existe pas, ou elle est hors perimetre. Les deux
      // se disent « introuvable » -- distinguer reviendrait a confirmer
      // l'existence d'une regle qu'on n'a pas le droit de voir.
      if (supprimee.rows.length === 0) throw new NotFoundException('Regle introuvable.');
    });
  }

  /**
   * Traduit les refus de PostgreSQL en refus lisibles.
   *
   * Deux contraintes peuvent mordre, et ni l'une ni l'autre n'est une erreur de
   * l'appelant au sens ou il faudrait la journaliser : ce sont des doublons et
   * des entites hors perimetre.
   */
  private traduire(erreur: unknown): Error {
    const code = codeSql(erreur);

    if (code === '23505') {
      return new BadRequestException('Cette regle existe deja.');
    }

    // 23514 : violation de la clause WITH CHECK de la politique, c'est-a-dire
    // une entite hors du perimetre de travail. 42501 le dit aussi selon la voie.
    if (code === '23514' || code === '42501') {
      return new BadRequestException("Cette entite n'est pas dans votre perimetre.");
    }

    if (code === '23503') {
      return new BadRequestException("L'entite ou le profil vise n'existe pas.");
    }

    return erreur as Error;
  }
}
