import { and, createDatabase, entities, entitySettings, eq, inArray, sql } from '../index.js';
import type { Connection, EntityScope, RequestContext } from '../index.js';

/**
 * Arborescence de test, batie sous sa propre racine.
 *
 * Elle cohabite avec les donnees deja presentes au lieu de vider la base : les
 * tests restent rejouables sur un poste de developpement sans detruire ce avec
 * quoi on travaille. Chaque execution prefixe ses entites, et ne supprime que
 * les siennes.
 */
export interface Fixture {
  /** Role proprietaire : sert a semer, exempte du Row-Level Security. */
  owner: Connection;
  /** Role applicatif : celui que les tests interrogent, soumis aux politiques. */
  app: Connection;
  entityIds: Record<string, number>;
  paths: Record<string, string>;
  cleanup: () => Promise<void>;
}

function requireEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} est absent : les tests d'integration exigent une base reelle.`);
  }

  return value;
}

/**
 * Arbre bati par chaque fixture :
 *
 *   racine
 *   ├── nord
 *   │   ├── siteA
 *   │   └── siteB
 *   └── siege
 *
 * Deux niveaux sous la racine et deux soeurs : le minimum pour distinguer une
 * habilitation recursive d'une habilitation simple, et pour qu'une fuite
 * laterale ait quelque part ou fuir.
 */
export async function createFixture(prefix: string): Promise<Fixture> {
  const owner = createDatabase({ connectionString: requireEnv('DATABASE_URL'), max: 2 });
  const app = createDatabase({ connectionString: requireEnv('DATABASE_APP_URL'), max: 4 });

  const entityIds: Record<string, number> = {};
  const paths: Record<string, string> = {};

  const addEntity = async (key: string, name: string, parent: string | null): Promise<void> => {
    const [row] = await owner.db
      .insert(entities)
      .values({
        name: `${prefix} ${name}`,
        parentId: parent === null ? null : (entityIds[parent] ?? null),
        // `path` et `completeName` sont recalcules par le declencheur avant
        // l'ecriture : les valeurs posees ici ne servent qu'a satisfaire le
        // NOT NULL, et ne sont jamais celles qui atterrissent en base.
        path: 'temporaire',
        completeName: name,
      })
      .returning({ id: entities.id, path: entities.path });

    if (!row) throw new Error(`Creation de ${name} impossible.`);

    entityIds[key] = row.id;
    paths[key] = row.path;
  };

  await addEntity('racine', 'Racine', null);
  await addEntity('nord', 'Filiale Nord', 'racine');
  await addEntity('siteA', 'Site A', 'nord');
  await addEntity('siteB', 'Site B', 'nord');
  await addEntity('siege', 'Siege', 'racine');

  const cleanup = async (): Promise<void> => {
    const ids = Object.values(entityIds);

    if (ids.length > 0) {
      // Les reglages d'abord : la contrainte est en cascade, mais l'ordre
      // explicite survivra a un changement de cette contrainte.
      await owner.db.delete(entitySettings).where(inArray(entitySettings.entityId, ids));

      // Puis l'arbre, par les feuilles. La cle etrangere `parent_id` n'est pas
      // differee : une entite ne se supprime pas tant qu'un enfant la
      // reference, et un `DELETE` unique sur tout l'ensemble echouerait selon
      // l'ordre que choisit le planificateur -- donc par intermittence.
      //
      // On ne peut pas non plus trier un `DELETE` : `ORDER BY` n'y est pas
      // accepte. D'ou cette boucle, qui retire les feuilles jusqu'a ce qu'il
      // n'en reste plus. La profondeur de la fixture est de trois niveaux ; la
      // borne evite une boucle infinie si un cycle apparaissait un jour.
      for (let passe = 0; passe < 20; passe += 1) {
        const supprimees = await owner.db
          .delete(entities)
          .where(
            and(
              inArray(entities.id, ids),
              sql`NOT EXISTS (SELECT 1 FROM entities enfant WHERE enfant.parent_id = ${entities.id})`,
            ),
          )
          .returning({ id: entities.id });

        if (supprimees.length === 0) break;
      }
    }

    await Promise.all([owner.close(), app.close()]);
  };

  return { owner, app, entityIds, paths, cleanup };
}

/** Contexte d'une habilitation **simple** : l'entite seule, sans sa descendance. */
export function exactly(path: string, userId = 1, profileId = 1): RequestContext {
  return {
    userId,
    profileId,
    entityPath: path,
    scope: { subtreePaths: [], exactPaths: [path] },
  };
}

/** Contexte d'une habilitation **recursive** : l'entite et toute sa descendance. */
export function withSubtree(path: string, userId = 1, profileId = 1): RequestContext {
  return {
    userId,
    profileId,
    entityPath: path,
    scope: { subtreePaths: [path], exactPaths: [] },
  };
}

/** Contexte cumulant plusieurs habilitations, comme un compte a cheval sur deux branches. */
export function combining(entityPath: string, scope: EntityScope, userId = 1): RequestContext {
  return { userId, profileId: 1, entityPath, scope };
}

/**
 * Motif reel d'un refus, chaine de causes comprise.
 *
 * Drizzle enveloppe l'erreur de PostgreSQL dans une `DrizzleQueryError` dont le
 * message est « Failed query: ... » : le motif que la base a donne vit dans
 * `cause`. Une assertion posee sur le message de surface passerait donc pour
 * n'importe quel echec de requete, y compris une faute de frappe -- elle
 * verifierait que quelque chose casse, pas que le bon garde-fou a joue.
 */
export async function motifDuRefus(promesse: Promise<unknown>): Promise<string> {
  try {
    await promesse;
  } catch (erreur: unknown) {
    const messages: string[] = [];

    for (let courant: unknown = erreur; courant instanceof Error; courant = courant.cause) {
      messages.push(courant.message);
    }

    return messages.join(' | ');
  }

  throw new Error("L'operation a reussi alors qu'elle devait etre refusee.");
}

/**
 * Accede a une entite de la fixture, en refusant une cle absente.
 *
 * `noUncheckedIndexedAccess` type l'acces indexe en `number | undefined`, et une
 * assertion `as number` ferait taire le compilateur sans rien garantir : une
 * faute de frappe dans la cle passerait `undefined` a la requete, qui ne
 * modifierait aucune ligne -- et le test verifierait alors que rien ne se passe
 * quand rien ne se passe.
 */
export function entityId(fixture: Fixture, cle: string): number {
  const valeur = fixture.entityIds[cle];

  if (valeur === undefined) throw new Error(`Entite ${cle} absente de la fixture.`);

  return valeur;
}

/** Meme chose pour un chemin. */
export function entityPath(fixture: Fixture, cle: string): string {
  const valeur = fixture.paths[cle];

  if (valeur === undefined) throw new Error(`Chemin ${cle} absent de la fixture.`);

  return valeur;
}

/** Relit une entite avec le role proprietaire, hors de toute politique. */
export async function readAsOwner(fixture: Fixture, id: number) {
  const [row] = await fixture.owner.db
    .select({ id: entities.id, path: entities.path, completeName: entities.completeName })
    .from(entities)
    .where(eq(entities.id, id));

  return row;
}
