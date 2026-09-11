import { Module } from '@nestjs/common';
import { QueueService } from './queue.service.js';

/**
 * La file, montee une fois et partagee.
 *
 * Deux consommateurs aujourd'hui -- le lancement d'une execution et la sonde de
 * sante -- et un troisieme demain, la planification (jalon J6). Une instance par
 * module ouvrirait autant de connexions Redis que de modules, pour la meme file.
 */
@Module({
  providers: [QueueService],
  exports: [QueueService],
})
export class QueueModule {}
