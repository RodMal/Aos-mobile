import { describe, expect, it } from 'vitest';
import { SERAPHON_SUNCLAW_STARHOST, SYLVANETH_LORDS_OF_THE_CLAN } from '../data/lists.js';
import { chooseAction } from '../ai/baseline.js';
import {
  createEngine,
  createScenario,
  IllegalActionError,
  profileOf,
  type GameState,
} from './index.js';
import { editable, keepOnly, placeUnit, startGame } from './test-helpers.js';

const scenario = createScenario([SYLVANETH_LORDS_OF_THE_CLAN, SERAPHON_SUNCLAW_STARHOST]);
const engine = createEngine(scenario);

/** Player 0's end phase with a unit that has two melee weapons in combat with two enemy units. */
function setup(): { s: GameState; unit: string; enemies: string[]; weapons: string[] } {
  const s = editable(startGame(engine, 1));
  const unit = Object.values(s.units).find(
    (u) =>
      u.owner === 0 &&
      u.models.length === 1 &&
      profileOf(scenario, u).weapons.filter((w) => w.kind === 'melee').length >= 2,
  )!;
  const enemies = Object.values(s.units)
    .filter((u) => u.owner === 1 && u.armyIndex >= 0 && u.models.length === 1)
    .slice(0, 2);
  keepOnly(s, [unit.id, ...enemies.map((u) => u.id)]);
  placeUnit(scenario, s, unit.id, 30, 22);
  placeUnit(scenario, s, enemies[0]!.id, 35, 22, 270);
  placeUnit(scenario, s, enemies[1]!.id, 30, 27, 180);
  s.players[0].rageDice = 3;
  s.phase = 'end';
  const weapons = profileOf(scenario, unit)
    .weapons.filter((w) => w.kind === 'melee')
    .map((w) => w.id);
  return { s, unit: unit.id, enemies: enemies.map((u) => u.id), weapons };
}

describe('Eruption of Fury choices (owner, 2026-11-11)', () => {
  it('offers up to 3 rage dice, the engaged targets and the melee weapons', () => {
    const { s, unit, enemies, weapons } = setup();
    const o = engine.unitOptions(s, unit).find((x) => x.t === 'ability')!;
    if (o.t !== 'ability') throw new Error('no ability option');
    expect(o.abilityId).toBe('eruption-of-fury');
    expect(o.maxRageDice).toBe(3);
    expect([...o.targets].sort()).toEqual([...enemies].sort());
    expect(o.weapons!.map((w) => w.id)).toEqual(weapons);
  });

  it('spends the number of dice chosen, with the chosen weapon and target', () => {
    const { s, unit, enemies, weapons } = setup();
    const r = engine.apply(s, {
      t: 'ability',
      unit,
      abilityId: 'eruption-of-fury',
      target: enemies[1]!,
      weaponId: weapons[1]!,
      rageDice: 1,
    });
    expect(r.state.players[0].rageDice).toBe(2);
    const note = r.events.find((e) => e.t === 'note' && e.text.includes('erupts'));
    const wName = profileOf(scenario, s.units[unit]!).weapons.find((w) => w.id === weapons[1])!;
    expect(note).toMatchObject({ t: 'note' });
    if (note?.t !== 'note') return;
    expect(note.text).toContain(`erupts with ${wName.name}: spent 1 rage dice`);
    expect(note.text).toContain(s.units[enemies[1]!]!.name);
  });

  it('rejects 0 dice, more than the maximum, and a weapon the unit does not have', () => {
    const { s, unit } = setup();
    const base = { t: 'ability', unit, abilityId: 'eruption-of-fury' } as const;
    expect(() => engine.apply(s, { ...base, rageDice: 0 })).toThrow(IllegalActionError);
    expect(() => engine.apply(s, { ...base, rageDice: 4 })).toThrow(IllegalActionError);
    s.players[0].rageDice = 2;
    expect(() => engine.apply(s, { ...base, rageDice: 3 })).toThrow(IllegalActionError);
    expect(() => engine.apply(s, { ...base, weaponId: 'nope' })).toThrow(IllegalActionError);
    // Leaving the choice out still spends the maximum.
    expect(engine.apply(s, base).state.players[0].rageDice).toBe(0);
  });

  it('the NPC names a legal weapon, target and dice count', () => {
    const { s, unit, enemies, weapons } = setup();
    const a = chooseAction(engine, s);
    expect(a).toMatchObject({ t: 'ability', unit, abilityId: 'eruption-of-fury', rageDice: 3 });
    if (a.t !== 'ability') return;
    expect(enemies).toContain(a.target);
    expect(weapons).toContain(a.weaponId);
    expect(() => engine.apply(s, a)).not.toThrow();
  });
});
