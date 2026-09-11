import { defineConfig, devices } from '@playwright/test';

/**
 * Les parcours de bout en bout.
 *
 * **Contre la pile reelle, jamais contre des doublures.** Un parcours qui
 * interrogerait une API simulee verifierait que la simulation est d'accord avec
 * elle-meme ; celui-ci ouvre un vrai navigateur sur la vraie interface, qui
 * parle a la vraie API, qui ecrit dans la vraie base -- avec ses politiques de
 * Row-Level Security, qui sont precisement ce que le parcours du cloisonnement
 * doit eprouver.
 *
 * Les serveurs deja lances sont **reutilises** : sur un poste de developpement
 * ils tournent en permanence, et les relancer pour chaque campagne couterait une
 * minute a chaque fois. En integration continue, rien ne tourne, et Playwright
 * les demarre.
 *
 * Le worker, lui, n'est pas demarre ici : il n'ecoute aucun port, et Playwright
 * ne saurait pas dire quand il est pret. Le parcours du cycle d'une execution
 * l'exige donc, et le dit clairement s'il manque -- plutot que d'attendre deux
 * minutes une execution que personne ne depile.
 */
const BASE = process.env['E2E_BASE_URL'] ?? 'http://localhost:5273';

export default defineConfig({
  testDir: './parcours',
  // Les parcours partagent une base : deux campagnes en parallele se marcheraient
  // sur les pieds, et l'echec serait intermittent -- le pire a diagnostiquer.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env['CI']),
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? [['github'], ['list']] : [['list']],
  timeout: 60_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: BASE,
    locale: 'fr-FR',
    // La trace du premier echec suffit a comprendre : elle porte les captures,
    // le DOM et le reseau. La garder pour les reussites remplirait le disque.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: [
    {
      command: 'pnpm --filter @flow/api start',
      url: 'http://localhost:3100/api/health',
      reuseExistingServer: !process.env['CI'],
      timeout: 120_000,
      cwd: '../..',
    },
    {
      command: 'pnpm --filter @flow/web dev',
      url: BASE,
      reuseExistingServer: !process.env['CI'],
      timeout: 120_000,
      cwd: '../..',
    },
  ],
});
