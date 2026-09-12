import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { sql } from '@flow/db';
import { runWithContext } from '../common/request-context.js';
import { contexteDe, createFixture, type Fixture } from '../test/fixtures.js';
import { BotRulesService } from './bot-rules.service.js';

const BOT = 'test.regles';
const AUTRE = 'test.regles.autre';

/**
 * Les regles de mise a disposition, contre une vraie base.
 *
 * Deux choses ne peuvent pas se verifier autrement, et ce sont les deux qui
 * cassent silencieusement :
 *
 *  1. **La resolution lit au-dessus du perimetre.** Une regle posee sur la
 *     racine, recursive, ouvre le bot a toute l'installation -- y compris a
 *     quelqu'un habilite trois niveaux plus bas, qui ne voit pas cette ligne.
 *     Resolue sous le role applicatif, elle disparaitrait de sa vue et le bot
 *     serait declare ferme : le refus porterait exactement sur les bots ouverts
 *     le plus largement, ce qu'aucun test a doublures ne montrerait.
 *
 *  2. **La gestion, elle, ne lit pas au-dessus.** L'administrateur d'une
 *     branche ne doit ni voir ni retirer une regle posee au-dessus de lui, et
 *     ne doit pas pouvoir en poser une ailleurs que chez lui.
 */
describe('Les regles de mise a disposition des bots', () => {
  let fixture: Fixture;
  let regles: BotRulesService;

  beforeAll(async () => {
    fixture = await createFixture('TEST-REGLES');
    regles = new BotRulesService(fixture.db);
  });

  afterEach(async () => {
    await fixture.owner.db.execute(sql`DELETE FROM bot_rules WHERE bot_id IN (${BOT}, ${AUTRE})`);
  });

  afterAll(async () => {
    await fixture.cleanup();
  });

  /** Pose une regle par le role proprietaire, sans passer par le cloisonnement. */
  const poser = async (
    entite: string,
    recursive: boolean,
    profil: string | null,
  ): Promise<void> => {
    const entityId = fixture.entityIds[entite];
    const profileId = profil === null ? null : (fixture.profileIds[profil] ?? null);

    await fixture.owner.db.execute(sql`
      INSERT INTO bot_rules (bot_id, entity_id, is_recursive, profile_id)
      VALUES (${BOT}, ${entityId}, ${recursive}, ${profileId})
    `);
  };

  const disponible = async (compte: string, entite: string, profil: string): Promise<boolean> => {
    const context = contexteDe(fixture, compte, entite, profil, false);

    return runWithContext(context, () =>
      regles.estDisponible(BOT, context.profileId, context.entityPath),
    );
  };

  describe('la resolution', () => {
    it('refuse un bot qu aucune regle n ouvre', async () => {
      // L'absence de ligne vaut refus, comme partout ailleurs dans le modele.
      await expect(disponible('locale', 'nord', 'locale')).resolves.toBe(false);
    });

    it('ouvre le bot sur l entite visee', async () => {
      await poser('nord', false, null);

      await expect(disponible('locale', 'nord', 'locale')).resolves.toBe(true);
    });

    it('n ouvre pas le parent depuis une regle posee sur l enfant', async () => {
      // Une execution nait dans l'entite active : un bot ouvert seulement en bas
      // ne doit pas etre lancable depuis le haut, ou sa trace atterrirait dans
      // une entite ou il n'est pas ouvert.
      await poser('nord', true, null);

      await expect(disponible('patronne', 'racine', 'admin')).resolves.toBe(false);
    });

    it('ouvre la descendance quand la regle est recursive', async () => {
      await poser('racine', true, null);

      await expect(disponible('locale', 'nord', 'locale')).resolves.toBe(true);
    });

    it('n ouvre pas la descendance quand la regle ne l est pas', async () => {
      await poser('racine', false, null);

      await expect(disponible('locale', 'nord', 'locale')).resolves.toBe(false);
    });

    it('voit une regle posee AU-DESSUS du perimetre de travail', async () => {
      // **Le test qui compte.** « locale » n'est habilitee que sur `nord` : la
      // racine est au-dessus de son perimetre, et la politique de `bot_rules`
      // lui cache cette ligne. La resolution passe donc par le role
      // proprietaire -- sans quoi le bot le plus largement ouvert de
      // l'installation serait declare ferme.
      await poser('racine', true, null);

      const context = contexteDe(fixture, 'locale', 'nord', 'locale', false);

      // Ce que la gestion voit : rien, et c'est voulu.
      const vues = await runWithContext(context, () => regles.list());

      expect(vues).toHaveLength(0);

      // Ce que la resolution conclut : ouvert.
      await expect(disponible('locale', 'nord', 'locale')).resolves.toBe(true);
    });
  });

  describe('le profil', () => {
    it('ouvre a tous les profils quand la regle n en vise aucun', async () => {
      await poser('racine', true, null);

      await expect(disponible('locale', 'nord', 'locale')).resolves.toBe(true);
      await expect(disponible('patronne', 'racine', 'admin')).resolves.toBe(true);
    });

    it('n ouvre qu au profil vise quand la regle en nomme un', async () => {
      await poser('racine', true, 'locale');

      await expect(disponible('locale', 'nord', 'locale')).resolves.toBe(true);
      // Meme entite, meme bot, autre profil : ferme.
      await expect(disponible('patronne', 'racine', 'admin')).resolves.toBe(false);
    });
  });

  describe('la gestion', () => {
    it('refuse de poser une regle hors du perimetre', async () => {
      const context = contexteDe(fixture, 'locale', 'nord', 'locale', false);
      const siege = fixture.entityIds['siege'];

      if (siege === undefined) throw new Error('Fixture incomplete.');

      // « locale » n'est habilitee que sur `nord`. Poser une regle sur le siege
      // reviendrait a decider quel code s'y executera.
      await expect(
        runWithContext(context, () =>
          regles.create({ botId: BOT, entityId: siege, isRecursive: true }),
        ),
      ).rejects.toThrow();
    });

    it('ne retire pas une regle hors du perimetre', async () => {
      await poser('siege', false, null);

      const context = contexteDe(fixture, 'locale', 'nord', 'locale', false);
      const [ligne] = await fixture.owner.db
        .execute<{ id: number }>(sql`SELECT id FROM bot_rules WHERE bot_id = ${BOT}`)
        .then((r) => r.rows);

      if (!ligne) throw new Error('Regle non posee.');

      // « introuvable » et non « interdit » : distinguer confirmerait
      // l'existence d'une regle qu'on n'a pas le droit de voir.
      await expect(runWithContext(context, () => regles.remove(ligne.id))).rejects.toThrow(
        /introuvable/i,
      );

      const restantes = await fixture.owner.db.execute(
        sql`SELECT id FROM bot_rules WHERE bot_id = ${BOT}`,
      );

      expect(restantes.rows).toHaveLength(1);
    });

    it('refuse deux fois la meme regle', async () => {
      const context = contexteDe(fixture, 'locale', 'nord', 'locale', false);
      const demande = { botId: BOT, entityId: fixture.entityIds['nord'] ?? 0, isRecursive: true };

      await runWithContext(context, () => regles.create(demande));

      await expect(runWithContext(context, () => regles.create(demande))).rejects.toThrow(
        /existe deja/i,
      );
    });

    it('refuse deux regles « tous profils » sur le meme couple', async () => {
      // PostgreSQL tient deux NULL pour differents : sans l'index partiel pose a
      // la main, ce doublon passerait, et retirer l'une des deux laisserait
      // l'autre ouvrir le bot -- un retrait de droit sans effet.
      await poser('nord', true, null);

      await expect(poser('nord', true, null)).rejects.toThrow();
    });
  });
});
