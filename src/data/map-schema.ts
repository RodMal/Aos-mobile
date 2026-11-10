import { z } from 'zod';
import {
  pointInPolygon,
  polygonProblems,
  polygonsOverlap,
  shapeInsideShape,
  shapeToPolygon,
  type MapShape,
  type ReadonlyPoint,
} from '../geom/polygon.js';

/**
 * BattleMap schema (ADR 0011). Units are inches on a 60" x 44" board; origin (0,0) is the
 * top-left corner of the printed map, x grows right and y grows down. The zod schema is the
 * source of truth (ADR 0008); `schema/battle-map.schema.json` is generated from it.
 */

export const MAP_SCHEMA_VERSION = '1.0.0';
export const MAP_SCHEMA_MAJOR = 1;
const SUPPORTED_SCHEMA_VERSION = new RegExp(`^${MAP_SCHEMA_MAJOR}\\.\\d+\\.\\d+$`);
export const BOARD_WIDTH = 60;
export const BOARD_HEIGHT = 44;
/**
 * Control range measured from the objective's centre (ADR 0021 §2): the core 3" range is
 * measured to the edge of a 40mm marker, so 3 + 20mm (0.787") = 3.79".
 */
export const DEFAULT_OBJECTIVE_RADIUS = 3.79;

const coord = z.number().finite();
const inches = z.number().finite().positive();
const slug = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be a lowercase slug like "long-edge-clash"');

export const PointSchema = z.tuple([coord, coord]);

export const PolygonShapeSchema = z.strictObject({
  type: z.literal('polygon'),
  /** Simple polygon, closed implicitly, either winding. */
  points: z.array(PointSchema).min(3),
});

/** Axis-aligned rectangle: top-left corner plus size. */
export const RectShapeSchema = z.strictObject({
  type: z.literal('rect'),
  x: coord,
  y: coord,
  w: inches,
  h: inches,
});

export const CircleShapeSchema = z.strictObject({
  type: z.literal('circle'),
  cx: coord,
  cy: coord,
  r: inches,
});

export const ShapeSchema = z.discriminatedUnion('type', [
  PolygonShapeSchema,
  RectShapeSchema,
  CircleShapeSchema,
]);

export const SideSchema = z.enum(['A', 'B']);

export const AreaSchema = z.strictObject({ side: SideSchema, shape: ShapeSchema });

export const ObjectiveSchema = z.strictObject({
  id: slug,
  x: coord,
  y: coord,
  /**
   * Free label used for display only (ADR 0021 §3): the realm objective type
   * ("sun-seekers", "golden-lions", "heldenhain", "scions-of-the-comet") or e.g. "primary".
   */
  kind: z.string().min(1).optional(),
  /** Control range in inches from the centre; default {@link DEFAULT_OBJECTIVE_RADIUS}. */
  radius: inches.optional(),
});

export const TerrainSchema = z.strictObject({
  id: slug,
  kind: z.string().min(1),
  shape: ShapeSchema,
  /** True when models cannot be set up on or in it. */
  blocksPlacement: z.boolean(),
});

export const FirstToDeploySchema = z.enum([
  'rollOff',
  'winnerChooses',
  'attacker',
  'defender',
  'A',
  'B',
]);

export const ReservesSchema = z.strictObject({
  allowed: z.boolean(),
  maxUnits: z.number().int().nonnegative().optional(),
  maxPoints: z.number().int().nonnegative().optional(),
  notes: z.string().optional(),
});

export const DeploymentRulesSchema = z.strictObject({
  /**
   * Default and label only (ADR 0021 §1): the territory the source map marks as the
   * attacker's. The attacker chooses its territory at set-up; the engine never treats this as
   * binding.
   */
  attackerSide: SideSchema.optional(),
  firstToDeploy: FirstToDeploySchema,
  alternation: z.enum(['unit', 'regiment']),
  /** Units must be set up MORE than this many inches from enemy territory. */
  minDistanceFromEnemyTerritory: z.number().finite().nonnegative(),
  /** Units must be set up wholly within their territory / zone. */
  whollyWithin: z.boolean().default(true),
  /** When one side has set up everything, the other sets up all its remaining units. */
  remainingDeployAtOnce: z.boolean(),
  reserves: ReservesSchema.optional(),
  /** Free-text notes for rules the MVP does not model. */
  special: z.array(z.string().min(1)).optional(),
});

export const BattleMapBaseSchema = z.strictObject({
  schemaVersion: z
    .string()
    .regex(
      SUPPORTED_SCHEMA_VERSION,
      `must be a ${MAP_SCHEMA_MAJOR}.x.y semver string (supported major: ${MAP_SCHEMA_MAJOR})`,
    ),
  id: slug,
  name: z.string().min(1),
  /** True for made-up maps used until the real GHB data arrives. */
  placeholder: z.boolean().optional(),
  source: z.strictObject({
    book: z.string().min(1),
    battleplan: z.string().min(1),
    page: z.number().int().nonnegative().optional(),
    /** Where the geometry was transcribed from (additive in 1.0.0, like ADR 0018 §2). */
    url: z.url().optional(),
  }),
  board: z.strictObject({ width: z.literal(BOARD_WIDTH), height: z.literal(BOARD_HEIGHT) }),
  territories: z.array(AreaSchema).min(2),
  /** Absent means each side's zone is its territory. */
  deploymentZones: z.array(AreaSchema).min(1).optional(),
  objectives: z.array(ObjectiveSchema),
  /** Only terrain fixed by the battleplan. */
  terrain: z.array(TerrainSchema).optional(),
  deploymentRules: DeploymentRulesSchema,
  /**
   * Provenance (ADR 0021 §3): which values were measured from the source image (and how
   * accurately) versus stated by the source, values worth re-checking, and what was left out.
   */
  notes: z.string().optional(),
});

type Path = (string | number)[];
type Issue = { path: Path; message: string };

const fmt = (n: number): string => String(Math.round(n * 1000) / 1000);

function shapeIssues(shape: MapShape, path: Path, width: number, height: number): Issue[] {
  const issues: Issue[] = [];
  const inBoard = (x: number, y: number): boolean => x >= 0 && x <= width && y >= 0 && y <= height;
  const where = `the ${width}x${height} board`;
  switch (shape.type) {
    case 'polygon':
      shape.points.forEach((p, i) => {
        if (!inBoard(p[0], p[1]))
          issues.push({
            path: [...path, 'points', i],
            message: `point (${fmt(p[0])}, ${fmt(p[1])}) is outside ${where}`,
          });
      });
      for (const problem of polygonProblems(shape.points))
        issues.push({ path: [...path, 'points'], message: `polygon ${problem}` });
      break;
    case 'rect':
      if (!inBoard(shape.x, shape.y) || !inBoard(shape.x + shape.w, shape.y + shape.h))
        issues.push({
          path,
          message: `rect (${fmt(shape.x)}, ${fmt(shape.y)}) ${fmt(shape.w)}x${fmt(shape.h)} is not inside ${where}`,
        });
      break;
    case 'circle':
      if (
        !inBoard(shape.cx - shape.r, shape.cy - shape.r) ||
        !inBoard(shape.cx + shape.r, shape.cy + shape.r)
      )
        issues.push({
          path,
          message: `circle at (${fmt(shape.cx)}, ${fmt(shape.cy)}) r=${fmt(shape.r)} is not inside ${where}`,
        });
      break;
  }
  return issues;
}

function duplicateIds(items: readonly { id: string }[], key: string): Issue[] {
  const seen = new Set<string>();
  const issues: Issue[] = [];
  items.forEach((item, i) => {
    if (seen.has(item.id))
      issues.push({ path: [key, i, 'id'], message: `duplicate id "${item.id}"` });
    seen.add(item.id);
  });
  return issues;
}

type BaseMap = z.output<typeof BattleMapBaseSchema>;

/** Every cross-field rule of ADR 0011, as path + message pairs. */
export function battleMapIssues(map: BaseMap): Issue[] {
  const { width, height } = map.board;
  const issues: Issue[] = [];
  const shapeOk = new Map<MapShape, boolean>();
  const checkShape = (shape: MapShape, path: Path): void => {
    const found = shapeIssues(shape, path, width, height);
    shapeOk.set(shape, found.length === 0);
    issues.push(...found);
  };

  map.territories.forEach((t, i) => checkShape(t.shape, ['territories', i, 'shape']));
  map.deploymentZones?.forEach((z, i) => checkShape(z.shape, ['deploymentZones', i, 'shape']));
  map.terrain?.forEach((t, i) => checkShape(t.shape, ['terrain', i, 'shape']));

  for (const side of ['A', 'B'] as const) {
    if (!map.territories.some((t) => t.side === side))
      issues.push({ path: ['territories'], message: `side ${side} has no territory` });
    if (map.deploymentZones && !map.deploymentZones.some((z) => z.side === side))
      issues.push({
        path: ['deploymentZones'],
        message: `side ${side} has no deployment zone (omit deploymentZones to use the territories)`,
      });
  }

  // Zones must lie wholly within one of their side's territories (exact for circles).
  map.deploymentZones?.forEach((zone, i) => {
    if (!shapeOk.get(zone.shape)) return;
    const own = map.territories.filter((t) => t.side === zone.side && shapeOk.get(t.shape));
    if (own.length === 0) return;
    const inside = own.some((t) => shapeInsideShape(zone.shape, t.shape));
    if (!inside)
      issues.push({
        path: ['deploymentZones', i, 'shape'],
        message: `deployment zone is not wholly within a territory of side ${zone.side}`,
      });
  });

  // Territories of A and B must not share area (touching along an edge is fine).
  map.territories.forEach((a, i) => {
    if (a.side !== 'A' || !shapeOk.get(a.shape)) return;
    map.territories.forEach((b, j) => {
      if (b.side !== 'B' || !shapeOk.get(b.shape)) return;
      if (polygonsOverlap(shapeToPolygon(a.shape), shapeToPolygon(b.shape), 1e-6))
        issues.push({
          path: ['territories', Math.max(i, j), 'shape'],
          message: `territories ${Math.min(i, j)} and ${Math.max(i, j)} (sides A and B) overlap`,
        });
    });
  });

  map.objectives.forEach((o, i) => {
    const p: ReadonlyPoint = [o.x, o.y];
    if (
      !pointInPolygon(p, [
        [0, 0],
        [width, 0],
        [width, height],
        [0, height],
      ])
    )
      issues.push({
        path: ['objectives', i],
        message: `objective "${o.id}" at (${fmt(o.x)}, ${fmt(o.y)}) is outside the ${width}x${height} board`,
      });
  });

  issues.push(...duplicateIds(map.objectives, 'objectives'));
  if (map.terrain) issues.push(...duplicateIds(map.terrain, 'terrain'));

  return issues;
}

export const BattleMapSchema = BattleMapBaseSchema.superRefine((map, ctx) => {
  for (const issue of battleMapIssues(map))
    ctx.addIssue({ code: 'custom', path: issue.path, message: issue.message });
});

export type Shape = z.output<typeof ShapeSchema>;
export type Side = z.output<typeof SideSchema>;
export type Area = z.output<typeof AreaSchema>;
export type Objective = z.output<typeof ObjectiveSchema>;
export type Terrain = z.output<typeof TerrainSchema>;
export type FirstToDeploy = z.output<typeof FirstToDeploySchema>;
export type DeploymentRules = z.output<typeof DeploymentRulesSchema>;
/** A parsed map (defaults applied). */
export type BattleMap = z.output<typeof BattleMapSchema>;
/** A map as written in JSON (fields with defaults may be omitted). */
export type BattleMapInput = z.input<typeof BattleMapSchema>;

/** Control range of an objective in inches. */
export function objectiveRadius(objective: Objective): number {
  return objective.radius ?? DEFAULT_OBJECTIVE_RADIUS;
}

/** Deployment zones of `side`: its `deploymentZones` if the map has them, else its territories. */
export function zonesFor(map: BattleMap, side: Side): Shape[] {
  const zones = map.deploymentZones?.filter((z) => z.side === side);
  return (zones && zones.length > 0 ? zones : map.territories.filter((t) => t.side === side)).map(
    (a) => a.shape,
  );
}

/** Territories of `side`. */
export function territoriesFor(map: BattleMap, side: Side): Shape[] {
  return map.territories.filter((t) => t.side === side).map((t) => t.shape);
}

export function otherSide(side: Side): Side {
  return side === 'A' ? 'B' : 'A';
}
