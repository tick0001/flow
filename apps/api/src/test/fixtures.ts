import {
  authorizations,
  createDatabase,
  entities,
  inArray,
  profileRights,
  profiles,
  sql,
  users,
  type Connection,
} from '@flow/db';
import { DatabaseService } from '../database/database.service.js';
import { PasswordService } from '../auth/password.service.js';
import { ScopeService } from '../auth/scope.service.js';
import { UsersService } from '../admin/users.service.js';
import { ProfilesService } from '../admin/profiles.service.js';
import { RightsService } from '../auth/rights.service.js';
import { RightsCatalogService } from '../admin/rights-catalog.service.js';
import type { FlowContext } from '../common/request-context.js';

/**
 * Services assembles a la main, sans conteneur d'injection.
 *
 * NestJS n'apporte rien ici : ce qu'on veut eprouver, ce sont des requetes
 * contre une vraie base, pas un cablage de modules. Les monter directement rend
 * aussi visible ce dont chaque service depend reellement -- une information que
 * le conteneur masque.
 */
export interface Fixture {
  owner: Connection;
  app: Connection;
  db: DatabaseService;
  usersService: UsersService;
  profilesService: ProfilesService;
  entityIds: Record<string, number>;
  paths: Record<string, string>;
  profileIds: Record<string, number>;
  userIds: Record<string, number>;
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
 * Deux branches, deux profils, trois comptes :
 *
 *   racine        <- « patronne » (Administration, recursive)
 *   ├── nord      <- « locale » (Administration locale, recursive)
 *   └── siege     <- « ailleurs » (Observation)
 *
 * C'est le minimum pour que la question interessante ait un sens : « locale »
 * doit voir « locale », et ni « patronne » ni « ailleurs ».
 */
export async function createFixture(prefix: string): Promise<Fixture> {
  const owner = createDatabase({ connectionString: requireEnv('DATABASE_URL'), max: 2 });
  const app = createDatabase({ connectionString: requireEnv('DATABASE_APP_URL'), max: 4 });

  const db = new DatabaseService(app.db, owner.db, { owner, app });
  const scopes = new ScopeService(db);
  const rights = new RightsService(db);
  const catalogue = new RightsCatalogService();
  const usersService = new UsersService(db, new PasswordService(), scopes);
  const profilesService = new ProfilesService(db, catalogue, rights);

  const entityIds: Record<string, number> = {};
  const paths: Record<string, string> = {};
  const profileIds: Record<string, number> = {};
  const userIds: Record<string, number> = {};

  const addEntity = async (cle: string, nom: string, parent: string | null): Promise<void> => {
    const [ligne] = await owner.db
      .insert(entities)
      .values({
        name: `${prefix} ${nom}`,
        parentId: parent === null ? null : (entityIds[parent] ?? null),
        path: 'temporaire',
        completeName: nom,
      })
      .returning({ id: entities.id, path: entities.path });

    if (!ligne) throw new Error(`Creation de ${nom} impossible.`);

    entityIds[cle] = ligne.id;
    paths[cle] = ligne.path;
  };

  const addProfile = async (cle: string, nom: string): Promise<void> => {
    const [ligne] = await owner.db
      .insert(profiles)
      .values({ name: `${prefix} ${nom}` })
      .returning({ id: profiles.id });

    if (!ligne) throw new Error(`Creation du profil ${nom} impossible.`);

    profileIds[cle] = ligne.id;
  };

  const addUser = async (
    cle: string,
    identifiant: string,
    profil: string,
    entite: string,
    recursif: boolean,
  ): Promise<void> => {
    const [ligne] = await owner.db
      .insert(users)
      .values({
        username: `${prefix}-${identifiant}`,
        passwordHash: 'sans-objet',
        authSource: 'local',
        isActive: true,
      })
      .returning({ id: users.id });

    if (!ligne) throw new Error(`Creation du compte ${identifiant} impossible.`);

    userIds[cle] = ligne.id;

    await owner.db.insert(authorizations).values({
      userId: ligne.id,
      profileId: profileIds[profil] ?? 0,
      entityId: entityIds[entite] ?? 0,
      isRecursive: recursif,
      isDynamic: false,
    });
  };

  await addEntity('racine', 'Racine', null);
  await addEntity('nord', 'Nord', 'racine');
  await addEntity('siege', 'Siege', 'racine');

  await addProfile('admin', 'Administration');
  await addProfile('locale', 'Administration locale');

  await addUser('patronne', 'patronne', 'admin', 'racine', true);
  await addUser('locale', 'locale', 'locale', 'nord', true);
  await addUser('ailleurs', 'ailleurs', 'locale', 'siege', false);

  const cleanup = async (): Promise<void> => {
    const comptes = Object.values(userIds);
    const profils = Object.values(profileIds);
    const arbre = Object.values(entityIds);

    if (comptes.length > 0) {
      await owner.db.delete(authorizations).where(inArray(authorizations.userId, comptes));
      await owner.db.delete(users).where(inArray(users.id, comptes));
    }

    if (profils.length > 0) {
      await owner.db.delete(profileRights).where(inArray(profileRights.profileId, profils));
      await owner.db.delete(profiles).where(inArray(profiles.id, profils));
    }

    if (arbre.length > 0) {
      // Par les feuilles : la cle etrangere `parent_id` n'est pas differee.
      for (let passe = 0; passe < 20; passe += 1) {
        const supprimees = await owner.db
          .delete(entities)
          .where(
            sql`${inArray(entities.id, arbre)} AND NOT EXISTS (SELECT 1 FROM entities enfant WHERE enfant.parent_id = ${entities.id})`,
          )
          .returning({ id: entities.id });

        if (supprimees.length === 0) break;
      }
    }

    await Promise.all([owner.close(), app.close()]);
  };

  return {
    owner,
    app,
    db,
    usersService,
    profilesService,
    entityIds,
    paths,
    profileIds,
    userIds,
    cleanup,
  };
}

/** Contexte de travail d'un compte de la fixture, sur son entite, recursif ou non. */
export function contexteDe(
  fixture: Fixture,
  compte: string,
  entite: string,
  profil: string,
  recursif: boolean,
): FlowContext {
  const userId = fixture.userIds[compte];
  const profileId = fixture.profileIds[profil];
  const entityId = fixture.entityIds[entite];
  const entityPath = fixture.paths[entite];

  if (
    userId === undefined ||
    profileId === undefined ||
    entityId === undefined ||
    entityPath === undefined
  ) {
    throw new Error('Fixture incomplete.');
  }

  return {
    sessionId: '00000000-0000-0000-0000-000000000000',
    userId,
    profileId,
    entityId,
    entityPath,
    includeSubEntities: recursif,
    locale: 'fr',
    mustChangePassword: false,
    scope: recursif
      ? { subtreePaths: [entityPath], exactPaths: [] }
      : { subtreePaths: [], exactPaths: [entityPath] },
  };
}
