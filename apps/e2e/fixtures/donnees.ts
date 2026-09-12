import './env.js';
import { hash } from '@node-rs/argon2';
import { createDatabase, sql, type Connection } from '@flow/db';

/**
 * Le jeu de donnees des parcours.
 *
 * Pose **par la base**, avec le role proprietaire, et non par l'API. Deux
 * raisons : il n'y a alors aucun mot de passe d'administration a poser dans un
 * fichier d'environnement pour que les parcours tournent, et le jeu est pret en
 * quelques requetes plutot qu'en une dizaine d'appels HTTP.
 *
 * Ce qui est eprouve, lui, passe integralement par le navigateur et par l'API.
 * La fixture n'est que le decor.
 *
 * Deux branches et trois comptes, comme pour les tests d'integration : c'est le
 * minimum pour que la question du cloisonnement ait un sens.
 *
 *   PARCOURS Racine      <- « patronne » (tous les droits, recursif)
 *   ├── PARCOURS Nord    <- « nord » (operateur, sa branche)
 *   └── PARCOURS Sud     <- « sud » (operateur, sa branche)
 */

/** Argon2id : valeur 2 de l'enumeration `Algorithm`, reprise comme dans l'API. */
const ARGON2ID = 2;

/** Prefixe de tout ce que les parcours creent, pour tout retrouver et tout rendre. */
export const PREFIXE = 'PARCOURS';

/**
 * Mots de passe des comptes du decor.
 *
 * Ecrits ici, et c'est sans consequence : ces comptes naissent au debut d'une
 * campagne et disparaissent a la fin, sur une base de developpement. Les tirer
 * au hasard les rendrait seulement plus penibles a reprendre a la main quand un
 * parcours echoue et qu'on veut aller voir.
 */
export const MOT_DE_PASSE = 'parcours-flow-2026';

export interface Decor {
  entites: Record<
    'racine' | 'nord' | 'sud',
    { id: number; path: string; name: string; completeName: string }
  >;
  profils: Record<'tous' | 'operateur', number>;
  comptes: Record<'patronne' | 'nord' | 'sud', { id: number; username: string }>;
  /** Cree a la demande un compte valide mais habilite nulle part. */
  creerCompteSansHabilitation: () => Promise<string>;
  fermer: () => Promise<void>;
}

function requis(nom: string): string {
  const valeur = process.env[nom];

  if (!valeur) throw new Error(`${nom} est absent : les parcours exigent une base reelle.`);

  return valeur;
}

/**
 * Pose le decor, apres avoir efface celui d'une campagne precedente.
 *
 * L'effacement en entree plutot qu'en sortie seulement : une campagne
 * interrompue -- par un `Ctrl-C`, par une panne -- laisse ses lignes derriere
 * elle, et la campagne suivante echouerait alors sur un doublon d'identifiant.
 */
export async function poserLeDecor(): Promise<Decor> {
  const connexion = createDatabase({ connectionString: requis('DATABASE_URL'), max: 2 });

  await effacer(connexion);

  const entites: Decor['entites'] = {
    racine: await creerEntite(connexion, 'Racine', null),
    // Remplaces juste apres : une entite fille exige l'identifiant de sa mere,
    // que l'objet litteral ne peut pas encore nommer.
    nord: { id: 0, path: '', name: '', completeName: '' },
    sud: { id: 0, path: '', name: '', completeName: '' },
  };

  entites.nord = await creerEntite(connexion, 'Nord', entites.racine.id);
  entites.sud = await creerEntite(connexion, 'Sud', entites.racine.id);

  const profils: Decor['profils'] = {
    tous: await creerProfil(connexion, 'Tous les droits', [
      ['entity', 'read', 'recursive'],
      ['bot', 'read', 'all'],
      ['bot', 'execute', 'all'],
      ['execution', 'read', 'recursive'],
      ['execution', 'cancel', 'recursive'],
      ['schedule', 'read', 'recursive'],
      ['schedule', 'create', 'recursive'],
      ['schedule', 'update', 'recursive'],
      ['schedule', 'delete', 'recursive'],
    ]),
    operateur: await creerProfil(connexion, 'Operateur', [
      ['entity', 'read', 'entity'],
      ['bot', 'read', 'all'],
      ['bot', 'execute', 'all'],
      ['execution', 'read', 'entity'],
      ['schedule', 'read', 'entity'],
      ['schedule', 'create', 'entity'],
      ['schedule', 'update', 'entity'],
      ['schedule', 'delete', 'entity'],
    ]),
  };

  // **Sans regle, aucun bot n'est propose.** Le decor ouvre le bot de reference
  // a toute la branche du decor, pour tous les profils : c'est le point de
  // depart le plus large, et les parcours qui eprouvent le cloisonnement le font
  // sur les executions, pas sur la mise a disposition.
  await connexion.db.execute(sql`
    INSERT INTO bot_rules (bot_id, entity_id, is_recursive, profile_id)
    VALUES ('exemple.bonjour', ${entites.racine.id}, true, NULL)
    ON CONFLICT DO NOTHING
  `);

  const comptes: Decor['comptes'] = {
    patronne: await creerCompte(connexion, 'patronne', profils.tous, entites.racine.id, true),
    nord: await creerCompte(connexion, 'nord', profils.operateur, entites.nord.id, false),
    sud: await creerCompte(connexion, 'sud', profils.operateur, entites.sud.id, false),
  };

  return {
    entites,
    profils,
    comptes,
    creerCompteSansHabilitation: async () => {
      const username = `${PREFIXE.toLowerCase()}-orphelin`;
      const condensat = await hash(MOT_DE_PASSE, { algorithm: ARGON2ID });

      await connexion.db.execute(sql`
        INSERT INTO users (username, password_hash, auth_source, is_active)
        VALUES (${username}, ${condensat}, 'local', true)
        ON CONFLICT (username) DO NOTHING
      `);

      return username;
    },
    fermer: async () => {
      await effacer(connexion);
      await connexion.close();
    },
  };
}

async function creerEntite(
  connexion: Connection,
  nom: string,
  parent: number | null,
): Promise<{ id: number; path: string; name: string; completeName: string }> {
  // `complete_name` est recalcule par un declencheur a partir de l'arbre : il
  // est relu ici plutot que suppose, sinon le decor annoncerait le nom court
  // qu'on vient d'ecrire et les parcours chercheraient un libelle qui n'existe
  // nulle part a l'ecran.
  const resultat = await connexion.db.execute<{
    id: number;
    path: string;
    name: string;
    completeName: string;
  }>(sql`
    INSERT INTO entities (name, parent_id, path, complete_name)
    VALUES (${`${PREFIXE} ${nom}`}, ${parent}, 'temporaire', ${nom})
    RETURNING id, path::text AS path, name, complete_name AS "completeName"
  `);

  const ligne = resultat.rows[0];

  if (!ligne) throw new Error(`Entite ${nom} non creee.`);

  return ligne;
}

async function creerProfil(
  connexion: Connection,
  nom: string,
  droits: [string, string, string][],
): Promise<number> {
  const resultat = await connexion.db.execute<{ id: number }>(sql`
    INSERT INTO profiles (name) VALUES (${`${PREFIXE} ${nom}`}) RETURNING id
  `);

  const id = resultat.rows[0]?.id;

  if (id === undefined) throw new Error(`Profil ${nom} non cree.`);

  for (const [objet, action, portee] of droits) {
    await connexion.db.execute(sql`
      INSERT INTO profile_rights (profile_id, object, action, scope)
      VALUES (${id}, ${objet}, ${action}, ${portee}::right_scope)
    `);
  }

  return id;
}

async function creerCompte(
  connexion: Connection,
  identifiant: string,
  profil: number,
  entite: number,
  recursif: boolean,
): Promise<{ id: number; username: string }> {
  const username = `${PREFIXE.toLowerCase()}-${identifiant}`;
  const condensat = await hash(MOT_DE_PASSE, { algorithm: ARGON2ID });

  const resultat = await connexion.db.execute<{ id: number }>(sql`
    INSERT INTO users (username, password_hash, auth_source, is_active, default_entity_id)
    VALUES (${username}, ${condensat}, 'local', true, ${entite})
    RETURNING id
  `);

  const id = resultat.rows[0]?.id;

  if (id === undefined) throw new Error(`Compte ${identifiant} non cree.`);

  await connexion.db.execute(sql`
    INSERT INTO authorizations (user_id, profile_id, entity_id, is_recursive, is_dynamic)
    VALUES (${id}, ${profil}, ${entite}, ${recursif}, false)
  `);

  return { id, username };
}

/**
 * Efface tout ce que le prefixe designe.
 *
 * L'ordre suit les cles etrangeres, des feuilles vers la racine. Les executions
 * partent avant les entites, faute de quoi la suppression d'une entite echoue
 * sur une execution qui la reference -- et la campagne suivante trouverait un
 * decor a moitie efface.
 */
async function effacer(connexion: Connection): Promise<void> {
  const motif = `${PREFIXE}%`;
  const comptes = sql`SELECT id FROM users WHERE username LIKE ${`${PREFIXE.toLowerCase()}-%`}`;
  const entites = sql`SELECT id FROM entities WHERE name LIKE ${motif}`;

  await connexion.db.execute(sql`DELETE FROM schedules WHERE entity_id IN (${entites})`);
  await connexion.db.execute(sql`DELETE FROM executions WHERE entity_id IN (${entites})`);
  await connexion.db.execute(sql`DELETE FROM api_keys WHERE entity_id IN (${entites})`);
  await connexion.db.execute(sql`DELETE FROM directory_rules WHERE entity_id IN (${entites})`);
  await connexion.db.execute(sql`DELETE FROM bot_rules WHERE entity_id IN (${entites})`);
  await connexion.db.execute(sql`DELETE FROM sessions WHERE user_id IN (${comptes})`);
  await connexion.db.execute(sql`DELETE FROM sessions WHERE entity_id IN (${entites})`);
  await connexion.db.execute(sql`DELETE FROM entity_settings WHERE entity_id IN (${entites})`);
  await connexion.db.execute(sql`DELETE FROM authorizations WHERE user_id IN (${comptes})`);
  await connexion.db.execute(sql`DELETE FROM users WHERE id IN (${comptes})`);
  await connexion.db.execute(
    sql`DELETE FROM profile_rights WHERE profile_id IN (SELECT id FROM profiles WHERE name LIKE ${motif})`,
  );
  await connexion.db.execute(sql`DELETE FROM profiles WHERE name LIKE ${motif}`);
  // Les enfants d'abord : une entite parente ne se supprime pas tant qu'une
  // fille la reference. Le tri par profondeur decroissante suffit ici, l'arbre
  // du decor n'ayant que deux niveaux.
  await connexion.db.execute(
    sql`DELETE FROM entities WHERE name LIKE ${motif} AND parent_id IS NOT NULL`,
  );
  await connexion.db.execute(sql`DELETE FROM entities WHERE name LIKE ${motif}`);
}
