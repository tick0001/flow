import { Global, Module } from '@nestjs/common';
import { DiskFileStore, type FileStore } from '@flow/storage';
import { appRoot, loadEnv } from '../config/env.js';
import { resolve } from 'node:path';

/** Jeton d'injection du stockage de fichiers. */
export const FILE_STORE = Symbol('FILE_STORE');

/**
 * Le stockage de fichiers, monte une fois.
 *
 * **Global**, comme la base : les pieces se lisent depuis les executions
 * aujourd'hui, et se liront depuis les plugins demain. Le declarer par module
 * ferait autant d'instances que de consommateurs, pour un objet qui n'est qu'un
 * chemin et quelques fonctions.
 *
 * L'API **lit** ; c'est le worker qui ecrit. Sur une seule machine les deux
 * voient le meme dossier sans rien faire ; sur plusieurs il faut un volume
 * partage, ou une implementation S3 que l'interface attend sans rien changer
 * autour.
 */
@Global()
@Module({
  providers: [
    {
      provide: FILE_STORE,
      useFactory: (): FileStore => new DiskFileStore(resolve(appRoot(), loadEnv().STORAGE_PATH)),
    },
  ],
  exports: [FILE_STORE],
})
export class StorageModule {}
