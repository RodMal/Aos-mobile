import mapJson from '../../data/maps/into-the-fire.json';
import terrainJson from '../../data/terrain/into-the-fire.json';
import { shapeToPolygon, type Polygon, type ReadonlyPoint } from '../geom/polygon.js';
import { BattleMapSchema, objectiveRadius, territoriesFor, type Side } from './map-schema.js';

export type TerrainKind = 'ruin' | 'spire' | 'outcrop';

/** Universal terrain abilities a feature has. */
export type TerrainTrait = 'cover' | 'obscuring' | 'unstable' | 'placeOfPower';

export interface TerrainFeature {
  id: string;
  name: string;
  kind: TerrainKind;
  /** Footprint in inches, clockwise on screen. */
  polygon: Polygon;
  centre: ReadonlyPoint;
  traits: TerrainTrait[];
}

export interface ObjectiveSpec {
  id: string;
  /** Realm objective type, e.g. "golden-lions". */
  kind: string;
  x: number;
  y: number;
  /** Control range from the centre in inches (3" plus the 40mm marker's radius). */
  radius: number;
}

/**
 * A battleplan's table: board, territories, objectives and terrain. Coordinates are inches
 * with the origin at the top-left corner, x to the right (0..60) and y down (0..44).
 */
export interface Battlefield {
  id: string;
  name: string;
  width: number;
  height: number;
  /** Territory polygons per map side. The attacker takes `attackerSide`. */
  territories: Record<Side, Polygon[]>;
  attackerSide: Side;
  /** Units deploy wholly within their territory and at least this far from enemy territory. */
  deployGapFromEnemyTerritory: number;
  objectives: ObjectiveSpec[];
  terrain: TerrainFeature[];
  /**
   * Terrain kinds models may stand on, for tests that try the other ruling. Leave it out to
   * use `LOW_TERRAIN_KINDS`.
   */
  lowTerrainKinds?: readonly TerrainKind[];
}

/**
 * THE switch for standing on terrain. Terrain kinds no more than 1" high, which models may
 * be set up on and may end any move on (owner's standing ruling: models may stand on terrain
 * 1" high or less; ruins and outcrops are assumed that low, awaiting the owner's answer).
 * Every other kind (the spires, which are the Places of Power) blocks models entirely: no
 * part of a base may end a move, a charge, a pile-in, a summon or a set-up on it.
 * If the owner rules that ruins and outcrops block too, change this line to `[]`.
 */
export const LOW_TERRAIN_KINDS: readonly TerrainKind[] = ['ruin', 'outcrop'];

/** True when models may stand on this feature (it is 1" high or less). */
export function allowsSetUpOn(
  feature: TerrainFeature,
  lowKinds: readonly TerrainKind[] = LOW_TERRAIN_KINDS,
): boolean {
  return lowKinds.includes(feature.kind);
}

/** True when models may stand on this feature of this battlefield. */
export function canStandOn(battlefield: Battlefield, feature: TerrainFeature): boolean {
  return allowsSetUpOn(feature, battlefield.lowTerrainKinds ?? LOW_TERRAIN_KINDS);
}

const TRAITS: Record<TerrainKind, TerrainTrait[]> = {
  ruin: ['cover', 'unstable'],
  spire: ['obscuring', 'placeOfPower'],
  outcrop: ['cover', 'obscuring'],
};

interface TerrainJson {
  id: string;
  name: string;
  kind: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rot: number;
}

function rotatedRect(f: TerrainJson): Polygon {
  const t = (f.rot * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  const corners: [number, number][] = [
    [-f.w / 2, -f.h / 2],
    [f.w / 2, -f.h / 2],
    [f.w / 2, f.h / 2],
    [-f.w / 2, f.h / 2],
  ];
  return corners.map(([lx, ly]) => [f.x + lx * c - ly * s, f.y + lx * s + ly * c] as const);
}

function build(): Battlefield {
  const map = BattleMapSchema.parse(mapJson);
  const side = (s: Side): Polygon[] => territoriesFor(map, s).map((shape) => shapeToPolygon(shape));
  return {
    id: 'into-the-fire',
    name: map.name,
    width: map.board.width,
    height: map.board.height,
    territories: { A: side('A'), B: side('B') },
    attackerSide: map.deploymentRules?.attackerSide ?? 'B',
    deployGapFromEnemyTerritory: map.deploymentRules?.minDistanceFromEnemyTerritory ?? 9,
    objectives: map.objectives.map((o) => ({
      id: o.id,
      kind: o.kind ?? 'objective',
      x: o.x,
      y: o.y,
      radius: objectiveRadius(o),
    })),
    terrain: (terrainJson.features as TerrainJson[]).map((f) => {
      const kind = f.kind as TerrainKind;
      return {
        id: f.id,
        name: f.name,
        kind,
        polygon: rotatedRect(f),
        centre: [f.x, f.y] as const,
        traits: TRAITS[kind],
      };
    }),
  };
}

/** GHB 2026-27 battleplan "Into the Fire" with an authored terrain layout. */
export const INTO_THE_FIRE: Battlefield = build();
