import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { botManifestSchema, type BotManifest } from '@flow/contracts';
import { createDatabase, sql } from '@flow/db';
import { appRoot, loadEnv, loadEnvFiles } from '../config/env.js';

/**
 * Ouvre tous les bots deposes a la racine de l'arbre, pour tous les profils.
 *
 * **A jouer une fois, en montant depuis la 0.1.0.** Jusque-la, un bot depose
 * etait propose a quiconque avait `bot:read` : il n'y avait aucune mise a
 * disposition a decider. Depuis, l'absence de regle vaut refus -- comme partout
 * ailleurs dans le modele de droits --, et une installation qui monte sans rien
 * faire verrait ses catalogues se vider.
 *
 * Cette commande retablit exactement le comportement d'avant : une regle par
 * bot, sur l'entite racine, recursive, sans profil -- donc tous. C'est le point
 * de depart le plus large ; resserrer ensuite se fait ecran par ecran, et chaque
 * retrait est alors une decision visible plutot qu'une surprise au premier
 * lancement refuse.
 *
 * Elle est **idempotente** : rejouee, elle ne cree rien de plus.
 *
 *   node apps/api/dist/cli/ouvrir-les-bots.js
 */
async function manifestes(racine: string): Promise<BotManifest[]> {
  const trouves: BotManifest[] = [];

  let entrees: string[];

  try {
    entrees = await readdir(racine);
  } catch {
    // Pas de dossier de depot : rien a ouvrir, et ce n'est pas une erreur.
    return trouves;
  }

  for (const nom of entrees) {
    if (nom.startsWith('.') || nom === 'node_modules') continue;

    // Les deux emplacements que le registre accepte : a la racine du dossier --
    // ce que produit un depot -- et dans `dist/`, ou il atterrit quand le bot est
    // construit sur place. Les lire tous les deux evite que la commande ouvre
    // moins de bots que le registre n'en propose.
    for (const candidat of [
      join(racine, nom, 'flow.bot.json'),
      join(racine, nom, 'dist', 'flow.bot.json'),
    ]) {
      try {
        const brut = await readFile(candidat, 'utf8');

        trouves.push(botManifestSchema.parse(JSON.parse(brut)));
        break;
      } catch {
        // Un dossier sans manifeste lisible n'est pas un bot. Le registre le
        // dira a sa facon au demarrage ; ici, on l'ignore.
      }
    }
  }

  return trouves;
}

async function main(): Promise<void> {
  loadEnvFiles();
  const env = loadEnv();

  const dossier = resolve(appRoot(), env.BOTS_PATH);
  const bots = await manifestes(dossier);

  if (bots.length === 0) {
    console.log(`Aucun bot lisible dans ${dossier}. Rien a ouvrir.`);

    return;
  }

  // Le role proprietaire : la commande s'execute hors session, donc sans
  // perimetre, et les politiques rendraient un resultat vide.
  const { db, close } = createDatabase({ connectionString: env.DATABASE_URL, max: 2 });

  try {
    const racine = await db.execute<{ id: number; name: string }>(sql`
      SELECT id, name FROM entities
       WHERE parent_id IS NULL AND deleted_at IS NULL
       ORDER BY id
       LIMIT 1
    `);

    const entite = racine.rows[0];

    if (!entite) throw new Error("Cette base n'a aucune entite racine.");

    let posees = 0;

    for (const bot of bots) {
      const insere = await db.execute<{ id: number }>(sql`
        INSERT INTO bot_rules (bot_id, entity_id, is_recursive, profile_id)
        VALUES (${bot.id}, ${entite.id}, true, NULL)
        ON CONFLICT DO NOTHING
        RETURNING id
      `);

      if (insere.rows.length > 0) posees += 1;
    }

    console.log(
      `${String(bots.length)} bot(s) lu(s), ${String(posees)} regle(s) posee(s) sur « ${entite.name} », ` +
        'recursives, tous profils.',
    );
  } finally {
    await close();
  }
}

main().catch((erreur: unknown) => {
  console.error(erreur instanceof Error ? erreur.message : String(erreur));
  process.exit(1);
});
