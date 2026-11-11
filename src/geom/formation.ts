import type { ModelBase as BaseShape } from './footprint.js';
import type { ReadonlyPoint } from './polygon.js';
import { checkCoherencyFootprints } from './coherency.js';
import {
  baseFootprint,
  boundingRadius,
  halfExtents,
  localPolygon,
  moveFootprint,
  type Footprint,
  type Token,
} from './footprint.js';
import { footprintGapAtLeast, withinCoherencyRange } from './geometry.js';
import {
  COHERENCY_RANGE_IN,
  COHERENCY_TWO_NEIGHBOURS_FROM,
  BASE_POLYGON_SEGMENTS,
  COHERENCY_POLYGON_SEGMENTS_FOR_MARGIN,
  DEFAULT_FORMATION_GAP_IN,
} from './units.js';

/**
 * Formation layout (ADR 0013), pure and deterministic.
 *
 * Frame: the formation is built in a local frame facing "up" (−y): the front row is at the
 * top and later rows go back (+y). Ovals and rectangles stand with their length along the
 * facing direction, i.e. local rotation 90°. The result is rotated clockwise by
 * `rotationDeg` about the centre of its bounding box, which is placed at `centre`.
 *
 * Construction: models fill rows of `frontage` in input order (champions first, as
 * `resolveBases` returns them). Inside a row bases sit exactly `gapIn` apart, edge to edge.
 * Odd rows are staggered by half a pitch, and each row is moved forward until it is exactly
 * `gapIn` from the rows already placed (bisection), which gives hex packing for uniform
 * bases. Units of 7+ models get a frontage of at least 2 so every model can have 2
 * neighbours. The result is then checked; if mixed base sizes broke coherency, the models
 * are re-placed one by one, each at its row slot when legal or else in the nearest "notch"
 * exactly `gapIn` from one or two already placed models it needs as neighbours.
 *
 * Guarantees: the layout never self-overlaps and is always a single connected group. It
 * also meets the 2-neighbour rule for units of 7+ unless the notch search finds no spot for
 * some model and a last-resort fallback is used (a ring position, or the right-hand end);
 * the property tests have not found such an input. `gapIn` is the overlap-test gap; it is
 * capped below 1/2" by a margin that covers the difference between the outer polygons
 * (overlap tests) and the inner ones (coherency), so neighbours always count as coherent.
 *
 * `options.stagger: false` (M4-T02) asks for aligned ranks and files instead: every row
 * starts at the same x, so uniform bases form a grid and frontage 1 is a straight column.
 * The same coherency repair runs afterwards, so a model that would lack neighbours (e.g. a
 * lone model in the last rank of a 7+ unit) is still moved into a notch. The default
 * (`stagger` omitted or true) is the staggered layout above, unchanged.
 */
export function layoutFormation(
  models: readonly BaseShape[],
  frontage: number,
  centre: ReadonlyPoint,
  rotationDeg: number,
  gapIn = DEFAULT_FORMATION_GAP_IN,
  options: FormationOptions = {},
): Token[] {
  return formationTemplate(models, frontage, rotationDeg, gapIn, options).tokensAt(
    centre[0],
    centre[1],
  );
}

/** Optional layout settings; omitting a field keeps the default layout. */
export interface FormationOptions {
  /**
   * Offset alternate rows by half a pitch (hex packing). Default true. With false, rows are
   * aligned (ranks and files), apart from coherency repairs for mixed or odd-sized units.
   */
  readonly stagger?: boolean;
  /**
   * Put the first `centreChampions` models (the champions, ADR 0009 order) in the middle of
   * the front rank (M4-T23). Default 0: today's layout, bit for bit. With `k` champions and
   * effective frontage `f`, they take the front slots `floor((f - k) / 2) ..` (left of centre
   * when the gap is odd); champions that do not fit overflow into the centre of rank 2 (and
   * so on). The other models keep their input order. It is a slot order only: tokens keep
   * `modelIndex` = the input index, and coherency repairs for mixed bases may still move a
   * champion. No effect for 1 model or frontage 1. The NPC never sets it.
   */
  readonly centreChampions?: number;
}

/**
 * Slot order for `centreChampions` (M4-T23): `slots[slot]` is the input index of the model
 * standing in row-major slot `slot`, with `k = min(floor(centre), n)` champions centred in
 * the front rank (left of centre when the gap is odd) and any overflow centred in the next
 * rank. Undefined when the order is the identity (no effect), so the default key is kept.
 */
function championSlotOrder(
  n: number,
  f: number,
  centre: number,
): { slots: number[]; championCount: number } | undefined {
  const k = Math.min(Math.max(Number.isFinite(centre) ? Math.floor(centre) : 0, 0), n);
  if (k === 0 || n <= 1 || f <= 1) return undefined;
  const slots: number[] = [];
  let nextChampion = 0;
  let nextOther = k;
  for (let rowStart = 0; rowStart < n; rowStart += f) {
    const len = Math.min(f, n - rowStart);
    const here = Math.min(k - nextChampion, len);
    const s = Math.floor((len - here) / 2);
    for (let slot = 0; slot < len; slot++) {
      slots.push(slot >= s && slot < s + here ? nextChampion++ : nextOther++);
    }
  }
  return slots.every((idx, slot) => idx === slot) ? undefined : { slots, championCount: k };
}

/** `localLayout` on the bases in slot order, indexed by input model again. */
function centredLayout(
  proto: readonly Footprint[],
  slots: readonly number[],
  frontage: number,
  gap: number,
  stagger: boolean,
): Footprint[] {
  const slotted = localLayout(
    slots.map((idx) => proto[idx] as Footprint),
    frontage,
    gap,
    stagger,
  );
  const byModel = new Array<Footprint>(proto.length);
  slots.forEach((idx, slot) => {
    byModel[idx] = slotted[slot] as Footprint;
  });
  return byModel;
}

/**
 * A formation with fixed bases, frontage and rotation, ready to be moved: the rigid
 * transform's per-model terms are precomputed, so `tokensAt(x, y)` returns exactly (bit for
 * bit) what `layoutFormation(models, frontage, [x, y], rotationDeg, gapIn, options)` returns,
 * and `xAt`/`yAt` give one model's centre without building any token (cheap candidate
 * rejection in NPC search loops). `options` is the same `FormationOptions` as for
 * `layoutFormation`: `stagger` (default true) picks staggered rows or aligned ranks, and the
 * two layouts are cached under separate keys; `centreChampions` (default 0) adds `|c<k>` to
 * the key when it changes the slot order.
 */
export interface FormationTemplate {
  readonly size: number;
  xAt(i: number, x: number): number;
  yAt(i: number, y: number): number;
  tokensAt(x: number, y: number): Token[];
}

export function formationTemplate(
  models: readonly BaseShape[],
  frontage: number,
  rotationDeg: number,
  gapIn = DEFAULT_FORMATION_GAP_IN,
  options: FormationOptions = {},
): FormationTemplate {
  if (!(gapIn > 0 && gapIn <= COHERENCY_RANGE_IN)) {
    throw new RangeError(`gapIn must be in (0, ${COHERENCY_RANGE_IN}], got ${gapIn}`);
  }
  const n = models.length;
  if (n === 0) return { size: 0, xAt: (_i, x) => x, yAt: (_i, y) => y, tokensAt: () => [] };
  const localRot = models.map((b) => (b.kind === 'oval' || b.kind === 'rect' ? 90 : 0));
  const proto = models.map((b, i) => baseFootprint(b, 0, 0, localRot[i]));
  const gap = effectiveGap(proto, gapIn);
  const stagger = options.stagger ?? true;
  const f = effectiveFrontage(n, frontage);
  const order = championSlotOrder(n, f, options.centreChampions ?? 0);

  // The default (staggered, no centred champion) key is the one used before `options`
  // existed; `|c<k>` is added only when centring changes the slot order.
  const key =
    `${JSON.stringify(models)}|${f}|${gap}${stagger ? '' : '|aligned'}` +
    (order ? `|c${order.championCount}` : '');
  let local = layoutCache.get(key);
  if (local) {
    layoutCache.delete(key); // refresh LRU position
  } else {
    local = order
      ? centredLayout(proto, order.slots, frontage, gap, stagger)
      : localLayout(proto, frontage, gap, stagger);
    if (layoutCache.size >= LAYOUT_CACHE_SIZE) {
      const oldest = layoutCache.keys().next().value;
      if (oldest !== undefined) layoutCache.delete(oldest);
    }
  }
  layoutCache.set(key, local);

  // Bounding-box centre of the local layout.
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const fp of local) {
    const { hx, hy } = halfExtents(fp);
    minX = Math.min(minX, fp.cx - hx);
    maxX = Math.max(maxX, fp.cx + hx);
    minY = Math.min(minY, fp.cy - hy);
    maxY = Math.max(maxY, fp.cy + hy);
  }
  const mx = (minX + maxX) / 2;
  const my = (minY + maxY) / 2;
  const t = (rotationDeg * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  // x = centre.x + dx*c - dy*s and y = centre.y + dx*s + dy*c, evaluated left to right as
  // before: only the products (independent of the centre) are precomputed.
  const xc: number[] = [];
  const xs: number[] = [];
  const ys: number[] = [];
  const yc: number[] = [];
  const rot: number[] = [];
  local.forEach((fp, i) => {
    const dx = fp.cx - mx;
    const dy = fp.cy - my;
    xc.push(dx * c);
    xs.push(dy * s);
    ys.push(dx * s);
    yc.push(dy * c);
    rot.push(normaliseDeg(rotationDeg + (localRot[i] as number)));
  });
  const xAt = (i: number, x: number): number => x + (xc[i] as number) - (xs[i] as number);
  const yAt = (i: number, y: number): number => y + (ys[i] as number) + (yc[i] as number);
  return {
    size: n,
    xAt,
    yAt,
    tokensAt: (x, y) =>
      models.map((base, i) => ({
        modelIndex: i,
        base,
        x: xAt(i, x),
        y: yAt(i, y),
        rotation: rot[i] as number,
      })),
  };
}

/**
 * The local layout depends only on the bases, frontage and gap; centre and rotation are a
 * rigid transform. Caching it keeps drag previews cheap. Entries are never mutated.
 */
const LAYOUT_CACHE_SIZE = 64;
/** Numerical margin kept between the layout gap and the coherency range. */
const GAP_MARGIN_IN = 0.01;
const layoutCache = new Map<string, readonly Footprint[]>();

/** Empty the layout cache (tests, or to free memory). */
export function clearFormationCache(): void {
  layoutCache.clear();
}

/**
 * Precompute (and cache) the layouts of `models` for each frontage, e.g. when the user
 * selects a unit, so that picking it up or changing frontage is instant.
 */
export function warmFormation(
  models: readonly BaseShape[],
  frontages: readonly number[],
  gapIn = DEFAULT_FORMATION_GAP_IN,
  options: FormationOptions = {},
): void {
  for (const f of frontages) layoutFormation(models, f, [0, 0], 0, gapIn, options);
}

/**
 * Gap actually used: `gapIn`, capped so that bases placed `gap` apart on their outer
 * polygons are still within 1/2" when measured on their inner polygons (coherency).
 */
function effectiveGap(proto: readonly Footprint[], gapIn: number): number {
  let excess = 0;
  for (const fp of proto) {
    if (fp.kind !== 'ellipse') continue; // circles are exact; rect polygons are exact
    const outer = 1 / Math.cos(Math.PI / BASE_POLYGON_SEGMENTS);
    const inner = Math.cos(Math.PI / COHERENCY_POLYGON_SEGMENTS_FOR_MARGIN);
    excess = Math.max(excess, Math.max(fp.rx, fp.ry) * (outer - inner));
  }
  return Math.min(gapIn, COHERENCY_RANGE_IN - 2 * excess - GAP_MARGIN_IN);
}

function localLayout(
  proto: readonly Footprint[],
  frontage: number,
  gapIn: number,
  staggered: boolean,
): Footprint[] {
  // Half-pitch stagger (hex packing) first; other staggers rescue some mixed-base units.
  // Aligned ranks try only the unstaggered rows, then the same repair and greedy fallback.
  let local: Footprint[] | undefined;
  let first: Footprint[] | undefined;
  for (const stagger of staggered ? [1, -1, 0] : [0]) {
    const candidate = rowLayout(proto, frontage, gapIn, stagger);
    first ??= candidate;
    if (isGood(candidate, gapIn)) {
      local = candidate;
      break;
    }
  }
  return (
    local ??
    repairLayout(first as Footprint[], gapIn) ??
    greedyLayout(proto, first as Footprint[], gapIn)
  );
}

/** Half extents of the footprint's outer polygon (what the overlap tests use). */
function outerHalfExtents(fp: Footprint): { hx: number; hy: number } {
  if (fp.kind === 'circle') return { hx: fp.r, hy: fp.r }; // circles are tested exactly
  let hx = 0;
  let hy = 0;
  for (const [x, y] of localPolygon(fp)) {
    hx = Math.max(hx, Math.abs(x));
    hy = Math.max(hy, Math.abs(y));
  }
  return { hx, hy };
}

/** Degrees in [0, 360). */
export function normaliseDeg(deg: number): number {
  const d = deg % 360;
  return d < 0 ? d + 360 : d === 0 ? 0 : d;
}

/** Frontage actually used: an integer in [1, n], at least 2 for units of 7+ models. */
export function effectiveFrontage(n: number, frontage: number): number {
  let f = Number.isFinite(frontage) ? Math.round(frontage) : 1;
  f = Math.min(Math.max(f, 1), Math.max(n, 1));
  if (n >= COHERENCY_TWO_NEIGHBOURS_FROM) f = Math.max(f, 2);
  return f;
}

function isGood(fps: readonly Footprint[], gap: number): boolean {
  for (let i = 0; i < fps.length; i++) {
    for (let j = i + 1; j < fps.length; j++) {
      const a = fps[i] as Footprint;
      const b = fps[j] as Footprint;
      if (!footprintGapAtLeast(a, b, gap * 0.5)) return false;
    }
  }
  return checkCoherencyFootprints(fps).coherent;
}

/**
 * Rows, each pushed forward until it is exactly `gap` from earlier rows. Alternate rows are
 * offset by `staggerSign` half pitches: ±1 for the staggered (hex) layout, 0 for the aligned
 * ranks and files that `FormationOptions.stagger: false` asks for (see `localLayout`).
 */
function rowLayout(
  proto: readonly Footprint[],
  frontage: number,
  gap: number,
  staggerSign: number,
): Footprint[] {
  const n = proto.length;
  const f = effectiveFrontage(n, frontage);
  // Extents of the outer polygons, so that the overlap tests (which use them) see the gap.
  const ext = proto.map(outerHalfExtents);
  const hx = (i: number): number => (ext[i] as { hx: number }).hx;
  const hy = (i: number): number => (ext[i] as { hy: number }).hy;

  const rows: number[][] = [];
  for (let i = 0; i < n; i += f)
    rows.push(Array.from({ length: Math.min(f, n - i) }, (_, k) => i + k));

  const firstRow = rows[0] as number[];
  const a0 = firstRow[0] as number;
  const a1 = firstRow[1] ?? a0;
  const stagger = (staggerSign * (hx(a0) + gap + hx(a1))) / 2;

  const placed: Footprint[] = [];
  let prevRow: Footprint[] = [];
  const out = new Array<Footprint>(n);
  let prevY = 0;
  let bottom = -Infinity; // max (cy + hy) of everything placed so far
  rows.forEach((row, r) => {
    const xs: number[] = [];
    let x = r % 2 === 1 ? stagger : 0;
    row.forEach((idx, k) => {
      if (k > 0) x += hx(row[k - 1] as number) + gap + hx(idx);
      xs.push(x);
    });
    const at = (y: number): Footprint[] =>
      row.map((idx, k) => moveFootprint(proto[idx] as Footprint, xs[k] as number, y));
    let y = 0;
    if (r > 0) {
      const clearOf =
        (against: readonly Footprint[]) =>
        (yy: number): boolean =>
          at(yy).every((fp) => against.every((p) => footprintGapAtLeast(fp, p, gap)));
      // Every placed model is above prevY, so each pair's gap only grows as y grows.
      const settle = (clear: (yy: number) => boolean): number => {
        let lo = prevY;
        let hi = bottom + gap + Math.max(...row.map(hy)) + 1e-6;
        if (clear(lo)) return lo;
        for (let it = 0; it < 40 && hi - lo > 1e-9; it++) {
          const mid = (lo + hi) / 2;
          if (clear(mid)) hi = mid;
          else lo = mid;
        }
        return hi;
      };
      // Usually only the previous row matters; recheck against everything (rarely needed,
      // e.g. a row of small bases behind a row of big ones) before accepting.
      y = settle(clearOf(prevRow));
      if (!clearOf(placed)(y)) y = settle(clearOf(placed));
    }
    prevRow = at(y);
    prevRow.forEach((fp, k) => {
      out[row[k] as number] = fp;
      placed.push(fp);
      bottom = Math.max(bottom, fp.cy + hy(row[k] as number));
    });
    prevY = y;
  });
  return out;
}

/** Point at gap `gap` from `a` in direction `theta`, for footprint `m`. */
function adjacent(m: Footprint, a: Footprint, theta: number, gap: number): Footprint {
  const ux = Math.cos(theta);
  const uy = Math.sin(theta);
  const at = (t: number): Footprint => moveFootprint(m, a.cx + t * ux, a.cy + t * uy);
  let lo = 0;
  let hi = boundingRadius(a) + boundingRadius(m) + gap + 1e-6;
  // For centrally symmetric convex shapes the gap grows monotonically along the ray.
  for (let it = 0; it < 24 && hi - lo > 1e-7; it++) {
    const mid = (lo + hi) / 2;
    if (footprintGapAtLeast(at(mid), a, gap)) hi = mid;
    else lo = mid;
  }
  return at(hi);
}

/** Positions `gap` from both `a` and `b` (one per side of the line a→b), when they exist. */
function notches(m: Footprint, a: Footprint, b: Footprint, gap: number): Footprint[] {
  const base = Math.atan2(b.cy - a.cy, b.cx - a.cx);
  const clear = (theta: number): boolean => footprintGapAtLeast(adjacent(m, a, theta, gap), b, gap);
  if (clear(base)) return [adjacent(m, a, base, gap)];
  const out: Footprint[] = [];
  for (const side of [1, -1]) {
    let lo = base;
    let hi = base + side * Math.PI;
    if (!clear(hi)) continue;
    for (let it = 0; it < 22 && Math.abs(hi - lo) > 1e-6; it++) {
      const mid = (lo + hi) / 2;
      if (clear(mid)) hi = mid;
      else lo = mid;
    }
    out.push(adjacent(m, a, hi, gap));
  }
  return out;
}

/** Place models one by one: row slot if legal, else the nearest notch next to placed models. */
function greedyLayout(
  proto: readonly Footprint[],
  slots: readonly Footprint[],
  gap: number,
): Footprint[] {
  const n = proto.length;
  const need = n >= COHERENCY_TWO_NEIGHBOURS_FROM ? 2 : 1;
  const placed: Footprint[] = [];
  const tol = 1e-6;

  const neighbours = (c: Footprint): number | undefined => {
    let count = 0;
    for (const p of placed) {
      if (!footprintGapAtLeast(c, p, gap - tol)) return undefined;
      if (withinCoherencyRange(c, p, COHERENCY_RANGE_IN)) count++;
    }
    return count;
  };

  for (let i = 0; i < n; i++) {
    const slot = slots[i] as Footprint;
    const needNow = Math.min(need, i);
    const ok = (c: Footprint, k: number): boolean => (neighbours(c) ?? -1) >= k;
    if (ok(slot, needNow)) {
      placed.push(slot);
      continue;
    }
    const m = proto[i] as Footprint;
    const dist2 = (c: Footprint): number => (c.cx - slot.cx) ** 2 + (c.cy - slot.cy) ** 2;
    const pick = (cands: Footprint[], k: number): Footprint | undefined => {
      let best: Footprint | undefined;
      for (const c of cands) if (ok(c, k) && (!best || dist2(c) < dist2(best))) best = c;
      return best;
    };

    const near = (p: Footprint): boolean =>
      Math.hypot(p.cx - slot.cx, p.cy - slot.cy) <=
      2 * boundingRadius(p) + 2 * boundingRadius(m) + 3 * COHERENCY_RANGE_IN;
    // Notches between pairs of mutual neighbours, nearest pair to the slot first; stop after
    // two pairs gave a legal spot.
    const pairs: [Footprint, Footprint, number][] = [];
    for (let a = 0; a < placed.length; a++) {
      const pa = placed[a] as Footprint;
      for (let b = a + 1; b < placed.length; b++) {
        const pb = placed[b] as Footprint;
        if (!near(pa) && !near(pb)) continue;
        if (!withinCoherencyRange(pa, pb, COHERENCY_RANGE_IN)) continue;
        pairs.push([
          pa,
          pb,
          (pa.cx + pb.cx - 2 * slot.cx) ** 2 + (pa.cy + pb.cy - 2 * slot.cy) ** 2,
        ]);
      }
    }
    pairs.sort((x, y) => x[2] - y[2]);
    const cands: Footprint[] = [];
    let found = 0;
    for (const [pa, pb] of pairs) {
      const ns = notches(m, pa, pb, gap).filter((c) => ok(c, needNow));
      cands.push(...ns);
      if (ns.length > 0 && ++found >= 2) break;
    }
    // Otherwise notches next to the last placed model, which has free space on its outer side.
    if (cands.length === 0 && placed.length >= 2) {
      const pa = placed[placed.length - 1] as Footprint;
      for (let b = placed.length - 2; b >= 0 && cands.length === 0; b--) {
        const pb = placed[b] as Footprint;
        if (withinCoherencyRange(pa, pb, COHERENCY_RANGE_IN)) {
          cands.push(...notches(m, pa, pb, gap).filter((c) => ok(c, needNow)));
        }
      }
    }
    let choice = pick(cands, needNow);
    if (!choice) {
      // Single-neighbour positions around every placed model.
      const ring: Footprint[] = [];
      for (const p of placed) {
        for (let k = 0; k < 24; k++) ring.push(adjacent(m, p, (k * Math.PI) / 12, gap));
      }
      choice = pick(ring, needNow) ?? pick(ring, Math.min(1, needNow));
    }
    if (!choice) {
      // Always legal: right of the right-most edge, touching that model at `gap`.
      let right = placed[0] as Footprint;
      for (const p of placed)
        if (p.cx + halfExtents(p).hx > right.cx + halfExtents(right).hx) right = p;
      choice = adjacent(m, right, 0, gap);
    }
    placed.push(choice);
  }
  return placed;
}

/**
 * Move each model that lacks coherency neighbours into the nearest notch between two
 * mutual neighbours where it overlaps nothing and has enough neighbours. Returns undefined
 * when that does not produce a coherent layout within a few passes.
 */
function repairLayout(start: readonly Footprint[], gap: number): Footprint[] | undefined {
  const fps = [...start];
  const n = fps.length;
  const need = n >= COHERENCY_TWO_NEIGHBOURS_FROM ? 2 : 1;
  const tol = 1e-6;
  const maxPasses = 2 * checkCoherencyFootprints(fps).lacking.length + 2;
  for (let pass = 0; pass < maxPasses; pass++) {
    const result = checkCoherencyFootprints(fps);
    if (result.coherent) return isGood(fps, gap) ? fps : undefined;
    const i = result.lacking[0];
    if (i === undefined) return undefined; // split into groups: leave it to the greedy layout
    const m = fps[i] as Footprint;
    const others = fps.filter((_, k) => k !== i);
    const legal = (c: Footprint): boolean => {
      let count = 0;
      for (const p of others) {
        if (!footprintGapAtLeast(c, p, gap - tol)) return false;
        if (withinCoherencyRange(c, p, COHERENCY_RANGE_IN)) count++;
      }
      return count >= need;
    };
    const pairs: [Footprint, Footprint, number][] = [];
    for (let a = 0; a < others.length; a++) {
      const pa = others[a] as Footprint;
      for (let b = a + 1; b < others.length; b++) {
        const pb = others[b] as Footprint;
        if (!withinCoherencyRange(pa, pb, COHERENCY_RANGE_IN)) continue;
        pairs.push([pa, pb, (pa.cx + pb.cx - 2 * m.cx) ** 2 + (pa.cy + pb.cy - 2 * m.cy) ** 2]);
      }
    }
    pairs.sort((x, y) => x[2] - y[2]);
    let best: Footprint | undefined;
    const d2 = (c: Footprint): number => (c.cx - m.cx) ** 2 + (c.cy - m.cy) ** 2;
    for (const [pa, pb] of pairs.slice(0, 6)) {
      for (const c of notches(m, pa, pb, gap))
        if (legal(c) && (!best || d2(c) < d2(best))) best = c;
    }
    if (!best) return undefined;
    fps[i] = best;
  }
  return isGood(fps, gap) ? fps : undefined;
}
