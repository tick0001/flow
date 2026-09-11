import { defineConfig } from 'vitest/config';
import { couverture } from '../../vitest.shared.mts';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
    setupFiles: ['./src/test/setup.ts'],
    coverage: couverture,
    // Les tests d'integration partagent une vraie base et un vrai navigateur :
    // les paralleliser ferait se disputer les memes lignes, et lancer autant de
    // Chromium que de fichiers.
    fileParallelism: false,
    // Un run reel ouvre un navigateur : le delai par defaut de cinq secondes
    // suffit rarement au premier, qui demarre le pilote.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
