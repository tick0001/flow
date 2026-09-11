import { defineConfig } from 'tsup';

export default defineConfig({
  // La bibliotheque qu'un plugin importe, et l'outil qui produit son manifeste.
  entry: ['src/index.ts', 'src/cli.ts'],
  format: ['esm', 'cjs'],
  dts: false,
  clean: true,
  sourcemap: true,
  target: 'es2023',
});
