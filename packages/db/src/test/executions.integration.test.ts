import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { entities, eq, executionLogs, executions, withRequestContext } from '../index.js';
import {
  createFixture,
  entityId,
  entityPath,
  exactly,
  motifDuRefus,
  seedExecution,
  withSubtree,
} from './fixtures.js';
import type { Fixture } from './fixtures.js';

/**
 * Cloisonnement des executions et de leurs journaux.
 *
 * Les executions sont la table qui grossit, celle qui porte des captures d'ecran
 * de pages authentifiees et des messages d'erreur bavards. Une fuite y est plus
 * couteuse que sur l'arbre des entites lui-meme -- d'ou ces tests, qui passent
 * par le role applicatif, celui que les politiques contraignent.
 */
describe('Cloisonnement des executions', () => {
  let fixture: Fixture;
  let deNord: string;
  let deSiege: string;

  beforeAll(async () => {
    fixture = await createFixture('TEST-EXEC');
    deNord = await seedExecution(fixture, 'nord');
    deSiege = await seedExecution(fixture, 'siege');
  }, 30_000);

  afterAll(async () => {
    await fixture.cleanup();
  });

  const chemin = (cle: string): string => entityPath(fixture, cle);

  it('ne montre aucune execution a une connexion sans contexte', async () => {
    const lignes = await fixture.app.db.select({ id: executions.id }).from(executions);

    expect(lignes).toEqual([]);
  });

  it('ne montre a une branche que les executions de son perimetre', async () => {
    const visibles = await withRequestContext(fixture.app.db, exactly(chemin('nord')), (tx) =>
      tx.select({ id: executions.id }).from(executions),
    );

    expect(visibles.map((e) => e.id)).toEqual([deNord]);
  });

  it('etend la visibilite a la descendance sur une habilitation recursive', async () => {
    const surSiteA = await seedExecution(fixture, 'siteA');

    const visibles = await withRequestContext(fixture.app.db, withSubtree(chemin('nord')), (tx) =>
      tx.select({ id: executions.id }).from(executions),
    );

    const ids = visibles.map((e) => e.id);

    expect(ids).toContain(deNord);
    expect(ids).toContain(surSiteA);
    // La branche soeur reste invisible : une habilitation descend, elle ne
    // traverse pas lateralement.
    expect(ids).not.toContain(deSiege);
  });

  it('fait suivre au journal la visibilite de son execution', async () => {
    // Une ligne de journal ne porte ni entite ni auteur : sa politique passe par
    // son execution. C'est ce qui garantit qu'elles ne peuvent pas diverger --
    // et ce test est ce qui garantit que la politique existe.
    const duNord = await withRequestContext(fixture.app.db, exactly(chemin('nord')), (tx) =>
      tx.select({ seq: executionLogs.seq }).from(executionLogs),
    );

    expect(duNord).toHaveLength(1);

    const duSiege = await withRequestContext(fixture.app.db, exactly(chemin('siege')), (tx) =>
      tx
        .select({ seq: executionLogs.seq })
        .from(executionLogs)
        .where(eq(executionLogs.executionId, deNord)),
    );

    expect(duSiege).toEqual([]);
  });

  it("refuse d'ecrire dans le journal d'une execution hors perimetre", async () => {
    // Le WITH CHECK, et non le USING : il ne s'agit plus de ce qu'on voit mais de
    // ce qu'on ecrit. Sans lui, un worker mal cable -- ou un plugin -- pourrait
    // deposer des lignes dans la trace d'une autre organisation.
    const motif = await motifDuRefus(
      withRequestContext(fixture.app.db, exactly(chemin('nord')), (tx) =>
        tx.insert(executionLogs).values({
          executionId: deSiege,
          seq: 99,
          level: 'error',
          message: 'Intrusion',
        }),
      ),
    );

    expect(motif).toMatch(/row-level security|policy/i);
  });

  it("emmene les executions d'une entite deplacee avec elle", async () => {
    // Le test qui decide de la forme des politiques.
    //
    // La premiere migration avait pose une fonction `sync_entity_path()` qui
    // recopiait le chemin de l'entite sur l'objet rattache, a l'ecriture. Rien
    // ne l'aurait propagee lors d'un deplacement : les executions seraient
    // restees visibles depuis l'ancienne branche et invisibles depuis la
    // nouvelle -- une fuite silencieuse, dans le sens le plus desagreable, celui
    // qui ne casse rien. Les politiques joignent donc `entities`, et ce test
    // echouerait si l'on revenait a une copie du chemin.
    const surSiteB = await seedExecution(fixture, 'siteB');

    await fixture.owner.db
      .update(entities)
      .set({ parentId: entityId(fixture, 'siege') })
      .where(eq(entities.id, entityId(fixture, 'siteB')));

    const [deplacee] = await fixture.owner.db
      .select({ path: entities.path })
      .from(entities)
      .where(eq(entities.id, entityId(fixture, 'siteB')));

    // Le declencheur a bien recompose le chemin : sans cela, le reste du test
    // verifierait une absence de changement plutot qu'un changement.
    expect(deplacee?.path).toContain(`e${String(entityId(fixture, 'siege'))}.`);

    // Visible depuis la nouvelle branche...
    const depuisSiege = await withRequestContext(
      fixture.app.db,
      withSubtree(chemin('siege')),
      (tx) => tx.select({ id: executions.id }).from(executions),
    );

    expect(depuisSiege.map((e) => e.id)).toContain(surSiteB);

    // ...et plus depuis l'ancienne.
    const depuisNord = await withRequestContext(fixture.app.db, withSubtree(chemin('nord')), (tx) =>
      tx.select({ id: executions.id }).from(executions),
    );

    expect(depuisNord.map((e) => e.id)).not.toContain(surSiteB);
  });
});
