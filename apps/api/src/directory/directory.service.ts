import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { sql } from '@flow/db';
import type { CreateDirectoryRule, DirectoryRule, UpdateDirectoryRule } from '@flow/contracts';
import { DatabaseService } from '../database/database.service.js';

interface LigneRegle extends Record<string, unknown> {
  id: number;
  groupName: string;
  isRecursive: boolean;
  createdAt: string;
  profileId: number;
  profileName: string;
  entityId: number;
  entityName: string;
  entityCompleteName: string;
  entityPath: string;
  entityParentId: number | null;
}

function versRegle(ligne: LigneRegle): DirectoryRule {
  return {
    id: ligne.id,
    groupName: ligne.groupName,
    isRecursive: ligne.isRecursive,
    createdAt: new Date(ligne.createdAt),
    profile: { id: ligne.profileId, name: ligne.profileName },
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

const PROJECTION = sql`
  SELECT r.id,
         r.group_name::text AS "groupName",
         r.is_recursive     AS "isRecursive",
         to_char(r.created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "createdAt",
         p.id   AS "profileId",
         p.name AS "profileName",
         e.id   AS "entityId",
         e.name AS "entityName",
         e.complete_name AS "entityCompleteName",
         e.path::text    AS "entityPath",
         e.parent_id     AS "entityParentId"
    FROM directory_rules r
    JOIN profiles p ON p.id = r.profile_id
    JOIN entities e ON e.id = r.entity_id
`;

/**
 * Les regles d'affectation.
 *
 * Tout passe par le role applicatif : la politique de `directory_rules` borne ce
 * qu'on voit et ce qu'on ecrit au perimetre de l'entite active. Ce n'est pas un
 * confort -- une regle est une **elevation de privileges differee**, qui
 * s'appliquera a la prochaine connexion de quelqu'un qu'on ne connait pas
 * encore. Sans cloisonnement, l'administrateur d'une filiale s'accorderait
 * l'administration du siege en posant une regle sur un groupe dont il fait
 * partie.
 */
@Injectable()
export class DirectoryRulesService {
  constructor(private readonly db: DatabaseService) {}

  async list(): Promise<DirectoryRule[]> {
    return this.db.asUser(async (tx) => {
      const resultat = await tx.execute<LigneRegle>(
        sql`${PROJECTION} ORDER BY r.group_name, e.complete_name`,
      );

      return resultat.rows.map(versRegle);
    });
  }

  async create(demande: CreateDirectoryRule): Promise<DirectoryRule> {
    return this.db.asUser(async (tx) => {
      const insere = await tx
        .execute<{ id: number }>(
          sql`
            INSERT INTO directory_rules (group_name, profile_id, entity_id, is_recursive)
            VALUES (${demande.groupName}, ${demande.profileId}, ${demande.entityId}, ${demande.isRecursive})
            RETURNING id
          `,
        )
        .catch((erreur: unknown) => {
          throw this.traduire(erreur);
        });

      const id = insere.rows[0]?.id;

      if (id === undefined) throw new BadRequestException("La regle n'a pas pu etre creee.");

      return this.exiger(tx, id);
    });
  }

  async update(id: number, demande: UpdateDirectoryRule): Promise<DirectoryRule> {
    return this.db.asUser(async (tx) => {
      const majs = [];

      if (demande.groupName !== undefined) majs.push(sql`group_name = ${demande.groupName}`);
      if (demande.profileId !== undefined) majs.push(sql`profile_id = ${demande.profileId}`);
      if (demande.entityId !== undefined) majs.push(sql`entity_id = ${demande.entityId}`);
      if (demande.isRecursive !== undefined) majs.push(sql`is_recursive = ${demande.isRecursive}`);

      if (majs.length > 0) {
        const modifiee = await tx
          .execute<{ id: number }>(
            sql`
              UPDATE directory_rules
                 SET ${sql.join(majs, sql`, `)}, updated_at = now()
               WHERE id = ${id}
               RETURNING id
            `,
          )
          .catch((erreur: unknown) => {
            throw this.traduire(erreur);
          });

        // Zero ligne : la regle n'existe pas, ou elle est hors perimetre. Les
        // deux se disent « introuvable » -- distinguer reviendrait a confirmer
        // l'existence d'une regle qu'on n'a pas le droit de voir.
        if (modifiee.rows.length === 0) throw new NotFoundException('Regle introuvable.');
      }

      return this.exiger(tx, id);
    });
  }

  async remove(id: number): Promise<void> {
    await this.db.asUser(async (tx) => {
      const supprimee = await tx.execute<{ id: number }>(
        sql`DELETE FROM directory_rules WHERE id = ${id} RETURNING id`,
      );

      if (supprimee.rows.length === 0) throw new NotFoundException('Regle introuvable.');

      // Les habilitations deja posees par cette regle ne sont pas retirees ici :
      // elles le seront a la prochaine connexion des comptes concernes, quand
      // les regles seront rejouees. Les retirer maintenant demanderait de savoir
      // lesquelles venaient de cette regle-ci -- une information que la table
      // des habilitations ne porte pas, et qu'il faudrait y ajouter pour un gain
      // de quelques heures.
    });
  }

  private async exiger(
    tx: Parameters<Parameters<DatabaseService['asUser']>[0]>[0],
    id: number,
  ): Promise<DirectoryRule> {
    const resultat = await tx.execute<LigneRegle>(sql`${PROJECTION} WHERE r.id = ${id}`);
    const ligne = resultat.rows[0];

    if (!ligne) throw new NotFoundException('Regle introuvable.');

    return versRegle(ligne);
  }

  /**
   * Traduit les refus de la base en refus lisibles.
   *
   * Une violation de la politique se presente comme une erreur de contrainte
   * illisible ; la laisser remonter telle quelle donnerait une 500 pour un
   * refus de perimetre parfaitement normal.
   */
  private traduire(erreur: unknown): Error {
    const code = (erreur as { code?: string }).code;

    if (code === '23505') {
      return new BadRequestException('Cette regle existe deja pour ce groupe.');
    }

    if (code === '42501' || code === '23514') {
      return new BadRequestException("Cette entite n'est pas dans votre perimetre.");
    }

    if (code === '23503') {
      return new BadRequestException("Ce profil ou cette entite n'existe pas.");
    }

    return erreur instanceof Error ? erreur : new Error(String(erreur));
  }
}
