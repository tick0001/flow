import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  // ESM seul : le worker charge le bot par un `import()` ordinaire.
  format: ['esm'],
  dts: false,
  clean: true,
  sourcemap: true,
  target: 'es2023',
  // Le SDK est fourni par le worker, comme Playwright : les embarquer donnerait
  // deux copies du meme code et, pour Playwright, deux instances du pilote.
  external: ['@flow/bot-sdk', 'playwright'],
});
