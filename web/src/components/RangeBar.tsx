import type { Brief } from "../types";
import { warp } from "../time";
import { useApp } from "../context";
import { useI18n } from "../i18n";

const AXIS = [4567, 2500, 538.8, 251.9, 66, 0];
const CROWDED = [2500, 251.9];

/** Strip of geologic units with the taxon's range highlighted, on the warped scale. */
export function RangeBar({ n, big = false, T }: { n: Brief; big?: boolean; T: number | null }) {
  const { scale } = useApp();
  const { unitName } = useI18n();
  const bands = scale.units.filter(u =>
    big
      ? u.level === "period" || (u.level === "era" && u.start > 538.8) || u.name === "Hadean"
      : u.level === "era" || u.name === "Hadean",
  );
  const pct = (t: number) => warp(t) * 100;
  return (
    <div className={`rbar ${big ? "big" : ""}`}>
      {bands.map(u => (
        <i key={u.name} title={unitName(u.name)} style={{ left: `${pct(u.start)}%`, width: `${pct(u.end) - pct(u.start)}%`, background: u.color }} />
      ))}
      {n.a != null && (
        <b style={{ left: `${pct(n.a)}%`, width: `${Math.max(pct(n.b ?? 0), pct(n.a) + 0.6) - pct(n.a)}%` }} />
      )}
      {T != null && <u style={{ left: `${pct(T)}%` }} />}
    </div>
  );
}

export function RangeAxis() {
  const { fmtShort, t } = useI18n();
  const label = (x: number) => (x === 0 ? t("time.now") : fmtShort(x >= 1000 ? x : Math.round(x)));
  // units spelled out ("млрд лет") don't fit between the first ticks: keep the well-spaced ones
  const long = label(2500).length > 7;
  return (
    <div className="rbar-axis">
      {AXIS.filter(x => !(long && CROWDED.includes(x))).map(x => <span key={x} style={{ left: `${warp(x) * 100}%` }}>{label(x)}</span>)}
    </div>
  );
}
