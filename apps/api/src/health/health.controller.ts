import { Controller, Get } from '@nestjs/common';
import type { Health } from '@flow/contracts';
import { DatabaseService } from '../database/database.service.js';
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
  constructor(private readonly db: DatabaseService) {}

  @Get()
  async health(): Promise<Health> {
    const database = await this.db.ping();

    return {
      status: database ? 'ok' : 'degraded',
      version,
      uptimeSeconds: Math.floor((Date.now() - DEMARRE_A) / 1000),
      checks: {
        database,
        // Redis et les workers arrivent au jalon J3, avec la file. Annoncer
        // `true` en attendant ferait mentir la sonde ; annoncer `false` la
        // ferait crier au loup. Les valeurs disent donc « rien a signaler
        // encore » : aucune file, aucun worker.
        queues: true,
        workers: 0,
      },
    };
  }
}
