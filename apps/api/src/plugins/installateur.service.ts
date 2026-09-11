import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { schemaDuPlugin } from '@flow/contracts';
import { sql, type Transaction } from '@flow/db';
import { DatabaseService } from '../database/database.service.js';
import { RightsService } from '../auth/rights.service.js';
import { PluginRegistryService, type PluginDecouvert } from './registre.service.js';
import { PluginHostService } from './hote.service.js';

/** Dossier des migrations d'un plugin, relatif a sa racine. */
const DOSSIER_MIGRATIONS = 'migrations';

/** Un identifiant de schema sur. Verifie avant toute concatenation. */
const SCHEMA_VALIDE = /^[a-z][a-z0-9_]{0,62}$/;

/**
 * Installe, desinstalle, active, desactive.
 *
 * Tout passe par le **role proprietaire** : creer un schema, poser des tables,
 * les supprimer sont des ordres que le role applicatif n'a pas le droit de
 * passer et ne doit pas avoir. C'est aussi ce qui fait qu'un plugin ne peut pas
 * s'installer lui-meme : il n'a que la connexion applicative.
 */
@Injectable()
export class PluginInstallerService {
  private readonly logger = new Logger(PluginInstallerService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly registre: PluginRegistryService,
    private readonly hote: PluginHostService,
    private readonly droits: RightsService,
  ) {}

  /** Ce que la base sait des plugins installes. */
  async installes(): Promise<
    { id: string; name: string; version: string; schemaName: string | null; isEnabled: boolean }[]
  > {
    return this.db.asOwner(async (tx) => {
      const resultat = await tx.execute<{
        id: string;
        name: string;
        version: string;
        schemaName: string | null;
        isEnabled: boolean;
      }>(sql`
        SELECT id, name, version, schema_name AS "schemaName", is_enabled AS "isEnabled"
          FROM plugins
         ORDER BY id
      `);

      return resultat.rows;
    });
  }

  /**
   * Installe un plugin depose.
   *
   * L'ordre compte : **la base d'abord, le chargement ensuite.** Si le module
   * refuse de s'importer, l'installation est defaite -- mieux vaut aucun plugin
   * qu'un schema cree pour du code qui ne tourne pas.
   */
  async installer(id: string): Promise<void> {
    const decouvert = this.exigerDecouvert(id);
    const manifeste = decouvert.manifest;

    if (!manifeste) {
      throw new BadRequestException(decouvert.reason ?? 'Plugin refuse.');
    }

    const deja = await this.ligne(id);

    if (deja) throw new BadRequestException(`${id} est deja installe.`);

    const schema = manifeste.schema ? schemaDuPlugin(id) : null;

    await this.db.asOwner(async (tx) => {
      await tx.execute(sql`
        INSERT INTO plugins (id, name, version, schema_name, is_enabled)
        VALUES (${id}, ${manifeste.name}, ${manifeste.version}, ${schema}, true)
      `);

      if (schema !== null) {
        await this.creerLeSchema(tx, schema);
        await this.jouerLesMigrations(tx, id, decouvert.directory, schema);
      }
    });

    try {
      await this.hote.charger(decouvert);
    } catch (erreur: unknown) {
      // Defaire plutot que laisser un demi-installe : une ligne en base pour un
      // module qui ne se charge pas donnerait un plugin « actif » qui n'accroche
      // rien, et que rien n'expliquerait.
      await this.effacer(id, schema);

      throw new BadRequestException(
        `Chargement impossible : ${erreur instanceof Error ? erreur.message : String(erreur)}`,
      );
    }

    this.logger.log(`${id} ${manifeste.version} installe.`);
  }

  /**
   * Desinstalle : le module, les droits, les tables, la ligne.
   *
   * **Sans trace**, et c'est la promesse la plus engageante du jalon. Le schema
   * part en entier, les droits accordes dans les profils avec lui, les
   * migrations jouees aussi. Ce qui reste apres n'est plus qu'un dossier sur le
   * disque, que l'exploitant retire s'il le souhaite.
   *
   * Fonctionne sur un **orphelin** -- un plugin installe dont le dossier a
   * disparu --, et c'est justement pour lui qu'elle ne s'appuie sur rien du
   * disque : le schema et les droits se deduisent de la ligne en base.
   */
  async desinstaller(id: string): Promise<void> {
    const ligne = await this.ligne(id);

    if (!ligne) throw new NotFoundException(`${id} n'est pas installe.`);

    this.hote.decharger(id);
    await this.effacer(id, ligne.schemaName);

    this.logger.log(`${id} desinstalle.`);
  }

  /** Active ou met en sommeil, sans rien effacer. */
  async basculer(id: string, actif: boolean): Promise<void> {
    const ligne = await this.ligne(id);

    if (!ligne) throw new NotFoundException(`${id} n'est pas installe.`);

    await this.db.asOwner(async (tx) => {
      await tx.execute(sql`
        UPDATE plugins SET is_enabled = ${actif}, updated_at = now() WHERE id = ${id}
      `);
    });

    if (actif) {
      const decouvert = this.exigerDecouvert(id);

      await this.hote.charger(decouvert);
    } else {
      this.hote.decharger(id);
    }
  }

  /**
   * Charge, au demarrage, les plugins installes et actifs.
   *
   * Un plugin qui refuse de se charger **ne fait pas echouer l'amorcage** : une
   * installation entiere ne doit pas rester a terre parce qu'une extension est
   * cassee. Il apparait en refus a l'ecran, avec son motif.
   */
  async chargerLesActifs(): Promise<void> {
    for (const ligne of await this.installes()) {
      if (!ligne.isEnabled) continue;

      const decouvert = this.registre.get(ligne.id);

      if (!decouvert || !decouvert.manifest) {
        this.logger.warn(
          `${ligne.id} est installe mais ${decouvert ? 'refuse' : 'absent du disque'} : non charge.`,
        );

        continue;
      }

      try {
        await this.hote.charger(decouvert);
      } catch (erreur: unknown) {
        this.logger.error(
          `${ligne.id} : chargement impossible : ${erreur instanceof Error ? erreur.message : String(erreur)}`,
        );
      }
    }
  }

  private exigerDecouvert(id: string): PluginDecouvert {
    const decouvert = this.registre.get(id);

    if (!decouvert) throw new NotFoundException(`Aucun plugin ${id} sur le disque.`);

    return decouvert;
  }

  private async ligne(
    id: string,
  ): Promise<{ id: string; schemaName: string | null; isEnabled: boolean } | null> {
    const lignes = await this.installes();

    return lignes.find((ligne) => ligne.id === id) ?? null;
  }

  /**
   * Cree le schema du plugin et ouvre ses tables au role applicatif.
   *
   * Les privileges par defaut sont poses **avant** les migrations : ils ne
   * valent que pour ce qui sera cree ensuite. Les poser apres laisserait des
   * tables que l'application ne pourrait pas lire, et l'erreur ne se verrait
   * qu'au premier appel du plugin.
   */
  private async creerLeSchema(tx: Transaction, schema: string): Promise<void> {
    if (!SCHEMA_VALIDE.test(schema)) throw new BadRequestException(`Schema refuse : ${schema}`);

    await tx.execute(sql.raw(`CREATE SCHEMA ${schema}`));
    await tx.execute(sql.raw(`GRANT USAGE ON SCHEMA ${schema} TO flow_app`));
    await tx.execute(
      sql.raw(`
        DO $privileges$
        BEGIN
          EXECUTE format(
            'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA ${schema}
               GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO flow_app',
            current_user
          );
          EXECUTE format(
            'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA ${schema}
               GRANT USAGE, SELECT ON SEQUENCES TO flow_app',
            current_user
          );
        END;
        $privileges$
      `),
    );
  }

  /**
   * Joue les migrations du plugin, dans l'ordre de leurs noms, une seule fois.
   *
   * Le `search_path` pointe sur le schema du plugin : ses migrations ecrivent
   * `CREATE TABLE notes (...)` sans se soucier du prefixe, et un plugin ne peut
   * pas creer par megarde une table dans `public`. Pour poser une politique de
   * cloisonnement, il appelle `public.flow_in_scope` -- la meme fonction que le
   * coeur, ce qui est tout l'interet.
   */
  private async jouerLesMigrations(
    tx: Transaction,
    id: string,
    dossier: string,
    schema: string,
  ): Promise<void> {
    const chemin = join(dossier, DOSSIER_MIGRATIONS);

    let fichiers: string[];

    try {
      fichiers = (await readdir(chemin)).filter((nom) => nom.endsWith('.sql')).sort();
    } catch {
      this.logger.warn(`${id} demande un schema mais n'a pas de dossier ${DOSSIER_MIGRATIONS}.`);

      return;
    }

    const deja = await tx.execute<{ filename: string }>(sql`
      SELECT filename FROM plugin_migrations WHERE plugin_id = ${id}
    `);
    const jouees = new Set(deja.rows.map((ligne) => ligne.filename));

    await tx.execute(sql.raw(`SET LOCAL search_path TO ${schema}, public`));

    for (const fichier of fichiers) {
      if (jouees.has(fichier)) continue;

      const contenu = await readFile(join(chemin, fichier), 'utf8');

      await tx.execute(sql.raw(contenu));
      await tx.execute(sql`
        INSERT INTO plugin_migrations (plugin_id, filename) VALUES (${id}, ${fichier})
      `);

      this.logger.log(`${id} : migration ${fichier} jouee.`);
    }

    // Le chemin est rendu a sa valeur pour la suite de la transaction : elle
    // ecrit encore dans `public`, et une insertion qui atterrirait dans le
    // schema du plugin echouerait sur une table absente.
    await tx.execute(sql.raw('SET LOCAL search_path TO public'));
  }

  /** Efface tout ce que l'installation a pose. */
  private async effacer(id: string, schema: string | null): Promise<void> {
    await this.db.asOwner(async (tx) => {
      // Les droits accordes dans les profils partent avec le plugin. Les
      // laisser donnerait des cases cochees pour un droit que plus rien ne
      // declare -- invisibles dans la matrice, et pourtant en base.
      await tx.execute(sql`DELETE FROM profile_rights WHERE object LIKE ${`${id}.%`}`);

      if (schema !== null) {
        if (!SCHEMA_VALIDE.test(schema)) throw new Error(`Schema refuse : ${schema}`);

        await tx.execute(sql.raw(`DROP SCHEMA IF EXISTS ${schema} CASCADE`));
      }

      // Les migrations partent par cascade avec la ligne du plugin.
      await tx.execute(sql`DELETE FROM plugins WHERE id = ${id}`);
    });

    // Les droits sont mis en cache par profil : sans cette invalidation, un
    // plugin desinstalle continuerait d'autoriser ses routes jusqu'au prochain
    // redemarrage -- alors meme que ses tables n'existent plus.
    this.droits.invalidate();
  }
}
