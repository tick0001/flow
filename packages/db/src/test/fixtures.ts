import {
  and,
  createDatabase,
  entities,
  entitySettings,
  eq,
  executionLogs,
  executions,
  inArray,
  profiles,
  sql,
  users,
} from '../index.js';
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
  /**
   * Un compte et un profil, pour satisfaire les cles etrangeres d'une execution.
   *
   * Ils n'ont aucun droit et ne servent a rien d'autre : ce que ces tests
   * eprouvent est le cloisonnement par entite, pas les habilitations -- qui sont
   * eprouvees cote API, ou elles sont decidees.
   */
  userId: number;
  profileId: number;
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

  const [compte] = await owner.db
    .insert(users)
    .values({ username: `${prefix}-compte`, passwordHash: 'sans-objet', authSource: 'local' })
    .returning({ id: users.id });

  const [profil] = await owner.db
    .insert(profiles)
    .values({ name: `${prefix} Profil` })
    .returning({ id: profiles.id });

  if (!compte || !profil) throw new Error('Creation du compte ou du profil impossible.');

  const cleanup = async (): Promise<void> => {
    const ids = Object.values(entityIds);

    if (ids.length > 0) {
      // Les executions avant les entites qu'elles referencent. Leurs journaux
      // partent en cascade -- une ligne de journal n'a aucun sens sans son
      // execution, ce qui est exactement ce que la cascade exprime.
      await owner.db.delete(executions).where(inArray(executions.entityId, ids));
    }

    await owner.db.delete(users).where(eq(users.id, compte.id));
    await owner.db.delete(profiles).where(eq(profiles.id, profil.id));

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

  return { owner, app, entityIds, paths, userId: compte.id, profileId: profil.id, cleanup };
}

/**
 * Sème une execution sur une entite, avec le role proprietaire.
 *
 * Semee hors politiques pour que le test porte sur la **lecture** : une
 * execution creee sous contexte prouverait seulement que le WITH CHECK accepte
 * ce qui est dans le perimetre, et laisserait inexplore ce qu'une autre branche
 * en voit.
 */
export async function seedExecution(
  fixture: Fixture,
  entityKey: string,
  botId = 'essai.bot',
): Promise<string> {
  const [ligne] = await fixture.owner.db
    .insert(executions)
    .values({
      botId,
      botName: 'Essai',
      botVersion: '1.0.0',
      entityId: entityId(fixture, entityKey),
      requestedBy: fixture.userId,
      profileId: fixture.profileId,
    })
    .returning({ id: executions.id });

  if (!ligne) throw new Error(`Creation d'une execution sur ${entityKey} impossible.`);

  await fixture.owner.db.insert(executionLogs).values({
    executionId: ligne.id,
    seq: 0,
    level: 'info',
    message: `Journal de ${entityKey}`,
  });

  return ligne.id;
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
