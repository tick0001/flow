import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { entities, eq, sql, withRequestContext } from '../index.js';
import {
  combining,
  createFixture,
  entityId,
  entityPath,
  exactly,
  motifDuRefus,
  readAsOwner,
  withSubtree,
} from './fixtures.js';
import type { Fixture } from './fixtures.js';

/**
 * Les tests d'isolation, critere de sortie du jalon J1.
 *
 * Ils tournent contre une vraie base PostgreSQL **avec le role applicatif**,
 * celui qui subit le Row-Level Security. Les executer avec le role proprietaire
 * les ferait tous passer sans rien prouver -- c'est precisement le piege que le
 * preambule de migration ferme en creant `flow_app` dans le schema lui-meme
 * plutot que dans un script d'initialisation de conteneur, que l'integration
 * continue n'executerait pas.
 */
describe('Isolation entre entites', () => {
  let fixture: Fixture;

  beforeAll(async () => {
    fixture = await createFixture('TEST-ISO');
  }, 30_000);

  afterAll(async () => {
    await fixture.cleanup();
  });

  const chemin = (cle: string): string => entityPath(fixture, cle);
  const id = (cle: string): number => entityId(fixture, cle);

  it('ne montre rien a une connexion sans contexte', async () => {
    // L'invariant le plus important du dispositif : le defaut penche du cote du
    // refus. Une connexion qui n'a pas ouvert de contexte -- une tache de fond
    // mal ecrite, un script -- voit un perimetre vide, jamais un perimetre
    // total. `current_setting(..., true)` rend cela possible en renvoyant NULL
    // plutot qu'en levant une erreur.
    const lignes = await fixture.app.db.select({ id: entities.id }).from(entities);

    expect(lignes).toEqual([]);
  });

  it('confine une habilitation simple a sa seule entite', async () => {
    const visibles = await withRequestContext(fixture.app.db, exactly(chemin('nord')), (tx) =>
      tx.select({ id: entities.id }).from(entities),
    );

    expect(visibles.map((e) => e.id)).toEqual([id('nord')]);
  });

  it('ouvre la descendance a une habilitation recursive, et elle seule', async () => {
    const visibles = await withRequestContext(fixture.app.db, withSubtree(chemin('nord')), (tx) =>
      tx.select({ id: entities.id }).from(entities),
    );

    const ids = visibles.map((e) => e.id).sort((a, b) => a - b);

    expect(ids).toEqual([id('nord'), id('siteA'), id('siteB')].sort((a, b) => a - b));
    // La branche soeur reste invisible : une habilitation descend, elle ne
    // traverse jamais lateralement.
    expect(ids).not.toContain(id('siege'));
    // Et elle ne remonte pas non plus vers la racine.
    expect(ids).not.toContain(id('racine'));
  });

  it('confine aussi une requete SQL brute, comme en ecrirait un plugin', async () => {
    // Le point entier du Row-Level Security. Le filtrage applicatif est la
    // premiere ligne ; celle-ci rattrape le code qui ne passe pas par elle.
    const lignes = await withRequestContext(
      fixture.app.db,
      exactly(chemin('siteA')),
      async (tx) => {
        const resultat = await tx.execute<{ id: number }>(sql`SELECT id FROM entities`);

        return resultat.rows;
      },
    );

    expect(lignes.map((l) => l.id)).toEqual([id('siteA')]);
  });

  it('cumule deux habilitations sans les fondre', async () => {
    // Un compte technicien sur toute la branche Nord, et simple observateur sur
    // le Siege. Il voit les deux, mais le Siege sans sa descendance -- si bien
    // qu'un cumul n'elargit jamais une habilitation simple en recursive.
    const visibles = await withRequestContext(
      fixture.app.db,
      combining(chemin('nord'), {
        subtreePaths: [chemin('nord')],
        exactPaths: [chemin('siege')],
      }),
      (tx) => tx.select({ id: entities.id }).from(entities),
    );

    const ids = visibles.map((e) => e.id);

    expect(ids).toContain(id('siteA'));
    expect(ids).toContain(id('siege'));
    expect(ids).not.toContain(id('racine'));
  });

  it('refuse une ecriture visant une entite hors perimetre', async () => {
    const avant = await readAsOwner(fixture, id('siege'));

    await withRequestContext(fixture.app.db, withSubtree(chemin('nord')), (tx) =>
      tx
        .update(entities)
        .set({ name: 'Detourne' })
        .where(eq(entities.id, id('siege'))),
    );

    // La mise a jour ne leve pas : elle ne trouve simplement aucune ligne a
    // modifier, puisque la politique la rend invisible. Un test qui n'attendrait
    // qu'une exception passerait donc a cote.
    const apres = await readAsOwner(fixture, id('siege'));

    expect(apres?.completeName).toBe(avant?.completeName);
    expect(apres?.completeName).not.toContain('Detourne');
  });

  it('refuse de creer sous un parent hors perimetre', async () => {
    // Le refus vient du declencheur, qui lit lui-meme sous les politiques : le
    // parent lui est invisible, donc « introuvable ». Le message ne distingue
    // pas les deux, et c'est voulu -- le distinguer confirmerait l'existence
    // d'une entite d'une autre organisation.
    const motif = await motifDuRefus(
      withRequestContext(fixture.app.db, withSubtree(chemin('nord')), (tx) =>
        tx.insert(entities).values({
          name: 'Intrusion',
          parentId: id('siege'),
          path: 'temporaire',
          completeName: 'Intrusion',
        }),
      ),
    );

    expect(motif).toMatch(/introuvable/i);
  });
});

/**
 * L'arbre lui-meme : ce que le schema seul ne peut pas garantir.
 */
describe("Coherence de l'arbre", () => {
  let fixture: Fixture;

  beforeAll(async () => {
    fixture = await createFixture('TEST-ARBRE');
  }, 30_000);

  afterAll(async () => {
    await fixture.cleanup();
  });

  const id = (cle: string): number => entityId(fixture, cle);

  it('compose le chemin et le nom complet depuis le parent', async () => {
    const racine = await readAsOwner(fixture, id('racine'));
    const siteA = await readAsOwner(fixture, id('siteA'));

    expect(racine?.path).toBe(`e${String(id('racine'))}`);
    // Le chemin est bati sur les identifiants, jamais sur les noms : il survit
    // ainsi a un renommage et ne peut pas entrer en collision.
    expect(siteA?.path).toBe(
      `e${String(id('racine'))}.e${String(id('nord'))}.e${String(id('siteA'))}`,
    );
    expect(siteA?.completeName).toBe(
      'TEST-ARBRE Racine > TEST-ARBRE Filiale Nord > TEST-ARBRE Site A',
    );
  });

  it('propage un deplacement a toute la descendance', async () => {
    // Le cas qui justifie le chemin materialise. Avec des caches d'ancetres et
    // de descendants, ce deplacement demanderait de les invalider tous ; ici
    // c'est une mise a jour de prefixe qui redescend par le declencheur.
    await fixture.owner.db
      .update(entities)
      .set({ parentId: id('siege') })
      .where(eq(entities.id, id('nord')));

    const siteA = await readAsOwner(fixture, id('siteA'));

    expect(siteA?.path).toBe(
      `e${String(id('racine'))}.e${String(id('siege'))}.e${String(id('nord'))}.e${String(id('siteA'))}`,
    );
    expect(siteA?.completeName).toContain('TEST-ARBRE Siege > TEST-ARBRE Filiale Nord');

    // Et la visibilite bascule immediatement : le nouveau parent voit ce qu'il
    // ne voyait pas.
    const visibles = await withRequestContext(
      fixture.app.db,
      withSubtree(`e${String(id('racine'))}.e${String(id('siege'))}`),
      (tx) => tx.select({ id: entities.id }).from(entities),
    );

    expect(visibles.map((e) => e.id)).toContain(id('siteA'));
  });

  it('refuse de rendre une entite sa propre descendante', async () => {
    // Sans ce garde-fou, le sous-arbre se detacherait du reste sans qu'aucune
    // erreur ne soit levee : il deviendrait invisible, et les objets rattaches
    // avec lui.
    const motif = await motifDuRefus(
      fixture.owner.db
        .update(entities)
        .set({ parentId: id('siteA') })
        .where(eq(entities.id, id('nord'))),
    );

    expect(motif).toMatch(/propre descendante/i);
  });
});
