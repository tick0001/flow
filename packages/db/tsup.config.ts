import { defineConfig } from 'tsup';

export default defineConfig({
  // Deux points d'entree : la bibliotheque, et le lanceur de migrations. Ce
  // dernier tourne dans l'image des migrations, ou `tsx` n'existe pas -- une
  // dependance de developpement n'a rien a faire dans une image de production.
  entry: ['src/index.ts', 'src/migrate.ts'],
  format: ['esm', 'cjs'],
  dts: false,
  clean: true,
  sourcemap: true,
  target: 'es2023',
});
