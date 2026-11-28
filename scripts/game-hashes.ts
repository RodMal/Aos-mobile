/**
 * Plays N seeded NPC-vs-NPC games and prints, per seed, the step count, final VP and a hash of
 * the final state, plus the mean time per game. Use it to prove a refactor or optimisation
 * changes no game result:
 *
 *   pnpm game-hashes --save        # record the baseline (scripts/.game-hashes.txt, gitignored)
 *   pnpm game-hashes               # compare with the baseline: prints IDENTICAL or the diff
 *   N=40 pnpm game-hashes          # more seeds (default 20)
 *   NPC=champion pnpm game-hashes  # play the shipped champion instead of the baseline
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { chooseAction } from '../src/ai/baseline.js';
import { chooseNpcAction, loadChampion } from '../src/ai/index.js';
import { SERAPHON_SUNCLAW_STARHOST, SYLVANETH_LORDS_OF_THE_CLAN } from '../src/data/lists.js';
import { createEngine, createScenario } from '../src/engine/index.js';
import { startGame } from '../src/engine/test-helpers.js';

const champion = process.env.NPC === 'champion' ? loadChampion() : null;
const N = Number(process.env.N ?? 20);
const file = new URL('./.game-hashes.txt', import.meta.url).pathname;
const engine = createEngine(
  createScenario([SYLVANETH_LORDS_OF_THE_CLAN, SERAPHON_SUNCLAW_STARHOST]),
);
startGame(engine, 0); // warm-up: set-up is computed once per engine

const lines: string[] = [];
let total = 0;
for (let seed = 1; seed <= N; seed++) {
  const t0 = performance.now();
  let state = startGame(engine, seed);
  let steps = 0;
  while (engine.decision(state)) {
    const action = champion
      ? chooseNpcAction(engine, state, champion)
      : chooseAction(engine, state);
    state = engine.apply(state, action).state;
    steps++;
  }
  total += performance.now() - t0;
  const hash = createHash('sha256').update(JSON.stringify(state)).digest('hex').slice(0, 16);
  lines.push(`${seed} ${steps} ${state.players[0].vp}/${state.players[1].vp} ${hash}`);
}
const result = lines.join('\n');
if (process.argv.includes('--save')) {
  writeFileSync(file, result + '\n');
  console.log(`saved ${N} games to scripts/.game-hashes.txt`);
} else if (existsSync(file)) {
  const before = readFileSync(file, 'utf8').trim();
  console.log(
    before === result ? 'IDENTICAL' : `DIFFERENT\n--- before\n${before}\n--- now\n${result}`,
  );
} else {
  console.log(result);
}
console.log(`mean ${(total / N).toFixed(0)} ms per game`);
