/**
 * R12: Seraphon rulings of 2026-11-19 (docs/RULES-DECISIONS.md I104): Star-venom in any shooting
 * phase (including Covering Fire), the Venomites token set up next to a deployed Sunblood Pack,
 * and no Celestial Conduit effect when the casting roll fails. Scry the Stars' pick after the
 * dice is in `seraphonActive.test.ts`; the NPC's judgement is in `src/ai/seraphon.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { chooseAction } from '../ai/baseline.js';
import { SERAPHON_SUNCLAW_STARHOST, SYLVANETH_LORDS_OF_THE_CLAN } from '../data/lists.js';
import { CELESTIAL_CONDUIT_ID, DARTPIPE_DAMAGE_ID, STAR_VENOM_ID } from './abilities/seraphon.js';
import { createEngine, createScenario, type GameState } from './index.js';
import type { Action, GameEvent, UnitId } from './types.js';
import { applyUntil, editable, keepOnly, placeUnit, startGame } from './test-helpers.js';

const scenario = createScenario([SERAPHON_SUNCLAW_STARHOST, SYLVANETH_LORDS_OF_THE_CLAN]);
const engine = createEngine(scenario);

const SUNBLOOD = '0:2';
const ASTROLITH = '0:4';
const STARSEER = '0:6';
const HUNTERS = '0:8';
const DRYADS = '1:6';

const rolls = (events: GameEvent[], label: string): number[] =>
  events.flatMap((e) => (e.t === 'roll' && e.label === label ? e.dice : []));
const use = (unit: UnitId, abilityId: string, extra: Partial<Action> = {}): Action =>
  ({ t: 'ability', unit, abilityId, ...extra }) as Action;
const effectsOf = (s: GameState, id: string, target?: UnitId) =>
  (s.effects ?? []).filter((e) => e.id === id && (!target || e.targetUnit === target));

function arena(
  at: Record<string, [number, number, number?]>,
  phase: GameState['phase'],
): GameState {
  const s = editable(startGame(engine, 1));
  keepOnly(s, Object.keys(at));
  for (const [id, [x, y, facing]] of Object.entries(at)) placeUnit(scenario, s, id, x, y, facing);
  s.active = 0;
  s.phase = phase;
  s.stack = [];
  s.players[0].cp = 0;
  s.players[1].cp = 0;
  s.players[0].rageDice = 0;
  s.players[1].rageDice = 0;
  return s;
}

describe('Star-venom in the enemy shooting phase, after Covering Fire (I104, R12)', () => {
  const field = (): GameState => {
    const s = arena({ [HUNTERS]: [30, 20], [DRYADS]: [30, 28] }, 'shooting');
    s.active = 1;
    s.players[0].cp = 3;
    // The active player did something, so Covering Fire is offered when it passes.
    s.units[DRYADS]!.moved = 'normal';
    return s;
  };
  const fire: Action = { t: 'command', command: 'coveringFire', unit: HUNTERS };

  it('is offered to the player who fired, once the attacks are done, and works on a 2+', () => {
    const passed = engine.apply(field(), { t: 'pass' });
    expect(engine.decision(passed.state)).toMatchObject({
      kind: 'reaction',
      player: 0,
      trigger: 'phase:shooting',
    });
    const fired = applyUntil(
      engine,
      passed.state,
      fire,
      (x) => effectsOf(x.state, DARTPIPE_DAMAGE_ID, DRYADS).length > 0,
    );
    expect(effectsOf(fired.state, DARTPIPE_DAMAGE_ID, DRYADS)).toHaveLength(1);
    // Still the shooting phase: the active player has finished, and Star-venom is on offer.
    expect(fired.state.phase).toBe('shooting');
    expect(engine.decision(fired.state)).toMatchObject({
      kind: 'reaction',
      player: 0,
      options: [{ ability: 'starVenom', unit: HUNTERS, cost: 0, targets: [DRYADS] }],
    });
    const used = applyUntil(
      engine,
      fired.state,
      use(HUNTERS, STAR_VENOM_ID, { target: DRYADS }),
      (x) => rolls(x.events, 'Star-venom')[0]! >= 2,
    );
    expect(effectsOf(used.state, STAR_VENOM_ID, DRYADS)).toHaveLength(1);
    expect(used.state.phase).toBe('charge');
    // Skipping it also ends the phase, with no effect.
    const skipped = engine.apply(fired.state, { t: 'pass' });
    expect(skipped.state.phase).toBe('charge');
    expect(effectsOf(skipped.state, STAR_VENOM_ID)).toHaveLength(0);
  });

  it('is not offered when the Dartpipe did no damage', () => {
    const passed = engine.apply(field(), { t: 'pass' });
    const fired = applyUntil(
      engine,
      passed.state,
      fire,
      (x) => effectsOf(x.state, DARTPIPE_DAMAGE_ID, DRYADS).length === 0,
    );
    expect(fired.state.phase).toBe('charge');
  });
});

describe('the Venomites token is placed when the Sunblood Pack is deployed (I104, R12)', () => {
  /** A new game in deployment, advanced with the default answers until the token is asked for. */
  const toToken = (): GameState => {
    let s = engine.newGame(3, { deploy: true });
    for (let i = 0; i < 200; i++) {
      if (engine.decision(s)?.kind === 'venomites') return s;
      s = engine.apply(s, engine.defaultAction(s)).state;
    }
    throw new Error('no Venomites token was asked for');
  };

  it('asks the unit’s player for a side, and the token stands next to the unit', () => {
    const s = toToken();
    const d = engine.decision(s);
    if (d?.kind !== 'venomites') throw new Error('expected the token');
    expect(d.unit).toBe(SUNBLOOD);
    expect(d.player).toBe(0);
    expect(s.units[SUNBLOOD]!.venomitesAt).toBeUndefined();
    const left = engine.apply(s, { t: 'choose', value: 'left' }).state.units[SUNBLOOD]!;
    expect(left.venomitesAt!.x).toBeLessThan(Math.min(...left.models.map((m) => m.x)));
    const right = engine.apply(s, { t: 'choose', value: 'right' }).state.units[SUNBLOOD]!;
    expect(right.venomitesAt!.x).toBeGreaterThan(Math.max(...right.models.map((m) => m.x)));
    expect(engine.decision(engine.apply(s, { t: 'choose', value: 'left' }).state)?.kind).not.toBe(
      'venomites',
    );
    expect(() => engine.apply(s, { t: 'choose', value: 'inside' })).toThrow();
    expect(() => engine.apply(s, { t: 'pass' })).toThrow();
  });

  it('the NPC places its own token, and the battle starts once every token is down', () => {
    const swapped = createScenario([SYLVANETH_LORDS_OF_THE_CLAN, SERAPHON_SUNCLAW_STARHOST]);
    const e = createEngine(swapped);
    let s = e.newGame(4, { deploy: true });
    let asked = 0;
    for (let i = 0; i < 400 && e.decision(s)?.kind !== 'priority'; i++) {
      const d = e.decision(s);
      if (d?.kind === 'venomites') {
        asked++;
        expect(d.player).toBe(1);
      }
      s = e.apply(s, chooseAction(e, s)).state;
    }
    expect(asked).toBe(1);
    expect(s.units['1:2']!.venomitesAt).toBeDefined();
    expect(e.decision(s)?.kind).toBe('priority');
  });
});

describe('a spell that fails its casting roll gives no Celestial Conduit effect (I104, R12)', () => {
  const field = (): GameState =>
    arena({ [STARSEER]: [30, 20], [ASTROLITH]: [30, 26], [DRYADS]: [30, 34] }, 'hero');

  it('neither a failed roll nor a miscast leaves the effect, while a success does', () => {
    const s = field();
    const spell = engine
      .unitOptions(s, STARSEER)
      .find((o) => o.t === 'ability' && o.kind === 'spell' && o.targets.includes(DRYADS));
    if (!spell || spell.t !== 'ability') throw new Error('no spell for the Dryads');
    const declared = engine.apply(s, use(STARSEER, spell.abilityId, { target: DRYADS }));
    const taken = engine.apply(declared.state, use(ASTROLITH, CELESTIAL_CONDUIT_ID));
    const cast = (r: { events: GameEvent[] }) => r.events.find((e) => e.t === 'cast');
    const failed = applyUntil(engine, taken.state, { t: 'pass' }, (x) => {
      const c = cast(x);
      return c?.t === 'cast' && !c.success && !c.miscast;
    });
    expect(effectsOf(failed.state, CELESTIAL_CONDUIT_ID)).toHaveLength(0);
    const miscast = applyUntil(engine, taken.state, { t: 'pass' }, (x) => {
      const c = cast(x);
      return c?.t === 'cast' && c.miscast;
    });
    expect(effectsOf(miscast.state, CELESTIAL_CONDUIT_ID)).toHaveLength(0);
    const worked = applyUntil(engine, taken.state, { t: 'pass' }, (x) => {
      const c = cast(x);
      return c?.t === 'cast' && c.success;
    });
    expect(effectsOf(worked.state, CELESTIAL_CONDUIT_ID)).toHaveLength(1);
  });
});
