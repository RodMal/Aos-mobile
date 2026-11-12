import { describe, expect, it } from 'vitest';
import {
  SERAPHON_PLACEHOLDER,
  SERAPHON_SUNCLAW_STARHOST,
  SYLVANETH_LORDS_OF_THE_CLAN,
} from '../data/lists.js';
import { pointInPolygon } from '../geom/index.js';
import {
  buildDeploymentFrames,
  checkDeployPlacement,
  createReserveUnits,
  npcDeployPlacement,
} from './deployment.js';
import { createEngine } from './engine.js';
import { currentPlacement, formPlacement, profileOf } from './query.js';
import { createScenario } from './scenario.js';
import type { GameState, PlayerId, Scenario, UnitId, UnitState } from './types.js';

function makeReserveState(scenario: Scenario): GameState {
  const reserveList = createReserveUnits(scenario);
  const units: Record<UnitId, UnitState> = {};
  const unitOrder: UnitId[] = [];
  for (const u of reserveList) {
    units[u.id] = u;
    unitOrder.push(u.id);
  }
  const stack = buildDeploymentFrames(scenario, units);
  return {
    seed: 1,
    rng: 1,
    status: 'playing',
    round: 1,
    turnIndex: 0,
    active: 0,
    firstPlayer: 0,
    phase: 'hero',
    players: [
      { cp: 4, vp: 0, vpByRound: [0] },
      { cp: 4, vp: 0, vpByRound: [0] },
    ],
    units,
    unitOrder,
    objectives: scenario.battlefield.objectives.map((o) => ({ id: o.id, controller: null })),
    stack,
    fightPicker: null,
    winner: null,
  };
}

describe('deployment: createReserveUnits and buildDeploymentFrames', () => {
  const scenario = createScenario([SYLVANETH_LORDS_OF_THE_CLAN, SERAPHON_SUNCLAW_STARHOST]);

  it('creates all army units plus faction terrain in reserve with coordinates inside their home territory', () => {
    const units = createReserveUnits(scenario);
    // Sylvaneth: 8 units + 1 faction terrain = 9
    // Seraphon Sunclaw: 10 units + 1 faction terrain = 11
    expect(units).toHaveLength(20);
    expect(units.every((u) => u.status === 'reserve')).toBe(true);

    const p0Terrain = units.find((u) => u.id === '0:terrain');
    const p1Terrain = units.find((u) => u.id === '1:terrain');
    expect(p0Terrain?.name).toBe('Awakened Wyldwood');
    expect(p0Terrain?.armyIndex).toBe(-1);
    expect(p1Terrain?.name).toBe('Realmshaper Engine');
    expect(p1Terrain?.armyIndex).toBe(-1);

    for (const u of units) {
      const own = scenario.battlefield.territories[scenario.sides[u.owner]];
      const c = u.models[0]!;
      expect(
        own.some((poly) => pointInPolygon([c.x, c.y], poly)),
        `${u.id} (${u.name}) starts inside own territory`,
      ).toBe(true);
    }
  });

  it('orders faction terrain first (attacker then defender), then alternates regiments until remaining deploy at once', () => {
    const state = makeReserveState(scenario);
    // Popping from the top of the LIFO stack gives the deployment sequence
    const popped = [...state.stack].reverse();
    expect(popped).toHaveLength(20);
    expect(popped.every((f) => f.t === 'place' && f.reason === 'deploy')).toBe(true);

    const sequence = popped.map((f) => {
      if (f.t !== 'place') throw new Error('expected place frame');
      const u = state.units[f.unit]!;
      if (profileOf(scenario, u).isFactionTerrain) {
        return `P${u.owner} terrain`;
      }
      const reg = scenario.armies[u.owner].units[u.armyIndex]!.regiment;
      return `P${u.owner} reg ${reg}`;
    });

    // Compress consecutive identical regiment labels to verify regiment alternation
    const regSteps: string[] = [];
    for (const label of sequence) {
      if (regSteps[regSteps.length - 1] !== label) {
        regSteps.push(label);
      }
    }

    expect(regSteps).toEqual([
      'P0 terrain',
      'P1 terrain',
      'P0 reg 0',
      'P1 reg 0',
      'P0 reg 1',
      'P1 reg 1',
      'P0 reg 2',
      'P1 reg 2',
      'P0 reg 3',
      'P0 reg 4',
    ]);
  });
});

describe('deployment: checkDeployPlacement', () => {
  const scenario = createScenario([SYLVANETH_LORDS_OF_THE_CLAN, SERAPHON_PLACEHOLDER]);

  it('allows setting up on ruins and outcrops (1" high or less) but not on a spire', () => {
    const state = makeReserveState(scenario);
    const warsong = state.units['0:5']!; // one model
    const at = (x: number, y: number) =>
      checkDeployPlacement(scenario, state, warsong, formPlacement(scenario, warsong, { x, y }, 0))
        .map((v) => v.code)
        .filter((c) => c === 'OVERLAP');
    const own = scenario.battlefield.territories[scenario.sides[0]];
    const inOwn = (t: { centre: readonly [number, number] }) =>
      own.some((poly) => pointInPolygon(t.centre, poly));
    const low = scenario.battlefield.terrain.filter((t) => t.kind !== 'spire' && inOwn(t));
    const spires = scenario.battlefield.terrain.filter((t) => t.kind === 'spire' && inOwn(t));
    expect(low.length).toBeGreaterThan(0);
    expect(spires.length).toBeGreaterThan(0);
    for (const t of low) expect(at(t.centre[0], t.centre[1]), t.id).toEqual([]);
    for (const t of spires) expect(at(t.centre[0], t.centre[1]), t.id).toEqual(['OVERLAP']);
  });

  it('rejects placements outside friendly territory (OUTSIDE_TERRITORY)', () => {
    const state = makeReserveState(scenario);
    const alarielle = state.units['0:0']!;
    // Player 0 is on side B (left side); x = 50, y = 25 is in side A (enemy territory)
    const bad = formPlacement(scenario, alarielle, { x: 50, y: 25 }, 90);
    const violations = checkDeployPlacement(scenario, state, alarielle, bad);
    expect(violations.map((v) => v.code)).toContain('OUTSIDE_TERRITORY');
  });

  it('rejects placements within 9" of enemy territory (TOO_CLOSE_TO_ENEMY_TERRITORY)', () => {
    const state = makeReserveState(scenario);
    const drycha = state.units['0:3']!;
    // Side B touches Side A at x = 30, y in [11, 33]. Placing at x = 25, y = 22 is inside Side B
    // but only ~5" from Side A (< 9" minimum gap).
    const tooClose = formPlacement(scenario, drycha, { x: 25, y: 22 }, 90);
    const violations = checkDeployPlacement(scenario, state, drycha, tooClose);
    expect(violations.map((v) => v.code)).toContain('TOO_CLOSE_TO_ENEMY_TERRITORY');
    expect(violations.map((v) => v.code)).not.toContain('OUTSIDE_TERRITORY');
  });

  it('rejects placements overlapping terrain or already-deployed units (OVERLAP)', () => {
    const state = makeReserveState(scenario);
    const durthu = state.units['0:2']!;
    // spire-w is at (7, 28) inside side B
    const onTerrain = formPlacement(scenario, durthu, { x: 7, y: 28 }, 90);
    const terrainViolations = checkDeployPlacement(scenario, state, durthu, onTerrain);
    expect(terrainViolations.map((v) => v.code)).toContain('OVERLAP');

    // Deploy durthu legally, then place drycha on top of durthu
    const legalDurthu = npcDeployPlacement(scenario, state, durthu);
    expect(checkDeployPlacement(scenario, state, durthu, legalDurthu)).toEqual([]);
    for (const m of legalDurthu.models) {
      Object.assign(durthu.models[m.i]!, { x: m.x, y: m.y, rot: m.rot });
    }
    durthu.status = 'battlefield';

    const drycha = state.units['0:3']!;
    const onUnit = formPlacement(
      scenario,
      drycha,
      { x: legalDurthu.models[0]!.x, y: legalDurthu.models[0]!.y },
      90,
    );
    const unitViolations = checkDeployPlacement(scenario, state, drycha, onUnit);
    expect(unitViolations.map((v) => v.code)).toContain('OVERLAP');
  });

  it('rejects faction terrain within 3" of an objective (OVERLAP)', () => {
    const state = makeReserveState(scenario);
    const wyldwood = state.units['0:terrain']!;
    // golden-lions-1 is at (15, 22) inside side B
    const onObjective = formPlacement(scenario, wyldwood, { x: 15, y: 22 }, 0);
    const violations = checkDeployPlacement(scenario, state, wyldwood, onObjective);
    expect(violations.map((v) => v.code)).toContain('OVERLAP');
  });

  it('rejects incoherent multi-model unit placements (COHERENCY)', () => {
    const state = makeReserveState(scenario);
    const spiteRevs = state.units['0:4']!;
    const legal = npcDeployPlacement(scenario, state, spiteRevs);
    expect(checkDeployPlacement(scenario, state, spiteRevs, legal)).toEqual([]);

    // Pull model 0 far away from the rest while staying inside territory B and >9" from A
    const broken = {
      unit: spiteRevs.id,
      models: legal.models.map((m, idx) => (idx === 0 ? { ...m, x: 4, y: 18 } : m)),
    };
    const violations = checkDeployPlacement(scenario, state, spiteRevs, broken);
    expect(violations.map((v) => v.code)).toContain('COHERENCY');
  });
});

describe('deployment: full alternating deployment via npcDeployPlacement', () => {
  it.each([
    ['Sylvaneth vs Seraphon Sunclaw', SYLVANETH_LORDS_OF_THE_CLAN, SERAPHON_SUNCLAW_STARHOST],
    ['Sylvaneth vs Seraphon Placeholder', SYLVANETH_LORDS_OF_THE_CLAN, SERAPHON_PLACEHOLDER],
  ])(
    'deploys all units and faction terrain legally on Into the Fire (%s)',
    (_label, list0, list1) => {
      const scenario = createScenario([list0, list1]);
      const state = makeReserveState(scenario);
      const totalToDeploy = state.stack.length;
      expect(totalToDeploy).toBe(Object.keys(state.units).length);

      let deployedCount = 0;
      while (state.stack.length > 0) {
        const frame = state.stack.pop()!;
        expect(frame.t).toBe('place');
        if (frame.t !== 'place') break;
        const unit = state.units[frame.unit]!;
        expect(unit.status).toBe('reserve');

        const placement = npcDeployPlacement(scenario, state, unit);
        const violations = checkDeployPlacement(scenario, state, unit, placement);
        expect(violations, `violations for ${unit.id} (${unit.name})`).toEqual([]);

        for (const m of placement.models) {
          Object.assign(unit.models[m.i]!, { x: m.x, y: m.y, rot: m.rot });
        }
        unit.status = 'battlefield';
        deployedCount++;
      }

      expect(deployedCount).toBe(totalToDeploy);
      for (const player of [0, 1] as PlayerId[]) {
        const playerUnits = state.unitOrder
          .map((id) => state.units[id]!)
          .filter((u) => u.owner === player);
        expect(playerUnits.every((u) => u.status === 'battlefield')).toBe(true);
      }
    },
  );
});

describe('deployment: quick start sets up faction terrain', () => {
  it('places both armies’ faction terrain legally, so overgrowth works in the default game', () => {
    const scenario = createScenario([SYLVANETH_LORDS_OF_THE_CLAN, SERAPHON_SUNCLAW_STARHOST]);
    const s = createEngine(scenario).newGame(1);
    for (const id of ['0:terrain', '1:terrain']) {
      const t = s.units[id]!;
      expect(t.status).toBe('battlefield');
      expect(checkDeployPlacement(scenario, s, t, currentPlacement(t))).toEqual([]);
    }
    // Ever Growing ran at the start of round 1 and gave a feature a token.
    expect(s.overgrown?.[0]).toHaveLength(1);
  });
});
