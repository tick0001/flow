import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  // ESM seulement : l'API importe le module par `import()`, jamais par `require`.
  format: ['esm'],
  dts: false,
  clean: true,
  sourcemap: true,
  target: 'es2023',
});
