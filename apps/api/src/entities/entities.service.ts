import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { EntityRef } from '@flow/contracts';
import { asc, entities, eq, isNull, and, sql } from '@flow/db';
import { DatabaseService } from '../database/database.service.js';

export interface CreateEntity {
  name: string;
  parentId: number | null;
  comment?: string | null | undefined;
}

function toRef(ligne: {
  id: number;
  name: string;
  completeName: string;
  path: string;
  level: number;
  parentId: number | null;
}): EntityRef {
  return {
    id: ligne.id,
    name: ligne.name,
    completeName: ligne.completeName,
    path: ligne.path,
    level: ligne.level,
    parentId: ligne.parentId,
  };
}

@Injectable()
export class EntitiesService {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Les entites visibles depuis le contexte courant, dans l'ordre de l'arbre.
   *
   * Aucun filtre d'entite n'est ecrit ici, et c'est le point : le perimetre vient
   * des politiques de Row-Level Security, alimentees par la transaction. Un
   * filtre applicatif en plus serait une seconde verite, qui finirait par
   * diverger de la premiere.
   *
   * Le tri sur `path` donne l'ordre de parcours de l'arbre : un parent precede
   * toujours ses enfants, et les fratries se suivent.
   */
  async list(): Promise<EntityRef[]> {
    const lignes = await this.db.asUser((tx) =>
      tx
        .select({
          id: entities.id,
          name: entities.name,
          completeName: entities.completeName,
          path: entities.path,
          level: entities.level,
          parentId: entities.parentId,
        })
        .from(entities)
        .where(isNull(entities.deletedAt))
        .orderBy(asc(entities.path)),
    );

    return lignes.map(toRef);
  }

  async get(id: number): Promise<EntityRef> {
    const [ligne] = await this.db.asUser((tx) =>
      tx
        .select({
          id: entities.id,
          name: entities.name,
          completeName: entities.completeName,
          path: entities.path,
          level: entities.level,
          parentId: entities.parentId,
        })
        .from(entities)
        .where(and(eq(entities.id, id), isNull(entities.deletedAt))),
    );

    // Invisible et inexistante rendent la meme reponse : distinguer les deux
    // confirmerait l'existence d'une entite d'une autre organisation.
    if (!ligne) throw new NotFoundException("Cette entite n'existe pas.");

    return toRef(ligne);
  }

  /**
   * Cree une entite sous un parent visible.
   *
   * Le chemin, le niveau et le nom complet sont poses par le declencheur, pas
   * ici : les valeurs fournies ne servent qu'a satisfaire les contraintes
   * NOT NULL et sont ecrasees avant l'ecriture.
   */
  async create(donnees: CreateEntity): Promise<EntityRef> {
    if (donnees.parentId === null) {
      // Creer une racine reviendrait a creer une organisation a cote de toutes
      // les autres, hors de tout perimetre : personne ne la verrait, pas meme
      // son auteur. La racine est posee une fois, par l'amorcage.
      throw new BadRequestException(
        "Une entite racine ne se cree pas depuis l'application : utilisez l'initialisation.",
      );
    }

    const [creee] = await this.db.asUser((tx) =>
      tx
        .insert(entities)
        .values({
          name: donnees.name,
          parentId: donnees.parentId,
          comment: donnees.comment ?? null,
          path: 'temporaire',
          completeName: donnees.name,
        })
        .returning({
          id: entities.id,
          name: entities.name,
          completeName: entities.completeName,
          path: entities.path,
          level: entities.level,
          parentId: entities.parentId,
        }),
    );

    if (!creee) throw new BadRequestException("L'entite n'a pas pu etre creee.");

    return toRef(creee);
  }

  async update(
    id: number,
    donnees: { name?: string | undefined; comment?: string | null | undefined },
  ): Promise<EntityRef> {
    await this.get(id);

    await this.db.asUser((tx) =>
      tx
        .update(entities)
        .set({
          ...(donnees.name === undefined ? {} : { name: donnees.name }),
          ...(donnees.comment === undefined ? {} : { comment: donnees.comment }),
        })
        .where(eq(entities.id, id)),
    );

    return this.get(id);
  }

  /**
   * Retire une entite, si elle est vide.
   *
   * Suppression logique : `deletedAt` la retire des listes sans effacer les
   * executions passees qui la referencent. Une suppression physique casserait
   * l'historique, qui est precisement ce que l'outil existe pour garder.
   */
  async remove(id: number): Promise<void> {
    await this.get(id);

    const [enfant] = await this.db.asUser((tx) =>
      tx
        .select({ id: entities.id })
        .from(entities)
        .where(and(eq(entities.parentId, id), isNull(entities.deletedAt)))
        .limit(1),
    );

    if (enfant) {
      throw new BadRequestException("Cette entite porte des sous-entites : supprimez-les d'abord.");
    }

    await this.db.asUser((tx) =>
      tx
        .update(entities)
        .set({ deletedAt: sql`now()` })
        .where(eq(entities.id, id)),
    );
  }
}
