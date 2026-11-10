import { defineConfig } from 'vitest/config';

// Full-game simulations (NPC vs NPC with invariants). Slower than unit tests, so they have
// their own command: `pnpm test:sim`. SIM_SEEDS sets how many seeded games run.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/sim/**/*.test.ts'],
    testTimeout: 600_000,
  },
});
