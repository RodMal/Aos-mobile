/**
 * Seraphon passives (M4f): Brutal Blows, Starspawned, Scaled Protectors, Beastmaster,
 * Selfless Protectors, Revivifying Energies and Ordered Cohorts. Readings: I100 to I102.
 */
import { describe, expect, it } from 'vitest';
import { SERAPHON_SUNCLAW_STARHOST, SYLVANETH_LORDS_OF_THE_CLAN } from '../../data/lists.js';
import { attackModifiers } from '../../rules/core/modifiers.js';
import { moveOf } from '../../rules/factions/seraphon.js';
import { weaponMods } from '../combat.js';
import type { Ctx } from '../ctx.js';
import { allocateDamage } from '../damage.js';
import { createEngine, createScenario, type GameState, type UnitId } from '../index.js';
import { profileOf } from '../query.js';
import { RngCursor } from '../rng.js';
import { editable, keepOnly, placeUnit, startGame } from '../test-helpers.js';
import { clearExpiredEffects, effectiveWard, unitGrants } from './effects.js';

const scenario = createScenario([SERAPHON_SUNCLAW_STARHOST, SYLVANETH_LORDS_OF_THE_CLAN]);
const engine = createEngine(scenario);

const KROAK = '0:0';
const KROXIGOR = '0:1';
const SUNBLOOD = '0:2';
const GUARD = '0:3';
const ASTROLITH = '0:4';
const WARRIORS = '0:5';
const BASTILADON = '0:7';
const HUNTERS = '0:8';
const DRYADS = '1:6';

function arena(at: Record<string, [number, number]>): GameState {
  const s = editable(startGame(engine, 1));
  keepOnly(s, Object.keys(at));
  for (const [id, [x, y]] of Object.entries(at)) placeUnit(scenario, s, id, x, y);
  s.active = 0;
  return s;
}

const unit = (s: GameState, id: UnitId) => s.units[id]!;

function ctxFor(s: GameState): Ctx {
  return { scenario, s, events: [], rng: new RngCursor(1) };
}

describe('Brutal Blows (786b-b219-e23-42f8)', () => {
  const hammer = profileOf(scenario, unit(arena({ [KROXIGOR]: [30, 22] }), KROXIGOR)).weapons[0]!;

  it('adds 1 Damage in melee against a unit of 10 or more models, not 9', () => {
    const s = arena({ [KROXIGOR]: [30, 22], [DRYADS]: [30, 26] });
    const dryads = unit(s, DRYADS);
    const sit = {
      attacker: unit(s, KROXIGOR),
      target: dryads,
      weapon: hammer,
      mode: 'fight' as const,
    };
    expect(dryads.models.filter((m) => m.alive).length).toBeGreaterThanOrEqual(10);
    const damage = (): number =>
      attackModifiers(scenario, s, sit)
        .filter((m) => m.stat === 'damage' && m.source === 'Brutal Blows')
        .reduce((n, m) => n + m.value, 0);
    expect(damage()).toBe(1);
    expect(weaponMods(scenario, s, sit.attacker, dryads, hammer, 'fight').damage).toBe(1);
    const alive = dryads.models.filter((m) => m.alive);
    for (const m of alive.slice(0, alive.length - 9)) m.alive = false;
    expect(dryads.models.filter((m) => m.alive)).toHaveLength(9);
    expect(damage()).toBe(0);
  });

  it('does not apply to shooting attacks', () => {
    const s = arena({ [KROXIGOR]: [30, 22], [DRYADS]: [30, 26] });
    const sit = {
      attacker: unit(s, KROXIGOR),
      target: unit(s, DRYADS),
      weapon: hammer,
      mode: 'shoot' as const,
    };
    expect(attackModifiers(scenario, s, sit).filter((m) => m.source === 'Brutal Blows')).toEqual(
      [],
    );
  });
});

describe('Starspawned (f571-744e-c103-8568)', () => {
  it('ignores the first damage point each phase for a Saurus or Kroxigor unit within 12"', () => {
    const s = arena({ [SUNBLOOD]: [30, 22], [KROXIGOR]: [30, 26], [DRYADS]: [30, 50] });
    const krox = unit(s, KROXIGOR);
    const ctx = ctxFor(s);
    expect(allocateDamage(ctx, krox, 3, 'test').taken).toBe(2);
    expect(krox.damage).toBe(2);
    expect(allocateDamage(ctx, krox, 3, 'test').taken).toBe(3);
    expect(krox.damage).toBe(5);
    clearExpiredEffects(s, 'phase');
    expect(allocateDamage(ctx, krox, 1, 'test').taken).toBe(0);
    expect(krox.damage).toBe(5);
  });

  it('does not help a unit beyond 12", a non-Saurus unit or an enemy', () => {
    const s = arena({
      [SUNBLOOD]: [30, 22],
      [KROXIGOR]: [30, 60],
      [BASTILADON]: [30, 26],
      [DRYADS]: [30, 40],
    });
    const ctx = ctxFor(s);
    expect(allocateDamage(ctx, unit(s, KROXIGOR), 3, 'test').taken).toBe(3);
    expect(allocateDamage(ctx, unit(s, BASTILADON), 3, 'test').taken).toBe(3);
    expect(allocateDamage(ctx, unit(s, DRYADS), 3, 'test').taken).toBe(3);
  });
});

describe('Scaled Protectors (3ffa-e9b3-901b-8d06)', () => {
  it('ignores save modifiers and Rend for the Sunblood Pack only', () => {
    const s = arena({ [SUNBLOOD]: [30, 22], [KROXIGOR]: [30, 28], [DRYADS]: [30, 40] });
    const weapon = profileOf(scenario, unit(s, DRYADS)).weapons.find((w) => w.rend > 0);
    const w = weapon ?? profileOf(scenario, unit(s, DRYADS)).weapons[0]!;
    expect(unitGrants(scenario, s, unit(s, SUNBLOOD)).ignoreSaveModifiers).toBe(true);
    expect(unitGrants(scenario, s, unit(s, KROXIGOR)).ignoreSaveModifiers).toBeUndefined();
    const against = (id: UnitId) =>
      weaponMods(scenario, s, unit(s, DRYADS), unit(s, id), w, 'fight');
    expect(against(SUNBLOOD).save).toBe(0);
    expect(against(SUNBLOOD).rend).toBe(-w.rend);
    expect(against(KROXIGOR).rend).toBe(0);
  });
});

describe('Beastmaster (5e50-d938-39d2-19a6)', () => {
  it('adds 2" to Seraphon Cavalry and Monsters wholly within 12" of the bearer', () => {
    const s = arena({
      [SUNBLOOD]: [30, 22],
      [BASTILADON]: [30, 28],
      [KROXIGOR]: [30, 32],
      [HUNTERS]: [30, 60],
    });
    expect(unit(s, SUNBLOOD).armyIndex).toBe(2);
    const base = profileOf(scenario, unit(s, BASTILADON)).move;
    expect(moveOf(scenario, s, unit(s, BASTILADON))).toBe(base + 2);
    // Infantry get nothing, even in range.
    expect(moveOf(scenario, s, unit(s, KROXIGOR))).toBe(
      profileOf(scenario, unit(s, KROXIGOR)).move,
    );
  });

  it('gives nothing to a Monster beyond 12" or once the bearer is gone', () => {
    const far = arena({ [SUNBLOOD]: [30, 22], [BASTILADON]: [30, 60] });
    const base = profileOf(scenario, unit(far, BASTILADON)).move;
    expect(moveOf(scenario, far, unit(far, BASTILADON))).toBe(base);
    const gone = arena({ [BASTILADON]: [30, 28] });
    expect(moveOf(scenario, gone, unit(gone, BASTILADON))).toBe(base);
  });
});

describe('Selfless Protectors (e49d-3d7e-2eee-a5e0)', () => {
  it('gives Ward (5+) to the unit and a Slann in its combat range', () => {
    const s = arena({ [GUARD]: [30, 22], [KROAK]: [30, 25.5], [WARRIORS]: [30, 50] });
    expect(effectiveWard(scenario, s, unit(s, GUARD))).toBe(5);
    // Lord Kroak has Ward (4+) already, which is better.
    expect(effectiveWard(scenario, s, unit(s, KROAK))).toBe(4);
    expect(effectiveWard(scenario, s, unit(s, WARRIORS))).toBeUndefined();
  });

  it('does nothing without a Slann in combat range', () => {
    const s = arena({ [GUARD]: [30, 22], [KROAK]: [30, 40] });
    expect(effectiveWard(scenario, s, unit(s, GUARD))).toBeUndefined();
  });
});

describe('Revivifying Energies (15e-ebba-9386-bd1a)', () => {
  it('gives Ward (6+) to Seraphon Infantry wholly within 12" and 5+ to those already 6+', () => {
    const s = arena({
      [ASTROLITH]: [30, 22],
      [WARRIORS]: [30, 28],
      [HUNTERS]: [30, 34],
      [BASTILADON]: [30, 40],
    });
    expect(effectiveWard(scenario, s, unit(s, WARRIORS))).toBe(6);
    // Hunters have Ward (5+) of their own already.
    expect(effectiveWard(scenario, s, unit(s, HUNTERS))).toBe(5);
    // A Monster is not Infantry.
    expect(effectiveWard(scenario, s, unit(s, BASTILADON))).toBeUndefined();
  });

  it('turns a printed Ward (6+) into 5+', () => {
    const s = arena({ [ASTROLITH]: [30, 22], [WARRIORS]: [30, 28] });
    unit(s, WARRIORS); // no printed ward: 6+
    const profile = profileOf(scenario, unit(s, WARRIORS)) as { ward: number | null };
    const saved = profile.ward;
    profile.ward = 6;
    try {
      expect(effectiveWard(scenario, s, unit(s, WARRIORS))).toBe(5);
    } finally {
      profile.ward = saved;
    }
  });

  it('is not given to units beyond 12"', () => {
    const s = arena({ [ASTROLITH]: [30, 22], [WARRIORS]: [30, 60] });
    expect(effectiveWard(scenario, s, unit(s, WARRIORS))).toBeUndefined();
  });
});

describe('Ordered Cohorts (4181-bbd5-a4d8-1f59)', () => {
  const objective = scenario.battlefield.objectives[0]!;
  const saves = (s: GameState): number =>
    attackModifiers(scenario, s, {
      attacker: unit(s, DRYADS),
      target: unit(s, WARRIORS),
      weapon: profileOf(scenario, unit(s, DRYADS)).weapons[0]!,
      mode: 'fight',
    })
      .filter((m) => m.stat === 'save')
      .reduce((n, m) => n + m.value, 0);

  function onObjective(): GameState {
    const s = arena({ [WARRIORS]: [objective.x, objective.y], [DRYADS]: [5, 5] });
    const w = unit(s, WARRIORS);
    // One model alone, on the objective.
    w.models.forEach((m, i) => {
      if (i > 0) m.alive = false;
    });
    Object.assign(w.models[0]!, { x: objective.x, y: objective.y });
    return s;
  }

  it('adds 1 to saves while the model contests an objective its owner controls', () => {
    const s = onObjective();
    s.objectives.find((o) => o.id === objective.id)!.controller = 0;
    expect(saves(s)).toBe(1);
  });

  it('does not while the objective is controlled by the enemy or by nobody', () => {
    const s = onObjective();
    expect(saves(s)).toBe(0);
    s.objectives.find((o) => o.id === objective.id)!.controller = 1;
    expect(saves(s)).toBe(0);
  });

  it('does not while any model is off the objective', () => {
    const s = onObjective();
    s.objectives.find((o) => o.id === objective.id)!.controller = 0;
    const w = unit(s, WARRIORS);
    w.models[1]!.alive = true;
    Object.assign(w.models[1]!, { x: objective.x + 20, y: objective.y + 20 });
    expect(saves(s)).toBe(0);
  });
});
