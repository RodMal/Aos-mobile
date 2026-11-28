/**
 * Plays NPC configurations against each other, each seed twice with the sides swapped:
 *
 *   pnpm selfplay A=champion B=baseline N=40
 *
 * `A` and `B` are `baseline`, `champion`, or a path to an NpcConfig JSON file. Prints A's
 * win/draw/loss, mean VP margin and the time per decision and per NPC turn (Node, this machine;
 * see HANDOVER for the Node-to-phone factor). Results are deterministic; only timings vary.
 */
import { readFileSync } from 'node:fs';
import { loadChampion, NpcConfigSchema } from '../src/ai/index.js';
import { playMatch, type NpcSpec } from '../src/ai/selfplay.js';
import { SERAPHON_SUNCLAW_STARHOST, SYLVANETH_LORDS_OF_THE_CLAN } from '../src/data/lists.js';
import { createEngine, createScenario } from '../src/engine/index.js';
import { startGame } from '../src/engine/test-helpers.js';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const i = a.indexOf('=');
    return i < 0 ? [a, ''] : [a.slice(0, i), a.slice(i + 1)];
  }),
);

function spec(name: string | undefined): NpcSpec {
  if (!name || name === 'baseline') return 'baseline';
  if (name === 'champion') return loadChampion();
  return NpcConfigSchema.parse(JSON.parse(readFileSync(name, 'utf8')));
}

const A = spec(args.A);
const B = spec(args.B);
const N = Number(args.N ?? 40);
const engine = createEngine(
  createScenario([SYLVANETH_LORDS_OF_THE_CLAN, SERAPHON_SUNCLAW_STARHOST]),
);
startGame(engine, 0); // warm-up: set-up is computed once per engine

let win = 0;
let draw = 0;
let loss = 0;
let margin = 0;
let games = 0;
let gameMs = 0;
const decisionMs: number[] = [];
const turnMs: number[] = [];
for (let seed = 1; seed <= N; seed++) {
  for (const swapped of [false, true]) {
    const t0 = performance.now();
    const r = playMatch(engine, seed, swapped ? [B, A] : [A, B], { now: () => performance.now() });
    gameMs += performance.now() - t0;
    const a = swapped ? 1 : 0;
    games++;
    if (r.winner === 'draw') draw++;
    else if (r.winner === a) win++;
    else loss++;
    margin += r.sides[a]!.vp - r.sides[1 - a]!.vp;
    for (const s of r.sides) {
      decisionMs.push(...s.decisionMs);
      turnMs.push(...s.turnMs);
    }
  }
}

const sorted = (xs: number[]) => [...xs].sort((x, y) => x - y);
const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length);
const p95 = (xs: number[]) => sorted(xs)[Math.floor(0.95 * (xs.length - 1))] ?? 0;
const max = (xs: number[]) => xs.reduce((m, x) => Math.max(m, x), 0);
const f = (x: number) => x.toFixed(3);

console.log(`A=${args.A ?? 'baseline'} B=${args.B ?? 'baseline'} games=${games} (N=${N}, swapped)`);
console.log(
  `A wins ${win}  draws ${draw}  losses ${loss}  (${((100 * win) / games).toFixed(1)}% wins)`,
);
console.log(`mean VP margin (A - B) ${(margin / games).toFixed(2)}`);
console.log(
  `ms per decision: mean ${f(mean(decisionMs))}  p95 ${f(p95(decisionMs))}  max ${f(max(decisionMs))}`,
);
console.log(`max ms per NPC turn ${f(max(turnMs))}`);
console.log(`ms per game: mean ${(gameMs / games).toFixed(0)}`);
