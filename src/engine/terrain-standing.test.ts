/**
 * Standing on terrain (owner's screenshot, 2026-11-12: a Bastiladon ended on a Place of Power).
 * The spires and faction terrain block models entirely; ruins and outcrops may be stood on
 * while `LOW_TERRAIN_KINDS` says so (the owner's standing ruling for terrain 1" high or less).
 */
import { describe, expect, it } from 'vitest';
import { moveTowards } from '../ai/placement.js';
import { LOW_TERRAIN_KINDS, type TerrainKind } from '../data/battlefield.js';
import { SERAPHON_SUNCLAW_STARHOST, SYLVANETH_LORDS_OF_THE_CLAN } from '../data/lists.js';
import { checkDeployPlacement } from './deployment.js';
import {
  createEngine,
  createScenario,
  formPlacement,
  IllegalActionError,
  profileOf,
} from './index.js';
import { checkMovePlacement, type PlaceRules } from './movement.js';
import { modelFootprint, unitTrunks } from './query.js';
import { footprintOverlapsPolygon, pointInPolygon, trunkFootprint } from '../geom/index.js';
import { largestInscribedCircle, WYLDWOOD_PIECES } from '../data/wyldwood.js';
import { editable, keepOnly, placeUnit, startGame } from './test-helpers.js';
import type { GameState, Placement, PlaceReason, Scenario, UnitId } from './types.js';

const scenario = createScenario([SYLVANETH_LORDS_OF_THE_CLAN, SERAPHON_SUNCLAW_STARHOST]);
const engine = createEngine(scenario);
const BASTILADON = '1:7'; // oval 120 x 92 mm
const SPIRE = scenario.battlefield.terrain.find((t) => t.id === 'spire-e')!; // (53, 17), 5" square

/** Scenario variant with another answer to "which kinds may be stood on". */
function withLowKinds(kinds: readonly TerrainKind[]): Scenario {
  return { ...scenario, battlefield: { ...scenario.battlefield, lowTerrainKinds: kinds } };
}

/** A quick-start state with only the Bastiladon (standing at (53, 25)) and an enemy unit. */
function arena(): GameState {
  const s = editable(startGame(engine, 1));
  keepOnly(s, [BASTILADON, '0:6']);
  placeUnit(scenario, s, BASTILADON, 53, 25, 0);
  placeUnit(scenario, s, '0:6', 40, 25, 0);
  return s;
}

/**
 * The Bastiladon's centre 0.8" outside the spire's south edge, long axis north-south: only the
 * tip of the oval is on the spire, so a centre-only test would miss it.
 */
function tipOnSpire(s: GameState): Placement {
  const p = formPlacement(scenario, s.units[BASTILADON]!, { x: 53, y: 20.3 }, 0);
  return { unit: BASTILADON, models: p.models.map((m) => ({ ...m, rot: 90 })) };
}

const REASONS: PlaceReason[] = ['normal', 'run', 'retreat', 'charge', 'pileIn', 'powerThrough'];

describe('standing on terrain: the Bastiladon on a Place of Power', () => {
  it('the test placement has its oval tip, not its centre, on the spire', () => {
    const s = arena();
    const p = tipOnSpire(s);
    const m = p.models[0]!;
    expect(m.y).toBeGreaterThan(19.5);
    const fp = modelFootprint(scenario, s.units[BASTILADON]!, 0, m);
    expect(footprintOverlapsPolygon(fp, SPIRE.polygon)).toBe(true);
  });

  for (const lowKinds of [LOW_TERRAIN_KINDS, [] as TerrainKind[]]) {
    const sc = withLowKinds(lowKinds);
    for (const reason of [...REASONS, 'summon' as const]) {
      it(`${reason} cannot end on a spire (low kinds: ${lowKinds.join(', ') || 'none'})`, () => {
        const s = arena();
        const rules: PlaceRules = {
          reason,
          allowance: 12,
          ...(reason === 'summon' ? { caster: BASTILADON, minEnemyGap: 0 } : {}),
        };
        for (const p of [
          tipOnSpire(s),
          formPlacement(sc, s.units[BASTILADON]!, { x: 53, y: 17 }, 0),
        ]) {
          const v = checkMovePlacement(sc, s, s.units[BASTILADON]!, p, rules);
          expect(v.find((x) => x.code === 'BLOCKED')?.models).toEqual([0]);
          expect(v.find((x) => x.code === 'BLOCKED')?.message).toMatch(/too tall to stand on/);
        }
      });
    }
  }

  it('the engine refuses it (IllegalActionError) for every move kind, Redeploy included', () => {
    // Redeploy and manifestation moves are `normal` place frames.
    for (const reason of REASONS) {
      const s = arena();
      s.stack.push({ t: 'place', unit: BASTILADON, reason, allowance: 12, dice: [] });
      let error: unknown;
      try {
        engine.apply(s, { t: 'place', placement: tipOnSpire(s) });
      } catch (e) {
        error = e;
      }
      expect(error, reason).toBeInstanceOf(IllegalActionError);
      const codes = (error as IllegalActionError).violations?.map((v) => v.code);
      expect(codes, reason).toContain('BLOCKED');
    }
  });

  it('cannot be deployed on a spire, however the low kinds are set', () => {
    for (const lowKinds of [LOW_TERRAIN_KINDS, [] as TerrainKind[]]) {
      const sc = withLowKinds(lowKinds);
      const s = arena();
      const bast = { ...s.units[BASTILADON]!, status: 'reserve' as const };
      s.units[BASTILADON] = bast;
      const codes = checkDeployPlacement(sc, s, bast, tipOnSpire(s)).map((v) => v.code);
      expect(codes).toContain('OVERLAP');
    }
  });

  it('the NPC placement helper moving towards the spire stops short of it', () => {
    const s = arena();
    s.stack.push({ t: 'place', unit: BASTILADON, reason: 'normal', allowance: 10, dice: [] });
    const p = moveTowards(engine, s, BASTILADON, { x: 53, y: 17 });
    expect(p).not.toBeNull();
    const fp = modelFootprint(scenario, s.units[BASTILADON]!, 0, p!.models[0]!);
    expect(footprintOverlapsPolygon(fp, SPIRE.polygon)).toBe(false);
  });

  it('a quick-start game sets up no model on a spire or a feature it may not stand on', () => {
    for (const seed of [1, 2, 3]) {
      const s = engine.newGame(seed);
      for (const id of s.unitOrder) {
        const u = s.units[id]!;
        if (u.status !== 'battlefield') continue;
        u.models.forEach((m, i) => {
          if (!m.alive) return;
          const fp = modelFootprint(scenario, u, i);
          for (const t of scenario.battlefield.terrain) {
            if (LOW_TERRAIN_KINDS.includes(t.kind)) continue;
            expect(footprintOverlapsPolygon(fp, t.polygon), `${u.name} on ${t.id}`).toBe(false);
          }
        });
      }
    }
  });

  it('cannot end a move on the Realmshaper Engine', () => {
    const s = editable(startGame(engine, 1));
    const engineId = terrainId(s, 1);
    keepOnly(s, ['0:5', engineId]);
    const t = s.units[engineId]!.models[0]!;
    const p = formPlacement(scenario, s.units['0:5']!, { x: t.x, y: t.y }, 0);
    const v = checkMovePlacement(scenario, s, s.units['0:5']!, p, {
      reason: 'normal',
      allowance: 100,
    });
    expect(v.map((x) => x.code)).toContain('OVERLAP');
  });
});

function terrainId(s: GameState, owner: 0 | 1): UnitId {
  return s.unitOrder.find(
    (id) => s.units[id]!.owner === owner && profileOf(scenario, s.units[id]!).isFactionTerrain,
  )!;
}

describe('standing on the Awakened Wyldwood (owner, 2026-11-12): anywhere but the trunk', () => {
  const BEARER = '1:4'; // Saurus Astrolith Bearer, one 40 mm base

  /** The Wyldwood, the trunk zone, and a spot on the thin part where the bearer fits. */
  function setUp() {
    const s = editable(startGame(engine, 1));
    const wood = terrainId(s, 0);
    keepOnly(s, [BEARER, wood]);
    const piece = s.units[wood]!;
    const outline = modelFootprint(scenario, piece, 0);
    const trunk = unitTrunks(scenario, piece)[0]!;
    if (outline.kind !== 'polygon' || trunk.kind !== 'circle') throw new Error('no trunk');
    const bearer = s.units[BEARER]!;
    const r = 40 / 25.4 / 2;
    let thin: { x: number; y: number } | null = null;
    for (const [px, py] of outline.outline) {
      // Step from each outline point towards the piece's centre until the base is inside.
      for (let f = 0.1; f <= 0.6 && !thin; f += 0.05) {
        const x = px + (piece.models[0]!.x - px) * f;
        const y = py + (piece.models[0]!.y - py) * f;
        if (Math.hypot(x - trunk.cx, y - trunk.cy) < trunk.r + r + 0.3) continue;
        const fp = modelFootprint(scenario, bearer, 0, { x, y, rot: 0 });
        if (!pointInPolygon([x, y], outline.outline)) continue;
        if (footprintOverlapsPolygon(fp, outline.outline)) thin = { x, y };
      }
      if (thin) break;
    }
    if (!thin) throw new Error('no thin spot found');
    return { s, bearer, trunk, thin };
  }

  it('a base on the thin part of the piece may end a move and be set up there', () => {
    const { s, bearer, thin } = setUp();
    const p: Placement = { unit: BEARER, models: [{ i: 0, x: thin.x, y: thin.y, rot: 0 }] };
    const rules: PlaceRules = { reason: 'normal', allowance: 100 };
    const codes = checkMovePlacement(scenario, s, bearer, p, rules).map((v) => v.code);
    expect(codes).not.toContain('OVERLAP');
    expect(codes).not.toContain('BLOCKED');
  });

  it('a base on the trunk is refused with a readable reason, for moves and set-up', () => {
    const { s, bearer, trunk } = setUp();
    const p: Placement = { unit: BEARER, models: [{ i: 0, x: trunk.cx, y: trunk.cy, rot: 0 }] };
    const v = checkMovePlacement(scenario, s, bearer, p, { reason: 'charge', allowance: 100 });
    const blocked = v.find((x) => x.code === 'BLOCKED');
    expect(blocked?.message).toBe("Models cannot stand on the Awakened Wyldwood's tree trunk.");
    const reserve = { ...bearer, status: 'reserve' as const };
    const d = checkDeployPlacement(
      scenario,
      { ...s, units: { ...s.units, [BEARER]: reserve } },
      reserve,
      p,
    );
    expect(d.map((x) => x.message)).toContain(
      "Models cannot be set up on the Awakened Wyldwood's tree trunk.",
    );
  });

  it('the trunk sits at the widest part of each piece and turns with it', () => {
    for (const piece of WYLDWOOD_PIECES) {
      const c = largestInscribedCircle(piece.points);
      expect(piece.trunk!.r).toBeCloseTo(c.r * 0.9, 2);
      expect(piece.trunk!.r).toBeGreaterThan(0.85);
      expect(pointInPolygon([piece.trunk!.x, piece.trunk!.y], piece.points)).toBe(true);
    }
    const base = WYLDWOOD_PIECES[0]!;
    const at0 = trunkFootprint(base, 10, 10, 0)!;
    const at90 = trunkFootprint(base, 10, 10, 90)!;
    expect(at0.kind === 'circle' && at90.kind === 'circle').toBe(true);
    if (at0.kind === 'circle' && at90.kind === 'circle') {
      expect(at90.cx).toBeCloseTo(10 - (at0.cy - 10), 6);
      expect(at90.cy).toBeCloseTo(10 + (at0.cx - 10), 6);
    }
  });
});

describe('standing on terrain: LOW_TERRAIN_KINDS decides ruins and outcrops', () => {
  const LOW = ['ruin-nw', 'outcrop-w', 'outcrop-e', 'ruin-se'];
  for (const id of LOW) {
    const feature = scenario.battlefield.terrain.find((t) => t.id === id)!;
    it(`${id}: may end a move on it by default, not when it is ruled to block`, () => {
      const s = editable(startGame(engine, 1));
      keepOnly(s, ['0:5']); // Warsong Revenant, one oval-based model
      const u = s.units['0:5']!;
      const p = formPlacement(scenario, u, { x: feature.centre[0], y: feature.centre[1] }, 0);
      const rules: PlaceRules = { reason: 'normal', allowance: 100 };
      const codes = (sc: Scenario) =>
        checkMovePlacement(sc, s, u, p, rules)
          .filter((v) => v.code === 'BLOCKED')
          .map((v) => v.models);
      expect(codes(scenario)).toEqual([]);
      expect(codes(withLowKinds(['ruin', 'outcrop']))).toEqual([]);
      expect(codes(withLowKinds([]))).toEqual([[0]]);
      expect(codes(withLowKinds([feature.kind === 'ruin' ? 'outcrop' : 'ruin']))).toEqual([[0]]);
    });
  }

  it('deployment follows the same switch', () => {
    const feature = scenario.battlefield.terrain.find((t) => t.id === 'outcrop-e')!;
    const s = editable(startGame(engine, 1));
    keepOnly(s, ['1:5']);
    const u = { ...s.units['1:5']!, status: 'reserve' as const };
    s.units['1:5'] = u;
    const p = formPlacement(scenario, u, { x: feature.centre[0] + 3, y: feature.centre[1] }, 0);
    const overlap = (sc: Scenario) =>
      checkDeployPlacement(sc, s, u, p).some((v) => v.code === 'OVERLAP');
    expect(overlap(scenario)).toBe(false);
    expect(overlap(withLowKinds([]))).toBe(true);
  });
});
