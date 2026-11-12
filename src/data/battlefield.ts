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
}

/**
 * Features no more than 1" high, which models may be set up on (owner's assumption,
 * 2026-11-11, awaiting a ruling): ruins and outcrops. The spires are too tall.
 */
export const LOW_TERRAIN_KINDS: readonly TerrainKind[] = ['ruin', 'outcrop'];

/** True when models may be set up on this feature (it is 1" high or less). */
export function allowsSetUpOn(feature: TerrainFeature): boolean {
  return LOW_TERRAIN_KINDS.includes(feature.kind);
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
