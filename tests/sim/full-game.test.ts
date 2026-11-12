/**
 * Full-game simulations: the baseline NPC plays both sides from a seed, the invariants are
 * checked after every action, and the game is replayed from its seed and actions at the end.
 * `SIM_SEEDS` sets how many seeds run (default 5).
 */
import { afterAll, describe, expect, it } from 'vitest';
import { chooseAction } from '../../src/ai/baseline.js';
import { SERAPHON_SUNCLAW_STARHOST, SYLVANETH_LORDS_OF_THE_CLAN } from '../../src/data/lists.js';
import {
  createEngine,
  createScenario,
  profileOf,
  unitFootprints,
  type Action,
  type Engine,
  type GameState,
  type UnitId,
} from '../../src/engine/index.js';
import {
  boundingRadius,
  checkCoherencyFootprints,
  footprintInsidePolygon,
  footprintsOverlap,
  type Footprint,
} from '../../src/geom/index.js';
import { startGame } from '../../src/engine/test-helpers.js';

const SEEDS = Number(process.env.SIM_SEEDS ?? 5);
const MAX_STEPS = 20_000;

/**
 * Checks the invariants after each step. Geometry is only re-checked for units whose models
 * changed since the previous step (moved, slain or returned), and base overlaps use a
 * bounding-circle test before the exact one.
 */
export class InvariantChecker {
  private readonly seen = new Map<UnitId, string>();
  private readonly board: readonly (readonly [number, number])[];

  constructor(private readonly engine: Engine) {
    const { width, height } = engine.scenario.battlefield;
    this.board = [
      [0, 0],
      [width, 0],
      [width, height],
      [0, height],
    ];
  }

  check(state: GameState, full = false): void {
    const { scenario } = this.engine;
    const fps = new Map<UnitId, Footprint[]>();
    const changed: UnitId[] = [];
    for (const id of state.unitOrder) {
      const unit = state.units[id]!;
      const health = profileOf(scenario, unit).health;
      expect(unit.damage, `${unit.name} damage below Health`).toBeLessThan(health);
      expect(unit.damage).toBeGreaterThanOrEqual(0);
      if (unit.status === 'reserve') continue;
      if (unit.status !== 'battlefield') {
        expect(
          unit.models.some((m) => m.alive),
          `${unit.name} destroyed with living models`,
        ).toBe(false);
        continue;
      }
      const sig = unit.models.map((m) => (m.alive ? `${m.x},${m.y},${m.rot}` : '-')).join('|');
      const unitFps = unitFootprints(scenario, unit);
      fps.set(id, unitFps);
      if (!full && this.seen.get(id) === sig) continue;
      this.seen.set(id, sig);
      changed.push(id);
      expect(unitFps.length, `${unit.name} has living models`).toBeGreaterThan(0);
      expect(checkCoherencyFootprints(unitFps).coherent, `${unit.name} coherency`).toBe(true);
      for (const fp of unitFps) {
        expect(footprintInsidePolygon(fp, this.board), `${unit.name} on board`).toBe(true);
      }
    }
    for (const id of state.unitOrder) {
      if (!fps.has(id)) this.seen.delete(id);
    }
    // Overlaps: each changed unit's bases against every other base on the battlefield.
    const all = [...fps.entries()].flatMap(([id, list]) => list.map((fp) => ({ id, fp })));
    for (const id of changed) {
      const mine = fps.get(id)!;
      for (let a = 0; a < mine.length; a++) {
        const fa = mine[a]!;
        const ra = boundingRadius(fa);
        for (const { id: other, fp: fb } of all) {
          if (fb === fa || (other === id && mine.indexOf(fb) < a)) continue;
          if (Math.hypot(fa.cx - fb.cx, fa.cy - fb.cy) >= ra + boundingRadius(fb)) continue;
          expect(footprintsOverlap(fa, fb), `bases overlap (${id}, ${other})`).toBe(false);
        }
      }
    }
    for (const p of state.players) {
      expect(p.cp).toBeGreaterThanOrEqual(0);
      expect(p.vp).toBeGreaterThanOrEqual(0);
    }
    if (full) expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  }
}

const results: { seed: number; winner: GameState['winner']; vp: [number, number]; ms: number }[] =
  [];

describe('full games, baseline NPC against itself', () => {
  const scenario = createScenario([SYLVANETH_LORDS_OF_THE_CLAN, SERAPHON_SUNCLAW_STARHOST]);
  const engine = createEngine(scenario);
  startGame(engine, 0); // warm the set-up cache

  for (let seed = 1; seed <= SEEDS; seed++) {
    it(`seed ${seed} finishes five rounds with every invariant holding`, () => {
      const t0 = performance.now();
      const checker = new InvariantChecker(engine);
      let state = startGame(engine, seed);
      const actions: Action[] = [];
      checker.check(state, true);
      let turn = `${state.round}:${state.turnIndex}`;
      while (engine.decision(state)) {
        // A legal action always exists.
        const fallback = engine.defaultAction(state);
        engine.apply(state, fallback);
        const action = chooseAction(engine, state);
        actions.push(action);
        state = engine.apply(state, action).state;
        const now = `${state.round}:${state.turnIndex}`;
        checker.check(state, now !== turn);
        turn = now;
        if (actions.length > MAX_STEPS) throw new Error('game did not end');
      }
      checker.check(state, true);
      expect(state.status).toBe('ended');
      expect(state.round).toBe(scenario.rounds);
      expect(state.winner).not.toBeNull();

      // The same seed and actions reproduce the same game.
      let replay = startGame(engine, seed);
      for (const a of actions) replay = engine.apply(replay, a).state;
      expect(replay).toEqual(state);
      results.push({
        seed,
        winner: state.winner,
        vp: [state.players[0].vp, state.players[1].vp],
        ms: performance.now() - t0,
      });
    });
  }

  for (let seed = 1; seed <= Math.min(SEEDS, 3); seed++) {
    it(`alternating deployment, seed ${seed}: the state survives a JSON round trip in every phase`, () => {
      const checker = new InvariantChecker(engine);
      let state = engine.newGame(seed, { deploy: true });
      let where = '';
      for (let i = 0; engine.decision(state); i++) {
        const d = engine.decision(state);
        const deploying = d?.kind === 'place' && d.reason === 'deploy';
        const now = `${state.round}:${state.turnIndex}:${state.phase}`;
        // Every step of deployment, and the first step of every phase after it.
        checker.check(state, deploying || now !== where);
        where = now;
        state = engine.apply(state, chooseAction(engine, state)).state;
        if (i > MAX_STEPS) throw new Error('game did not end');
      }
      checker.check(state, true);
      expect(state.status).toBe('ended');
    });
  }

  it('plays a game without invariant checks quickly', () => {
    const t0 = performance.now();
    let state = startGame(engine, SEEDS + 1);
    while (engine.decision(state)) state = engine.apply(state, chooseAction(engine, state)).state;
    expect(state.status).toBe('ended');
    // A game takes about 0.4 s on a development machine. This budget leaves room for slower
    // CI runners and still fails on a slowdown like the one that came with the first ability
    // framework (1.6 s per game), which is what a phone would feel most.
    expect(performance.now() - t0).toBeLessThan(1200);
  });
});

afterAll(() => {
  if (results.length === 0) return;
  const wins = [0, 0, 0];
  for (const r of results) wins[r.winner === 'draw' ? 2 : (r.winner as number)]!++;
  const mean = (i: 0 | 1): string =>
    (results.reduce((n, r) => n + r.vp[i], 0) / results.length).toFixed(1);
  const ms = results.reduce((n, r) => n + r.ms, 0) / results.length;
  process.stdout.write(
    `\n${results.length} games: player 0 won ${wins[0]}, player 1 won ${wins[1]}, ${wins[2]} draws; ` +
      `mean VP ${mean(0)} / ${mean(1)}; ${ms.toFixed(0)} ms per game with invariants and replay\n`,
  );
});
