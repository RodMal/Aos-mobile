/**
 * Sylvaneth activated abilities (task M4i): Lifebloom, Living Battering Ram, Groundshaker,
 * Wyldwood Revenants and Aspect of Heartwood. One block per ability; printed text in
 * data/factions/sylvaneth.json, readings in docs/RULES-DECISIONS.md I106 and I107.
 */
import { describe, expect, it } from 'vitest';
import { SERAPHON_SUNCLAW_STARHOST, SYLVANETH_LORDS_OF_THE_CLAN } from '../data/lists.js';
import type { ArmyList } from '../data/lists.js';
import { resolveEndlessGrowth } from '../rules/factions/sylvaneth.js';
import { strikeOrder } from './abilities/effects.js';
import { magicOptionsForUnit } from './abilities/magic.js';
import {
  ASPECT_OF_HEARTWOOD_ID,
  GROUNDSHAKER_ID,
  LIFEBLOOM_ID,
  LIVING_BATTERING_RAM_ID,
  WYLDWOOD_REVENANTS_ID,
} from './abilities/sylvaneth.js';
import type { Ctx } from './ctx.js';
import { createEngine, createScenario, profileOf, type GameState } from './index.js';
import { unitsWithin } from './query.js';
import { groundshakerTarget } from './sylvanethActive.js';
import type { Action, GameEvent, UnitId } from './types.js';
import {
  ScriptedDice,
  applyUntil,
  editable,
  keepOnly,
  placeUnit,
  startGame,
} from './test-helpers.js';

const scenario = createScenario([SYLVANETH_LORDS_OF_THE_CLAN, SERAPHON_SUNCLAW_STARHOST]);
const engine = createEngine(scenario);

const ALARIELLE = '0:0';
const DURTHU = '0:2';
const WARSONG = '0:5';
const DRYADS = '0:6';
const DRYADS_ASPECT = '0:7';
const KROXIGOR = '1:3';
const STEGADON_LIKE = '1:7'; // a Monster of the Seraphon list

type Phase = GameState['phase'];

function arena(at: Record<string, [number, number, number?]>, phase: Phase): GameState {
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

const option = (s: GameState, id: UnitId, abilityId: string) =>
  engine.unitOptions(s, id).find((o) => o.t === 'ability' && o.abilityId === abilityId);
const rolls = (events: GameEvent[], label: string): number[] =>
  events.flatMap((e) => (e.t === 'roll' && e.label === label ? e.dice : []));
const use = (unit: UnitId, abilityId: string, extra: Partial<Action> = {}): Action =>
  ({ t: 'ability', unit, abilityId, ...extra }) as Action;

/** The nearest x at which `b` stands within `gap`" of `a` (a at 30, 30), scanning outwards. */
function standNear(s: GameState, a: UnitId, b: UnitId, within: number): void {
  for (let x = 34; x < 60; x += 0.25) {
    placeUnit(scenario, s, b, x, 30, 270);
    if (unitsWithin(scenario, s.units[a]!, s.units[b]!, within)) return;
  }
  throw new Error('no position');
}

describe('Lifebloom (e4b4-8e4d-5f0-eb6a)', () => {
  const hurt = (): GameState => {
    const s = arena({ [ALARIELLE]: [30, 30] }, 'hero');
    s.units[ALARIELLE]!.damage = profileOf(scenario, s.units[ALARIELLE]!).health - 1;
    return s;
  };

  it('is offered in your hero phase to a damaged unit only', () => {
    expect(option(hurt(), ALARIELLE, LIFEBLOOM_ID)).toBeDefined();
    const whole = hurt();
    whole.units[ALARIELLE]!.damage = 0;
    expect(option(whole, ALARIELLE, LIFEBLOOM_ID)).toBeUndefined();
    const movement = hurt();
    movement.phase = 'movement';
    expect(option(movement, ALARIELLE, LIFEBLOOM_ID)).toBeUndefined();
  });

  it('heals 2D6 and is once per turn for the army', () => {
    const s = hurt();
    const before = s.units[ALARIELLE]!.damage;
    const r = engine.apply(s, use(ALARIELLE, LIFEBLOOM_ID));
    const dice = rolls(r.events, 'Lifebloom');
    expect(dice).toHaveLength(2);
    expect(r.state.units[ALARIELLE]!.damage).toBe(before - dice[0]! - dice[1]!);
    expect(option(r.state, ALARIELLE, LIFEBLOOM_ID)).toBeUndefined();
    expect(() => engine.apply(r.state, use(ALARIELLE, LIFEBLOOM_ID))).toThrow();
  });
});

describe('Living Battering Ram (5abd-6507-dbee-ed76)', () => {
  const charged = (): GameState => {
    const s = arena({ [ALARIELLE]: [30, 30, 90], [KROXIGOR]: [34, 30, 270] }, 'charge');
    standNear(s, ALARIELLE, KROXIGOR, 0.9);
    s.units[ALARIELLE]!.charged = true;
    return s;
  };

  it('is offered after a charge, against a visible enemy within 1"', () => {
    expect(option(charged(), ALARIELLE, LIVING_BATTERING_RAM_ID)).toMatchObject({
      targets: [KROXIGOR],
    });
    const idle = charged();
    idle.units[ALARIELLE]!.charged = false;
    expect(option(idle, ALARIELLE, LIVING_BATTERING_RAM_ID)).toBeUndefined();
    const far = charged();
    standNear(far, ALARIELLE, KROXIGOR, 2.5);
    placeUnit(scenario, far, KROXIGOR, 38, 30, 270);
    expect(option(far, ALARIELLE, LIVING_BATTERING_RAM_ID)).toBeUndefined();
  });

  it('on a 3+ inflicts mortal damage equal to the roll', () => {
    const s = charged();
    const r = applyUntil(engine, s, use(ALARIELLE, LIVING_BATTERING_RAM_ID), (x) => {
      const d = rolls(x.events, 'Living Battering Ram')[0]!;
      return d >= 4;
    });
    const die = rolls(r.events, 'Living Battering Ram')[0]!;
    const total = r.events
      .filter((e) => e.t === 'damage' && e.unit === KROXIGOR)
      .reduce((n, e) => n + (e.t === 'damage' ? e.amount : 0), 0);
    expect(total).toBe(die);
  });

  it('on a 1 or 2 does nothing, and is once per turn', () => {
    const s = charged();
    const r = applyUntil(
      engine,
      s,
      use(ALARIELLE, LIVING_BATTERING_RAM_ID),
      (x) => rolls(x.events, 'Living Battering Ram')[0]! <= 2,
    );
    expect(r.events.some((e) => e.t === 'damage')).toBe(false);
    expect(option(r.state, ALARIELLE, LIVING_BATTERING_RAM_ID)).toBeUndefined();
  });
});

describe('Groundshaker (7124-769a-aafd-7b38)', () => {
  const duel = (foe: UnitId = KROXIGOR): GameState => {
    const s = arena({ [DURTHU]: [30, 30, 90], [foe]: [34, 30, 270] }, 'combat');
    standNear(s, DURTHU, foe, 2.5);
    return s;
  };

  it('is offered while a fighter is picked, against Infantry (not Fly) or Cavalry in combat', () => {
    const s = duel();
    expect(engine.decision(s)).toMatchObject({ kind: 'fightPick', player: 0 });
    expect(option(s, DURTHU, GROUNDSHAKER_ID)).toMatchObject({ targets: [KROXIGOR] });
    // A Monster is not a target.
    expect(option(duel(STEGADON_LIKE), DURTHU, GROUNDSHAKER_ID)).toBeUndefined();
    // A unit not in combat with it is not a target.
    const apart = duel();
    placeUnit(scenario, apart, KROXIGOR, 45, 30, 270);
    expect(option(apart, DURTHU, GROUNDSHAKER_ID)).toBeUndefined();
  });

  it('reads the keywords: Infantry without Fly, or Cavalry', () => {
    const target = (...keywords: string[]) =>
      groundshakerTarget({ profiles: { x: { keywords } } } as never, { profileId: 'x' } as never);
    expect(target('INFANTRY')).toBe(true);
    expect(target('INFANTRY', 'FLY', 'HERO')).toBe(false);
    expect(target('CAVALRY')).toBe(true);
    expect(target('MONSTER')).toBe(false);
  });

  it('on a 3+ gives the target Strike-last for the rest of the turn; on a 1 or 2 nothing', () => {
    const s = duel();
    expect(strikeOrder(scenario, s, s.units[KROXIGOR]!)).toBe('normal');
    const hit = applyUntil(
      engine,
      s,
      use(DURTHU, GROUNDSHAKER_ID),
      (x) => rolls(x.events, 'Groundshaker')[0]! >= 3,
    );
    expect(strikeOrder(scenario, hit.state, hit.state.units[KROXIGOR]!)).toBe('strikeLast');
    const miss = applyUntil(
      engine,
      s,
      use(DURTHU, GROUNDSHAKER_ID),
      (x) => rolls(x.events, 'Groundshaker')[0]! <= 2,
    );
    expect(strikeOrder(scenario, miss.state, miss.state.units[KROXIGOR]!)).toBe('normal');
    // Once per turn for the army.
    expect(option(hit.state, DURTHU, GROUNDSHAKER_ID)).toBeUndefined();
  });

  it('a unit with only Groundshaker is not one that can fight', () => {
    const s = duel();
    const durthu = engine.unitOptions(s, DURTHU);
    expect(durthu.some((o) => o.t === 'fight')).toBe(true);
    s.units[DURTHU]!.fought = true;
    const after = engine.unitOptions(s, DURTHU);
    expect(after.some((o) => o.t === 'fight')).toBe(false);
  });
});

describe('Wyldwood Revenants (dc61-1f39-51f9-52da)', () => {
  const chantingState = (): { s: GameState; action: Action } => {
    const s = arena({ [WARSONG]: [30, 30], [KROXIGOR]: [40, 30, 270] }, 'hero');
    const prayer = magicOptionsForUnit(scenario, s, s.units[WARSONG]!).find(
      (o) => o.t === 'ability' && o.kind === 'prayer',
    );
    if (prayer?.t !== 'ability') throw new Error('no prayer');
    return {
      s,
      action: use(WARSONG, prayer.abilityId, { target: prayer.targets[0] }),
    };
  };

  it('is offered on an unmodified chanting roll of 1 and re-rolls it', () => {
    const { s, action } = chantingState();
    const r = applyUntil(engine, s, action, (x) => {
      const d = engine.decision(x.state);
      return d?.kind === 'reaction' && d.trigger.startsWith('chant:');
    });
    const d = engine.decision(r.state);
    if (d?.kind !== 'reaction') throw new Error('no reaction');
    expect(d.options).toEqual([{ ability: 'wyldwoodRevenants', unit: WARSONG, cost: 0 }]);
    const kept = engine.apply(r.state, { t: 'pass' });
    const keptChant = kept.events.find((e) => e.t === 'chant');
    expect(keptChant).toMatchObject({ die: 1, total: 1 });
    expect(kept.state.players[0].usedOncePerTurn ?? []).not.toContain(WYLDWOOD_REVENANTS_ID);
    const used = engine.apply(r.state, use(WARSONG, WYLDWOOD_REVENANTS_ID));
    expect(rolls(used.events, 'Wyldwood Revenants (re-roll)')).toHaveLength(1);
    const chant = used.events.find((e) => e.t === 'chant');
    const redo = rolls(used.events, 'Wyldwood Revenants (re-roll)')[0]!;
    if (redo > 1) expect(chant).toMatchObject({ die: redo });
    expect(used.state.players[0].usedOncePerTurn).toContain(WYLDWOOD_REVENANTS_ID);
    expect(used.state.stack.some((f) => f.t === 'chantReact')).toBe(false);
  });

  it('is not offered on any other roll, and not twice in a turn', () => {
    const { s, action } = chantingState();
    const r = applyUntil(engine, s, action, (x) =>
      x.events.some((e) => e.t === 'chant' && e.die > 1),
    );
    expect(engine.decision(r.state)?.kind).not.toBe('reaction');
    const spent = editable(s);
    spent.players[0].usedOncePerTurn = [WYLDWOOD_REVENANTS_ID];
    const ones = applyUntil(engine, spent, action, (x) =>
      x.events.some((e) => e.t === 'chant' && e.die === 1),
    );
    expect(engine.decision(ones.state)?.kind).not.toBe('reaction');
  });
});

describe('Aspect of Heartwood (0770-09a1-99c6-1a99)', () => {
  const ctxWith = (s: GameState, dice: number[]): Ctx => ({
    scenario,
    s,
    events: [],
    rng: new ScriptedDice(dice),
  });
  const outcrop = scenario.battlefield.terrain.find((t) => t.id === 'outcrop-w')!;
  const grown = (ids: UnitId[]): GameState => {
    const s = editable(startGame(engine, 1));
    keepOnly(s, ids);
    s.overgrown = [[outcrop.id], []];
    for (const id of ids) placeUnit(scenario, s, id, outcrop.centre[0], outcrop.centre[1]);
    return s;
  };

  it('rolls a D6 instead of a D3 for a target wholly within 12" of the bearer, once per battle', () => {
    const s = grown([DRYADS, DRYADS_ASPECT]);
    s.units[DRYADS]!.damage = 5;
    s.units[DRYADS_ASPECT]!.damage = 5;
    // Bearer first in army order is Dryads 0:6 (no ability); the D6 applies to both targets.
    resolveEndlessGrowth(ctxWith(s, [5, 5]), 0);
    expect(s.units[DRYADS]!.damage).toBe(0);
    expect(s.units[DRYADS_ASPECT]!.damage).toBe(0);
    expect(s.players[0].usedOncePerBattle).toContain(`${DRYADS_ASPECT}:${ASPECT_OF_HEARTWOOD_ID}`);
    // Used up: the next Endless Growth rolls a D3 again (a 5 would be refused by the dice).
    s.units[DRYADS]!.damage = 5;
    expect(() => resolveEndlessGrowth(ctxWith(s, [5]), 0)).toThrow();
    resolveEndlessGrowth(ctxWith(s, [3, 3]), 0);
    expect(s.units[DRYADS]!.damage).toBe(2);
  });

  it('does not reach a target more than 12" from the bearer, nor an army without the bearer', () => {
    const s = grown([DRYADS, DRYADS_ASPECT]);
    placeUnit(scenario, s, DRYADS, outcrop.centre[0] + 14, outcrop.centre[1]);
    s.overgrown = [['outcrop-w', ...scenario.battlefield.terrain.map((t) => t.id)], []];
    s.units[DRYADS]!.damage = 3;
    expect(() => resolveEndlessGrowth(ctxWith(s, [3]), 0)).not.toThrow();
    const none = grown([DRYADS]);
    none.units[DRYADS]!.damage = 3;
    expect(() => resolveEndlessGrowth(ctxWith(none, [5]), 0)).toThrow();
  });

  it("Heals 6 instead of 3 where Nature's Titans would heal 3", () => {
    const s = grown([DURTHU, DRYADS_ASPECT]);
    s.units[DURTHU]!.damage = 9;
    resolveEndlessGrowth(ctxWith(s, []), 0);
    expect(s.units[DURTHU]!.damage).toBe(3);
  });

  it('returns 1 slain model to a Kurnothi target instead of rolling', () => {
    const list: ArmyList = {
      ...SYLVANETH_LORDS_OF_THE_CLAN,
      units: [
        { name: 'Alarielle the Everqueen', regiment: 0, general: true },
        { name: 'Kurnoth Hunters with Kurnoth Greatswords', regiment: 1 },
        { name: 'Dryads', regiment: 2, enhancements: ['Aspect of Heartwood'] },
      ],
    };
    const sc = createScenario([list, SERAPHON_SUNCLAW_STARHOST]);
    const eng = createEngine(sc);
    const s = editable(startGame(eng, 1));
    keepOnly(s, ['0:1', '0:2']);
    s.overgrown = [[outcrop.id], []];
    placeUnit(sc, s, '0:1', outcrop.centre[0], outcrop.centre[1]);
    placeUnit(sc, s, '0:2', outcrop.centre[0], outcrop.centre[1] + 5);
    const kh = s.units['0:1']!;
    kh.models[0]!.alive = false;
    kh.models[1]!.alive = false;
    const ctx = { scenario: sc, s, events: [], rng: new ScriptedDice([]) } as Ctx;
    resolveEndlessGrowth(ctx, 0);
    expect(kh.models.filter((m) => !m.alive)).toHaveLength(1);
  });
});
