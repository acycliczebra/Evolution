import type { Brief, Unit, UnitLevel } from "./types";

export const LEVELS: UnitLevel[] = ["eon", "era", "period", "epoch", "age"];
export const EARTH_AGE = 4567;

export function fmtMa(ma: number | undefined | null): string {
  if (ma == null) return "?";
  if (ma === 0) return "present";
  if (ma >= 1000) return (ma / 1000).toFixed(ma % 1000 === 0 ? 0 : 2).replace(/\.?0+$/, "") + " billion years ago";
  if (ma >= 1) return (+ma.toFixed(ma < 10 ? 2 : 1)).toLocaleString("en-US") + " million years ago";
  const ky = ma * 1000;
  if (ky >= 1) return (+ky.toFixed(ky < 10 ? 1 : 0)).toLocaleString("en-US") + " thousand years ago";
  return Math.round(ma * 1e6).toLocaleString("en-US") + " years ago";
}

export function fmtShort(ma: number | undefined | null): string {
  if (ma == null) return "?";
  if (ma === 0) return "0";
  if (ma >= 1000) return (ma / 1000).toFixed(2).replace(/\.?0+$/, "") + " Ga";
  if (ma >= 1) return +ma.toFixed(ma < 10 ? 2 : 1) + " Ma";
  if (ma >= 0.001) return +(ma * 1000).toFixed(1) + " ka";
  return Math.round(ma * 1e6) + " yr";
}

export function fmtDuration(ma: number): string {
  return fmtShort(ma).replace(" Ma", " million years").replace(" ka", " thousand years").replace(" Ga", " billion years");
}

/** Piecewise-linear warp so the Phanerozoic gets room while the whole history stays visible. */
const WARP: [number, number][] = [[EARTH_AGE, 0], [2500, 0.12], [538.8, 0.26], [251.902, 0.47], [66, 0.7], [2.58, 0.95], [0, 1]];

export function warp(t: number): number {
  t = Math.max(0, Math.min(EARTH_AGE, t));
  for (let i = 0; i < WARP.length - 1; i++) {
    const [a, wa] = WARP[i], [b, wb] = WARP[i + 1];
    if (t <= a && t >= b) return wa + ((a - t) / (a - b)) * (wb - wa);
  }
  return 1;
}

export function unwarp(w: number): number {
  w = Math.max(0, Math.min(1, w));
  for (let i = 0; i < WARP.length - 1; i++) {
    const [a, wa] = WARP[i], [b, wb] = WARP[i + 1];
    if (w >= wa && w <= wb) return a - ((w - wa) / (wb - wa)) * (a - b);
  }
  return 0;
}

export type Domain = [number, number];

/** Zoom the domain around time t by factor f (in warped space). */
export function zoomDomain([a, b]: Domain, t: number, f: number): Domain | null {
  const wa = warp(a), wb = warp(b), wt = warp(t);
  let na = wt - (wt - wa) * f, nb = wt + (wb - wt) * f;
  if (nb - na > 1) { na = 0; nb = 1; }
  if (nb - na < 0.00002) return null;
  if (na < 0) { nb -= na; na = 0; }
  if (nb > 1) { na -= nb - 1; nb = 1; }
  return [unwarp(Math.max(0, na)), unwarp(Math.min(1, nb))];
}

export function unitDomain(u: Unit): Domain {
  const pad = (warp(u.end) - warp(u.start)) * 0.35;
  return [unwarp(Math.max(0, warp(u.start) - pad)), unwarp(Math.min(1, warp(u.end) + pad))];
}

export const isAlive = (n: Brief, T: number) => n.a != null && n.a >= T && (n.b ?? 0) <= T;

export function rangeText(n: Brief): string {
  if (n.a == null) return n.x ? "Extinct (age unknown)" : "Extant";
  const b = n.b ?? 0;
  if (!n.x && b === 0) return `${fmtShort(n.a)} – present`;
  return `${fmtShort(n.a)} – ${fmtShort(b)}`;
}

export class TimeScale {
  readonly byName: Record<string, Unit>;
  constructor(readonly units: Unit[]) {
    this.byName = Object.fromEntries(units.map(u => [u.name, u]));
  }
  path(name: string): string[] {
    const out: string[] = [];
    let u: Unit | undefined = this.byName[name];
    while (u) { out.unshift(u.name); u = u.parent ? this.byName[u.parent] : undefined; }
    return out;
  }
  at(T: number, level: UnitLevel): Unit | undefined {
    return this.units.find(u => u.level === level && u.start >= T && u.end <= T && (u.end < T || T === 0));
  }
  /** The most specific unit containing T. */
  deepestAt(T: number): Unit | undefined {
    for (const lvl of [...LEVELS].reverse()) {
      const u = this.at(T, lvl);
      if (u) return u;
    }
    return undefined;
  }
  children(name: string): Unit[] {
    return this.units.filter(u => u.parent === name);
  }
  /** Map for a unit, falling back to the nearest ancestor with one, then to a child. */
  mapFor(u: Unit): Unit | undefined {
    for (let cur: Unit | undefined = u; cur; cur = cur.parent ? this.byName[cur.parent] : undefined) {
      if (cur.map) return cur;
    }
    return this.units.find(k => k.parent === u.name && k.map);
  }
  /** Curated notes may live on an ancestor. */
  notesFor(u: Unit): Unit | undefined {
    for (let cur: Unit | undefined = u; cur; cur = cur.parent ? this.byName[cur.parent] : undefined) {
      if (cur.earth) return cur;
    }
    return undefined;
  }
  /** Sequence stepped through by "Journey through time". */
  journey(): Unit[] {
    return this.units
      .filter(u => u.level === "period" || u.name === "Hadean" || (u.level === "era" && u.parent === "Archean"))
      .sort((a, b) => b.start - a.start);
  }
}
