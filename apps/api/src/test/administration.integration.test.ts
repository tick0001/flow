import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runWithContext } from '../common/request-context.js';
import { contexteDe, createFixture, type Fixture } from './fixtures.js';

/**
 * L'administration des comptes, contre une vraie base.
 *
 * Ces tests couvrent ce que le Row-Level Security **ne peut pas** couvrir :
 * `users` et `profiles` n'ont pas de politique, faute d'entite a laquelle les
 * rattacher. Leur confinement repose entierement sur une jointure ecrite dans le
 * service -- une ligne de SQL qu'un jour quelqu'un pourrait « simplifier ».
 *
 * C'est donc ici, et nulle part ailleurs, que se joue l'isolation des comptes.
 */
describe('Visibilite des comptes entre branches', () => {
  let fixture: Fixture;

  beforeAll(async () => {
    fixture = await createFixture('TEST-ADM');
  }, 30_000);

  afterAll(async () => {
    await fixture.cleanup();
  });

  const nomsVus = async (
    compte: string,
    entite: string,
    profil: string,
    recursif: boolean,
  ): Promise<string[]> => {
    const liste = await runWithContext(contexteDe(fixture, compte, entite, profil, recursif), () =>
      fixture.usersService.list(),
    );

    return liste.map((utilisateur) => utilisateur.username).sort();
  };

  it('confine un administrateur de branche aux comptes de sa branche', async () => {
    // Le test qui justifie l'existence de ce fichier. `users` n'ayant aucune
    // politique, un `SELECT` sans jointure rendrait ici les trois comptes -- et
    // rien, ni erreur ni avertissement, ne le signalerait.
    const vus = await nomsVus('locale', 'nord', 'locale', true);

    expect(vus).toEqual(['TEST-ADM-locale']);
  });

  it('ne montre pas le compte d’une branche soeur', async () => {
    const vus = await nomsVus('locale', 'nord', 'locale', true);

    expect(vus).not.toContain('TEST-ADM-ailleurs');
  });

  it('ne montre pas le compte habilite au-dessus', async () => {
    // Une habilitation descend, elle ne remonte pas : l'administrateur de la
    // racine est invisible depuis une branche, meme s'il y a tous les droits.
    const vus = await nomsVus('locale', 'nord', 'locale', true);

    expect(vus).not.toContain('TEST-ADM-patronne');
  });

  it('montre toute la descendance a une habilitation recursive sur la racine', async () => {
    const vus = await nomsVus('patronne', 'racine', 'admin', true);

    expect(vus).toEqual(['TEST-ADM-ailleurs', 'TEST-ADM-locale', 'TEST-ADM-patronne']);
  });

  it('referme le perimetre quand la recursion n’est pas demandee', async () => {
    // Meme compte, meme habilitation : seule la case « inclure les
    // sous-entites » change. La racine ne porte qu'elle-meme.
    const vus = await nomsVus('patronne', 'racine', 'admin', false);

    expect(vus).toEqual(['TEST-ADM-patronne']);
  });

  it('rend « inexistant » pour un compte simplement invisible', async () => {
    // Distinguer « invisible » de « inexistant » confirmerait l'existence d'un
    // compte d'une autre organisation -- un oracle a partir d'un identifiant.
    const patronne = fixture.userIds['patronne'];

    if (patronne === undefined) throw new Error('Fixture incomplete.');

    await expect(
      runWithContext(contexteDe(fixture, 'locale', 'nord', 'locale', true), () =>
        fixture.usersService.get(patronne),
      ),
    ).rejects.toThrow(/n'existe pas/i);
  });
});

describe('Habilitations', () => {
  let fixture: Fixture;

  beforeAll(async () => {
    fixture = await createFixture('TEST-HAB');
  }, 30_000);

  afterAll(async () => {
    await fixture.cleanup();
  });

  it('refuse d’accorder une habilitation hors du perimetre de celui qui accorde', async () => {
    // Sans ce refus, un administrateur de branche s'accorderait une
    // habilitation sur une autre branche et s'y ferait entrer. La politique
    // refuserait l'ecriture, mais le message serait muet.
    const locale = fixture.userIds['locale'];
    const siege = fixture.entityIds['siege'];
    const profilLocale = fixture.profileIds['locale'];

    if (locale === undefined || siege === undefined || profilLocale === undefined) {
      throw new Error('Fixture incomplete.');
    }

    await expect(
      runWithContext(contexteDe(fixture, 'locale', 'nord', 'locale', true), () =>
        fixture.usersService.grant(locale, {
          entityId: siege,
          profileId: profilLocale,
          isRecursive: false,
        }),
      ),
    ).rejects.toThrow(/perimetre/i);
  });

  it('refuse de retirer la derniere habilitation d’un compte', async () => {
    // Un compte sans habilitation disparait de toutes les listes -- y compris
    // de celle de qui vient de le lui retirer. Le rattraper demanderait du SQL.
    const ailleurs = fixture.userIds['ailleurs'];
    const siege = fixture.entityIds['siege'];
    const profilLocale = fixture.profileIds['locale'];

    if (ailleurs === undefined || siege === undefined || profilLocale === undefined) {
      throw new Error('Fixture incomplete.');
    }

    await expect(
      runWithContext(contexteDe(fixture, 'patronne', 'racine', 'admin', true), () =>
        fixture.usersService.revoke(ailleurs, siege, profilLocale),
      ),
    ).rejects.toThrow(/derniere habilitation/i);
  });
});

describe('Profils', () => {
  let fixture: Fixture;

  beforeAll(async () => {
    fixture = await createFixture('TEST-PRO');
  }, 30_000);

  afterAll(async () => {
    await fixture.cleanup();
  });

  it('refuse un droit absent du catalogue', async () => {
    // Sans ce controle, la table accepterait n'importe quel couple -- une faute
    // de frappe comprise -- et le droit resterait coche a l'ecran sans que rien
    // ne le consulte jamais.
    await expect(
      runWithContext(contexteDe(fixture, 'patronne', 'racine', 'admin', true), () =>
        fixture.profilesService.create({
          name: 'TEST-PRO inconnu',
          rights: [{ object: 'licorne', action: 'voler', scope: 'all' }],
        }),
      ),
    ).rejects.toThrow(/inconnus/i);
  });

  it('refuse une portee que l’objet n’accepte pas', async () => {
    // Une entite n'a pas d'auteur : `own` n'y signifie rien, et le proposer
    // donnerait un reglage qui ne filtre rien.
    await expect(
      runWithContext(contexteDe(fixture, 'patronne', 'racine', 'admin', true), () =>
        fixture.profilesService.create({
          name: 'TEST-PRO portee',
          rights: [{ object: 'entity', action: 'read', scope: 'own' }],
        }),
      ),
    ).rejects.toThrow(/portee inapplicable/i);
  });

  it('refuse de supprimer un profil encore utilise', async () => {
    // Une suppression en cascade retirerait leurs droits a des comptes d'autres
    // branches, que celui qui supprime ne voit meme pas.
    const profilLocale = fixture.profileIds['locale'];

    if (profilLocale === undefined) throw new Error('Fixture incomplete.');

    await expect(
      runWithContext(contexteDe(fixture, 'patronne', 'racine', 'admin', true), () =>
        fixture.profilesService.remove(profilLocale),
      ),
    ).rejects.toThrow(/habilitation/i);
  });
});
