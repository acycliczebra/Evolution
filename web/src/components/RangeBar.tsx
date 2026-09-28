import type { Brief } from "../types";
import { warp } from "../time";
import { useApp } from "../context";

const AXIS: [number, string][] = [[4567, "4.57 Ga"], [2500, "2.5 Ga"], [538.8, "539 Ma"], [251.9, "252 Ma"], [66, "66 Ma"], [0, "now"]];

/** Strip of geologic units with the taxon's range highlighted, on the warped scale. */
export function RangeBar({ n, big = false, T }: { n: Brief; big?: boolean; T: number | null }) {
  const { scale } = useApp();
  const bands = scale.units.filter(u =>
    big
      ? u.level === "period" || (u.level === "era" && u.start > 538.8) || u.name === "Hadean"
      : u.level === "era" || u.name === "Hadean",
  );
  const pct = (t: number) => warp(t) * 100;
  return (
    <div className={`rbar ${big ? "big" : ""}`}>
      {bands.map(u => (
        <i key={u.name} title={u.name} style={{ left: `${pct(u.start)}%`, width: `${pct(u.end) - pct(u.start)}%`, background: u.color }} />
      ))}
      {n.a != null && (
        <b style={{ left: `${pct(n.a)}%`, width: `${Math.max(pct(n.b ?? 0), pct(n.a) + 0.6) - pct(n.a)}%` }} />
      )}
      {T != null && <u style={{ left: `${pct(T)}%` }} />}
    </div>
  );
}

export function RangeAxis() {
  return (
    <div className="rbar-axis">
      {AXIS.map(([t, l]) => <span key={l} style={{ left: `${warp(t) * 100}%` }}>{l}</span>)}
    </div>
  );
}
