/**
 * Reserve and ambush (M4j): Hidden Hunters sets a Hunters of Huanchi unit up in reserve in
 * ambush instead of deploying it; Chameleon Ambush sets it up in its movement phase, anywhere
 * more than 9" from enemy units; units still in reserve in ambush are destroyed at the start of
 * round 4 (Core 24.0 and 24.1).
 */
import { describe, expect, it } from 'vitest';
import { SERAPHON_SUNCLAW_STARHOST, SYLVANETH_LORDS_OF_THE_CLAN } from '../data/lists.js';
import { CHAMELEON_AMBUSH_ID, HIDDEN_HUNTERS_ID } from './abilities/seraphon.js';
import { RngCursor } from './rng.js';
import { npcDeployPlacement } from './deployment.js';
import { createEngine } from './engine.js';
import { formPlacement } from './query.js';
import { createScenario } from './scenario.js';
import { editable, placeUnit } from './test-helpers.js';
import { startRound } from './turns.js';
import type { Action, GameState, Placement } from './types.js';

const scenario = createScenario([SERAPHON_SUNCLAW_STARHOST, SYLVANETH_LORDS_OF_THE_CLAN]);
const engine = createEngine(scenario);
const HUNTERS = '0:8';
const OTHER_HUNTERS = '0:9';

/** Deploys both armies; the Hunters in `ambush` use Hidden Hunters. */
function deploy(ambush: string[]): GameState {
  let s = engine.newGame(3, { deploy: true });
  for (let i = 0; i < 200; i++) {
    const d = engine.decision(s);
    if (d?.kind === 'venomites') {
      s = engine.apply(s, engine.defaultAction(s)).state;
      continue;
    }
    if (!d || d.kind !== 'place' || d.reason !== 'deploy') break;
    const unit = s.units[d.unit]!;
    const action: Action = ambush.includes(d.unit)
      ? { t: 'ability', unit: d.unit, abilityId: HIDDEN_HUNTERS_ID }
      : { t: 'place', placement: npcDeployPlacement(scenario, s, unit)! };
    s = engine.apply(s, action).state;
  }
  return s;
}

/** Any legal spot for the unit being set up, scanning the battlefield. */
function legalSpot(s: GameState, unitId: string, near?: { x: number; y: number }): Placement {
  const unit = s.units[unitId]!;
  const { width, height } = scenario.battlefield;
  const spots: { x: number; y: number }[] = [];
  for (let x = 4; x < width - 3; x += 3)
    for (let y = 4; y < height - 3; y += 3) spots.push({ x, y });
  if (near) {
    spots.sort(
      (a, b) => Math.hypot(a.x - near.x, a.y - near.y) - Math.hypot(b.x - near.x, b.y - near.y),
    );
  }
  for (const c of spots) {
    const p = formPlacement(scenario, unit, c, 0);
    if (engine.checkPlacement(s, p).length === 0) return p;
  }
  throw new Error('no legal spot');
}

/** A started game's movement phase of player 0 in round 2, the Hunters in ambush. */
function movementPhase(): GameState {
  const s = editable(deploy([HUNTERS]));
  s.stack = [];
  s.round = 2;
  s.active = 0;
  s.phase = 'movement';
  return s;
}

describe('Hidden Hunters', () => {
  it('is offered for the unit about to be deployed, and only for a unit that has it', () => {
    let s = engine.newGame(3, { deploy: true });
    const seen = new Map<string, boolean>();
    for (let i = 0; i < 200; i++) {
      const d = engine.decision(s);
      if (d?.kind === 'venomites') {
        s = engine.apply(s, engine.defaultAction(s)).state;
        continue;
      }
      if (!d || d.kind !== 'place' || d.reason !== 'deploy') break;
      seen.set(d.unit, d.canAmbush === true);
      s = engine.apply(s, {
        t: 'place',
        placement: npcDeployPlacement(scenario, s, s.units[d.unit]!)!,
      }).state;
    }
    expect([...seen.entries()].filter(([, v]) => v).map(([k]) => k)).toEqual([
      HUNTERS,
      OTHER_HUNTERS,
    ]);
    expect(seen.get('1:3')).toBe(false);
  });

  it('sets the unit up in reserve in ambush, counted as deployed, and deployment goes on', () => {
    const s = deploy([HUNTERS]);
    const unit = s.units[HUNTERS]!;
    expect(unit.status).toBe('reserve');
    expect(unit.inAmbush).toBe(true);
    // Deployment is over: everything else is on the battlefield and the battle has begun.
    expect(s.stack.filter((f) => f.t === 'place')).toHaveLength(0);
    expect(s.units[OTHER_HUNTERS]!.status).toBe('battlefield');
    expect(s.units[OTHER_HUNTERS]!.inAmbush).toBeFalsy();
    expect(engine.decision(s)?.kind).not.toBe('place');
  });

  it('cannot be used on the battlefield, or for a unit that is not the one being deployed', () => {
    const s = engine.newGame(3, { deploy: true });
    const first = engine.decision(s);
    if (first?.kind !== 'place') throw new Error('expected a deploy placement');
    expect(() =>
      engine.apply(s, { t: 'ability', unit: HUNTERS, abilityId: HIDDEN_HUNTERS_ID }),
    ).toThrow();
    const after = deploy([]);
    expect(() =>
      engine.apply(after, { t: 'ability', unit: HUNTERS, abilityId: HIDDEN_HUNTERS_ID }),
    ).toThrow();
  });

  it('keeps a unit in ambush off the battlefield: no options in other phases, not a target', () => {
    const s = movementPhase();
    s.phase = 'shooting';
    expect(engine.unitOptions(s, HUNTERS)).toEqual([]);
  });
});

describe('Chameleon Ambush', () => {
  it('is offered in the owner’s own movement phase, not in the enemy turn', () => {
    const s = movementPhase();
    const opts = engine.unitOptions(s, HUNTERS);
    expect(opts).toHaveLength(1);
    expect(opts[0]).toMatchObject({
      t: 'ability',
      abilityId: CHAMELEON_AMBUSH_ID,
      name: 'Chameleon Ambush',
    });
    s.active = 1;
    expect(engine.unitOptions(s, HUNTERS)).toEqual([]);
    expect(() =>
      engine.apply(s, { t: 'ability', unit: HUNTERS, abilityId: CHAMELEON_AMBUSH_ID }),
    ).toThrow();
  });

  it('sets the unit up anywhere more than 9" from all enemy units, and not closer', () => {
    const s = movementPhase();
    const declared = engine.apply(s, {
      t: 'ability',
      unit: HUNTERS,
      abilityId: CHAMELEON_AMBUSH_ID,
    }).state;
    const d = engine.decision(declared);
    expect(d).toMatchObject({ kind: 'place', reason: 'relocate', unit: HUNTERS });
    // Right beside an enemy unit: not allowed.
    const enemy = Object.values(declared.units).find(
      (u) => u.owner === 1 && u.status === 'battlefield' && u.armyIndex >= 0,
    )!;
    const near = formPlacement(
      scenario,
      declared.units[HUNTERS]!,
      { x: enemy.models[0]!.x + 4, y: enemy.models[0]!.y },
      0,
    );
    expect(engine.checkPlacement(declared, near).map((v) => v.code)).toContain(
      'ENEMY_COMBAT_RANGE',
    );
    // Anywhere legal, outside its own territory too.
    const spot = legalSpot(declared, HUNTERS, { x: 30, y: 22 });
    const after = engine.apply(declared, { t: 'place', placement: spot }).state;
    const unit = after.units[HUNTERS]!;
    expect(unit.status).toBe('battlefield');
    expect(unit.inAmbush).toBe(false);
    expect(unit.models[0]!.x).toBeCloseTo(spot.models[0]!.x);
  });

  it('counts as set up this turn: it cannot move in the same movement phase (Core 24.0)', () => {
    const s = movementPhase();
    const declared = engine.apply(s, {
      t: 'ability',
      unit: HUNTERS,
      abilityId: CHAMELEON_AMBUSH_ID,
    }).state;
    const after = engine.apply(declared, {
      t: 'place',
      placement: legalSpot(declared, HUNTERS, { x: 30, y: 22 }),
    }).state;
    expect(after.units[HUNTERS]!.setUpThisTurn).toBe(true);
    expect(engine.unitOptions(after, HUNTERS).some((o) => o.t === 'move')).toBe(false);
  });

  it('can be cancelled: the unit stays in ambush', () => {
    const s = movementPhase();
    const declared = engine.apply(s, {
      t: 'ability',
      unit: HUNTERS,
      abilityId: CHAMELEON_AMBUSH_ID,
    }).state;
    const after = engine.apply(declared, { t: 'pass' }).state;
    expect(after.units[HUNTERS]).toMatchObject({ status: 'reserve', inAmbush: true });
    expect(engine.unitOptions(after, HUNTERS)).toHaveLength(1);
  });

  it('keeps the other models of the unit in coherency and off other units (core set-up limits)', () => {
    const s = movementPhase();
    const declared = engine.apply(s, {
      t: 'ability',
      unit: HUNTERS,
      abilityId: CHAMELEON_AMBUSH_ID,
    }).state;
    const unit = declared.units[HUNTERS]!;
    const friend = Object.values(declared.units).find(
      (u) => u.owner === 0 && u.status === 'battlefield' && u.armyIndex >= 0,
    )!;
    const onFriend = formPlacement(
      scenario,
      unit,
      { x: friend.models[0]!.x, y: friend.models[0]!.y },
      0,
    );
    expect(engine.checkPlacement(declared, onFriend).map((v) => v.code)).toContain('OVERLAP');
    // All models must be set up: a placement missing one is refused.
    const spot = legalSpot(declared, HUNTERS, { x: 30, y: 22 });
    const short = { ...spot, models: spot.models.slice(1) };
    expect(engine.checkPlacement(declared, short).map((v) => v.code)).toContain('WRONG_MODELS');
  });
});

describe('units still in ambush at round 4 (Core 24.1)', () => {
  it('are destroyed at the start of the fourth battle round, not before', () => {
    const s = movementPhase();
    s.round = 3;
    const ctx3 = { scenario, s, events: [], rng: new RngCursor(s.rng) };
    startRound(ctx3);
    expect(s.units[HUNTERS]!.status).toBe('reserve');
    s.round = 4;
    const ctx4 = { scenario, s, events: [] as { t: string }[], rng: new RngCursor(s.rng) };
    startRound(ctx4 as Parameters<typeof startRound>[0]);
    expect(s.units[HUNTERS]!.status).toBe('destroyed');
    expect(s.units[HUNTERS]!.models.every((m) => !m.alive)).toBe(true);
  });

  it('spares a unit that was set up', () => {
    const s = movementPhase();
    placeUnit(scenario, s, HUNTERS, 30, 22);
    s.units[HUNTERS]!.status = 'battlefield';
    s.units[HUNTERS]!.inAmbush = false;
    s.round = 4;
    startRound({ scenario, s, events: [], rng: new RngCursor(s.rng) });
    expect(s.units[HUNTERS]!.status).toBe('battlefield');
  });
});
