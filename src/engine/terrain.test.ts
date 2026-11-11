import { describe, expect, it } from 'vitest';
import { SERAPHON_PLACEHOLDER, SYLVANETH_LORDS_OF_THE_CLAN } from '../data/lists.js';
import { effectsOnUnit } from './abilities/effects.js';
import type { Ctx } from './ctx.js';
import { cloneState } from './engine.js';
import { createEngine, createScenario, formPlacement, unitsOf } from './index.js';
import { RngCursor } from './rng.js';
import {
  canUsePlaceOfPower,
  effectiveWeaponRange,
  footprintWithinTerrain,
  isGuardedHero,
  isModelVisibleToModel,
  isModelVisibleToUnit,
  isUnitObscured,
  isUnitVisible,
  pathBlockedModels,
  PLACE_OF_POWER_ID,
  resolvePlaceOfPower,
  segmentCrossesPolygon,
  terrainController,
  unitBehindTerrain,
  unitHasCover,
  unitWhollyOnTerrain,
  unitWithinTerrain,
  unstableTerrainViolations,
} from './terrain.js';

const scenario = createScenario([SYLVANETH_LORDS_OF_THE_CLAN, SERAPHON_PLACEHOLDER]);
const engine = createEngine(scenario);

function findTerrain(id: string) {
  const t = scenario.battlefield.terrain.find((f) => f.id === id);
  if (!t) throw new Error(`missing terrain ${id}`);
  return t;
}

describe('terrain distance & overlap helpers', () => {
  it('detects footprints and units within or wholly within terrain features', () => {
    const ruinNw = findTerrain('ruin-nw'); // centre (15, 4.5), 7x4
    expect(footprintWithinTerrain({ kind: 'circle', cx: 15, cy: 4.5, r: 0.6 }, ruinNw, 0)).toBe(
      true,
    );
    expect(footprintWithinTerrain({ kind: 'circle', cx: 15, cy: 7.2, r: 0.5 }, ruinNw, 0)).toBe(
      false,
    );
    expect(footprintWithinTerrain({ kind: 'circle', cx: 15, cy: 7.2, r: 0.5 }, ruinNw, 1)).toBe(
      true,
    );

    const state = cloneState(engine.newGame(1));
    const warsong = unitsOf(state, 0).find((u) => u.name === 'Warsong Revenant')!;
    warsong.models[0]!.x = 15;
    warsong.models[0]!.y = 4.5;
    expect(unitWithinTerrain(scenario, warsong, ruinNw, 0, true)).toBe(true);
    expect(unitWhollyOnTerrain(scenario, warsong, ruinNw)).toBe(true);
  });
});

describe('unstable terrain', () => {
  it('flags models ending a placement on unstable terrain (ruin-nw)', () => {
    const state = cloneState(engine.newGame(1));
    const dryads = unitsOf(state, 0).find((u) => u.name === 'Dryads')!;
    const ruinNw = findTerrain('ruin-nw'); // (15, 4.5)

    // Place Dryads right onto ruin-nw
    const onRuin = formPlacement(scenario, dryads, { x: ruinNw.centre[0], y: ruinNw.centre[1] }, 0);
    const violations = unstableTerrainViolations(scenario, dryads, onRuin);
    expect(violations.length).toBeGreaterThan(0);

    // Place Dryads in open ground away from ruins
    const clear = formPlacement(scenario, dryads, { x: 15, y: 12 }, 0);
    expect(unstableTerrainViolations(scenario, dryads, clear)).toEqual([]);
  });
});

describe('fly and path-blocking', () => {
  it('blocks non-FLY models moving across another unit, while FLY models ignore it, and allows crossing unstable terrain', () => {
    const state = cloneState(engine.newGame(1));
    const spites = unitsOf(state, 0).find((u) => u.name === 'Spite-Revenants')!;
    spites.models.forEach((m, idx) => {
      m.alive = idx === 0;
    });
    const alarielle = unitsOf(state, 0).find((u) => u.name === 'Alarielle the Everqueen')!;
    const blocker = unitsOf(state, 0).find((u) => u.name === 'Spirit of Durthu')!;

    // Clear other units far away so only blocker is in the path
    for (const id of state.unitOrder) {
      const u = state.units[id]!;
      for (const m of u.models) {
        m.x = 55;
        m.y = 40;
      }
    }

    // Blocker at (20, 20)
    blocker.models[0]!.x = 20;
    blocker.models[0]!.y = 20;

    // Non-FLY Spite-Revenants moves from (16, 20) to (24, 20) straight through blocker
    spites.models[0]!.x = 16;
    spites.models[0]!.y = 20;
    const blockedPlacement = {
      unit: spites.id,
      models: [{ i: 0, x: 24, y: 20, rot: 0 }],
    };
    expect(pathBlockedModels(scenario, state, spites, blockedPlacement)).toEqual([0]);

    // Non-FLY Spite-Revenants moving across open ground (16, 15) -> (24, 15) is not blocked
    spites.models[0]!.x = 16;
    spites.models[0]!.y = 15;
    const clearPlacement = {
      unit: spites.id,
      models: [{ i: 0, x: 24, y: 15, rot: 0 }],
    };
    expect(pathBlockedModels(scenario, state, spites, clearPlacement)).toEqual([]);

    // Non-FLY Spite-Revenants moving across unstable ruin-nw (15, 1.5) -> (15, 8.5) is allowed along path
    spites.models[0]!.x = 15;
    spites.models[0]!.y = 1.5;
    const acrossRuinPlacement = {
      unit: spites.id,
      models: [{ i: 0, x: 15, y: 8.5, rot: 0 }],
    };
    expect(pathBlockedModels(scenario, state, spites, acrossRuinPlacement)).toEqual([]);
    expect(unstableTerrainViolations(scenario, spites, acrossRuinPlacement)).toEqual([]);

    // FLY Alarielle moving from (15, 20) to (25, 20) right over blocker is NOT blocked
    alarielle.models[0]!.x = 15;
    alarielle.models[0]!.y = 20;
    const flyPlacement = {
      unit: alarielle.id,
      models: [{ i: 0, x: 25, y: 20, rot: 0 }],
    };
    expect(pathBlockedModels(scenario, state, alarielle, flyPlacement)).toEqual([]);
  });
});

describe('line of sight and obscuring terrain', () => {
  it('hides non-Monster/non-Fly units behind or within 1" of spire-w and halves their weapon range, while MONSTER and FLY remain visible', () => {
    const state = cloneState(engine.newGame(1));
    const spireW = findTerrain('spire-w'); // centre (7, 28), 5x5 -> x: 4.5..9.5, y: 25.5..30.5
    expect(segmentCrossesPolygon([2, 28], [13, 28], spireW.polygon)).toBe(true);
    expect(segmentCrossesPolygon([2, 20], [13, 20], spireW.polygon)).toBe(false);

    const attacker = unitsOf(state, 1).find((u) => u.name === 'Spawn of Chotec')!;
    const spites = unitsOf(state, 0).find((u) => u.name === 'Spite-Revenants')!;
    spites.models.forEach((m, idx) => {
      m.alive = idx === 0;
    });
    const durthu = unitsOf(state, 0).find((u) => u.name === 'Spirit of Durthu')!; // MONSTER
    const kroak = unitsOf(state, 1).find((u) => u.name === 'Lord Kroak')!; // FLY

    // Attacker at (14, 28), Spites behind spire-w at (2, 28)
    attacker.models[0]!.x = 14;
    attacker.models[0]!.y = 28;
    spites.models[0]!.x = 2;
    spites.models[0]!.y = 28;

    expect(isModelVisibleToModel(scenario, state, attacker, 0, spites, 0)).toBe(false);
    expect(isModelVisibleToUnit(scenario, state, attacker, 0, spites)).toBe(false);
    expect(isUnitVisible(scenario, state, attacker, spites)).toBe(false);

    // Spites wholly within 1" of spire-w (e.g. at (10, 28), on the same side as attacker at (18, 28))
    attacker.models[0]!.x = 18;
    attacker.models[0]!.y = 28;
    spites.models[0]!.x = 10;
    spites.models[0]!.y = 28;
    expect(isUnitObscured(scenario, state, spites)).toBe(true);
    expect(isUnitVisible(scenario, state, attacker, spites)).toBe(false);
    expect(effectiveWeaponRange(scenario, state, spites, 18)).toBe(9);
    expect(effectiveWeaponRange(scenario, state, spites, 15)).toBe(7);

    // Within combat range (3"), an obscured unit IS visible
    attacker.models[0]!.x = 12;
    attacker.models[0]!.y = 28;
    expect(isUnitVisible(scenario, state, attacker, spites)).toBe(true);

    // MONSTER (Durthu) behind/within spire-w remains visible even from afar
    attacker.models[0]!.x = 18;
    attacker.models[0]!.y = 28;
    durthu.models[0]!.x = 2;
    durthu.models[0]!.y = 28;
    expect(isUnitObscured(scenario, state, durthu)).toBe(false);
    expect(isUnitVisible(scenario, state, attacker, durthu)).toBe(true);

    // FLY unit (Lord Kroak) behind spire-w remains visible
    kroak.models[0]!.x = 2;
    kroak.models[0]!.y = 28;
    expect(isUnitObscured(scenario, state, kroak)).toBe(false);
    expect(isUnitVisible(scenario, state, spites, kroak)).toBe(true);
  });
});

describe('cover', () => {
  it('grants cover to units wholly within 1" or behind cover terrain unless they charged or have FLY', () => {
    const state = cloneState(engine.newGame(1));
    const outcropW = findTerrain('outcrop-w'); // centre (22, 17)
    const attacker = unitsOf(state, 1).find((u) => u.name === 'Spawn of Chotec')!;
    const spites = unitsOf(state, 0).find((u) => u.name === 'Spite-Revenants')!;
    spites.models.forEach((m, idx) => {
      m.alive = idx === 0;
    });
    const kroak = unitsOf(state, 1).find((u) => u.name === 'Lord Kroak')!; // FLY

    attacker.models[0]!.x = 32;
    attacker.models[0]!.y = 17;

    // Spites wholly within 1" of outcrop-w
    spites.models[0]!.x = 22;
    spites.models[0]!.y = 17;
    spites.charged = false;
    expect(unitHasCover(scenario, state, attacker, spites, 'shoot')).toBe(true);
    expect(unitHasCover(scenario, state, attacker, spites, 'fight')).toBe(true);

    // Spites behind outcrop-w (within 2.5" of outcrop-w, sight line crosses outcrop-w)
    spites.models[0]!.x = 17.5;
    spites.models[0]!.y = 17;
    expect(unitBehindTerrain(scenario, attacker, spites, outcropW)).toBe(true);
    expect(unitHasCover(scenario, state, attacker, spites, 'shoot')).toBe(true);

    // Unit that charged this turn does not get cover
    spites.charged = true;
    expect(unitHasCover(scenario, state, attacker, spites, 'shoot')).toBe(false);
    spites.charged = false;

    // Unit with FLY never gets cover
    kroak.models[0]!.x = 22;
    kroak.models[0]!.y = 17;
    kroak.charged = false;
    expect(unitHasCover(scenario, state, spites, kroak, 'shoot')).toBe(false);
  });
});

describe('guarded hero', () => {
  it('identifies a Hero (Health <= 10, non-Monster) within 3" of a 3+ model non-Hero friendly unit and sets infantry flag', () => {
    const state = cloneState(engine.newGame(1));
    const warsong = unitsOf(state, 0).find((u) => u.name === 'Warsong Revenant')!; // INFANTRY HERO, health 7
    const dryads = unitsOf(state, 0).find((u) => u.name === 'Dryads')!; // 10 models
    const durthu = unitsOf(state, 0).find((u) => u.name === 'Spirit of Durthu')!; // MONSTER HERO, health 14
    const scarVet = unitsOf(state, 1).find((u) => u.name === 'Saurus Scar-Veteran on Aggradon')!; // CAVALRY HERO, health 7
    const warriors = unitsOf(state, 1).find((u) => u.name === 'Saurus Warriors')!;

    // Move everyone far apart first
    for (const id of state.unitOrder) {
      const u = state.units[id]!;
      u.models.forEach((m, idx) => {
        m.x = 5 + idx * 1.3;
        m.y = u.owner === 0 ? 5 : 38;
      });
    }

    // Place Warsong far from Dryads -> not guarded
    warsong.models[0]!.x = 40;
    warsong.models[0]!.y = 20;
    expect(isGuardedHero(scenario, state, warsong)).toEqual({ guarded: false, infantry: false });

    // Place Dryads within 3" of Warsong -> guarded & infantry: true
    const dryadPlacement = formPlacement(scenario, dryads, { x: 40, y: 17.5 }, 0);
    for (const m of dryadPlacement.models) {
      dryads.models[m.i]!.x = m.x;
      dryads.models[m.i]!.y = m.y;
    }
    expect(isGuardedHero(scenario, state, warsong)).toEqual({ guarded: true, infantry: true });

    // Non-INFANTRY Cavalry Hero (Scar-Veteran on Aggradon) near Saurus Warriors -> guarded: true, infantry: false
    scarVet.models[0]!.x = 20;
    scarVet.models[0]!.y = 30;
    const warriorPlacement = formPlacement(scenario, warriors, { x: 20, y: 32.5 }, 0);
    for (const m of warriorPlacement.models) {
      warriors.models[m.i]!.x = m.x;
      warriors.models[m.i]!.y = m.y;
    }
    expect(isGuardedHero(scenario, state, scarVet)).toEqual({ guarded: true, infantry: false });

    // If bodyguard drops below 3 living models -> not guarded
    dryads.models.forEach((m, idx) => {
      m.alive = idx < 2;
    });
    expect(isGuardedHero(scenario, state, warsong)).toEqual({ guarded: false, infantry: false });

    // MONSTER hero (Durthu) is never a Guarded Hero
    durthu.models[0]!.x = 20;
    durthu.models[0]!.y = 30;
    expect(isGuardedHero(scenario, state, durthu)).toEqual({ guarded: false, infantry: false });
  });
});

describe('terrain control', () => {
  it('computes the controlling player from models within 3" of a terrain feature', () => {
    const state = cloneState(engine.newGame(1));
    const outcropW = findTerrain('outcrop-w'); // (22, 17)
    for (const id of state.unitOrder) {
      const u = state.units[id]!;
      for (const m of u.models) {
        m.x = 55;
        m.y = 40;
      }
    }
    expect(terrainController(scenario, state, outcropW)).toBeNull();

    const warsong = unitsOf(state, 0).find((u) => u.name === 'Warsong Revenant')!;
    warsong.models[0]!.x = 22;
    warsong.models[0]!.y = 17;
    expect(terrainController(scenario, state, outcropW)).toBe(0);
  });
});

describe('Place of Power', () => {
  it('grants +1 cast/chant/unbind/banish effect and inflicts D3 mortal damage on a 1D6 roll of 1', () => {
    const spireW = findTerrain('spire-w'); // (7, 28)

    // Find a seed where rng.int(1, 6) rolls > 1 and a seed where it rolls 1
    let seedSuccess = 1;
    while (new RngCursor(seedSuccess).int(1, 6) === 1) seedSuccess++;
    let seedBackfire = 1;
    while (new RngCursor(seedBackfire).int(1, 6) !== 1) seedBackfire++;

    // Case 1: Roll >= 2 (no mortal damage, effect added)
    const stateOk = cloneState(engine.newGame(1));
    for (const id of stateOk.unitOrder) {
      const u = stateOk.units[id]!;
      for (const m of u.models) {
        m.x = 50;
        m.y = u.owner === 0 ? 5 : 39;
      }
    }
    const warsongOk = unitsOf(stateOk, 0).find((u) => u.name === 'Warsong Revenant')!;
    warsongOk.models[0]!.x = spireW.centre[0];
    warsongOk.models[0]!.y = spireW.centre[1] - 3; // within 3" of spire-w

    expect(canUsePlaceOfPower(scenario, stateOk, warsongOk)?.id).toBe('spire-w');

    const ctxOk: Ctx = {
      scenario,
      s: stateOk,
      events: [],
      rng: new RngCursor(seedSuccess),
    };
    resolvePlaceOfPower(ctxOk, warsongOk);

    expect(stateOk.usedPlacesOfPower).toContain('spire-w');
    expect(warsongOk.abilitiesUsed).toContain(PLACE_OF_POWER_ID);
    expect(canUsePlaceOfPower(scenario, stateOk, warsongOk)).toBeNull();
    expect(warsongOk.damage).toBe(0);

    const effs = effectsOnUnit(stateOk, warsongOk.id);
    expect(effs).toHaveLength(1);
    expect(effs[0]!.data).toMatchObject({
      castBonus: 1,
      chantBonus: 1,
      unbindBonus: 1,
      banishBonus: 1,
    });

    // Case 2: Roll === 1 (inflicts D3 mortal damage)
    const stateFail = cloneState(engine.newGame(1));
    for (const id of stateFail.unitOrder) {
      const u = stateFail.units[id]!;
      for (const m of u.models) {
        m.x = 50;
        m.y = u.owner === 0 ? 5 : 39;
      }
    }
    const warsongFail = unitsOf(stateFail, 0).find((u) => u.name === 'Warsong Revenant')!;
    warsongFail.models[0]!.x = spireW.centre[0];
    warsongFail.models[0]!.y = spireW.centre[1] - 3;

    const expectedRng = new RngCursor(seedBackfire);
    expect(expectedRng.int(1, 6)).toBe(1);
    const expectedDmg = expectedRng.int(1, 3);

    const ctxFail: Ctx = {
      scenario,
      s: stateFail,
      events: [],
      rng: new RngCursor(seedBackfire),
    };
    resolvePlaceOfPower(ctxFail, warsongFail);

    expect(warsongFail.damage).toBe(expectedDmg);
    expect(
      ctxFail.events.some(
        (e) => e.t === 'damage' && e.unit === warsongFail.id && e.amount === expectedDmg,
      ),
    ).toBe(true);
  });
});
