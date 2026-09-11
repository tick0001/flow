import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from '@flow/db';
import { schemaDuPlugin } from '@flow/contracts';
import { runWithContext } from '../common/request-context.js';
import { RightsService } from '../auth/rights.service.js';
import { RightsCatalogService } from '../admin/rights-catalog.service.js';
import { contexteDe, createFixture, type Fixture } from '../test/fixtures.js';
import { contextePour } from './contexte.js';
import { PluginRegistryService } from './registre.service.js';
import { PluginHostService } from './hote.service.js';
import { PluginInstallerService } from './installateur.service.js';
import { PluginHooksService } from './hooks.service.js';

const PLUGIN = 'exemple-carnet';
const SCHEMA = schemaDuPlugin(PLUGIN);

/**
 * Le plugin de reference, installe pour de vrai, contre une vraie base.
 *
 * **C'est le critere de sortie du jalon J8**, et il ne peut pas s'ecrire
 * autrement : chaque point d'extension touche soit PostgreSQL, soit le
 * chargement de modules, soit les deux. Un test a doublures ne dirait rien --
 * il verifierait que les doublures sont d'accord entre elles.
 *
 * Le plugin qu'on installe ici est celui du depot, construit par `pnpm build`.
 * S'il n'est pas construit, le test le dit plutot que de passer a cote.
 *
 * Il prend et rend le plugin : il le desinstalle en entrant s'il etait la, et en
 * sortant dans tous les cas. Sur une base de developpement ou il etait installe,
 * il faudra donc le reinstaller -- c'est le prix d'un test qui eprouve
 * l'installation elle-meme.
 */
describe('Le cycle de vie d un plugin', () => {
  let fixture: Fixture;
  let registre: PluginRegistryService;
  let hote: PluginHostService;
  let installateur: PluginInstallerService;
  let hooks: PluginHooksService;
  let catalogue: RightsCatalogService;

  /** Une requete du role proprietaire, pour constater ce qui existe vraiment. */
  const constater = async <L extends Record<string, unknown>>(
    requete: ReturnType<typeof sql>,
  ): Promise<L[]> => {
    const resultat = await fixture.owner.db.execute(requete);

    return resultat.rows as unknown as L[];
  };

  beforeAll(async () => {
    fixture = await createFixture('TEST-PLUGIN');

    catalogue = new RightsCatalogService();
    registre = new PluginRegistryService();
    hote = new PluginHostService(catalogue);
    installateur = new PluginInstallerService(
      fixture.db,
      registre,
      hote,
      new RightsService(fixture.db),
    );
    hooks = new PluginHooksService(hote, fixture.db);

    await registre.relire();

    const decouvert = registre.get(PLUGIN);

    if (!decouvert?.manifest) {
      throw new Error(
        `${PLUGIN} introuvable ou refuse (${decouvert?.reason ?? 'absent'}). Lancez « pnpm build ».`,
      );
    }

    // La base de developpement le porte peut-etre deja : on part d'une table
    // rase, sans quoi l'installation echouerait sur un doublon.
    if ((await installateur.installes()).some((ligne) => ligne.id === PLUGIN)) {
      await installateur.desinstaller(PLUGIN);
    }

    await installateur.installer(PLUGIN);
  }, 60_000);

  afterAll(async () => {
    if ((await installateur.installes()).some((ligne) => ligne.id === PLUGIN)) {
      await installateur.desinstaller(PLUGIN);
    }

    await fixture.cleanup();
  });

  it('cree le schema du plugin et joue ses migrations', async () => {
    const schemas = await constater<{ nspname: string }>(
      sql`SELECT nspname FROM pg_namespace WHERE nspname = ${SCHEMA}`,
    );
    const tables = await constater<{ tablename: string }>(
      sql`SELECT tablename FROM pg_tables WHERE schemaname = ${SCHEMA} ORDER BY tablename`,
    );
    const migrations = await constater<{ filename: string }>(
      sql`SELECT filename FROM plugin_migrations WHERE plugin_id = ${PLUGIN}`,
    );

    expect(schemas).toHaveLength(1);
    expect(tables.map((table) => table.tablename)).toEqual(['bots_geles', 'notes']);
    expect(migrations).toHaveLength(1);
  });

  it('declare ses droits au catalogue, prefixes de son identifiant', () => {
    // Le prefixe n'est pas cosmetique : sans lui, deux plugins qui declarent
    // chacun « note:read » partagent le meme droit, et desinstaller l'un
    // retirerait les droits de l'autre.
    const droits = catalogue.all().filter((droit) => droit.object.startsWith(`${PLUGIN}.`));

    expect(droits.map((droit) => `${droit.object}:${droit.action}`)).toEqual([
      `${PLUGIN}.note:read`,
      `${PLUGIN}.note:write`,
    ]);
    expect(droits[0]?.label?.fr).toBe('Voir le carnet');
  });

  it('accroche le lancement, et laisse passer ce qui n est pas gele', async () => {
    await expect(
      runWithContext(contexteDe(fixture, 'patronne', 'racine', 'admin', true), () =>
        hooks.avantLancement({
          botId: 'exemple.bonjour',
          botName: 'Bonjour',
          parameters: {},
          entityPath: fixture.paths['racine'] ?? '',
          userId: fixture.userIds['patronne'] ?? 0,
        }),
      ),
    ).resolves.toBeUndefined();
  });

  it('refuse le lancement d un bot gele, avec le motif du plugin', async () => {
    await geler('racine', 'exemple.bonjour', 'inventaire');

    await expect(
      runWithContext(contexteDe(fixture, 'patronne', 'racine', 'admin', true), () =>
        hooks.avantLancement({
          botId: 'exemple.bonjour',
          botName: 'Bonjour',
          parameters: {},
          entityPath: fixture.paths['racine'] ?? '',
          userId: fixture.userIds['patronne'] ?? 0,
        }),
      ),
    ).rejects.toThrow(/inventaire/);
  });

  it('ne fait pas deborder un gel d une branche sur une autre', async () => {
    // Le gel est pose sur la racine ; la filiale ne le voit pas, et le plugin
    // n'a pourtant pas une seule clause d'entite. C'est la politique de sa
    // table qui le decide -- la meme fonction que celle du coeur.
    await expect(
      runWithContext(contexteDe(fixture, 'locale', 'nord', 'locale', true), () =>
        hooks.avantLancement({
          botId: 'exemple.bonjour',
          botName: 'Bonjour',
          parameters: {},
          entityPath: fixture.paths['nord'] ?? '',
          userId: fixture.userIds['locale'] ?? 0,
        }),
      ),
    ).resolves.toBeUndefined();
  });

  it('ecrit ses notes sur l evenement, sous le contexte de l execution', async () => {
    const charge = hote.get(PLUGIN);

    expect(charge).toBeDefined();

    await runWithContext(contexteDe(fixture, 'patronne', 'racine', 'admin', true), async () => {
      const contexte = contextePour(fixture.db, PLUGIN, SCHEMA, {
        userId: fixture.userIds['patronne'] ?? 0,
        profileId: fixture.profileIds['admin'] ?? 0,
        entityPath: fixture.paths['racine'] ?? '',
        scope: { subtreePaths: [], exactPaths: [fixture.paths['racine'] ?? ''] },
      });

      await charge?.instance.events?.['execution.terminee']?.(contexte, {
        executionId: '00000000-0000-0000-0000-000000000001',
        botId: 'exemple.bonjour',
        entityPath: fixture.paths['racine'] ?? '',
        userId: fixture.userIds['patronne'] ?? 0,
        status: 'succeeded',
        durationMs: 4200,
        message: null,
      });
    });

    const notes = await constater<{ texte: string }>(sql.raw(`SELECT texte FROM ${SCHEMA}.notes`));

    expect(notes.map((note) => note.texte)).toContain('Issue : succeeded en 4 s.');
  });

  it('ne laisse pas une branche lire les notes d une autre', async () => {
    // La preuve qui porte tout le jalon : une extension n'invente pas son
    // isolation, elle declare une politique et herite de celle du coeur.
    const vues = await runWithContext(
      contexteDe(fixture, 'locale', 'nord', 'locale', true),
      async () => {
        const contexte = contextePour(fixture.db, PLUGIN, SCHEMA, {
          userId: fixture.userIds['locale'] ?? 0,
          profileId: fixture.profileIds['locale'] ?? 0,
          entityPath: fixture.paths['nord'] ?? '',
          scope: { subtreePaths: [fixture.paths['nord'] ?? ''], exactPaths: [] },
        });

        return contexte.requete<{ texte: string }>('SELECT texte FROM notes');
      },
    );

    expect(vues).toHaveLength(0);
  });

  it('rend ses propres lignes par une vue', async () => {
    const charge = hote.get(PLUGIN);
    const vue = charge?.instance.views?.find((candidate) => candidate.name === 'notes');

    expect(vue).toBeDefined();

    const lignes = await runWithContext(
      contexteDe(fixture, 'patronne', 'racine', 'admin', true),
      async () =>
        (await vue?.run(
          contextePour(fixture.db, PLUGIN, SCHEMA, {
            userId: fixture.userIds['patronne'] ?? 0,
            profileId: fixture.profileIds['admin'] ?? 0,
            entityPath: fixture.paths['racine'] ?? '',
            scope: { subtreePaths: [], exactPaths: [fixture.paths['racine'] ?? ''] },
          }),
          { executionId: '00000000-0000-0000-0000-000000000001' },
        )) as { texte: string }[],
    );

    expect(lignes).toHaveLength(1);
  });

  it('purge ses vieilles lignes par sa tache de fond', async () => {
    await fixture.owner.db.execute(
      sql.raw(`
        INSERT INTO ${SCHEMA}.notes (execution_id, entity_path, texte, created_at)
        SELECT NULL, '${fixture.paths['racine'] ?? ''}'::public.ltree, 'ancienne',
               now() - interval '400 days'
      `),
    );

    const tache = hote.get(PLUGIN)?.instance.tasks?.[0];

    expect(tache).toBeDefined();

    // Sans acteur : une tache de fond voit toute l'installation, et c'est ce
    // qu'il lui faut pour purger.
    await tache?.run(contextePour(fixture.db, PLUGIN, SCHEMA, null));

    const restantes = await constater<{ texte: string }>(
      sql.raw(`SELECT texte FROM ${SCHEMA}.notes WHERE texte = 'ancienne'`),
    );

    expect(restantes).toHaveLength(0);
  });

  it('ne laisse aucune trace une fois desinstalle', async () => {
    // La promesse la plus engageante du jalon, et donc celle qu'il faut tenir
    // par un test : le schema, les migrations, la ligne, les droits accordes
    // dans les profils et les droits du catalogue s'en vont ensemble.
    const profil = fixture.profileIds['admin'] ?? 0;

    await fixture.owner.db.execute(sql`
      INSERT INTO profile_rights (profile_id, object, action, scope)
      VALUES (${profil}, ${`${PLUGIN}.note`}, 'read', 'all')
    `);

    await installateur.desinstaller(PLUGIN);

    const schemas = await constater(sql`SELECT 1 FROM pg_namespace WHERE nspname = ${SCHEMA}`);
    const lignes = await constater(sql`SELECT 1 FROM plugins WHERE id = ${PLUGIN}`);
    const migrations = await constater(
      sql`SELECT 1 FROM plugin_migrations WHERE plugin_id = ${PLUGIN}`,
    );
    const droits = await constater(
      sql`SELECT 1 FROM profile_rights WHERE object LIKE ${`${PLUGIN}.%`}`,
    );

    expect(schemas).toHaveLength(0);
    expect(lignes).toHaveLength(0);
    expect(migrations).toHaveLength(0);
    expect(droits).toHaveLength(0);
    expect(catalogue.all().filter((droit) => droit.object.startsWith(`${PLUGIN}.`))).toHaveLength(
      0,
    );
    expect(hote.estCharge(PLUGIN)).toBe(false);
  });

  it('refuse un manifeste ecrit pour une autre majeure, sans charger le module', () => {
    // La seule verification que l'application puisse faire de l'exterieur. Une
    // fois le module importe, le plugin est dans le processus.
    const decouvert = registre.get(PLUGIN);

    expect(decouvert?.manifest?.sdk).toBe(1);
  });

  /** Gele un bot dans une branche, avec le role proprietaire. */
  const geler = async (entite: string, botId: string, motif: string): Promise<void> => {
    await fixture.owner.db.execute(
      sql.raw(`
        INSERT INTO ${SCHEMA}.bots_geles (bot_id, entity_path, motif)
        VALUES ('${botId}', '${fixture.paths[entite] ?? ''}'::public.ltree, '${motif}')
      `),
    );
  };
});
