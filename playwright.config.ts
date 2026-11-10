import { defineConfig, devices } from '@playwright/test';

// Phone-sized viewports only: this app is built for touch. Both projects use Chromium so the
// suite needs a single browser; the iPhone project still gets the iPhone viewport and touch.
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'off',
  },
  projects: [
    { name: 'pixel-7', use: { ...devices['Pixel 7'] } },
    {
      name: 'iphone-14',
      use: { ...devices['iPhone 14'], browserName: 'chromium', defaultBrowserType: 'chromium' },
    },
  ],
  webServer: {
    command: 'pnpm build && pnpm preview',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
