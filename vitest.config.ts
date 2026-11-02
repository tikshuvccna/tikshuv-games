import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'text'],
      include: ['packages/core/src/**', 'packages/save/src/**', 'packages/dialogue/src/**'],
      // entry/barrel files and the CLI wrapper carry no logic worth measuring
      exclude: ['**/*.test.ts', '**/index.ts', 'packages/dialogue/src/cli.ts'],
      thresholds: {
        'packages/core/src/**': { lines: 80 },
        'packages/save/src/**': { lines: 80 },
        'packages/dialogue/src/**': { lines: 80 },
      },
    },
  },
});
