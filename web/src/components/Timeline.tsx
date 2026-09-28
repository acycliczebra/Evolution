import { useEffect, useMemo, useRef, useState } from "react";
import type { Milestone } from "../types";
import { LEVELS, unwarp, warp, zoomDomain, type Domain } from "../time";
import { useApp } from "../context";
import { useI18n } from "../i18n";

const ROW_H = 24;
const PIN_H = 34;
const CHAR_W = 6.6;

interface Props {
  milestones: Milestone[];
  domain: Domain;
  setDomain: (d: Domain) => void;
  unit: string | null;
  T: number | null;
  msTitle: string | null;
  /** Called while the time cursor is dragged. */
  onScrub: (T: number) => void;
  /** A band was clicked. */
  onPickUnit: (name: string) => void;
}

interface Tip { x: number; y: number; html: React.ReactNode }

/** Approximate label width: CJK and Hangul glyphs are about twice as wide as Latin ones. */
const charW = (ch: string) => (ch.codePointAt(0)! >= 0x2e80 ? CHAR_W * 1.8 : CHAR_W);
const textW = (s: string) => [...s].reduce((w, ch) => w + charW(ch), 0);

function abbrev(s: string, maxW: number) {
  const chars = [...s];
  let w = 0, n = 0;
  while (n < chars.length && w + charW(chars[n]) <= maxW - CHAR_W) w += charW(chars[n++]);
  if (n >= chars.length) return s;
  return chars.slice(0, Math.max(1, n)).join("") + ".";
}

export function Timeline({ milestones, domain, setDomain, unit, T, msTitle, onScrub, onPickUnit }: Props) {
  const { scale, selectMilestone } = useApp();
  const { t, fmtShort, fmtMa, unitName, milestone: localMs } = useI18n();
  const wrap = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const [W, setW] = useState(1000);
  const [tip, setTip] = useState<Tip | null>(null);
  const drag = useRef<{ mode: "pan" | "scrub"; x: number; d: Domain; moved: boolean } | null>(null);
  const domainRef = useRef(domain);
  domainRef.current = domain;

  useEffect(() => {
    const el = wrap.current!;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const [a, b] = domain;
  const wa = warp(a), wb = warp(b);
  const tx = (t: number) => ((warp(t) - wa) / (wb - wa)) * W;

  // wheel zoom needs a non-passive listener to prevent page scroll
  useEffect(() => {
    const el = svg.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const [da, db] = domainRef.current;
      const x = e.clientX - el.getBoundingClientRect().left;
      const t = unwarp(warp(da) + (x / el.clientWidth) * (warp(db) - warp(da)));
      const nd = zoomDomain(domainRef.current, t, e.deltaY > 0 ? 1.25 : 0.8);
      if (nd) setDomain(nd);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [setDomain]);

  useEffect(() => {
    // cleared after the click event so band/pin clicks can tell a drag from a click
    const up = () => { setTimeout(() => { drag.current = null; }, 0); };
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, []);

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    const scrub = (e.target as Element).closest(".cursor-handle") != null;
    drag.current = { mode: scrub ? "scrub" : "pan", x: e.clientX, d: [...domain] as Domain, moved: false };
    if (scrub) {
      e.currentTarget.setPointerCapture(e.pointerId);
      e.preventDefault();
    }
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d) return;
    if (d.mode === "scrub") {
      d.moved = true;
      const x = Math.max(0, Math.min(W, e.clientX - e.currentTarget.getBoundingClientRect().left));
      onScrub(unwarp(wa + (x / W) * (wb - wa)));
      return;
    }
    const dx = e.clientX - d.x;
    if (Math.abs(dx) < 4 && !d.moved) return;
    // capture only once a drag starts, so plain clicks still reach the bands and pins
    if (!d.moved) e.currentTarget.setPointerCapture(e.pointerId);
    d.moved = true;
    const [a0, b0] = d.d, w0 = warp(a0), w1 = warp(b0);
    const dw = (-dx / W) * (w1 - w0);
    let na = w0 + dw, nb = w1 + dw;
    if (na < 0) { nb -= na; na = 0; }
    if (nb > 1) { na -= nb - 1; nb = 1; }
    setDomain([unwarp(na), unwarp(nb)]);
  };
  const wasDrag = () => drag.current?.moved === true;

  const path = useMemo(() => new Set(unit ? scale.path(unit) : []), [unit, scale]);
  const showTip = (e: React.MouseEvent, html: React.ReactNode) => setTip({ x: e.clientX, y: e.clientY, html });

  const ticks = useMemo(() => {
    const out: number[] = [];
    const N = Math.max(4, Math.floor(W / 110));
    for (let i = 0; i <= N; i++) {
      let t = unwarp(wa + ((wb - wa) * i) / N);
      const mag = Math.pow(10, Math.floor(Math.log10(Math.max(t, 1e-6))));
      const step = t / mag >= 5 ? mag : t / mag >= 2 ? mag / 2 : mag / 5;
      t = Math.round(t / step) * step;
      out.push(+t.toPrecision(3));
    }
    return [...new Set(out)];
  }, [W, wa, wb]);

  // milestone pins, staggered into lanes when crowded
  let lastX = -99, lane = 0;
  const pins = milestones
    .filter(m => m.ma <= a && m.ma >= b)
    .sort((p, q) => q.ma - p.ma)
    .map(m => {
      const x = tx(m.ma);
      lane = x - lastX < 12 ? (lane + 1) % 3 : 0;
      lastX = x;
      return { m, x, y: 8 + lane * 9 };
    });

  const H = PIN_H + ROW_H * LEVELS.length + 22;
  const axisY = PIN_H + ROW_H * LEVELS.length + 14;
  // the cursor rests at "today" until a time is chosen; it can always be dragged.
  // Keep the handle fully inside the strip so it can be grabbed at either end.
  const rawX = tx(T ?? 0);
  const cursorX = rawX >= -1 && rawX <= W + 1 ? Math.min(Math.max(rawX, 7), W - 7) : -1;

  return (
    <div ref={wrap} className="timeline">
      <svg
        ref={svg}
        width={W}
        height={H}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onMouseLeave={() => setTip(null)}
      >
        {LEVELS.map((lvl, row) => {
          const y = PIN_H + row * ROW_H;
          return (
            <g key={lvl}>
              {scale.units.filter(u => u.level === lvl && u.start > b && u.end < a).map(u => {
                const x0 = Math.max(0, tx(u.start)), x1 = Math.min(W, tx(u.end));
                const w = x1 - x0;
                if (w < 0.3) return null;
                const name = unitName(u.name);
                const label = w > textW(name) + 8 ? name : w > 30 ? abbrev(name, w - 6) : "";
                const cls = "band" + (unit === u.name ? " sel" : path.has(u.name) ? " path" : "");
                return (
                  <g
                    key={u.name}
                    className={cls}
                    onClick={() => { if (!wasDrag()) onPickUnit(u.name); }}
                    onMouseMove={e => showTip(e, <><b>{name}</b> <span className="muted">{t(`level.${u.level}`)}</span><br />{fmtShort(u.start)} – {fmtShort(u.end)}</>)}
                    onMouseLeave={() => setTip(null)}
                  >
                    <rect x={x0} y={y} width={Math.max(w, 0.5)} height={ROW_H - 1} fill={u.color} />
                    {label && <text x={x0 + w / 2} y={y + 16} textAnchor="middle">{label}</text>}
                  </g>
                );
              })}
            </g>
          );
        })}
        {ticks.map(t => {
          const x = tx(t);
          if (x < 0 || x > W) return null;
          return (
            <g key={t}>
              <line className="tick" x1={x} x2={x} y1={PIN_H} y2={axisY - 10} />
              <text className="ticklab" x={x} y={axisY} textAnchor={x < 20 ? "start" : x > W - 20 ? "end" : "middle"}>{fmtShort(t)}</text>
            </g>
          );
        })}
        {pins.map(({ m, x, y }) => (
          <g
            key={m.title}
            className={`pin ${m.cat}${msTitle === m.title ? " sel" : ""}`}
            transform={`translate(${x},${y})`}
            onClick={() => { if (!wasDrag()) selectMilestone(m); }}
            onMouseMove={e => { const lm = localMs(m); showTip(e, <><b>{lm.title}</b><br /><span className="muted">{fmtMa(m.ma)}</span><br />{lm.desc}</>); }}
            onMouseLeave={() => setTip(null)}
          >
            <line y1={4} y2={PIN_H - y} />
            <circle r={4.5} />
          </g>
        ))}
        {cursorX >= 0 && cursorX <= W && (
          <g className={`cursor-handle${T == null ? " idle" : ""}`}>
            <title>{t("timeline.dragCursor")}</title>
            <line className="cursor" x1={cursorX} x2={cursorX} y1={0} y2={axisY - 8} />
            <rect className="cursor-hit" x={cursorX - 8} y={PIN_H} width={16} height={axisY - PIN_H} />
            <circle className="cursor-knob" cx={cursorX} cy={axisY - 8} r={6} />
            <text className="cursorlab" x={Math.min(Math.max(cursorX, 70), W - 70)} y={H - 1} textAnchor="middle">
              ▲ {T == null ? t("timeline.cursorIdle") : fmtShort(T)}
            </text>
          </g>
        )}
      </svg>
      {tip && (
        <div className="tip" style={{ left: Math.min(tip.x + 14, innerWidth - 300), top: tip.y + 14 }}>{tip.html}</div>
      )}
    </div>
  );
}
