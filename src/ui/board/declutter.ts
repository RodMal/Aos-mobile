/** Label decluttering: keep the most important labels that do not overlap. Pure. */

export interface LabelBox {
  key: string;
  /** Centre of the box in screen pixels. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Higher wins. */
  priority: number;
}

function overlaps(a: LabelBox, b: LabelBox, gap: number): boolean {
  return (
    Math.abs(a.x - b.x) * 2 < a.w + b.w + gap * 2 && Math.abs(a.y - b.y) * 2 < a.h + b.h + gap * 2
  );
}

/** Keys of the labels to show, chosen greedily by priority. */
export function declutter(boxes: readonly LabelBox[], gap = 2): Set<string> {
  const shown: LabelBox[] = [];
  const sorted = [...boxes].sort((a, b) => b.priority - a.priority);
  for (const box of sorted) if (!shown.some((s) => overlaps(s, box, gap))) shown.push(box);
  return new Set(shown.map((b) => b.key));
}

/** Rough width of a label in pixels at the given font size. */
export function estimateTextWidth(text: string, fontPx: number): number {
  return text.length * fontPx * 0.56;
}

/** The zoom rounded down to a 1.25x step, so labels re-flow only now and then. */
export function zoomBucket(scale: number): number {
  const step = Math.log(1.25);
  return Math.exp(Math.floor(Math.log(scale) / step) * step);
}
