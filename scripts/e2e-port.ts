import { createHash } from 'node:crypto';

/** Prints the port `pnpm test:e2e` uses in this directory (same formula as playwright.config.ts). */
console.log(
  Number(process.env.E2E_PORT) ||
    4200 + (createHash('sha1').update(process.cwd()).digest().readUInt16BE(0) % 1000),
);
