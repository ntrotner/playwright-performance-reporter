import {defineConfig, devices} from '@playwright/test';
import {performanceOptions} from './performance-options.fixture-mode';

export default defineConfig({
  testDir: './tests-fixture-mode',
  fullyParallel: true,
  workers: 3,
  reporter: [
    ['list'],
    ['../lib', performanceOptions],
  ],
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
      },
    },
  ],
});
