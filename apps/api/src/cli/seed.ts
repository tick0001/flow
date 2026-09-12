import { hash } from '@node-rs/argon2';
import { createDatabase, sql, type Transaction } from '@flow/db';
import type { RightScope } from '@flow/contracts';
import { RightsCatalogService } from '../admin/rights-catalog.service.js';
import { loadEnv, loadEnvFiles } from '../config/env.js';

/** Argon2id : valeur 2 de l'enumeration `Algorithm`, reprise comme dans l'API. */
const ARGON2ID = 2;

/**
 * Jeu de demonstration.
 *
 * **Il tronque toutes les tables avant d'ecrire.** Ce n'est pas une
 * installation : c'est ce qui remplit la demonstration publique, remise a zero
 * chaque heure. Pour poser une installation reelle, c'est `initialiser` qui
 * s'en charge, et lui refuse de s'executer si quelque chose existe deja.
 *
 * Ce qu'il fabrique tient en une phrase : une organisation plausible, cinq
 * comptes qui montrent chacun un cas du modele de droits, et un mois
 * d'historique d'executions -- assez pour que l'ecran de pilotage ait quelque
 * chose a dire, et que ce qu'il dit soit vrai.
 *
 * **Aucune piece d'execution n'est fabriquee.** Une capture inventee serait une
 * capture de rien, et un lien de telechargement vers un fichier absent. Les
 * captures et les traces que la demonstration montre viennent d'executions
 * reelles, lancees par la remise a zero apres l'amorcage -- voir
 * `docker/demo-reset.sh`.
 */

const MOT_DE_PASSE = 'flow';

/** Les bots livres avec le produit, tels que le registre les nomme. */
const BOTS = {
  bonjour: { id: 'exemple.bonjour', nom: 'Bonjour', version: '2.0.0' },
  catalogue: { id: 'exemple.catalogue', nom: 'Relevé de prix', version: '1.0.0' },
  connexion: { id: 'exemple.connexion', nom: 'Espace connecté', version: '1.0.0' },
  epreuves: { id: 'exemple.epreuves', nom: "Épreuves d'automatisation", version: '1.0.0' },
} as const;

/**
 * Les causes d'echec du mois ecoule.
 *
 * Elles sont **volontairement repetees avec des valeurs differentes** : des
 * adresses, des durees, des identifiants qui changent d'une ligne a l'autre. Sans
 * cela, l'ecran de pilotage n'aurait rien a regrouper, et sa raison d'etre --
 * ramener deux cents messages uniques aux quelques pannes qu'ils sont -- ne se
 * verrait pas.
 */
const ECHECS: Record<keyof typeof BOTS, ((n: number) => string)[]> = {
  // Hors ligne : il ne peut pas tomber sur le reseau. Ce qui lui arrive, c'est
  // son propre contexte qui disparait sous lui.
  bonjour: [
    () =>
      'page.setContent: Target page, context or browser has been closed\n' +
      'Call log: - setting frame content',
    (n: number) =>
      `Timeout ${String(5000 + n * 500)}ms exceeded.\n` +
      `Call log: - waiting for locator('[data-reference]') to be visible`,
  ],
  catalogue: [
    (n: number) =>
      `page.goto: net::ERR_CONNECTION_TIMED_OUT at https://books.toscrape.com/catalogue/page-${String(n + 2)}.html ` +
      `Call log: - navigating to "https://books.toscrape.com/catalogue/page-${String(n + 2)}.html", waiting until "load"`,
    (n: number) =>
      `locator.click: Element is not attached to the DOM\n` +
      `Call log: - waiting for locator('article.product_pod').nth(${String(n)})`,
  ],
  connexion: [
    () => "La connexion n'a pas abouti : aucun lien de deconnexion apres soumission.",
    (n: number) =>
      `page.fill: Timeout ${String(10000 + n * 1000)}ms exceeded.\n` +
      `Call log: - waiting for locator('#username')`,
  ],
  epreuves: [
    (n: number) =>
      `Le serveur a repondu 500 sur https://the-internet.herokuapp.com/status_codes/500?essai=${String(n)}`,
    (n: number) =>
      `Timeout ${String(20000 + n * 1000)}ms exceeded.\n` +
      `Call log: - waiting for locator('#finish h4') to be visible`,
  ],
};

/**
 * Qui lance quoi, et depuis ou.
 *
 * **Accorde aux regles de mise a disposition posees plus haut**, et ce n'est pas
 * du zele : l'historique se lit a cote du catalogue et de l'ecran des regles. Un
 * releve de prix trace dans une entite ou ce bot n'est ouvert par aucune regle
 * se remarque, et fait douter du reste.
 */
const LANCEURS: { compte: string; entite: string; bots: (keyof typeof BOTS)[] }[] = [
  { compte: 'admin', entite: 'racine', bots: ['bonjour', 'epreuves'] },
  { compte: 'admin', entite: 'siege', bots: ['bonjour', 'epreuves', 'connexion'] },
  { compte: 'sophie', entite: 'industrie', bots: ['bonjour', 'epreuves', 'catalogue'] },
  { compte: 'thomas', entite: 'lyon', bots: ['bonjour', 'epreuves', 'catalogue'] },
  { compte: 'lea', entite: 'saint-etienne', bots: ['bonjour', 'epreuves', 'catalogue'] },
];

interface Compte {
  identifiant: string;
  prenom: string;
  nom: string;
  profil: string;
  entite: string;
  recursif: boolean;
}

const COMPTES: Compte[] = [
  {
    identifiant: 'admin',
    prenom: 'Awa',
    nom: 'Diallo',
    profil: 'Administration',
    entite: 'racine',
    recursif: true,
  },
  {
    identifiant: 'sophie',
    prenom: 'Sophie',
    nom: 'Berger',
    profil: 'Supervision',
    entite: 'industrie',
    recursif: true,
  },
  {
    identifiant: 'thomas',
    prenom: 'Thomas',
    nom: 'Leroy',
    profil: 'Opérateur',
    entite: 'lyon',
    recursif: false,
  },
  {
    identifiant: 'lea',
    prenom: 'Léa',
    nom: 'Marchand',
    profil: 'Opérateur',
    entite: 'saint-etienne',
    recursif: false,
  },
  {
    identifiant: 'marc',
    prenom: 'Marc',
    nom: 'Oliveira',
    profil: 'Observation',
    entite: 'racine',
    recursif: true,
  },
];

/** Un generateur reproductible : deux amorcages donnent le meme decor. */
function dez(graine: number): () => number {
  let etat = graine;

  return () => {
    etat = (etat * 1103515245 + 12345) % 2147483648;

    return etat / 2147483648;
  };
}

async function creerEntite(tx: Transaction, nom: string, parent: number | null): Promise<number> {
  // `path` est recalcule par un declencheur : la valeur posee ici n'est qu'un
  // marqueur, et `complete_name` suit le meme chemin.
  const resultat = await tx.execute<{ id: number }>(sql`
    INSERT INTO entities (name, parent_id, path, complete_name)
    VALUES (${nom}, ${parent}, 'temporaire', ${nom})
    RETURNING id
  `);

  const id = resultat.rows[0]?.id;

  if (id === undefined) throw new Error(`Creation de l'entite ${nom} impossible.`);

  return id;
}

async function creerProfil(
  tx: Transaction,
  nom: string,
  droits: [string, string, RightScope][],
): Promise<number> {
  const resultat = await tx.execute<{ id: number }>(sql`
    INSERT INTO profiles (name) VALUES (${nom}) RETURNING id
  `);

  const id = resultat.rows[0]?.id;

  if (id === undefined) throw new Error(`Creation du profil ${nom} impossible.`);

  for (const [objet, action, portee] of droits) {
    await tx.execute(sql`
      INSERT INTO profile_rights (profile_id, object, action, scope)
      VALUES (${id}, ${objet}, ${action}, ${portee}::right_scope)
    `);
  }

  return id;
}

/**
 * **Pas de contexte NestJS.** L'amorcage n'a besoin que d'une connexion et d'un
 * hachoir : demarrer l'application entiere lancerait au passage le
 * planificateur, le balayage des orphelines, la file BullMQ et l'hote de
 * plugins -- des travaux de fond qui tournent sur la base qu'on est en train de
 * tronquer, et dont les connexions maintiennent ensuite le processus en vie.
 * Une premiere version le faisait : elle ecrivait tout correctement et ne
 * rendait jamais la main.
 */
async function main(): Promise<void> {
  loadEnvFiles();
  const env = loadEnv();

  const catalogue = new RightsCatalogService();
  const condensat = await hash(MOT_DE_PASSE, { algorithm: ARGON2ID });

  const { db, close } = createDatabase({ connectionString: env.DATABASE_URL, max: 2 });

  try {
    await db.transaction(async (tx) => {
      // L'ordre suit les cles etrangeres, et `CASCADE` fait le reste. Les tables
      // de plugins ne sont pas touchees : leurs lignes decrivent des schemas
      // PostgreSQL reellement poses, qu'un TRUNCATE laisserait orphelins.
      await tx.execute(sql`
        TRUNCATE execution_artifacts, execution_logs, executions,
                 schedules, api_keys, bot_rules, directory_rules,
                 entity_settings, authorizations, profile_rights,
                 sessions, users, profiles, entities
        RESTART IDENTITY CASCADE
      `);

      // --- L'organisation ----------------------------------------------------
      const entites: Record<string, number> = {};

      entites['racine'] = await creerEntite(tx, 'Groupe Vercors', null);
      entites['industrie'] = await creerEntite(tx, 'Pôle Industrie', entites['racine']);
      entites['lyon'] = await creerEntite(tx, 'Site de Lyon', entites['industrie']);
      entites['saint-etienne'] = await creerEntite(
        tx,
        'Site de Saint-Étienne',
        entites['industrie'],
      );
      entites['services'] = await creerEntite(tx, 'Pôle Services', entites['racine']);
      entites['grenoble'] = await creerEntite(tx, 'Agence de Grenoble', entites['services']);
      entites['siege'] = await creerEntite(tx, 'Siège', entites['racine']);

      // --- Les profils -------------------------------------------------------
      //
      // L'administration derive du catalogue plutot que d'une liste ecrite ici :
      // une liste figee aurait cesse d'etre complete des le premier droit ajoute.
      const tousLesDroits = catalogue
        .all()
        .map(
          (definition) =>
            [
              definition.object,
              definition.action,
              definition.scopes[definition.scopes.length - 1] ?? 'entity',
            ] as [string, string, RightScope],
        );

      const profils: Record<string, number> = {};

      profils['Administration'] = await creerProfil(tx, 'Administration', tousLesDroits);

      profils['Supervision'] = await creerProfil(tx, 'Supervision', [
        ['entity', 'read', 'recursive'],
        ['user', 'read', 'recursive'],
        ['bot', 'read', 'all'],
        ['bot', 'execute', 'all'],
        ['execution', 'read', 'recursive'],
        ['execution', 'cancel', 'recursive'],
        ['schedule', 'read', 'recursive'],
        ['schedule', 'create', 'entity'],
        ['schedule', 'update', 'recursive'],
        ['schedule', 'delete', 'recursive'],
        ['stats', 'read', 'recursive'],
        ['apikey', 'read', 'recursive'],
      ]);

      profils['Opérateur'] = await creerProfil(tx, 'Opérateur', [
        ['bot', 'read', 'all'],
        ['bot', 'execute', 'all'],
        ['execution', 'read', 'entity'],
        ['execution', 'cancel', 'own'],
        ['schedule', 'read', 'entity'],
        ['stats', 'read', 'entity'],
      ]);

      profils['Observation'] = await creerProfil(tx, 'Observation', [
        ['bot', 'read', 'all'],
        ['execution', 'read', 'recursive'],
        ['schedule', 'read', 'recursive'],
        ['stats', 'read', 'recursive'],
      ]);

      // --- Les comptes -------------------------------------------------------
      const comptes: Record<string, number> = {};

      for (const compte of COMPTES) {
        const resultat = await tx.execute<{ id: number }>(sql`
          INSERT INTO users (username, password_hash, auth_source, is_active, first_name, last_name,
                             default_entity_id)
          VALUES (${compte.identifiant}, ${condensat}, 'local', true,
                  ${compte.prenom}, ${compte.nom}, ${entites[compte.entite]})
          RETURNING id
        `);

        const id = resultat.rows[0]?.id;

        if (id === undefined)
          throw new Error(`Creation du compte ${compte.identifiant} impossible.`);

        comptes[compte.identifiant] = id;

        await tx.execute(sql`
          INSERT INTO authorizations (user_id, profile_id, entity_id, is_recursive)
          VALUES (${id}, ${profils[compte.profil]}, ${entites[compte.entite]}, ${compte.recursif})
        `);
      }

      // Le cumul : Lea est operatrice a Saint-Etienne **et** observatrice au
      // Siege. C'est le cas que le modele doit savoir traiter, et celui qu'on ne
      // comprend qu'en basculant d'un profil a l'autre dans l'interface : les
      // droits suivent le profil actif, jamais l'union des deux.
      await tx.execute(sql`
        INSERT INTO authorizations (user_id, profile_id, entity_id, is_recursive)
        VALUES (${comptes['lea']}, ${profils['Observation']}, ${entites['siege']}, false)
      `);

      // --- La mise a disposition des bots ------------------------------------
      //
      // Volontairement inegale : c'est ce qui rend la regle visible. Depuis Lyon
      // on voit trois bots, depuis le Siege on en voit quatre, et « Espace
      // connecte » n'est ouvert qu'a l'administration.
      const regles: [string, string, boolean, string | null][] = [
        [BOTS.bonjour.id, 'racine', true, null],
        [BOTS.epreuves.id, 'racine', true, null],
        [BOTS.catalogue.id, 'industrie', true, null],
        [BOTS.catalogue.id, 'grenoble', false, null],
        [BOTS.connexion.id, 'siege', false, 'Administration'],
      ];

      for (const [bot, entite, recursif, profil] of regles) {
        await tx.execute(sql`
          INSERT INTO bot_rules (bot_id, entity_id, is_recursive, profile_id)
          VALUES (${bot}, ${entites[entite]}, ${recursif},
                  ${profil === null ? null : profils[profil]})
        `);
      }

      // --- Les planifications ------------------------------------------------
      const planifications: [string, keyof typeof BOTS, string, string, string, string, boolean][] =
        [
          [
            'Relevé quotidien des prix',
            'catalogue',
            '0 6 * * *',
            'Europe/Paris',
            'lyon',
            'thomas',
            true,
          ],
          [
            'Contrôle du matin',
            'bonjour',
            '30 7 * * 1-5',
            'Europe/Paris',
            'industrie',
            'sophie',
            true,
          ],
          [
            'Épreuves hebdomadaires',
            'epreuves',
            '0 4 * * 1',
            'Europe/Paris',
            'racine',
            'admin',
            true,
          ],
          [
            'Relevé de nuit (suspendu)',
            'catalogue',
            '0 2 * * *',
            'Europe/Lisbon',
            'saint-etienne',
            'lea',
            false,
          ],
        ];

      for (const [nom, bot, cron, fuseau, entite, compte, actif] of planifications) {
        const profil = COMPTES.find((c) => c.identifiant === compte)?.profil ?? 'Administration';

        await tx.execute(sql`
          INSERT INTO schedules (name, bot_id, parameters, cron, timezone, entity_id, owner_id,
                                 profile_id, is_active, next_run_at, last_run_at)
          VALUES (${nom}, ${BOTS[bot].id}, '{}'::jsonb, ${cron}, ${fuseau},
                  ${entites[entite]}, ${comptes[compte]}, ${profils[profil]}, ${actif},
                  ${actif ? sql`now() + interval '6 hours'` : sql`NULL`},
                  now() - interval '18 hours')
        `);
      }

      // --- Un mois d'historique ----------------------------------------------
      //
      // Fabrique plutot que joue : trois cents executions reelles demanderaient
      // une heure de navigateur a chaque remise a zero. Ce qui compte ici est la
      // **forme** de l'historique -- des durees credibles, une proportion d'echecs
      // qui laisse le taux de reussite dans une zone parlante, et des causes qui se
      // repetent.
      const hasard = dez(20260912);
      let creees = 0;

      for (let jour = 29; jour >= 0; jour -= 1) {
        // Moins le week-end : un historique parfaitement plat se lit comme une
        // fabrication, et la courbe de tendance n'a plus rien a montrer.
        const dateDuJour = new Date(Date.now() - jour * 86_400_000);
        const weekend = dateDuJour.getDay() === 0 || dateDuJour.getDay() === 6;
        const combien = weekend ? 2 + Math.floor(hasard() * 3) : 6 + Math.floor(hasard() * 7);

        for (let n = 0; n < combien; n += 1) {
          const lanceur = LANCEURS[Math.floor(hasard() * LANCEURS.length)] ?? LANCEURS[0];

          if (!lanceur) continue;

          const compte = COMPTES.find((c) => c.identifiant === lanceur.compte);

          if (!compte) continue;

          const cle = lanceur.bots[Math.floor(hasard() * lanceur.bots.length)] ?? 'bonjour';
          const bot = BOTS[cle];

          const rate = hasard() < 0.13;
          const duree = Math.floor(
            cle === 'bonjour' ? 200 + hasard() * 600 : 1500 + hasard() * 9000,
          );
          const debut = new Date(
            dateDuJour.getTime() -
              (dateDuJour.getHours() - 7 - Math.floor(hasard() * 10)) * 3_600_000,
          );
          const fin = new Date(debut.getTime() + duree);
          // La cause vient du bot qui a echoue, jamais d'un tirage global : un
          // releve de prix ne se plaint pas d'un formulaire de connexion.
          const causes = ECHECS[cle];
          const echec = causes[Math.floor(hasard() * causes.length)] ?? causes[0];

          const resultat = await tx.execute<{ id: string }>(sql`
            INSERT INTO executions (bot_id, bot_name, bot_version, parameters, status,
                                    entity_id, requested_by, profile_id, message,
                                    duration_ms, created_at, started_at, finished_at)
            VALUES (${bot.id}, ${bot.nom}, ${bot.version}, '{}'::jsonb,
                    ${rate ? 'failed' : 'succeeded'}::execution_status,
                    ${entites[lanceur.entite]}, ${comptes[lanceur.compte]},
                    ${profils[compte.profil]},
                    ${rate && echec ? echec(n) : 'Terminé sans erreur.'},
                    ${duree}, ${debut.toISOString()}, ${debut.toISOString()},
                    ${fin.toISOString()})
            RETURNING id
          `);

          const id = resultat.rows[0]?.id;

          if (id === undefined) continue;

          creees += 1;

          const lignes: [string, string][] = rate
            ? [
                ['info', `Démarrage de ${bot.nom}.`],
                ['info', 'Ouverture du contexte navigateur.'],
                ['error', (echec?.(n) ?? '').split('\n')[0] ?? ''],
              ]
            : [
                ['info', `Démarrage de ${bot.nom}.`],
                ['info', 'Ouverture du contexte navigateur.'],
                ['info', 'Lecture de la page.'],
                ['info', `Terminé en ${String(duree)} ms.`],
              ];

          for (const [seq, [niveau, message]] of lignes.entries()) {
            await tx.execute(sql`
              INSERT INTO execution_logs (execution_id, seq, at, level, message)
              VALUES (${id}, ${seq}, ${new Date(debut.getTime() + seq * 120).toISOString()},
                      ${niveau}::log_level, ${message})
            `);
          }
        }
      }

      // Une execution en cours, pour que l'ecran ne soit pas fige : elle sera
      // balayee comme abandonnee au bout de quelques minutes, ce qui est
      // exactement ce qu'on veut montrer d'un worker qui a disparu.
      await tx.execute(sql`
        INSERT INTO executions (bot_id, bot_name, bot_version, parameters, status,
                                entity_id, requested_by, profile_id,
                                progress_step, progress_percent, created_at, started_at,
                                heartbeat_at, worker_id)
        VALUES (${BOTS.catalogue.id}, ${BOTS.catalogue.nom}, ${BOTS.catalogue.version},
                '{"categorie":"policier","pages":3}'::jsonb, 'running'::execution_status,
                ${entites['lyon']}, ${comptes['thomas']}, ${profils['Opérateur']},
                'Page 2 sur 3', 55, now() - interval '40 seconds', now() - interval '38 seconds',
                now() - interval '5 seconds', 'demonstration')
      `);

      console.log(
        `Jeu de demonstration pose.
  ` +
          `  ${String(Object.keys(entites).length)} entites, ${String(COMPTES.length)} comptes, ` +
          `${String(regles.length)} regles de bots, ${String(planifications.length)} planifications
  ` +
          `  ${String(creees + 1)} executions sur trente jours
  ` +
          `  Mot de passe commun : ${MOT_DE_PASSE}`,
      );
    });
  } finally {
    await close();
  }
}

main().catch((erreur: unknown) => {
  console.error(erreur instanceof Error ? erreur.message : String(erreur));
  process.exit(1);
});
