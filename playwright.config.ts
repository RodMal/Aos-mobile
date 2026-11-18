import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

// Two phone projects (touch) and one desktop project (mouse, wheel, keyboard). All use Chromium so
// the suite needs a single browser; the iPhone project still gets the iPhone viewport and touch.
// Touch-only specs skip themselves on `desktop` and mouse equivalents live in the shared helpers.
// On CI the build job's `dist` is downloaded and only served; locally (or without a dist) the app
// is built first. PW_PREBUILT=1 forces serving the existing dist.
const prebuilt =
  process.env.PW_PREBUILT === '1' || (!!process.env.CI && existsSync('dist/index.html'));

// Each checkout gets its own preview port so two agents or worktrees running the suite at once
// never test each other's build: E2E_PORT if set, else 4200-5199 derived from this directory.
// (The config is loaded again in every worker, so the port must be stable, not random.)
const port =
  Number(process.env.E2E_PORT) ||
  4200 + (createHash('sha1').update(process.cwd()).digest().readUInt16BE(0) % 1000);
const origin = `http://localhost:${port}`;

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: origin,
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
    command: `${prebuilt ? '' : 'pnpm build && '}pnpm exec vite preview --port ${port} --strictPort`,
    url: origin,
    // Never adopt a server we did not start: it could serve another checkout's build.
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
