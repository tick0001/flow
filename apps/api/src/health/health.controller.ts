import { Controller, Get } from '@nestjs/common';
import type { Health } from '@flow/contracts';
import { DatabaseService } from '../database/database.service.js';
import { QueueService } from '../queue/queue.service.js';
import { version } from '../version.js';

const DEMARRE_A = Date.now();

/**
 * Sonde de sante.
 *
 * Publique et sans authentification : elle est interrogee par un orchestrateur,
 * un relais ou une supervision, qui n'ont pas de session.
 *
 * Elle interroge reellement ses dependances plutot que de repondre « ok » du
 * seul fait que le processus tourne -- ce qui est le comportement par defaut de
 * la plupart des sondes, et ce qui les rend inutiles : une API qui ne joint plus
 * sa base repond encore.
 */
@Controller('health')
export class HealthController {
  constructor(
    private readonly db: DatabaseService,
    private readonly file: QueueService,
  ) {}

  @Get()
  async health(): Promise<Health> {
    // Les deux verifications en parallele : sequentielles, elles additionneraient
    // leurs delais d'attente, et une sonde qui met dix secondes a repondre est
    // comptee en panne par l'orchestrateur qui l'interroge.
    const [database, file] = await Promise.all([this.db.ping(), this.file.state()]);

    // Zero worker est une degradation et non une panne : l'API sert, les
    // executions s'empilent, et c'est exactement ce qu'il faut voir avant que la
    // file ne s'allonge. Repondre `ok` le cacherait jusqu'a ce que quelqu'un se
    // demande pourquoi rien ne demarre.
    const enForme = database && file.reachable && file.workers > 0;

    return {
      status: enForme ? 'ok' : 'degraded',
      version,
      uptimeSeconds: Math.floor((Date.now() - DEMARRE_A) / 1000),
      checks: { database, queues: file.reachable, workers: file.workers },
    };
  }
}
