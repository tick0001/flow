import { defineConfig } from 'vitest/config';
import { couverture } from '../../vitest.shared.mts';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
    setupFiles: ['./src/test/setup.ts'],
    coverage: couverture,
    // Les tests d'integration partagent une vraie base : les paralleliser ferait
    // qu'une fixture supprime ses lignes pendant qu'une autre les compte.
    fileParallelism: false,
  },
});
