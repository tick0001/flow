import { defineConfig } from 'vitest/config';
import { couverture } from '../../vitest.shared.mts';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
    coverage: couverture,
    // Les tests d'integration partagent une vraie base : les faire tourner en
    // parallele ferait qu'une fixture supprimerait ses entites pendant qu'une
    // autre les compte. Le cout est faible -- ils sont peu nombreux et brefs.
    fileParallelism: false,
  },
})
