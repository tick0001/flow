import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: false,
  clean: true,
  sourcemap: true,
  target: 'es2023',
  // `ldapts` reste externe : le module est importe par l'API, qui resout ses
  // dependances depuis le dossier du plugin comme n'importe quel paquet Node.
  external: ['ldapts'],
});
