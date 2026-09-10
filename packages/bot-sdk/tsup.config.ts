import { defineConfig } from 'tsup';

export default defineConfig({
  // Deux points d'entree : la bibliotheque qu'un bot importe, et l'outil qui
  // produit son manifeste. Le second n'a rien a faire dans le bundle du premier.
  entry: ['src/index.ts', 'src/cli.ts'],
  format: ['esm', 'cjs'],
  dts: false,
  clean: true,
  sourcemap: true,
  target: 'es2023',
});
