import { configDefaults, defineConfig } from 'vitest/config';

const infra = 'packages/infra/src/**/*.test.ts';

export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: [
      {
        test: {
          name: 'packages',
          include: ['packages/*/src/**/*.test.ts'],
          exclude: [...configDefaults.exclude, infra],
        },
      },
      {
        // CDK synth takes seconds per stack and competes for CPU across files.
        test: { name: 'infra', include: [infra], testTimeout: 30_000, hookTimeout: 30_000 },
      },
    ],
  },
});
