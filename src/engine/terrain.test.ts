import { describe, expect, it } from 'vitest';
import { SERAPHON_PLACEHOLDER, SYLVANETH_LORDS_OF_THE_CLAN } from '../data/lists.js';
import { effectsOnUnit } from './abilities/effects.js';
import type { Ctx } from './ctx.js';
import { cloneState } from './engine.js';
import { chooseAction } from '../ai/baseline.js';
import { eligibleUnbinders, magicOptionsForUnit } from './abilities/magic.js';
import {
  createEngine,
  createScenario,
  formPlacement,
  profileOf,
  unitsOf,
  type GameState,
} from './index.js';
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
import { applyUntil, startGame } from './test-helpers.js';

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

    const state = cloneState(startGame(engine, 1));
    const warsong = unitsOf(state, 0).find((u) => u.name === 'Warsong Revenant')!;
    warsong.models[0]!.x = 15;
    warsong.models[0]!.y = 4.5;
    expect(unitWithinTerrain(scenario, warsong, ruinNw, 0, true)).toBe(true);
    expect(unitWhollyOnTerrain(scenario, warsong, ruinNw)).toBe(true);
  });
});

describe('unstable terrain', () => {
  it('flags models ending a placement on unstable terrain (ruin-nw)', () => {
    const state = cloneState(startGame(engine, 1));
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
    const state = cloneState(startGame(engine, 1));
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
  it('hides non-Monster/non-Fly units within 1" of spire-w (not merely behind it) and halves their weapon range, while MONSTER and FLY remain visible', () => {
    const state = cloneState(startGame(engine, 1));
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

    // Owner's ruling, 2026-11-11: Obscuring does not block sight lines through the feature;
    // a unit behind it but more than 1" away is visible.
    expect(isUnitObscured(scenario, state, spites)).toBe(false);
    expect(isModelVisibleToModel(scenario, state, attacker, 0, spites, 0)).toBe(true);
    expect(isModelVisibleToUnit(scenario, state, attacker, 0, spites)).toBe(true);
    expect(isUnitVisible(scenario, state, attacker, spites)).toBe(true);

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
  it('owner ruling 2026-11-11: no cover wholly within 1" in the open; cover behind or wholly on', () => {
    const state = cloneState(startGame(engine, 1));
    const attacker = unitsOf(state, 1).find((u) => u.name === 'Spawn of Chotec')!;
    const spites = unitsOf(state, 0).find((u) => u.name === 'Spite-Revenants')!;
    spites.models.forEach((m, idx) => {
      m.alive = idx === 0;
    });
    spites.charged = false;
    attacker.models[0]!.x = 32;
    attacker.models[0]!.y = 16.5;
    // Next to outcrop-w's east edge, on the attacker's side: wholly within 1", in the open.
    spites.models[0]!.x = 25.6;
    spites.models[0]!.y = 16.5;
    expect(unitWithinTerrain(scenario, spites, findTerrain('outcrop-w'), 1, true)).toBe(true);
    expect(unitHasCover(scenario, state, attacker, spites, 'shoot')).toBe(false);
    // Behind it: cover.
    spites.models[0]!.x = 17.5;
    spites.models[0]!.y = 17;
    expect(unitHasCover(scenario, state, attacker, spites, 'shoot')).toBe(true);
    // Wholly on it: cover, against shooting and in combat.
    spites.models[0]!.x = 22;
    spites.models[0]!.y = 17;
    expect(unitHasCover(scenario, state, attacker, spites, 'shoot')).toBe(true);
    expect(unitHasCover(scenario, state, attacker, spites, 'fight')).toBe(true);
  });

  it('grants cover to units wholly on or behind cover terrain unless they charged or have FLY', () => {
    const state = cloneState(startGame(engine, 1));
    const outcropW = findTerrain('outcrop-w'); // centre (22, 17)
    const attacker = unitsOf(state, 1).find((u) => u.name === 'Spawn of Chotec')!;
    const spites = unitsOf(state, 0).find((u) => u.name === 'Spite-Revenants')!;
    spites.models.forEach((m, idx) => {
      m.alive = idx === 0;
    });
    const kroak = unitsOf(state, 1).find((u) => u.name === 'Lord Kroak')!; // FLY

    attacker.models[0]!.x = 32;
    attacker.models[0]!.y = 17;

    // Spites wholly on outcrop-w
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
  it('identifies a non-Monster Hero within 3" of a friendly non-Hero unit and sets infantry flag', () => {
    const state = cloneState(startGame(engine, 1));
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

    // No model-count condition (awaiting the owner's confirmation): one Dryad within 3"
    // still guards; with none within 3" the Hero is not guarded.
    dryads.models.forEach((m, idx) => {
      m.alive = idx === 0;
    });
    dryads.models[0]!.x = 40;
    dryads.models[0]!.y = 18;
    expect(isGuardedHero(scenario, state, warsong)).toEqual({ guarded: true, infantry: true });
    dryads.models[0]!.y = 10;
    expect(isGuardedHero(scenario, state, warsong)).toEqual({ guarded: false, infantry: false });

    // MONSTER hero (Durthu) is never a Guarded Hero
    durthu.models[0]!.x = 20;
    durthu.models[0]!.y = 30;
    expect(isGuardedHero(scenario, state, durthu)).toEqual({ guarded: false, infantry: false });
  });
});

describe('terrain control', () => {
  it('computes the controlling player from models within 3" of a terrain feature', () => {
    const state = cloneState(startGame(engine, 1));
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

describe('Place of Power (owner ruling, 2026-11-11)', () => {
  const spireW = findTerrain('spire-w'); // (7, 28), player 0's side
  const spireE = findTerrain('spire-e'); // (53, 17)

  /** Every unit far away, then one hero of each army next to a spire. */
  function heroesAtSpires() {
    const s = cloneState(startGame(engine, 1));
    for (const id of s.unitOrder) {
      const u = s.units[id]!;
      u.models.forEach((m, i) => {
        m.x = 20 + (i % 10) * 2;
        m.y = u.owner === 0 ? 3 + Math.floor(i / 10) * 2 : 41 - Math.floor(i / 10) * 2;
      });
      // Spread units out so they do not overlap each other.
      u.models.forEach((m) => (m.x += u.armyIndex * 0.01));
    }
    const warsong = unitsOf(s, 0).find((u) => u.name === 'Warsong Revenant')!;
    warsong.models[0]!.x = spireW.centre[0];
    warsong.models[0]!.y = spireW.centre[1] - 4;
    const enemyHero = unitsOf(s, 1).find((u) => profileOf(scenario, u).isHero)!;
    enemyHero.models.forEach((m) => {
      m.x = spireE.centre[0];
      m.y = spireE.centre[1] + 4;
    });
    return { s, warsong, enemyHero };
  }

  /** Passes every decision until the next turn starts. */
  function toNextTurn(s0: GameState): GameState {
    let s = s0;
    const turn = `${s.round}:${s.turnIndex}`;
    while (`${s.round}:${s.turnIndex}` === turn) {
      const d = engine.decision(s)!;
      s = engine.apply(s, d.kind === 'priority' ? engine.defaultAction(s) : { t: 'pass' }).state;
    }
    return s;
  }

  it('is offered at the start of each turn to both players, the active player first', () => {
    const { s, warsong, enemyHero } = heroesAtSpires();
    const next = toNextTurn(s);
    expect(next.active).toBe(1);
    expect(engine.decision(next)).toMatchObject({
      kind: 'placeOfPower',
      player: 1,
      hero: enemyHero.id,
    });
    const after = engine.apply(next, { t: 'pass' }).state;
    expect(engine.decision(after)).toMatchObject({
      kind: 'placeOfPower',
      player: 0,
      hero: warsong.id,
    });
    expect(engine.decision(engine.apply(after, { t: 'pass' }).state)).toMatchObject({
      kind: 'main',
      phase: 'hero',
    });
  });

  it('is once per turn per army, needs no control, and is not offered in the hero phase', () => {
    const { s, warsong } = heroesAtSpires();
    // An enemy unit contesting the spire does not matter.
    const ctx: Ctx = { scenario, s, events: [], rng: new RngCursor(5) };
    expect(canUsePlaceOfPower(scenario, s, warsong)?.id).toBe('spire-w');
    resolvePlaceOfPower(ctx, warsong, 'ignite_fury');
    const alarielle = unitsOf(s, 0).find((u) => u.name === 'Alarielle the Everqueen')!;
    alarielle.models[0]!.x = spireW.centre[0] + 4;
    alarielle.models[0]!.y = spireW.centre[1];
    expect(canUsePlaceOfPower(scenario, s, alarielle)).toBeNull();
    // Not usable as a hero-phase action.
    const hero = passToPhase(cloneState(startGame(engine, 1)), 'hero');
    expect(() =>
      engine.apply(hero, {
        t: 'ability',
        unit: warsong.id,
        abilityId: PLACE_OF_POWER_ID,
      }),
    ).toThrow(/start of a turn/);
  });

  it('the default declines; the NPC picks a boon that helps that hero', () => {
    const { s, warsong } = heroesAtSpires();
    s.stack.push({ t: 'placeOfPower', player: 0, hero: warsong.id, terrain: spireW.id });
    expect(engine.decision(s)).toMatchObject({ kind: 'placeOfPower', player: 0 });
    expect(engine.defaultAction(s)).toEqual({ t: 'pass' });
    // A Priest in its own turn chants: Channelled Wrath. In the enemy turn it cannot.
    s.active = 0;
    expect(chooseAction(engine, s)).toEqual({ t: 'choose', value: 'channelled_wrath' });
    s.active = 1;
    expect(chooseAction(engine, s)).toEqual({ t: 'choose', value: 'ignite_fury' });
    // A hero that is neither Wizard nor Priest never takes Channelled Wrath.
    const plain = unitsOf(s, 0).find((u) => {
      const p = profileOf(scenario, u);
      return p.isHero && !(p.wizard ?? 0) && !(p.priest ?? 0);
    });
    if (plain) {
      s.active = 0;
      s.stack[s.stack.length - 1] = {
        t: 'placeOfPower',
        player: 0,
        hero: plain.id,
        terrain: spireW.id,
      };
      expect(chooseAction(engine, s)).toEqual({ t: 'choose', value: 'ignite_fury' });
    }
  });

  it('backfires on a 1 with D3 mortal damage, which wards can stop', () => {
    let seed = 1;
    while (new RngCursor(seed).int(1, 6) !== 1) seed++;
    const { s, warsong } = heroesAtSpires();
    const ctx: Ctx = { scenario, s, events: [], rng: new RngCursor(seed) };
    resolvePlaceOfPower(ctx, warsong, 'channelled_wrath');
    expect(
      ctx.events.some((e) => e.t === 'roll' && e.label.startsWith('Place of Power backfire')),
    ).toBe(true);
    expect(ctx.events.some((e) => e.t === 'damage' && e.unit === warsong.id)).toBe(true);
    expect(effectsOnUnit(s, warsong.id)).toHaveLength(0);
  });

  it('Channelled Wrath adds 1 to the chanting roll; Dizzying Rage lets a non-wizard unbind', () => {
    let seed = 1;
    while (new RngCursor(seed).int(1, 6) === 1) seed++;
    const { s, warsong, enemyHero } = heroesAtSpires();
    resolvePlaceOfPower(
      { scenario, s, events: [], rng: new RngCursor(seed) },
      warsong,
      'channelled_wrath',
    );
    // An enemy unit in spell range.
    const foe = unitsOf(s, 1).find((u) => u.id !== enemyHero.id && u.armyIndex >= 0)!;
    foe.models.forEach((m, i) => {
      m.x = warsong.models[0]!.x + 8 + (i % 5) * 1.3;
      m.y = warsong.models[0]!.y + Math.floor(i / 5) * 1.3;
    });
    // The Warsong Revenant is a priest: its chanting roll gets the +1.
    const prayer = magicOptionsForUnit(scenario, s, warsong).find(
      (o) => o.t === 'ability' && o.kind === 'prayer',
    );
    if (prayer?.t !== 'ability') throw new Error('no prayer');
    const chant = applyUntil(
      engine,
      s,
      { t: 'ability', unit: warsong.id, abilityId: prayer.abilityId, target: prayer.targets[0] },
      (r) => r.events.some((e) => e.t === 'chant' && e.die > 1),
    );
    const ev = chant.events.find((e) => e.t === 'chant');
    if (ev?.t !== 'chant') throw new Error('no chant');
    expect(ev.total).toBe(ev.die + 1);

    // Dizzying Rage: an enemy hero that is no wizard becomes an unbinder for one spell.
    const t = cloneState(s);
    const plain = unitsOf(t, 1).find(
      (u) => profileOf(scenario, u).isHero && (profileOf(scenario, u).wizard ?? 0) === 0,
    );
    if (!plain) return;
    plain.models.forEach((m, i) => {
      m.x = warsong.models[0]!.x + 10 + i;
      m.y = warsong.models[0]!.y;
    });
    expect(eligibleUnbinders(scenario, t, t.units[warsong.id]!).map((u) => u.id)).not.toContain(
      plain.id,
    );
    t.effects = [
      ...(t.effects ?? []),
      {
        id: PLACE_OF_POWER_ID,
        name: 'Place of Power (Dizzying Rage)',
        sourceUnit: plain.id,
        targetUnit: plain.id,
        owner: 1,
        expires: 'turn',
        data: { boon: 'dizzying_rage' },
      },
    ];
    expect(eligibleUnbinders(scenario, t, t.units[warsong.id]!).map((u) => u.id)).toContain(
      plain.id,
    );
    void enemyHero;
  });
});

function passToPhase(s0: GameState, phase: GameState['phase']): GameState {
  let s = s0;
  while (engine.decision(s)?.kind !== 'main' || s.phase !== phase) {
    s = engine.apply(s, { t: 'pass' }).state;
  }
  return s;
}
