import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Filter, Meta, Milestone, TimeData, View } from "./types";
import { TimeScale, unitDomain, zoomDomain, EARTH_AGE, type Domain } from "./time";
import { AppContext, type AppActions } from "./context";
import { Header } from "./components/Header";
import { Timeline } from "./components/Timeline";
import { Explorer } from "./components/Explorer";
import { TimePanel } from "./components/TimePanel";

const FULL: Domain = [EARTH_AGE, 0];
const JOURNEY_STEP_MS = 7000;

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
  const [playing, setPlaying] = useState(false);
  const pushNext = useRef(false);

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

  useEffect(() => {
    const onPop = () => {
      const h = readHash();
      setId(h.id);
      if (h.unit && scale.byName[h.unit]) setUnit(h.unit);
    };
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  }, [scale]);

  const go = useCallback((next: number) => {
    pushNext.current = true;
    setId(next);
    const el = document.querySelector<HTMLElement>(".explorer");
    if (el) scrollTo({ top: el.offsetTop - 70, behavior: "smooth" });
  }, []);

  const selectUnit = useCallback((name: string, zoom = false, at?: number) => {
    const u = scale.byName[name];
    if (!u) return;
    setUnit(name);
    setMilestone(null);
    setT(at ?? (u.start + u.end) / 2);
    if (zoom) setDomain(unitDomain(u.level === "age" && u.parent ? scale.byName[u.parent] : u));
  }, [scale]);

  const selectMilestone = useCallback((m: Milestone) => {
    setMilestone(m);
    setT(m.ma);
    const u = scale.deepestAt(m.ma);
    if (u) setUnit(u.name);
  }, [scale]);

  const jumpToTime = useCallback((at: number) => {
    const u = scale.at(at, "age") || scale.at(at, "period") || scale.at(at, "era") || scale.at(at, "eon");
    if (u) selectUnit(u.name, true, at);
    document.querySelector(".timepanel")?.scrollIntoView({ behavior: "smooth" });
  }, [scale, selectUnit]);

  const home = () => {
    setUnit(null); setT(null); setMilestone(null); setDomain(FULL); go(0);
  };

  // "Journey through time": step through the periods (plus Hadean and Archean eras)
  useEffect(() => {
    if (!playing) return;
    const seq = scale.journey();
    let i = unit ? Math.max(0, seq.findIndex(u => scale.path(unit).includes(u.name))) : 0;
    const step = () => {
      if (i >= seq.length) { setPlaying(false); return; }
      selectUnit(seq[i++].name, true);
    };
    step();
    const timer = setInterval(step, JOURNEY_STEP_MS);
    return () => clearInterval(timer);
    // intentionally not re-run when `unit` changes: the journey starts from the unit selected when play was pressed
  }, [playing, scale, selectUnit]);

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
  const fmt = (t: number) => (t === 0 ? "today" : t >= 1000 ? `${(t / 1000).toFixed(2).replace(/\.?0+$/, "")} Ga` : `${+t.toFixed(1)} Ma`);

  return (
    <AppContext.Provider value={actions}>
      <Header meta={meta} onPick={go} onHome={home} />
      <section className="timeline-wrap">
        <div className="timeline-bar">
          <div className="tl-title">Geologic time <span className="muted">· {fmt(a)} → {fmt(b)}</span></div>
          <div className="tl-controls">
            <button id="tl-play" onClick={() => setPlaying(p => !p)}>{playing ? "⏸ Pause" : "▶ Journey through time"}</button>
            <button onClick={() => zoomBy(2)} title="Zoom out">−</button>
            <button onClick={() => zoomBy(0.5)} title="Zoom in">+</button>
            <button onClick={() => setDomain(FULL)} title="Show all of Earth's history">All time</button>
            <span className="legend"><i className="dot life" />Life <i className="dot extinction" />Extinction <i className="dot earth" />Earth</span>
          </div>
        </div>
        <Timeline milestones={time.milestones} domain={domain} setDomain={setDomain} unit={unit} T={T} msTitle={milestone?.title ?? null} />
        <div className="tl-hint muted">
          Click a band to explore that time · scroll to zoom · drag to pan · pins are evolutionary milestones · scale is compressed for the Precambrian
        </div>
      </section>
      <main className="layout">
        <Explorer id={id} T={T} filter={filter} setFilter={setFilter} view={view} setView={setView} />
        <TimePanel unit={unit} milestone={milestone} milestones={time.milestones} />
      </main>
      <footer className="foot">
        Data extracted from every taxobox and taxonomy template in the English Wikipedia dump (2026-09). Text and images © Wikipedia /
        Wikimedia Commons contributors, <a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA</a>. Time scale: ICS
        International Chronostratigraphic Chart. <a href="https://github.com/acycliczebra/Evolution">Source &amp; data dump on GitHub</a>.
      </footer>
    </AppContext.Provider>
  );
}
