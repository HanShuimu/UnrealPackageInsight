import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['apps/desktop/renderer-src/src/**/*.test.{ts,tsx}'],
    passWithNoTests: true,
    setupFiles: ['apps/desktop/renderer-src/src/test/setup.ts'],
  },
});
