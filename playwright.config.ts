import { defineConfig, devices } from '@playwright/test';

// Two phone projects (touch) and one desktop project (mouse, wheel, keyboard). All use Chromium so
// the suite needs a single browser; the iPhone project still gets the iPhone viewport and touch.
// Touch-only specs skip themselves on `desktop` and mouse equivalents live in the shared helpers.
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
    {
      name: 'desktop',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
        hasTouch: false,
        isMobile: false,
      },
    },
  ],
  webServer: {
    command: 'pnpm build && pnpm preview',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
