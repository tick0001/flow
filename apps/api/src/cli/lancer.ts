import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { createDatabase, sql } from '@flow/db';
import { EXECUTION_QUEUE, type ExecutionJob } from '@flow/contracts';
import { loadEnv, loadEnvFiles } from '../config/env.js';

/**
 * Lance un bot depuis la ligne de commande.
 *
 *   node apps/api/dist/cli/lancer.js exemple.bonjour '{"decor":"tableau"}'
 *
 * Ecrit par la remise a zero de la demonstration, qui rejoue quelques
 * executions reelles apres chaque amorcage : le jeu de donnees fabrique
 * l'historique, mais **ne fabrique aucune piece** -- une capture inventee serait
 * une capture de rien. Ces lancements-ci passent par la file, le worker et un
 * vrai Chromium, et produisent donc de vraies captures et de vraies traces.
 *
 * Ils verifient la pile au passage. Une demonstration dont le worker est mort
 * depuis trois jours ressemble a une demonstration qui marche, jusqu'a ce qu'un
 * visiteur clique.
 *
 * **Aucun droit n'est verifie ici, et c'est assume** : cette commande s'execute
 * sur la machine, avec les identifiants de la base. Qui peut la lancer peut deja
 * tout faire. Elle respecte en revanche les regles de mise a disposition -- elle
 * choisit une entite ou le bot est reellement ouvert --, sans quoi elle
 * produirait un historique que l'ecran des regles contredit.
 */
async function main(): Promise<void> {
  loadEnvFiles();
  const env = loadEnv();

  const botId = process.argv[2];
  const brut = process.argv[3] ?? '{}';

  if (!botId) {
    throw new Error("Usage : node dist/cli/lancer.js <bot> '<parametres JSON>'");
  }

  const parametres: unknown = JSON.parse(brut);

  const { db, close } = createDatabase({ connectionString: env.DATABASE_URL, max: 2 });
  const redis = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
  const file = new Queue<ExecutionJob>(EXECUTION_QUEUE, { connection: redis });

  try {
    // Le premier couple compte + entite ou une regle ouvre ce bot. Les regles
    // sont resolues comme le fait l'application : l'entite elle-meme, ou un
    // ancetre qui l'a ouverte de facon recursive.
    const cible = await db.execute<{
      entityId: number;
      userId: number;
      profileId: number;
    }>(sql`
      SELECT e.id AS "entityId", a.user_id AS "userId", a.profile_id AS "profileId"
        FROM bot_rules r
        JOIN entities porteuse ON porteuse.id = r.entity_id
        JOIN entities e
          ON e.path = porteuse.path
          OR (r.is_recursive AND e.path <@ porteuse.path)
        JOIN authorizations a ON a.entity_id = e.id
        JOIN profile_rights d
          ON d.profile_id = a.profile_id AND d.object = 'bot' AND d.action = 'execute'
       WHERE r.bot_id = ${botId}
         AND (r.profile_id IS NULL OR r.profile_id = a.profile_id)
         AND e.deleted_at IS NULL
       ORDER BY e.path
       LIMIT 1
    `);

    const ou = cible.rows[0];

    if (!ou) {
      throw new Error(
        `Aucun compte ne peut lancer ${botId} : ni regle de mise a disposition, ni habilitation.`,
      );
    }

    const manifeste = await db.execute<{ botName: string; botVersion: string }>(sql`
      SELECT bot_name AS "botName", bot_version AS "botVersion"
        FROM executions WHERE bot_id = ${botId}
       ORDER BY created_at DESC LIMIT 1
    `);

    // Le nom et la version sont recopies dans la trace : elle doit dire quelle
    // version a tourne, meme apres une mise a jour du bot. Faute d'historique,
    // l'identifiant fait l'affaire -- le worker n'en a pas besoin pour executer.
    const nom = manifeste.rows[0]?.botName ?? botId;
    const version = manifeste.rows[0]?.botVersion ?? '0.0.0';

    const creee = await db.execute<{ id: string }>(sql`
      INSERT INTO executions (bot_id, bot_name, bot_version, parameters, entity_id,
                              requested_by, profile_id)
      VALUES (${botId}, ${nom}, ${version}, ${JSON.stringify(parametres)}::jsonb,
              ${ou.entityId}, ${ou.userId}, ${ou.profileId})
      RETURNING id
    `);

    const id = creee.rows[0]?.id;

    if (!id) throw new Error("L'execution n'a pas pu etre creee.");

    // La ligne d'abord, la file ensuite. L'ordre n'est pas interchangeable :
    // publier d'abord ouvrirait une fenetre pendant laquelle un worker depile un
    // travail dont la ligne n'est pas encore visible, et le jetterait.
    await file.add(
      'executer',
      { executionId: id, botId },
      { jobId: id, attempts: 1, removeOnComplete: { count: 200 }, removeOnFail: { count: 200 } },
    );

    console.log(`${botId} : execution ${id} mise en file.`);
  } finally {
    await file.close();
    redis.disconnect();
    await close();
  }
}

main().catch((erreur: unknown) => {
  console.error(erreur instanceof Error ? erreur.message : String(erreur));
  process.exitCode = 1;
});
