import { hash } from '@node-rs/argon2';
import {
  authorizations,
  createDatabase,
  entities,
  profileRights,
  profiles,
  sql,
  users,
} from '@flow/db';
import { loadEnv, loadEnvFiles } from '../config/env.js';
import type { RightScope } from '@flow/contracts';

const ARGON2ID = 2;

/**
 * Droits accordes au profil d'administration.
 *
 * `all` partout : c'est le profil qui doit pouvoir tout reparer, y compris se
 * redonner des droits. La portee reste combinee a l'entite active -- « tout »
 * signifie « tout ce que le perimetre de travail laisse voir », jamais « toute
 * l'installation ».
 */
const DROITS_ADMINISTRATION: [objet: string, action: string, portee: RightScope][] = [
  ['entity', 'read', 'all'],
  ['entity', 'create', 'all'],
  ['entity', 'update', 'all'],
  ['entity', 'delete', 'all'],
  ['user', 'read', 'all'],
  ['user', 'create', 'all'],
  ['user', 'update', 'all'],
  ['user', 'delete', 'all'],
  ['profile', 'read', 'all'],
  ['profile', 'create', 'all'],
  ['profile', 'update', 'all'],
  ['profile', 'delete', 'all'],
];

/**
 * Droits du profil d'observation.
 *
 * Cree en meme temps que l'administration, et volontairement : une installation
 * qui ne propose qu'un profil pousse a donner l'administration a tout le monde,
 * faute d'alternative sous la main au moment ou l'on cree le deuxieme compte.
 */
const DROITS_OBSERVATION: [objet: string, action: string, portee: RightScope][] = [
  ['entity', 'read', 'entity'],
];

/**
 * Amorce une installation vierge : une entite racine, deux profils, un compte
 * d'administration.
 *
 * Distinct d'un jeu de demonstration, qui vide la base : celui-ci ne cree que le
 * strict minimum, et refuse de s'executer si quelque chose existe deja.
 *
 * Le mot de passe vient de l'environnement et le compte est marque « a changer a
 * la premiere connexion ». Le poser en dur -- ce que faisait BotManager avec
 * `admin`/`admin123` -- ouvre toute installation dont l'exploitant n'a pas lu la
 * documentation jusqu'au bout.
 */
async function main(): Promise<void> {
  loadEnvFiles();
  const env = loadEnv();

  const motDePasse = process.env['FLOW_ADMIN_PASSWORD'];
  const identifiant = process.env['FLOW_ADMIN_USERNAME'] ?? 'admin';

  if (!motDePasse || motDePasse.length < 12) {
    throw new Error(
      'FLOW_ADMIN_PASSWORD est absent ou trop court (douze caracteres au minimum).\n' +
        "Exemple : FLOW_ADMIN_PASSWORD='...' node dist/cli/initialiser.js",
    );
  }

  const { db, close } = createDatabase({ connectionString: env.DATABASE_URL, max: 2 });

  try {
    await db.transaction(async (tx) => {
      const dejaLa = await tx.select({ id: users.id }).from(users).limit(1);

      if (dejaLa.length > 0) {
        throw new Error(
          "Cette base porte deja des comptes : l'initialisation refuse de s'executer.\n" +
            'Pour repartir de zero, videz la base puis rejouez les migrations.',
        );
      }

      const [racine] = await tx
        .insert(entities)
        .values({ name: 'Racine', parentId: null, path: 'temporaire', completeName: 'Racine' })
        .returning({ id: entities.id, path: entities.path });

      if (!racine) throw new Error("L'entite racine n'a pas pu etre creee.");

      const [administration] = await tx
        .insert(profiles)
        .values({ name: 'Administration', isDefault: false, comment: 'Tous les droits.' })
        .returning({ id: profiles.id });

      const [observation] = await tx
        .insert(profiles)
        .values({
          name: 'Observation',
          isDefault: true,
          comment: 'Lecture seule sur l’entité active.',
        })
        .returning({ id: profiles.id });

      if (!administration || !observation) throw new Error('Les profils n’ont pas pu être créés.');

      await tx.insert(profileRights).values([
        ...DROITS_ADMINISTRATION.map(([object, action, scope]) => ({
          profileId: administration.id,
          object,
          action,
          scope,
        })),
        ...DROITS_OBSERVATION.map(([object, action, scope]) => ({
          profileId: observation.id,
          object,
          action,
          scope,
        })),
      ]);

      const [compte] = await tx
        .insert(users)
        .values({
          username: identifiant,
          passwordHash: await hash(motDePasse, { algorithm: ARGON2ID }),
          authSource: 'local',
          isActive: true,
          // Le mot de passe a transite par une variable d'environnement, donc
          // par l'historique d'un shell et par les journaux d'un orchestrateur.
          mustChangePassword: true,
          defaultEntityId: racine.id,
        })
        .returning({ id: users.id });

      if (!compte) throw new Error("Le compte d'administration n'a pas pu etre cree.");

      await tx.insert(authorizations).values({
        userId: compte.id,
        profileId: administration.id,
        entityId: racine.id,
        // Recursive : sans cela l'administrateur ne verrait pas les entites
        // qu'il vient de creer sous la racine.
        isRecursive: true,
        isDynamic: false,
      });

      // La racine porte les valeurs par defaut dont toute la descendance
      // heritera tant qu'elle ne les redefinit pas.
      await tx.execute(sql`
        INSERT INTO entity_settings (entity_id, default_locale, execution_retention_days, concurrent_execution_limit)
        VALUES (${racine.id}, ${env.DEFAULT_LOCALE}, 90, 3)
      `);
    });

    console.log(
      `Installation initialisee.\n` +
        `  Entite racine : Racine\n` +
        `  Profils       : Administration, Observation\n` +
        `  Compte        : ${identifiant} (changement de mot de passe impose a la premiere connexion)`,
    );
  } finally {
    await close();
  }
}

main().catch((erreur: unknown) => {
  console.error(erreur instanceof Error ? erreur.message : erreur);
  process.exitCode = 1;
});
