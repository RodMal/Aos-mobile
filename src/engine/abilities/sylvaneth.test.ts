/**
 * Sylvaneth passive abilities (M4d): Alarielle's Song, Terror Of The Deep Woods, One With The
 * Forest, Kurnothi War-horn, Battle Damaged (three warscrolls) and the Glamourweave artefact.
 * Readings: docs/RULES-DECISIONS.md I91 to I97.
 */
import { describe, expect, it } from 'vitest';
import { SERAPHON_SUNCLAW_STARHOST, SYLVANETH_LORDS_OF_THE_CLAN } from '../../data/lists.js';
import { attackModifiers } from '../../rules/core/modifiers.js';
import { moveOf } from '../../rules/factions/seraphon.js';
import { rollAttackSequence, rollWard } from '../attack.js';
import { usedWeapon } from '../combat.js';
import { moveOptions } from '../eligibility.js';
import { createEngine, createScenario, inCombat, type GameState, type UnitId } from '../index.js';
import { profileOf } from '../query.js';
import {
  ScriptedDice,
  editable,
  keepOnly,
  passTo,
  placeUnit,
  startGame,
  weapon,
} from '../test-helpers.js';
import { applyUntil } from '../test-helpers.js';
import { clearExpiredEffects, effectiveWard, unitGrants, wardRollModifier } from './effects.js';
import { glamourRerolls, spendGlamourweave } from './sylvaneth.js';

const scenario = createScenario([SYLVANETH_LORDS_OF_THE_CLAN, SERAPHON_SUNCLAW_STARHOST]);
const engine = createEngine(scenario);

const ALARIELLE = '0:0';
const BELTHANOS = '0:1';
const DURTHU = '0:2';
const DRYCHA = '0:3';
const WARSONG = '0:5';
const DRYADS = '0:6';
const FAR_DRYADS = '0:7';
const ENEMY = '1:1';
const FAR_ENEMY = '1:2';

/** `ids` only, in the movement phase, at the given places. */
function arena(at: Record<string, [number, number]>): GameState {
  const s = editable(startGame(engine, 1));
  keepOnly(s, Object.keys(at));
  for (const [id, [x, y]] of Object.entries(at)) placeUnit(scenario, s, id, x, y);
  s.active = 0;
  for (const p of s.players) {
    p.cp = 0;
    p.rageDice = 0;
  }
  return s;
}

const unit = (s: GameState, id: UnitId) => s.units[id]!;

describe("Alarielle's Song (3f73-3ee4-8f6b-b16b)", () => {
  const s = arena({
    [WARSONG]: [30, 22],
    [DRYADS]: [30, 28],
    [FAR_DRYADS]: [30, 60],
    [ALARIELLE]: [10, 10],
    [ENEMY]: [40, 22],
    [FAR_ENEMY]: [10, 60],
  });

  it('gives Ward (6+) to friendly Sylvaneth wholly within 12", itself included', () => {
    expect(effectiveWard(scenario, s, unit(s, DRYADS))).toBe(6);
    expect(effectiveWard(scenario, s, unit(s, WARSONG))).toBe(6);
    expect(effectiveWard(scenario, s, unit(s, FAR_DRYADS))).toBeUndefined();
  });

  it('never worsens a better ward', () => {
    const t = arena({ [WARSONG]: [30, 22], [ALARIELLE]: [30, 28], [DRYADS]: [24, 22] });
    expect(unitGrants(scenario, t, unit(t, ALARIELLE)).ward).toBe(5);
    expect(unitGrants(scenario, t, unit(t, DRYADS)).ward).toBe(6);
  });

  it('subtracts 1 from the ward rolls of enemies within 12", and rollWard applies it', () => {
    expect(wardRollModifier(scenario, s, unit(s, ENEMY))).toBe(-1);
    expect(wardRollModifier(scenario, s, unit(s, FAR_ENEMY))).toBe(0);
    expect(wardRollModifier(scenario, s, unit(s, DRYADS))).toBe(0);
    // Ward 6+: an unmodified 6 saves, but with -1 it is a 5 and fails.
    expect(rollWard(new ScriptedDice([6]), 1, 6, 0).taken).toBe(0);
    expect(rollWard(new ScriptedDice([6]), 1, 6, -1).taken).toBe(1);
  });
});

describe('Terror Of The Deep Woods (a1f-39fd-6570-f3d5)', () => {
  it('bars enemies within 9" from running; beyond 9" they may run', () => {
    const near = arena({ [DRYCHA]: [20, 22], [ENEMY]: [30, 22], [FAR_ENEMY]: [55, 50] });
    expect(unitGrants(scenario, near, unit(near, ENEMY)).cannotRun).toBe(true);
    expect(
      moveOptions(scenario, near, unit(near, ENEMY)).map((o) => o.t === 'move' && o.kind),
    ).toEqual(['normal']);
    const far = moveOptions(scenario, near, unit(near, FAR_ENEMY)).map(
      (o) => o.t === 'move' && o.kind,
    );
    expect(far).toEqual(['normal', 'run']);
  });

  it('bars enemies in combat with it from retreating', () => {
    const s = arena({ [DRYCHA]: [20, 22], [ENEMY]: [24, 22] });
    expect(inCombat(scenario, s, unit(s, ENEMY))).toBe(true);
    expect(moveOptions(scenario, s, unit(s, ENEMY))).toEqual([]);
    // Without it the same unit may retreat.
    const without = arena({ [DURTHU]: [20, 22], [ENEMY]: [26, 22] });
    expect(inCombat(scenario, without, unit(without, ENEMY))).toBe(true);
    expect(
      moveOptions(scenario, without, unit(without, ENEMY)).map((o) => o.t === 'move' && o.kind),
    ).toEqual(['retreat']);
  });

  it('does not bind its own side', () => {
    const s = arena({ [DRYCHA]: [20, 22], [DRYADS]: [24, 22] });
    expect(unitGrants(scenario, s, unit(s, DRYADS)).cannotRun).toBeFalsy();
  });
});

describe('One With The Forest (f62f-75b0-48cd-101e)', () => {
  const outcrop = scenario.battlefield.terrain.find((t) => t.id === 'outcrop-w')!;
  const sit = (s: GameState) => ({
    attacker: unit(s, ENEMY),
    target: unit(s, DRYADS),
    weapon: weapon(),
    mode: 'fight' as const,
  });

  it('subtracts 1 from hit and wound rolls while the unit is wholly within the overgrowth', () => {
    const s = arena({ [DRYADS]: [outcrop.centre[0], outcrop.centre[1]], [ENEMY]: [10, 10] });
    s.overgrown = [['outcrop-w'], []];
    const mods = attackModifiers(scenario, s, sit(s));
    expect(mods).toContainEqual(expect.objectContaining({ stat: 'hit', value: -1 }));
    expect(mods).toContainEqual(expect.objectContaining({ stat: 'wound', value: -1 }));
  });

  it('does nothing outside the overgrowth, or when the unit is only partly within it', () => {
    const s = arena({ [DRYADS]: [outcrop.centre[0], outcrop.centre[1]], [ENEMY]: [10, 10] });
    s.overgrown = [[], []];
    expect(
      attackModifiers(scenario, s, sit(s)).filter((m) => m.source === 'One With The Forest'),
    ).toEqual([]);
    const t = arena({ [DRYADS]: [outcrop.centre[0], outcrop.centre[1] + 12], [ENEMY]: [10, 10] });
    t.overgrown = [['outcrop-w'], []];
    expect(
      attackModifiers(scenario, t, sit(t)).filter((m) => m.source === 'One With The Forest'),
    ).toEqual([]);
  });
});

describe('Kurnothi War-horn (59e8-f376-a5df-144c)', () => {
  it('adds 2" to the Move of Belthanos himself, the only Kurnothi in the list', () => {
    const s = arena({ [BELTHANOS]: [30, 22], [DRYADS]: [30, 28] });
    const base = profileOf(scenario, unit(s, BELTHANOS)).move;
    expect(moveOf(scenario, s, unit(s, BELTHANOS))).toBe(base + 2);
    const options = moveOptions(scenario, s, unit(s, BELTHANOS));
    expect(options.map((o) => o.t === 'move' && o.allowance)).toEqual([base + 2, base + 2]);
  });

  it('is not given to other units, or to Belthanos once he is gone', () => {
    const s = arena({ [BELTHANOS]: [30, 22], [DRYADS]: [30, 28] });
    expect(moveOf(scenario, s, unit(s, DRYADS))).toBe(profileOf(scenario, unit(s, DRYADS)).move);
    const gone = arena({ [DRYADS]: [30, 28] });
    expect(moveOf(scenario, gone, unit(gone, DRYADS))).toBe(
      profileOf(scenario, unit(gone, DRYADS)).move,
    );
  });

  it('is not given to an enemy unit', () => {
    const s = arena({ [BELTHANOS]: [30, 22], [ENEMY]: [35, 22] });
    expect(moveOf(scenario, s, unit(s, ENEMY))).toBe(profileOf(scenario, unit(s, ENEMY)).move);
  });
});

describe('Battle Damaged', () => {
  const cases: [string, UnitId, string, number][] = [
    ['135b-afc5-4fd9-3460', ALARIELLE, "Wardroth Beetle's Antlers", 4],
    ['c6b8-a8fd-b2-59fa', BELTHANOS, "Carnelian Greatspite's Mandibles", 3],
    ['2eb1-9bd5-1544-36d9', DURTHU, 'Guardian Sword', 3],
  ];
  for (const [id, who, name, attacks] of cases) {
    it(`${name} has ${attacks} Attacks from 10 damage points (${id})`, () => {
      const s = arena({ [who]: [30, 22] });
      const u = unit(s, who);
      expect(profileOf(scenario, u).abilities.some((a) => a.id === id)).toBe(true);
      const w = profileOf(scenario, u).weapons.find((x) => x.name.trim() === name)!;
      expect(usedWeapon(scenario, s, u, w).attacks).toEqual(w.attacks);
      u.damage = 9;
      expect(usedWeapon(scenario, s, u, w).attacks).toEqual(w.attacks);
      u.damage = 10;
      expect(usedWeapon(scenario, s, u, w).attacks).toEqual({ n: 0, sides: 0, plus: attacks });
      for (const other of profileOf(scenario, u).weapons.filter((x) => x.id !== w.id)) {
        expect(usedWeapon(scenario, s, u, other).attacks).toEqual(other.attacks);
      }
    });
  }
});

describe('Glamourweave (cafd-9cf1-871c-f47e)', () => {
  it('re-rolls the first failed hit, wound and save once each, and no second failure', () => {
    // 2 attacks, hit 4+, wound 4+, save 4+. Hits: 2 (fails) -> 5 re-roll; 3 (fails, none left).
    // Wound on the one hit: 1 (fails) -> 6 re-roll. Save: 2 (fails) -> 5 re-roll saves.
    const r = rollAttackSequence(new ScriptedDice([2, 5, 3, 1, 6, 2, 5]), {
      weapon: weapon({ attacks: { n: 0, sides: 0, plus: 2 } }),
      attacks: 2,
      mods: { hit: 0, wound: 0, save: 0, rend: 0, damage: 0 },
      target: { save: 4, ward: null },
      rerolls: { hit: true, wound: true, save: true },
    });
    expect(r).toMatchObject({
      hits: 1,
      wounds: 1,
      unsaved: 0,
      rerolled: { hit: true, wound: true, save: true },
    });
  });

  it('is spent once per phase for the unit and returns at the end of the phase', () => {
    const s = arena({ [DURTHU]: [30, 22], [ENEMY]: [36, 22] });
    expect(glamourRerolls(scenario, s, unit(s, DURTHU), unit(s, ENEMY))).toEqual({
      hit: true,
      wound: true,
    });
    expect(glamourRerolls(scenario, s, unit(s, ENEMY), unit(s, DURTHU))).toEqual({ save: true });
    spendGlamourweave(s, unit(s, DURTHU), unit(s, ENEMY), { hit: true, wound: false, save: false });
    expect(glamourRerolls(scenario, s, unit(s, DURTHU), unit(s, ENEMY))).toEqual({ wound: true });
    spendGlamourweave(s, unit(s, ENEMY), unit(s, DURTHU), { hit: false, wound: false, save: true });
    expect(glamourRerolls(scenario, s, unit(s, ENEMY), unit(s, DURTHU))).toEqual({});
    clearExpiredEffects(s, 'phase');
    expect(glamourRerolls(scenario, s, unit(s, DURTHU), unit(s, ENEMY))).toEqual({
      hit: true,
      wound: true,
    });
  });

  it('is not given to the unit without the artefact', () => {
    const s = arena({ [ALARIELLE]: [30, 22], [ENEMY]: [36, 22] });
    expect(glamourRerolls(scenario, s, unit(s, ALARIELLE), unit(s, ENEMY))).toEqual({});
  });

  it('is used in a real fight: the re-roll is noted and spent for the phase', () => {
    const base = arena({ [DURTHU]: [20, 22], [ENEMY]: [26, 22], [BELTHANOS]: [8, 8] });
    placeUnit(scenario, base, DURTHU, 20, 22, 90);
    placeUnit(scenario, base, ENEMY, 26, 22, 270);
    expect(inCombat(scenario, base, unit(base, DURTHU))).toBe(true);
    let s = passTo(engine, base, 'combat');
    s = engine.apply(s, { t: 'fight', unit: DURTHU }).state;
    s = engine.apply(s, { t: 'pass' }).state; // no pile-in
    const r = applyUntil(engine, s, engine.defaultAction(s), (x) =>
      x.events.some((e) => e.t === 'note' && e.text.startsWith('Glamourweave')),
    );
    expect(r.state.effects?.some((e) => e.id.startsWith('cafd-9cf1-871c-f47e:'))).toBe(true);
  });
});
