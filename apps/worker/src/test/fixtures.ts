import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  createDatabase,
  entities,
  eq,
  executions,
  inArray,
  profiles,
  sql,
  users,
  type Connection,
} from '@flow/db';
import type { ExecutionStatus } from '@flow/contracts';
import { resetEnvCache } from '../config/env.js';
import { resetRegistre } from '../registre.js';

/**
 * Une entite, un compte, un profil, et un dossier de bots a nous.
 *
 * Les bots de test sont ecrits **sous `apps/worker`** et non dans le dossier
 * temporaire du systeme : un module importe depuis `/tmp` ne resoudrait pas
 * `@flow/bot-sdk`, puisque la resolution de Node remonte les dossiers parents a
 * la recherche d'un `node_modules`. Les bots de test importent donc le vrai SDK
 * et le vrai Zod -- ce qui est tout l'interet, la validation des parametres etant
 * ce qu'on veut eprouver.
 */
export interface Fixture {
  owner: Connection;
  dossierDesBots: string;
  entityId: number;
  entityPath: string;
  userId: number;
  profileId: number;
  /** Depose un bot et rend son identifiant. */
  deposerBot: (nom: string, source: string, parametres: unknown) => Promise<string>;
  /** Insere une execution en attente et rend son identifiant. */
  mettreEnAttente: (botId: string, parameters?: Record<string, unknown>) => Promise<string>;
  relire: (executionId: string) => Promise<LigneRelue>;
  journalDe: (executionId: string) => Promise<{ seq: number; level: string; message: string }[]>;
  cleanup: () => Promise<void>;
}

export interface LigneRelue {
  status: ExecutionStatus;
  message: string | null;
  output: Record<string, unknown> | null;
  durationMs: number | null;
  workerId: string | null;
  progressStep: string | null;
  progressPercent: number | null;
  startedAt: Date | null;
  finishedAt: Date | null;
}

function requireEnv(nom: string): string {
  const valeur = process.env[nom];

  if (!valeur) {
    throw new Error(`${nom} est absent : les tests d'integration exigent une base reelle.`);
  }

  return valeur;
}

export async function createFixture(prefix: string): Promise<Fixture> {
  const owner = createDatabase({ connectionString: requireEnv('DATABASE_URL'), max: 3 });
  const racine = join(import.meta.dirname, '../../.essais', randomUUID());

  await mkdir(racine, { recursive: true });

  // Le worker lit sa configuration au premier appel : la poser avant que quoi
  // que ce soit ne demarre evite un cache fige sur les valeurs du `.env`.
  process.env['BOTS_PATH'] = racine;
  process.env['WORKER_OUTPUT_PATH'] = join(racine, 'sorties');
  resetEnvCache();
  resetRegistre();

  const [entite] = await owner.db
    .insert(entities)
    .values({ name: `${prefix} Racine`, parentId: null, path: 'temporaire', completeName: prefix })
    .returning({ id: entities.id, path: entities.path });

  const [compte] = await owner.db
    .insert(users)
    .values({ username: `${prefix}-compte`, passwordHash: 'sans-objet', authSource: 'local' })
    .returning({ id: users.id });

  const [profil] = await owner.db
    .insert(profiles)
    .values({ name: `${prefix} Profil` })
    .returning({ id: profiles.id });

  if (!entite || !compte || !profil) throw new Error('Fixture incomplete.');

  const deposerBot = async (nom: string, source: string, parametres: unknown): Promise<string> => {
    const botId = `essai.${nom}`;
    const dossier = join(racine, nom);

    await mkdir(dossier, { recursive: true });
    await writeFile(join(dossier, 'index.js'), source, 'utf8');
    await writeFile(
      join(dossier, 'flow.bot.json'),
      JSON.stringify({
        id: botId,
        name: nom,
        description: '',
        version: '1.0.0',
        author: '',
        tags: [],
        parameters: parametres,
        sdk: 1,
      }),
      'utf8',
    );

    return botId;
  };

  const mettreEnAttente = async (
    botId: string,
    parameters: Record<string, unknown> = {},
  ): Promise<string> => {
    const [ligne] = await owner.db
      .insert(executions)
      .values({
        botId,
        botName: botId,
        botVersion: '1.0.0',
        parameters,
        entityId: entite.id,
        requestedBy: compte.id,
        profileId: profil.id,
      })
      .returning({ id: executions.id });

    if (!ligne) throw new Error('Mise en attente impossible.');

    return ligne.id;
  };

  const relire = async (executionId: string): Promise<LigneRelue> => {
    const [ligne] = await owner.db
      .select({
        status: executions.status,
        message: executions.message,
        output: executions.output,
        durationMs: executions.durationMs,
        workerId: executions.workerId,
        progressStep: executions.progressStep,
        progressPercent: executions.progressPercent,
        startedAt: executions.startedAt,
        finishedAt: executions.finishedAt,
      })
      .from(executions)
      .where(eq(executions.id, executionId));

    if (!ligne) throw new Error(`Execution ${executionId} introuvable.`);

    return ligne;
  };

  const journalDe = async (
    executionId: string,
  ): Promise<{ seq: number; level: string; message: string }[]> => {
    const resultat = await owner.db.execute<{ seq: number; level: string; message: string }>(sql`
      SELECT seq, level::text AS level, message
        FROM execution_logs
       WHERE execution_id = ${executionId}::uuid
       ORDER BY seq
    `);

    return resultat.rows;
  };

  const cleanup = async (): Promise<void> => {
    await owner.db.delete(executions).where(inArray(executions.entityId, [entite.id]));
    await owner.db.delete(users).where(eq(users.id, compte.id));
    await owner.db.delete(profiles).where(eq(profiles.id, profil.id));
    await owner.db.delete(entities).where(eq(entities.id, entite.id));
    await owner.close();
    await rm(racine, { recursive: true, force: true });

    delete process.env['BOTS_PATH'];
    delete process.env['WORKER_OUTPUT_PATH'];
    resetEnvCache();
    resetRegistre();
  };

  return {
    owner,
    dossierDesBots: racine,
    entityId: entite.id,
    entityPath: entite.path,
    userId: compte.id,
    profileId: profil.id,
    deposerBot,
    mettreEnAttente,
    relire,
    journalDe,
    cleanup,
  };
}

/** JSON Schema d'un parametre `url` obligatoire, tel que le SDK en produirait un. */
export const SCHEMA_URL = {
  type: 'object',
  properties: { url: { type: 'string', format: 'uri' } },
  required: ['url'],
};
