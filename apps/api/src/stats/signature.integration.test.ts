import { afterAll, describe, expect, it } from 'vitest';
import { createDatabase, sql } from '@flow/db';
import { SIGNATURE_SQL } from './signature.js';

/**
 * La signature est une expression SQL : elle ne peut s'eprouver qu'en base.
 *
 * Le test n'a besoin ni de fixtures ni de droits -- il ne lit aucune table. Il
 * pose des messages a la main et regarde ce qui se regroupe. Ecrire les cas ici
 * plutot que d'attendre qu'ils surviennent en production est tout l'interet :
 * ces messages viennent de bibliotheques qu'on ne controle pas, et la regle
 * devra s'affiner. Ce fichier dit ce qu'elle a deja appris.
 */
const connexion = createDatabase({
  connectionString: process.env['DATABASE_URL'] ?? '',
  max: 1,
});

afterAll(async () => {
  await connexion.close();
});

async function signatures(messages: string[]): Promise<string[]> {
  const lignes = sql.join(
    messages.map((message) => sql`(${message})`),
    sql`, `,
  );

  const { rows } = await connexion.db.execute<{ signature: string }>(sql`
    SELECT ${sql.raw(SIGNATURE_SQL)} AS signature
    FROM (VALUES ${lignes}) AS x(message)
  `);

  return rows.map((ligne) => ligne.signature);
}

/** Combien de causes distinctes ces messages donnent-ils ? */
async function causes(messages: string[]): Promise<number> {
  return new Set(await signatures(messages)).size;
}

describe('la signature des echecs', () => {
  it('regroupe des delais d attente de durees differentes', async () => {
    // Le cas qui a motive la regle actuelle. Une premiere version exigeait une
    // frontiere de mot autour des nombres, et « 30000ms » ne se regroupait pas
    // avec « 45000ms » : le chiffre colle a son unite n'a pas de frontiere
    // apres lui. C'etait le message d'echec le plus frequent de tous.
    expect(
      await causes([
        'page.goto: Timeout 30000ms exceeded.',
        'page.goto: Timeout 45000ms exceeded.',
        'locator.click: Timeout 5s exceeded',
        'locator.click: Timeout 1.5s exceeded',
      ]),
    ).toBe(2);
  });

  it('regroupe des identifiants, des adresses et des valeurs citees', async () => {
    expect(
      await causes([
        'Execution 0f3b9a12-4c5d-4e6f-8a9b-1c2d3e4f5a6b introuvable',
        'Execution aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee introuvable',
      ]),
    ).toBe(1);

    expect(
      await causes([
        'navigating to "http://localhost:8899/page"',
        'navigating to "https://exemple.test/autre?x=2"',
      ]),
    ).toBe(1);

    expect(
      await causes([
        'Le selecteur « #form > input » est introuvable',
        'Le selecteur « .bouton-envoyer » est introuvable',
      ]),
    ).toBe(1);
  });

  it('ne regroupe pas deux causes differentes', async () => {
    // Le danger symetrique : une regle trop large ecraserait tout sur une seule
    // ligne, et l'ecran ne dirait plus rien.
    expect(
      await causes([
        'page.goto: Timeout 30000ms exceeded.',
        'Le selecteur « #form » est introuvable',
        'Execution 0f3b9a12-4c5d-4e6f-8a9b-1c2d3e4f5a6b introuvable',
      ]),
    ).toBe(3);
  });

  it('remplace les nombres sans abimer les identifiants', async () => {
    // L'ordre des substitutions : l'identifiant part avant les chiffres, sans
    // quoi il deviendrait « <n>-<n>-<n>-<n>-<n> » et deux identifiants de
    // formes differentes cesseraient de se ressembler.
    const [signature] = await signatures([
      'Execution 0f3b9a12-4c5d-4e6f-8a9b-1c2d3e4f5a6b introuvable apres 3 tentatives',
    ]);

    expect(signature).toBe('Execution <id> introuvable apres <n> tentatives');
  });

  it('ecrase les retours a la ligne et les espaces multiples', async () => {
    // Playwright envoie ses journaux d'appel sur plusieurs lignes ; sans cette
    // derniere passe, deux messages identiques au retour chariot pres feraient
    // deux causes.
    const [signature] = await signatures(['page.goto a echoue.\n  Call log:\n    - navigating']);

    expect(signature).toBe('page.goto a echoue. Call log: - navigating');
  });
});
