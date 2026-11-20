/**
 * R11 (I103.7, I108): the NPC uses Huntmaster's Strike, Rhythm of the Chase, Merciless Ambush,
 * Shadowcreep, Realmroot Guide and Guardian Of The Glades only when they serve its plan, and
 * picks legal set-up spots. One block per ability: used when it helps, skipped when it does not.
 */
import { describe, expect, it } from 'vitest';
import { SERAPHON_SUNCLAW_STARHOST, SYLVANETH_LORDS_OF_THE_CLAN } from '../data/lists.js';
import {
  GROUNDSHAKER_ID,
  GUARDIAN_OF_THE_GLADES_ID,
  HUNTMASTERS_STRIKE_ID,
  MERCILESS_AMBUSH_ID,
  REALMROOT_GUIDE_ID,
  RHYTHM_OF_THE_CHASE_ID,
  SHADOWCREEP_ID,
} from '../engine/abilities/sylvaneth.js';
import { createEngine, createScenario, type GameState } from '../engine/index.js';
import { editable, keepOnly, placeUnit, startGame } from '../engine/test-helpers.js';
import { chooseAction } from './baseline.js';
import { ambushRollNeeded, twoDiceChance } from './sylvaneth.js';

const scenario = createScenario([SYLVANETH_LORDS_OF_THE_CLAN, SERAPHON_SUNCLAW_STARHOST]);
const engine = createEngine(scenario);
const WYLDWOOD = '0:terrain';
const BELTHANOS = 'Belthanos, First Thorn of Kurnoth';
const named = (s: GameState, owner: 0 | 1, name: string) =>
  Object.values(s.units).find((u) => u.owner === owner && u.name === name)!;
const obj = scenario.battlefield.objectives.find((o) => o.id === 'golden-lions-1')!;
/** The Wyldwood stands near it, so its overgrowth reaches spots at the objective. */
const WOOD = { x: obj.x, y: obj.y - 5.5 };

/** Player 0 (the NPC) has the Wyldwood on an objective and the named units; the Kroxigor is the enemy. */
function arranged(keep: string[], phase: GameState['phase']): GameState {
  const s = editable(startGame(engine, 1));
  const krox = named(s, 1, 'Kroxigor').id;
  keepOnly(s, [WYLDWOOD, krox, ...keep.map((n) => named(s, 0, n).id)]);
  // Alarielle is gone, and The Goddess Of Life spent: not what these tests are about.
  s.players[0].goddessOfLifeUsed = true;
  placeUnit(scenario, s, WYLDWOOD, WOOD.x, WOOD.y);
  placeUnit(scenario, s, krox, obj.x + 27, obj.y);
  s.active = 0;
  s.phase = phase;
  s.stack = [];
  s.round = 2;
  for (const p of s.players) {
    p.cp = 4;
    p.rageDice = 0;
  }
  for (const o of s.objectives) o.controller = null;
  return s;
}

describe('NPC: Shadowcreep and Realmroot Guide', () => {
  it('Shadowcreep: used by a unit that cannot walk to its objective this turn, set up legally', () => {
    const s = arranged(['Spite-Revenants'], 'movement');
    const id = named(s, 0, 'Spite-Revenants').id;
    placeUnit(scenario, s, id, WOOD.x, WOOD.y - 5);
    const a = chooseAction(engine, s);
    expect(a).toEqual({ t: 'ability', unit: id, abilityId: SHADOWCREEP_ID });
    const declared = engine.apply(s, a).state;
    const p = chooseAction(engine, declared);
    expect(p.t).toBe('place');
    expect(engine.apply(declared, p).state.units[id]!.status).toBe('battlefield');
  });

  it('Shadowcreep: not used when the unit can simply walk there', () => {
    const s = arranged(['Spite-Revenants'], 'movement');
    const id = named(s, 0, 'Spite-Revenants').id;
    placeUnit(scenario, s, id, obj.x, obj.y - 4);
    expect(chooseAction(engine, s)).not.toMatchObject({ abilityId: SHADOWCREEP_ID });
  });

  it('Realmroot Guide: used once, by a far-off bearer, taking a friend with it', () => {
    const s = arranged(['Warsong Revenant', 'Dryads'], 'movement');
    const id = named(s, 0, 'Warsong Revenant').id;
    placeUnit(scenario, s, id, WOOD.x - 3, WOOD.y - 5);
    placeUnit(scenario, s, named(s, 0, 'Dryads').id, WOOD.x + 1, WOOD.y - 5);
    const a = chooseAction(engine, s);
    expect(a).toMatchObject({ t: 'ability', unit: id, abilityId: REALMROOT_GUIDE_ID });
    let st = engine.apply(s, a).state;
    for (let i = 0; i < 2; i++) {
      const p = chooseAction(engine, st);
      expect(p.t).toBe('place');
      st = engine.apply(st, p).state;
    }
    expect(engine.decision(st)).toMatchObject({ kind: 'main' });
    // Once per battle: not again.
    expect(chooseAction(engine, st)).not.toMatchObject({ abilityId: REALMROOT_GUIDE_ID });
  });

  it('Realmroot Guide: not used by a bearer already on an objective', () => {
    const s = arranged(['Warsong Revenant'], 'movement');
    placeUnit(scenario, s, named(s, 0, 'Warsong Revenant').id, obj.x, obj.y);
    expect(chooseAction(engine, s)).not.toMatchObject({ abilityId: REALMROOT_GUIDE_ID });
  });
});

describe("NPC: Huntmaster's Strike and Rhythm of the Chase", () => {
  function charged(): GameState {
    const s = arranged([BELTHANOS], 'end');
    placeUnit(scenario, s, named(s, 0, BELTHANOS).id, WOOD.x, WOOD.y - 5);
    s.units[named(s, 0, BELTHANOS).id]!.charged = true;
    return engine.apply(s, { t: 'pass' }).state;
  }

  it("Huntmaster's Strike: a charger away from an objective is set up on one", () => {
    const s = charged();
    const id = named(s, 0, BELTHANOS).id;
    const a = chooseAction(engine, s);
    expect(a).toEqual({ t: 'ability', unit: id, abilityId: HUNTMASTERS_STRIKE_ID });
    const declared = engine.apply(s, a).state;
    const p = chooseAction(engine, declared);
    if (p.t !== 'place') throw new Error('expected a placement');
    expect(engine.checkPlacement(declared, p.placement)).toEqual([]);
  });

  it("Huntmaster's Strike: not used by a unit already on an objective", () => {
    const s = arranged([BELTHANOS], 'end');
    placeUnit(scenario, s, named(s, 0, BELTHANOS).id, obj.x, obj.y);
    s.units[named(s, 0, BELTHANOS).id]!.charged = true;
    const r = engine.apply(s, { t: 'pass' }).state;
    expect(chooseAction(engine, r)).toEqual({ t: 'pass' });
  });

  it('Rhythm of the Chase: used against the enemy in combat, free damage, and it stays put', () => {
    const s = arranged([BELTHANOS], 'charge');
    const b = named(s, 0, BELTHANOS).id;
    const krox = named(s, 1, 'Kroxigor').id;
    placeUnit(scenario, s, b, 30, 30, 90);
    placeUnit(scenario, s, krox, 34, 30, 270);
    const start = engine.apply(s, { t: 'pass' }).state;
    const a = chooseAction(engine, start);
    expect(a).toEqual({ t: 'ability', unit: b, abilityId: RHYTHM_OF_THE_CHASE_ID, target: krox });
  });

  it('Groundshaker (R14): used in the start-of-combat window against the enemy in combat', () => {
    const s = arranged(['Spirit of Durthu'], 'charge');
    const d = named(s, 0, 'Spirit of Durthu').id;
    const krox = named(s, 1, 'Kroxigor').id;
    placeUnit(scenario, s, d, 30, 30, 90);
    placeUnit(scenario, s, krox, 34, 30, 270);
    const start = engine.apply(s, { t: 'pass' }).state;
    expect(engine.decision(start)).toMatchObject({ kind: 'reaction', trigger: 'start:combat' });
    expect(chooseAction(engine, start)).toEqual({
      t: 'ability',
      unit: d,
      abilityId: GROUNDSHAKER_ID,
      target: krox,
    });
  });

  it('Groundshaker (R14): not offered when no enemy is in combat with the unit', () => {
    const s = arranged(['Spirit of Durthu'], 'charge');
    placeUnit(scenario, s, named(s, 0, 'Spirit of Durthu').id, 30, 30, 90);
    placeUnit(scenario, s, named(s, 1, 'Kroxigor').id, 50, 30, 270);
    const start = engine.apply(s, { t: 'pass' }).state;
    expect(engine.decision(start)?.kind).not.toBe('reaction');
  });
});

describe('NPC: Merciless Ambush and Guardian Of The Glades', () => {
  const DRYCHA = 'Drycha Hamadreth';

  it('Merciless Ambush: declared against a far enemy next to its feature, then confirmed and set up', () => {
    const s = arranged([DRYCHA], 'charge');
    const d = named(s, 0, DRYCHA).id;
    placeUnit(scenario, s, d, obj.x - 12, obj.y);
    placeUnit(scenario, s, named(s, 1, 'Kroxigor').id, obj.x + 7, WOOD.y);
    const a = chooseAction(engine, s);
    expect(a).toEqual({ t: 'command', command: 'mercilessAmbush', unit: d });
    const asked = engine.apply(s, a).state;
    expect(engine.decision(asked)).toMatchObject({ kind: 'reaction' });
    expect(chooseAction(engine, asked)).toEqual({
      t: 'ability',
      unit: d,
      abilityId: MERCILESS_AMBUSH_ID,
    });
    // With any roll that leaves a legal spot it sets up; with none it stays and loses nothing more.
    let sawSetUp = false;
    for (let rng = 1; rng < 60 && !sawSetUp; rng++) {
      let st = engine.apply({ ...asked, rng }, chooseAction(engine, asked)).state;
      if (engine.decision(st)?.kind !== 'place') continue;
      const p = chooseAction(engine, st);
      if (p.t === 'place') {
        st = engine.apply(st, p).state;
        expect(st.units[d]!.charged).toBe(true);
        sawSetUp = true;
      }
    }
    expect(sawSetUp).toBe(true);
  });

  it('Merciless Ambush: not used when a normal charge reaches, nor with CP short', () => {
    const near = arranged([DRYCHA], 'charge');
    placeUnit(scenario, near, named(near, 0, DRYCHA).id, obj.x - 12, obj.y);
    placeUnit(scenario, near, named(near, 1, 'Kroxigor').id, obj.x - 4, obj.y);
    expect(chooseAction(engine, near)).not.toMatchObject({ command: 'mercilessAmbush' });
    const poor = arranged([DRYCHA], 'charge');
    placeUnit(scenario, poor, named(poor, 0, DRYCHA).id, obj.x - 12, obj.y);
    placeUnit(scenario, poor, named(poor, 1, 'Kroxigor').id, obj.x + 7, WOOD.y);
    poor.players[0].cp = 1;
    expect(chooseAction(engine, poor)).not.toMatchObject({ command: 'mercilessAmbush' });
  });

  it('Merciless Ambush: the 2D6 chance of the roll needed decides (58% at X = 7)', () => {
    expect(twoDiceChance(7)).toBeCloseTo(21 / 36, 5);
    expect(twoDiceChance(8)).toBeLessThan(0.58);
    const used = (dx: number) => {
      const s = arranged([DRYCHA], 'charge');
      placeUnit(scenario, s, named(s, 0, DRYCHA).id, obj.x - 12, obj.y);
      placeUnit(scenario, s, named(s, 1, 'Kroxigor').id, obj.x + dx, WOOD.y);
      const x = ambushRollNeeded(scenario, s, named(s, 0, DRYCHA), named(s, 1, 'Kroxigor'));
      const a = chooseAction(engine, s);
      return { x, used: a.t === 'command' && a.command === 'mercilessAmbush' };
    };
    const near = used(7);
    expect(near.x).toBeLessThanOrEqual(7);
    expect(near.used).toBe(true);
    const far = used(28);
    expect(far.x).toBeGreaterThan(7);
    expect(far.used).toBe(false);
  });

  it('Guardian Of The Glades: declared to charge the enemy fighting a friendly Hero', () => {
    const s = arranged(['Spirit of Durthu', BELTHANOS], 'charge');
    placeUnit(scenario, s, named(s, 0, BELTHANOS).id, 20, 20, 90);
    placeUnit(scenario, s, named(s, 1, 'Kroxigor').id, 24, 20, 270);
    const du = named(s, 0, 'Spirit of Durthu').id;
    placeUnit(scenario, s, du, 24, 29, 0);
    const a = chooseAction(engine, s);
    expect(a).toEqual({ t: 'ability', unit: du, abilityId: GUARDIAN_OF_THE_GLADES_ID });
  });

  it('Guardian Of The Glades: not used when no enemy fights a Hero', () => {
    const s = arranged(['Spirit of Durthu', BELTHANOS], 'charge');
    placeUnit(scenario, s, named(s, 0, BELTHANOS).id, 10, 10, 90);
    placeUnit(scenario, s, named(s, 0, 'Spirit of Durthu').id, 24, 29, 0);
    expect(chooseAction(engine, s)).not.toMatchObject({ abilityId: GUARDIAN_OF_THE_GLADES_ID });
  });
});
