import { describe, expect, it } from 'vitest';
import { SERAPHON_PLACEHOLDER, SYLVANETH_LORDS_OF_THE_CLAN } from '../data/lists.js';
import {
  createEngine,
  createScenario,
  IllegalActionError,
  unitDistance,
  type Action,
  type GameState,
} from './index.js';
import { editable, keepOnly, passTo, placeUnit, startGame } from './test-helpers.js';

const scenario = createScenario([SYLVANETH_LORDS_OF_THE_CLAN, SERAPHON_PLACEHOLDER]);
const engine = createEngine(scenario);
const DURTHU = '0:2'; // Verdant Blast, 12"
const DRYADS = '0:6';
const SKINKS = '1:7'; // 10 models, Javelins 12", Shoot in Combat
const SAURUS = '1:1';

/** Player `active`'s shooting phase with Durthu, Dryads, Skinks and Saurus Guard set up. */
function arena(active: 0 | 1 = 0): GameState {
  const s = editable(startGame(engine, 1));
  s.active = active;
  s.firstPlayer = active;
  keepOnly(s, [DURTHU, DRYADS, SKINKS, SAURUS]);
  placeUnit(scenario, s, DURTHU, 20, 22);
  placeUnit(scenario, s, DRYADS, 10, 35);
  placeUnit(scenario, s, SKINKS, 34, 22, 270);
  placeUnit(scenario, s, SAURUS, 50, 40);
  return passTo(engine, s, 'shooting');
}

describe('shooting', () => {
  it('offers shoot to a unit with a ranged weapon and a target in range', () => {
    const s = arena();
    expect(unitDistance(scenario, s.units[DURTHU]!, s.units[SKINKS]!)).toBeLessThan(12);
    expect(engine.unitOptions(s, DURTHU)).toEqual([{ t: 'shoot' }]);
    expect(engine.unitOptions(s, DRYADS)).toEqual([]); // no ranged weapon
  });

  it('lists each weapon with its targets, models in range and expected damage', () => {
    const s = arena();
    const options = engine.targetOptions(s, DURTHU, 'shoot');
    expect(options).toHaveLength(1);
    expect(options[0]!.weaponName).toBe('Verdant Blast');
    expect(options[0]!.targets).toHaveLength(1);
    expect(options[0]!.targets[0]).toMatchObject({ unit: SKINKS, modelsInRange: 1 });
    expect(options[0]!.targets[0]!.expectedDamage).toBeGreaterThan(0);
  });

  it('counts only the models in range of the target', () => {
    const s = editable(arena(1));
    // Durthu 12.5" from the nearest Skink: only part of the Skink unit reaches.
    placeUnit(scenario, s, SKINKS, 33, 22, 270);
    placeUnit(scenario, s, DURTHU, 19, 22);
    const t = engine.targetOptions(s, SKINKS, 'shoot')[0]!.targets.find((x) => x.unit === DURTHU);
    expect(t).toBeDefined();
    expect(t!.modelsInRange).toBeGreaterThan(0);
    expect(t!.modelsInRange).toBeLessThan(10);
  });

  it('rolls the attacks, allocates the damage and marks the unit as having shot', () => {
    const s = arena();
    s.players[1].cp = 0; // no All-out Defence reaction
    const weaponId = engine.targetOptions(s, DURTHU, 'shoot')[0]!.weaponId;
    const r = engine.apply(s, {
      t: 'shoot',
      unit: DURTHU,
      allocations: [{ weaponId, target: SKINKS }],
    });
    const attacks = r.events.find((e) => e.t === 'attacks');
    expect(attacks).toMatchObject({ attacker: DURTHU, target: SKINKS, mode: 'shoot', attacks: 5 });
    expect(r.state.units[DURTHU]!.shot).toBe(true);
    expect(engine.unitOptions(r.state, DURTHU)).toEqual([]);
    if (attacks?.t === 'attacks' && attacks.damage > 0) {
      expect(r.events).toContainEqual(expect.objectContaining({ t: 'damage', unit: SKINKS }));
    }
  });

  it('refuses a weapon, target or unit that cannot shoot', () => {
    const s = arena();
    const weaponId = engine.targetOptions(s, DURTHU, 'shoot')[0]!.weaponId;
    const bad: Action[] = [
      { t: 'shoot', unit: DURTHU, allocations: [{ weaponId, target: SAURUS }] },
      { t: 'shoot', unit: DURTHU, allocations: [{ weaponId: 'nope', target: SKINKS }] },
      { t: 'shoot', unit: DURTHU, allocations: [] },
      { t: 'shoot', unit: DRYADS, allocations: [{ weaponId, target: SKINKS }] },
    ];
    for (const a of bad) expect(() => engine.apply(s, a)).toThrow(IllegalActionError);
  });

  it('a unit that ran or retreated cannot shoot', () => {
    for (const moved of ['run', 'retreat'] as const) {
      const s = editable(arena());
      s.units[DURTHU]!.moved = moved;
      expect(engine.unitOptions(s, DURTHU)).toEqual([]);
      expect(engine.targetOptions(s, DURTHU, 'shoot')).toEqual([]);
    }
  });

  it('a unit in combat can only use Shoot in Combat weapons', () => {
    // Durthu next to the Saurus Guard: Verdant Blast lacks Shoot in Combat.
    const s = editable(arena());
    placeUnit(scenario, s, SAURUS, 20, 26);
    expect(engine.unitOptions(s, DURTHU)).toEqual([]);
    // Skinks next to the Dryads still throw javelins (Shoot in Combat).
    const t = editable(arena(1));
    placeUnit(scenario, t, DRYADS, 34, 26);
    expect(engine.targetOptions(t, SKINKS, 'shoot')[0]!.weaponName).toBe(
      'Javelins and Boltspitters',
    );
  });
});
