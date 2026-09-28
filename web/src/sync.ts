/**
 * Keeping the open taxon and the selected geologic time consistent.
 *
 * A taxon "fits" the selected time when its temporal range overlaps the selected unit
 * (or the cursor instant when no unit is selected). Undated taxa never force a change.
 */
import type { Brief, Taxon, Unit } from "./types";

/** The selected span of time, oldest first: [start Ma, end Ma]. */
export interface TimeWindow {
  start: number;
  end: number;
  /** The selected unit (English name), or undefined when it is just an instant. */
  unit?: string;
}

export type Relation = "alive" | "extinct" | "future" | "unknown";

const EPS = 1e-6;

export function timeWindow(unit: Unit | undefined, T: number | null): TimeWindow | null {
  if (unit) return { start: unit.start, end: unit.end, unit: unit.name };
  if (T != null) return { start: T, end: T };
  return null;
}

/** How a taxon relates to the window: alive during it, extinct before it, or not yet evolved. */
export function relation(n: Pick<Brief, "a" | "b" | "i">, w: TimeWindow | null): Relation {
  if (!w || n.a == null || n.i === 0) return "unknown";
  const end = n.b ?? 0;
  if (w.start - w.end > EPS) {
    // a span: the ranges must genuinely overlap, touching at a boundary is not enough
    // (T. rex, 69–66 Ma, is extinct by the Paleogene, which begins at 66 Ma)
    if (end >= w.start - EPS) return "extinct";
    if (n.a <= w.end + EPS) return "future";
    return "alive";
  }
  // an instant
  if (end > w.start + EPS) return "extinct";
  if (n.a < w.end - EPS) return "future";
  return "alive";
}

/** Deepest taxon in the lineage (root first, target last) that fits the window; the root always does. */
export function nearestFitting(lineage: Taxon[], w: TimeWindow): Taxon {
  for (let i = lineage.length - 1; i > 0; i--) {
    if (relation(lineage[i], w) === "alive") return lineage[i];
  }
  return lineage[0];
}
