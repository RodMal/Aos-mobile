// Renders public/icon.svg to the PNG icons with Playwright's Chromium.
// Usage: node scripts/make-icons.mjs   (needs Playwright with Chromium installed)
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const pub = fileURLToPath(new URL('../public/', import.meta.url));
const svg = readFileSync(`${pub}icon.svg`, 'utf8');

// `inset` shrinks the mark inside the full-bleed background (maskable safe zone is the inner 80%).
const targets = [
  { file: 'icon-192.png', size: 192, inset: 1 },
  { file: 'icon-512.png', size: 512, inset: 1 },
  { file: 'icon-maskable-512.png', size: 512, inset: 0.78 },
  { file: 'apple-touch-icon.png', size: 180, inset: 1 },
];

const browser = await chromium.launch();
for (const { file, size, inset } of targets) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  const px = Math.round(size * inset);
  await page.setContent(
    `<body style="margin:0;background:#0e1114;display:grid;place-items:center;width:${size}px;height:${size}px">` +
      `<img src="${dataUrl}" width="${px}" height="${px}"></body>`,
  );
  await page.screenshot({ path: `${pub}${file}` });
  await page.close();
}
await browser.close();
