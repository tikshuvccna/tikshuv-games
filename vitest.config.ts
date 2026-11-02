import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'text'],
      include: ['packages/core/src/**', 'packages/save/src/**', 'packages/dialogue/src/**', 'packages/net-sim/src/**', 'packages/quiz/src/**', 'packages/sim-kit/src/**',
        'packages/terminal-ui/src/{backend,history,completion,session}.ts',
      ],
      // entry/barrel files and the CLI wrapper carry no logic worth measuring
      exclude: ['**/*.test.ts', '**/index.ts', 'packages/dialogue/src/cli.ts', 'packages/quiz/src/renderer.ts',
        // sim-kit stage.ts is the DOM painter (no jsdom); its logic lives in controller.ts/scene.ts
        'packages/sim-kit/src/stage.ts'],
      thresholds: {
        'packages/core/src/**': { lines: 80 },
        'packages/save/src/**': { lines: 80 },
        'packages/dialogue/src/**': { lines: 80 },
        'packages/net-sim/src/**': { lines: 80 },
        'packages/sim-kit/src/**': { lines: 90 },
        'packages/quiz/src/**': { lines: 80 },
        'packages/terminal-ui/src/**': { lines: 80 },
      },
    },
  },
});
