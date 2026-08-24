import { defineConfig, devices } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const API_URL = process.env.API_URL || 'http://localhost:4000';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : 1,
  reporter: process.env.CI
    ? [['html', { open: 'never' }], ['github'], ['list']]
    : [['html', { open: 'on-failure' }], ['list']],

  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },

  use: {
    baseURL: BASE_URL,
    apiURL: API_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: process.env.CI ? 'retain-on-failure' : 'off',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
      },
    },
  ],

  webServer: process.env.CI
    ? undefined
    : [
        {
          command: 'docker compose up --build',
          url: `${API_URL}/health`,
          reuseExistingServer: true,
          timeout: 300_000,
          cwd: '../..',
        },
      ],
});
