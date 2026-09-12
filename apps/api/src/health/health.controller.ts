import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { Health } from '@flow/contracts';
import { DatabaseService } from '../database/database.service.js';
import { QueueService } from '../queue/queue.service.js';
import type { Response } from 'express';
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

  /**
   * Le code HTTP porte le verdict, pas seulement le corps.
   *
   * C'est ce que lit la sonde de l'image -- `fetch(...).then(r => r.ok ? 0 : 1)`
   * -- et ce sur quoi Compose s'appuie pour marquer un conteneur malsain. Un 200
   * accompagne d'un `status: degraded` laissait le conteneur au vert : la sonde
   * du Dockerfile ne pouvait alors echouer qu'en cas de panne du processus
   * lui-meme, c'est-a-dire dans le seul cas ou elle etait inutile. Le corps est
   * pour l'humain, le code pour l'outillage.
   */
  @Get()
  async health(@Res({ passthrough: true }) reponse: Response): Promise<Health> {
    // Les deux verifications en parallele : sequentielles, elles additionneraient
    // leurs delais d'attente, et une sonde qui met dix secondes a repondre est
    // comptee en panne par l'orchestrateur qui l'interroge.
    const [database, file] = await Promise.all([this.db.ping(), this.file.state()]);

    // Zero worker est une degradation et non une panne : l'API sert, les
    // executions s'empilent, et c'est exactement ce qu'il faut voir avant que la
    // file ne s'allonge. Repondre `ok` le cacherait jusqu'a ce que quelqu'un se
    // demande pourquoi rien ne demarre.
    const enForme = database && file.reachable && file.workers > 0;

    reponse.status(enForme ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);

    return {
      status: enForme ? 'ok' : 'degraded',
      version,
      uptimeSeconds: Math.floor((Date.now() - DEMARRE_A) / 1000),
      checks: { database, queues: file.reachable, workers: file.workers },
    };
  }
}
