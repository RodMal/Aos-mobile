import { describe, expect, it } from 'vitest';
import { chooseAction } from '../../ai/baseline.js';
import { SERAPHON_SUNCLAW_STARHOST, SYLVANETH_LORDS_OF_THE_CLAN } from '../../data/lists.js';
import { weaponMods } from '../../engine/combat.js';
import {
  createEngine,
  createScenario,
  profileOf,
  type GameState,
  type UnitId,
} from '../../engine/index.js';
import { editable, keepOnly, placeUnit, startGame } from '../../engine/test-helpers.js';
import {
  ASTERISMS,
  GREAT_PLAN_ID,
  FURTHER_GREAT_PLAN_ID,
  ITZL_ID,
  QUETZL_ID,
  SOTEK_ID,
  TEPOK_ID,
  asterismConditionMet,
  asterismWeapon,
  moveOf,
} from './seraphon.js';

// Sylvaneth is player 0, Seraphon player 1.
const scenario = createScenario([SYLVANETH_LORDS_OF_THE_CLAN, SERAPHON_SUNCLAW_STARHOST]);
const engine = createEngine(scenario);
const KROAK = '1:0';
const WARRIORS = '1:5';
const BASTILADON = '1:7'; // Bludgeoning Tail is a Companion weapon
const ALARIELLE = '0:0'; // the Sylvaneth general
const DRYADS = '0:6';

/** The game at its first main decision, with `ids` prophesied for the Seraphon player. */
function game(ids: string[] = []): GameState {
  const s = editable(startGame(engine, 1));
  s.asterisms = { 1: { picked: [...ids], prophesied: [...ids], askedRound: 1 } };
  return s;
}

/** Plays defaults (and a pass for each Asterism) until the Further the Great Plan question. */
function toFurther(s0: GameState): GameState {
  let s = s0;
  for (let i = 0; i < 400; i++) {
    const d = engine.decision(s);
    if (d?.kind === 'asterism' && d.stage === 'further') return s;
    s = engine.apply(s, engine.defaultAction(s)).state;
  }
  throw new Error('no Further the Great Plan question');
}

describe('The Great Plan (9db2-50c6-6181-fc51)', () => {
  it('is on the Seraphon battle traits and asks the Seraphon player before round 1 starts', () => {
    expect(scenario.armies[1].battleTraits.map((a) => a.id)).toContain(GREAT_PLAN_ID);
    expect(scenario.armies[1].battleTraits.map((a) => a.id)).toContain(FURTHER_GREAT_PLAN_ID);
    let s = engine.newGame(1);
    // Alarielle's Seasons Of War come first; then the Great Plan.
    s = engine.apply(s, engine.defaultAction(s)).state;
    const d = engine.decision(s)!;
    expect(d).toMatchObject({ kind: 'asterism', player: 1, stage: 'great' });
    if (d.kind !== 'asterism') return;
    expect(d.options.map((o) => o.id)).toEqual(ASTERISMS.map((a) => a.id));
    expect(d.options.every((o) => o.met)).toBe(true);
    const next = engine.apply(s, { t: 'choose', value: TEPOK_ID }).state;
    expect(next.asterisms?.[1]).toMatchObject({ picked: [TEPOK_ID], prophesied: [TEPOK_ID] });
    // The Great Plan is used once: it is not asked again this round.
    expect(engine.decision(next)?.kind).not.toBe('asterism');
  });

  it('only accepts an Asterism, and a pass only for a game saved before it existed', () => {
    let s = engine.newGame(1);
    s = engine.apply(s, engine.defaultAction(s)).state;
    expect(() => engine.apply(s, { t: 'choose', value: 'first' })).toThrow(/Asterism/);
    expect(() => engine.apply(s, { t: 'fight', unit: KROAK })).toThrow();
  });

  it('the NPC picks one deterministically', () => {
    let s = engine.newGame(1);
    s = engine.apply(s, engine.defaultAction(s)).state;
    expect(chooseAction(engine, s)).toEqual({ t: 'choose', value: SOTEK_ID });
    expect(chooseAction(engine, s)).toEqual(chooseAction(engine, s));
  });

  it('prophesies nothing for an army without it (Sylvaneth is never asked)', () => {
    const s = engine.newGame(1);
    expect(s.asterisms?.[0]).toBeUndefined();
  });
});

describe('Further the Great Plan (4d17-ddf6-7d2a-9889)', () => {
  it('is asked at the start of round 2, not round 1, with each condition shown', () => {
    const s = toFurther(game());
    expect(s.round).toBe(2);
    const d = engine.decision(s)!;
    if (d.kind !== 'asterism') throw new Error('expected asterism');
    expect(d.player).toBe(1);
    expect(d.options).toHaveLength(4);
    // Nothing destroyed, nobody in combat, no enemy in the Seraphon territory, Kroak is alive.
    expect(Object.fromEntries(d.options.map((o) => [o.id, o.met]))).toEqual({
      [SOTEK_ID]: false,
      [ITZL_ID]: false,
      [QUETZL_ID]: true,
      [TEPOK_ID]: true,
    });
  });

  it('a met condition prophesies; an unmet one is picked for nothing and cannot be picked again', () => {
    let s = toFurther(game());
    s = engine.apply(s, { t: 'choose', value: ITZL_ID }).state; // 0 enemy units destroyed
    expect(s.asterisms?.[1]).toMatchObject({ picked: [ITZL_ID], prophesied: [] });
    s = engine.apply(s, engine.defaultAction(s)).state;
    s = editable(toFurther(s));
    expect(s.round).toBe(3);
    const d = engine.decision(s)!;
    if (d.kind !== 'asterism') throw new Error('expected asterism');
    expect(d.options.map((o) => o.id)).not.toContain(ITZL_ID);
    expect(() => engine.apply(s, { t: 'choose', value: ITZL_ID })).toThrow(/not been picked/);
    const t = engine.apply(s, { t: 'choose', value: TEPOK_ID }).state;
    expect(t.asterisms?.[1]?.prophesied).toEqual([TEPOK_ID]);
  });

  it('may be passed, and the NPC passes when no condition is met', () => {
    const s = toFurther(game());
    const d = engine.decision(s)!;
    if (d.kind !== 'asterism') throw new Error('expected asterism');
    // The NPC takes the first met Asterism in its order (Quetzl: nothing in its territory).
    expect(chooseAction(engine, s)).toEqual({ t: 'choose', value: QUETZL_ID });
    const none = editable(s);
    none.units[KROAK]!.status = 'reserve'; // no Slann on the battlefield: Tepok is not met
    none.asterisms = { 1: { picked: [QUETZL_ID], prophesied: [], askedRound: 1 } };
    expect(chooseAction(engine, none)).toEqual({ t: 'pass' });
    expect(engine.apply(none, { t: 'pass' }).state.asterisms?.[1]?.askedRound).toBe(2);
  });

  it('Itzl the Tamer needs 3 or more enemy units destroyed', () => {
    const s = game();
    expect(asterismConditionMet(scenario, s, 1, ITZL_ID)).toBe(false);
    for (const id of ['0:1', '0:2'] as UnitId[]) s.units[id]!.status = 'destroyed';
    expect(asterismConditionMet(scenario, s, 1, ITZL_ID)).toBe(false);
    s.units['0:3']!.status = 'destroyed';
    expect(asterismConditionMet(scenario, s, 1, ITZL_ID)).toBe(true);
  });

  it('Quetzl the Preserver needs no enemy unit wholly within friendly territory', () => {
    const s = game();
    expect(asterismConditionMet(scenario, s, 1, QUETZL_ID)).toBe(true);
    const home = s.units[WARRIORS]!.models[0]!;
    placeUnit(scenario, s, DRYADS, home.x, home.y);
    expect(asterismConditionMet(scenario, s, 1, QUETZL_ID)).toBe(false);
  });

  it('Sotek the Deliverer needs the enemy general in combat or destroyed', () => {
    const s = game();
    expect(asterismConditionMet(scenario, s, 1, SOTEK_ID)).toBe(false);
    const c = editable(s);
    const a = c.units[ALARIELLE]!.models[0]!;
    placeUnit(scenario, c, WARRIORS, a.x + 3, a.y);
    expect(asterismConditionMet(scenario, c, 1, SOTEK_ID)).toBe(true);
    s.units[ALARIELLE]!.status = 'destroyed';
    expect(asterismConditionMet(scenario, s, 1, SOTEK_ID)).toBe(true);
  });

  it('Tepok the Seer needs a Slann on the battlefield, none in combat or destroyed', () => {
    const s = game();
    expect(asterismConditionMet(scenario, s, 1, TEPOK_ID)).toBe(true);
    const c = editable(s);
    const k = c.units[KROAK]!.models[0]!;
    placeUnit(scenario, c, DRYADS, k.x + 3, k.y);
    expect(asterismConditionMet(scenario, c, 1, TEPOK_ID)).toBe(false);
    const d = editable(s);
    d.units[KROAK]!.status = 'destroyed';
    expect(asterismConditionMet(scenario, d, 1, TEPOK_ID)).toBe(false);
    const e = editable(s);
    e.units[KROAK]!.status = 'reserve';
    expect(asterismConditionMet(scenario, e, 1, TEPOK_ID)).toBe(false);
  });
});

describe('the Asterisms apply only once prophesied', () => {
  it('Itzl the Tamer (360d-fd80-f153-269f): Companion weapons of Seraphon have Crit (2 Hits)', () => {
    const tail = profileOf(scenario, game().units[BASTILADON]!).weapons.find(
      (w) => w.name === 'Bludgeoning Tail',
    )!;
    expect(tail.abilities.some((a) => a.t === 'companion')).toBe(true);
    const off = game();
    const on = game([ITZL_ID]);
    expect(
      asterismWeapon(scenario, off, off.units[BASTILADON]!, tail).abilities,
    ).not.toContainEqual({
      t: 'crit2Hits',
    });
    expect(asterismWeapon(scenario, on, on.units[BASTILADON]!, tail).abilities).toContainEqual({
      t: 'crit2Hits',
    });
    // Not for a weapon without Companion, nor for the other player.
    const jaws = profileOf(scenario, on.units[KROAK]!).weapons[0]!;
    expect(asterismWeapon(scenario, on, on.units[KROAK]!, jaws)).toBe(jaws);
    expect(asterismWeapon(scenario, on, on.units[DRYADS]!, tail)).toBe(tail);
  });

  it('Quetzl the Preserver (5089-fe1e-4dd7-5eb4): -1 Rend against melee attacks on Seraphon wholly in friendly territory', () => {
    const off = game();
    const on = game([QUETZL_ID]);
    const sword = profileOf(scenario, on.units[DRYADS]!).weapons.find((w) => w.kind === 'melee')!;
    const bow = profileOf(scenario, on.units[DRYADS]!).weapons.find((w) => w.kind === 'ranged');
    const rend = (s: GameState, weapon = sword) =>
      weaponMods(scenario, s, s.units[DRYADS]!, s.units[WARRIORS]!, weapon, 'fight').rend;
    expect(rend(off)).toBe(0);
    expect(rend(on)).toBe(-1);
    // Ranged attacks are not melee.
    if (bow) expect(rend(on, bow)).toBe(0);
    // Outside friendly territory (the middle of the table) there is no effect.
    const mid = editable(on);
    placeUnit(
      scenario,
      mid,
      WARRIORS,
      scenario.battlefield.width / 2,
      scenario.battlefield.height / 2,
    );
    expect(rend(mid)).toBe(0);
  });

  it('Sotek the Deliverer (6960-effd-2a46-d7d4): +2 Move for Seraphon, shown as the allowance', () => {
    const off = game();
    const on = game([SOTEK_ID]);
    const base = profileOf(scenario, on.units[WARRIORS]!).move;
    const allowance = (s: GameState, id: UnitId, kind: 'normal' | 'run' = 'normal') =>
      engine.unitOptions(s, id).find((o) => o.t === 'move' && o.kind === kind) as
        { allowance: number } | undefined;
    expect(moveOf(scenario, off, off.units[WARRIORS]!)).toBe(base);
    expect(moveOf(scenario, on, on.units[WARRIORS]!)).toBe(base + 2);
    // It is the Seraphon player's turn after a pass to their turn: ask the options directly.
    const turn = editable(on);
    turn.active = 1;
    turn.phase = 'movement';
    turn.stack = [];
    expect(allowance(turn, WARRIORS)?.allowance).toBe(base + 2);
    expect(allowance(turn, WARRIORS, 'run')?.allowance).toBe(base + 2);
    // The other army is unaffected.
    expect(moveOf(scenario, on, on.units[DRYADS]!)).toBe(
      profileOf(scenario, on.units[DRYADS]!).move,
    );
  });

  it('Tepok the Seer (90ae-3432-b3f3-4727): +1 to casting rolls for Seraphon', () => {
    const run = (ids: string[]) => {
      const s = game(ids);
      keepOnly(s, [KROAK, DRYADS]);
      placeUnit(scenario, s, KROAK, 30, 22);
      placeUnit(scenario, s, DRYADS, 40, 22);
      s.active = 1;
      s.phase = 'hero';
      s.stack = [];
      s.players[1].cp = 4;
      const spell = engine
        .unitOptions(s, KROAK)
        .find((o) => o.t === 'ability' && o.targets.length > 0 && o.abilityId !== 'place-of-power');
      if (!spell || spell.t !== 'ability') throw new Error('no spell');
      const r = engine.apply(s, {
        t: 'ability',
        unit: KROAK,
        abilityId: spell.abilityId,
        target: spell.targets[0]!,
      });
      return r.events.find((e) => e.t === 'cast');
    };
    const off = run([]);
    const on = run([TEPOK_ID]);
    expect(off?.t === 'cast' && on?.t === 'cast').toBe(true);
    if (off?.t !== 'cast' || on?.t !== 'cast') return;
    expect(on.dice).toEqual(off.dice);
    expect(on.total).toBe(off.total + 1);
  });
});
