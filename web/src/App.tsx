import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Filter, Meta, Milestone, TimeData, Unit, View } from "./types";
import { TimeScale, unitDomain, zoomDomain, fmtShort, EARTH_AGE, type Domain } from "./time";
import { AppContext, type AppActions } from "./context";
import { getLineage, getTaxon } from "./data";
import { nearestFitting, relation, timeWindow, type TimeWindow } from "./sync";
import { Header } from "./components/Header";
import { Timeline } from "./components/Timeline";
import { Explorer } from "./components/Explorer";
import { TimePanel } from "./components/TimePanel";
import { SciName } from "./components/common";

const FULL: Domain = [EARTH_AGE, 0];
const NOTICE_MS = 6000;

function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  return { id: p.has("n") ? Number(p.get("n")) || 0 : 0, unit: p.get("u") };
}

export function App({ meta, time }: { meta: Meta; time: TimeData }) {
  const scale = useMemo(() => new TimeScale(time.units), [time]);
  const initial = useMemo(() => {
    const h = readHash();
    const u = h.unit && scale.byName[h.unit] ? scale.byName[h.unit] : null;
    return { id: h.id, unit: u?.name ?? null, T: u ? (u.start + u.end) / 2 : null, domain: u ? unitDomain(u) : FULL };
  }, [scale]);

  const [id, setId] = useState(initial.id);
  const [unit, setUnit] = useState<string | null>(initial.unit);
  const [T, setT] = useState<number | null>(initial.T);
  const [milestone, setMilestone] = useState<Milestone | null>(null);
  const [domain, setDomain] = useState<Domain>(initial.domain);
  const [filter, setFilter] = useState<Filter>("all");
  const [view, setView] = useState<View>("cards");
  /** Narrow screens show one pane at a time (see .mobile-tabs); ignored by the desktop layout. */
  const [pane, setPane] = useState<"tree" | "time">("tree");
  const [notice, setNotice] = useState<{ key: number; body: React.ReactNode } | null>(null);
  const pushNext = useRef(false);
  const idRef = useRef(id);
  idRef.current = id;
  const unitRef = useRef(unit);
  unitRef.current = unit;
  const winRef = useRef<TimeWindow | null>(null);
  const win = useMemo(() => timeWindow(unit ? scale.byName[unit] : undefined, T), [scale, unit, T]);
  winRef.current = win;
  /** Guards async reconciliation against newer user actions. */
  const syncSeq = useRef(0);

  // keep the URL in sync: taxon navigation creates history entries, time selection replaces
  useEffect(() => {
    const p = new URLSearchParams();
    if (id) p.set("n", String(id));
    if (unit) p.set("u", unit);
    const h = "#" + p.toString();
    if (h === location.hash) return;
    if (pushNext.current) history.pushState(null, "", h); else history.replaceState(null, "", h);
    pushNext.current = false;
  }, [id, unit]);

  // back/forward restores exactly what was in the URL (no reconciliation)
  useEffect(() => {
    const onPop = () => {
      syncSeq.current++;
      const h = readHash();
      setId(h.id);
      const u = h.unit ? scale.byName[h.unit] : undefined;
      if ((u?.name ?? null) === unitRef.current) return;
      setUnit(u?.name ?? null);
      setMilestone(null);
      setT(u ? (u.start + u.end) / 2 : null);
      setDomain(u ? unitDomain(u) : FULL);
    };
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  }, [scale]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(t);
  }, [notice]);
  const say = (body: React.ReactNode) => setNotice({ key: Date.now(), body });

  const zoomTo = useCallback((u: Unit) => {
    setDomain(unitDomain(u.level === "age" && u.parent ? scale.byName[u.parent] : u));
  }, [scale]);

  /** Time changed: if the open taxon didn't exist then, climb to the nearest ancestor that did. */
  const reconcileTaxon = useCallback(async (w: TimeWindow | null) => {
    if (!w) return;
    const seq = ++syncSeq.current;
    const n = await getTaxon(idRef.current);
    if (!n || seq !== syncSeq.current) return;
    const rel = relation(n, w);
    if (rel !== "extinct" && rel !== "future") return;
    const lineage = await getLineage(n.i);
    if (seq !== syncSeq.current) return;
    const target = nearestFitting(lineage, w);
    setId(target.i); // replaces the history entry, keeping taxon and time consistent in the URL
    say(<><SciName n={n} /> {rel === "extinct" ? "had died out by" : "hadn't evolved yet in"} {w.label}, so showing {target.i === 0 ? "all life" : <SciName n={target} />} instead.</>);
  }, []);

  /** Navigate to a taxon; if it didn't exist at the selected time, move the time to its origin. */
  const go = useCallback((next: number) => {
    const seq = ++syncSeq.current;
    pushNext.current = true;
    setId(next);
    setPane("tree");
    const el = document.querySelector<HTMLElement>(".explorer");
    if (el) scrollTo({ top: el.offsetTop - 70, behavior: "smooth" });
    const w = winRef.current;
    if (!w) return;
    getTaxon(next).then(n => {
      if (!n || seq !== syncSeq.current || n.a == null) return;
      const rel = relation(n, w);
      if (rel !== "extinct" && rel !== "future") return;
      const level = unitRef.current ? scale.byName[unitRef.current].level : "period";
      const u = scale.at(n.a, level) ?? scale.deepestAt(n.a);
      if (!u) return;
      setUnit(u.name);
      setT(n.a);
      setMilestone(null);
      zoomTo(u);
      say(<>Moved to the {u.name} ({fmtShort(n.a)}), when <SciName n={n} /> first appeared.</>);
    });
  }, [scale, zoomTo]);

  const selectUnit = useCallback((name: string, zoom = false, at?: number) => {
    const u = scale.byName[name];
    if (!u) return;
    const t = at ?? (u.start + u.end) / 2;
    setUnit(name);
    setMilestone(null);
    setT(t);
    if (zoom) zoomTo(u);
    reconcileTaxon(timeWindow(u, t));
  }, [scale, zoomTo, reconcileTaxon]);

  const selectMilestone = useCallback((m: Milestone) => {
    const u = scale.deepestAt(m.ma);
    setMilestone(m);
    setT(m.ma);
    if (u) setUnit(u.name);
    reconcileTaxon(timeWindow(u, m.ma));
  }, [scale, reconcileTaxon]);

  const jumpToTime = useCallback((at: number) => {
    const u = scale.at(at, "age") || scale.at(at, "period") || scale.at(at, "era") || scale.at(at, "eon");
    if (u) selectUnit(u.name, true, at);
    const panel = document.querySelector<HTMLElement>(".timepanel");
    if (!panel) return;
    panel.scrollTop = 0;
    // Side-by-side layout: the panel is already on screen, so leave the page where it is.
    // Stacked (narrow) layout: the panel sits below the explorer, so bring it into view.
    if (panel.getBoundingClientRect().top > innerHeight) panel.scrollIntoView({ behavior: "smooth" });
  }, [scale, selectUnit]);

  // Dragging the time cursor: follow it at the selected unit's level (period by default).
  const scrubTo = useCallback((at: number) => {
    const cur = unitRef.current;
    const u = scale.at(at, cur ? scale.byName[cur].level : "period") ?? scale.deepestAt(at);
    setT(at);
    setMilestone(null);
    if (u) setUnit(u.name);
    if (u?.name !== cur) reconcileTaxon(timeWindow(u, at));
  }, [scale, reconcileTaxon]);

  const home = () => {
    setUnit(null); setT(null); setMilestone(null); setDomain(FULL); go(0);
  };

  // changing the time never switches panes on mobile; the Organism pane follows the time
  const pickUnitFromTimeline = useCallback((name: string) => selectUnit(name, true), [selectUnit]);

  const zoomBy = (f: number) => {
    const [a, b] = domain;
    const nd = zoomDomain(domain, T ?? (a + b) / 2, f);
    if (nd) setDomain(nd);
  };

  const actions: AppActions = useMemo(
    () => ({ scale, go, selectUnit, selectMilestone, jumpToTime }),
    [scale, go, selectUnit, selectMilestone, jumpToTime],
  );
  const [a, b] = domain;
  const [nodeLabel, setNodeLabel] = useState("Life");
  useEffect(() => {
    let live = true;
    getTaxon(id).then(n => { if (live && n) setNodeLabel(n.i === 0 ? "Life" : n.c || n.n); });
    return () => { live = false; };
  }, [id]);
  const fmt = (t: number) => (t === 0 ? "today" : t >= 1000 ? `${(t / 1000).toFixed(2).replace(/\.?0+$/, "")} Ga` : `${+t.toFixed(1)} Ma`);

  return (
    <AppContext.Provider value={actions}>
      <Header meta={meta} onPick={go} onHome={home} />
      <section className="timeline-wrap">
        <div className="timeline-bar">
          <div className="tl-title">Geologic time <span className="muted">· {fmt(a)} → {fmt(b)}</span></div>
          <div className="tl-controls">
            <button onClick={() => zoomBy(2)} title="Zoom out">−</button>
            <button onClick={() => zoomBy(0.5)} title="Zoom in">+</button>
            <button onClick={() => setDomain(FULL)} title="Show all of Earth's history">All time</button>
            <span className="legend"><i className="dot life" />Life <i className="dot extinction" />Extinction <i className="dot earth" />Earth</span>
          </div>
        </div>
        <Timeline milestones={time.milestones} domain={domain} setDomain={setDomain} unit={unit} T={T} msTitle={milestone?.title ?? null} onScrub={scrubTo} onPickUnit={pickUnitFromTimeline} />
        <div className="tl-hint muted">
          Click a band to explore that time · drag the ▲ cursor to travel through time · scroll to zoom, drag to pan · pins are evolutionary milestones · scale is compressed for the Precambrian
        </div>
      </section>
      <main className={`layout pane-${pane}`}>
        <Explorer id={id} T={T} win={win} filter={filter} setFilter={setFilter} view={view} setView={setView} />
        <TimePanel unit={unit} T={T} milestone={milestone} milestones={time.milestones} />
      </main>
      <footer className="foot">
        Data extracted from every taxobox and taxonomy template in the English Wikipedia dump (2026-09). Text and images © Wikipedia /
        Wikimedia Commons contributors, <a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA</a>. Time scale: ICS
        International Chronostratigraphic Chart.
      </footer>
      <nav className="mobile-tabs" aria-label="Sections">
        <button className={pane === "tree" ? "on" : ""} onClick={() => { setPane("tree"); scrollTo({ top: 0 }); }}>
          🌳 Organism<small>{nodeLabel}</small>
        </button>
        <button className={pane === "time" ? "on" : ""} onClick={() => { setPane("time"); scrollTo({ top: 0 }); }}>
          ⏳ Time<small>{unit ?? "Milestones"}</small>
        </button>
      </nav>
      {notice && (
        <div key={notice.key} className="notice" role="status">
          <span>⏱ {notice.body}</span>
          <button onClick={() => setNotice(null)} aria-label="Dismiss">×</button>
        </div>
      )}
    </AppContext.Provider>
  );
}
