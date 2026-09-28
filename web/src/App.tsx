import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Filter, Meta, Milestone, TimeData, Unit, View } from "./types";
import { TimeScale, unitDomain, zoomDomain, EARTH_AGE, type Domain } from "./time";
import { AppContext, type AppActions } from "./context";
import { getLineage, getTaxon } from "./data";
import { nearestFitting, relation, timeWindow, type TimeWindow } from "./sync";
import { Header } from "./components/Header";
import { Timeline } from "./components/Timeline";
import { Explorer } from "./components/Explorer";
import { TimePanel } from "./components/TimePanel";
import { SciName } from "./components/common";
import { useI18n } from "./i18n";

const FULL: Domain = [EARTH_AGE, 0];
const NOTICE_MS = 6000;

function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  return { id: p.has("n") ? Number(p.get("n")) || 0 : 0, unit: p.get("u") };
}

export function App({ meta, time }: { meta: Meta; time: TimeData }) {
  const i18n = useI18n();
  const { t, tn, lang } = i18n;
  const i18nRef = useRef(i18n);
  i18nRef.current = i18n;
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

  // keep the URL in sync: choosing a taxon or a time period creates a history entry; follow-up
  // adjustments (keeping taxon and time consistent) and dragging the time cursor replace it
  useEffect(() => {
    const p = new URLSearchParams();
    if (id) p.set("n", String(id));
    if (unit) p.set("u", unit);
    const h = "#" + p.toString();
    const push = pushNext.current;
    pushNext.current = false;
    if (h === (location.hash || "#")) return;
    if (push) history.pushState(null, "", h); else history.replaceState(null, "", h);
  }, [id, unit]);

  // back/forward restores exactly what was in the URL (no reconciliation)
  useEffect(() => {
    const onPop = () => {
      syncSeq.current++;
      // restoring an entry must never push one (that would erase the forward history)
      pushNext.current = false;
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

  /** The next URL change creates a history entry — only if taxon or unit really changes (else the flag would linger). */
  const pushIfChanged = useCallback((nextId: number, nextUnit: string | null) => {
    if (nextId !== idRef.current || nextUnit !== unitRef.current) pushNext.current = true;
  }, []);
  /** Set when a drag of the time cursor starts: its first change of unit creates one history entry. */
  const dragPending = useRef(false);

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
    const i = i18nRef.current;
    const key = rel === "extinct" ? (w.unit ? "notice.extinctUnit" : "notice.extinctAt") : (w.unit ? "notice.futureUnit" : "notice.futureAt");
    say(i.tn(key, {
      taxon: <SciName n={n} />,
      unit: w.unit ? i.unitName(w.unit) : "",
      time: i.fmtShort(w.start),
      target: target.i === 0 ? i.t("notice.allLife") : <SciName n={target} />,
    }));
  }, []);

  /** Navigate to a taxon; if it didn't exist at the selected time, move the time to its origin. */
  const go = useCallback((next: number) => {
    const seq = ++syncSeq.current;
    pushIfChanged(next, unitRef.current);
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
      const i = i18nRef.current;
      say(i.tn("notice.moved", { unit: i.unitName(u.name), time: i.fmtShort(n.a), taxon: <SciName n={n} /> }));
    });
  }, [scale, zoomTo, pushIfChanged]);

  const selectUnit = useCallback((name: string, zoom = false, at?: number) => {
    const u = scale.byName[name];
    if (!u) return;
    const t = at ?? (u.start + u.end) / 2;
    pushIfChanged(idRef.current, name);
    setUnit(name);
    setMilestone(null);
    setT(t);
    if (zoom) zoomTo(u);
    reconcileTaxon(timeWindow(u, t));
  }, [scale, zoomTo, reconcileTaxon, pushIfChanged]);

  const selectMilestone = useCallback((m: Milestone) => {
    const u = scale.deepestAt(m.ma);
    if (u) pushIfChanged(idRef.current, u.name);
    setMilestone(m);
    setT(m.ma);
    if (u) setUnit(u.name);
    reconcileTaxon(timeWindow(u, m.ma));
  }, [scale, reconcileTaxon, pushIfChanged]);

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
  const scrubTo = useCallback((at: number, start = false) => {
    const cur = unitRef.current;
    const u = scale.at(at, cur ? scale.byName[cur].level : "period") ?? scale.deepestAt(at);
    if (start) dragPending.current = true;
    if (dragPending.current && u && u.name !== cur) {
      pushIfChanged(idRef.current, u.name);
      dragPending.current = false;
    }
    setT(at);
    setMilestone(null);
    if (u) setUnit(u.name);
    if (u?.name !== cur) reconcileTaxon(timeWindow(u, at));
  }, [scale, reconcileTaxon, pushIfChanged]);

  const home = () => {
    pushIfChanged(0, null);
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
  const [nodeLabel, setNodeLabel] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    getTaxon(id, lang.code).then(n => { if (live && n) setNodeLabel(n.i === 0 ? null : n.c || n.n); });
    return () => { live = false; };
  }, [id, lang.code]);
  const fmt = (x: number) => (x === 0 ? t("time.today") : i18n.fmtShort(x >= 1000 ? +x.toPrecision(3) : +x.toFixed(1)));

  return (
    <AppContext.Provider value={actions}>
      <Header meta={meta} onPick={go} onHome={home} />
      <section className="timeline-wrap">
        <div className="timeline-bar">
          <div className="tl-title">{t("timeline.title")} <span className="muted">· <bdi>{fmt(a)} → {fmt(b)}</bdi></span></div>
          <div className="tl-controls">
            <button onClick={() => zoomBy(2)} title={t("timeline.zoomOut")}>−</button>
            <button onClick={() => zoomBy(0.5)} title={t("timeline.zoomIn")}>+</button>
            <button onClick={() => setDomain(FULL)} title={t("timeline.allTitle")}>{t("timeline.all")}</button>
            <span className="legend">
              <i className="dot life" />{t("timeline.legendLife")} <i className="dot extinction" />{t("timeline.legendExtinction")}{" "}
              <i className="dot earth" />{t("timeline.legendEarth")}
            </span>
          </div>
        </div>
        <Timeline milestones={time.milestones} domain={domain} setDomain={setDomain} unit={unit} T={T} msTitle={milestone?.title ?? null} onScrub={scrubTo} onPickUnit={pickUnitFromTimeline} />
        <div className="tl-hint muted">
          {t("timeline.hint")}
        </div>
      </section>
      <main className={`layout pane-${pane}`}>
        <Explorer id={id} T={T} win={win} filter={filter} setFilter={setFilter} view={view} setView={setView} />
        <TimePanel unit={unit} T={T} milestone={milestone} milestones={time.milestones} />
      </main>
      <footer className="foot">
        <b>{t("footer.stats", { taxa: i18n.fmtInt(meta.count), species: i18n.fmtInt(meta.species) })}</b>
        <br />
        {t("footer.data")}{" "}
        {lang.code !== "en" && <>{t("footer.translated", { wiki: i18n.wikiName })} </>}
        {tn("footer.license", { license: <a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA</a> })}{" "}
        {t("footer.timescale")}
      </footer>
      <nav className="mobile-tabs" aria-label={t("tabs.sections")}>
        <button className={pane === "tree" ? "on" : ""} onClick={() => { setPane("tree"); scrollTo({ top: 0 }); }}>
          🌳 {t("tabs.organism")}<small>{nodeLabel ?? t("life")}</small>
        </button>
        <button className={pane === "time" ? "on" : ""} onClick={() => { setPane("time"); scrollTo({ top: 0 }); }}>
          ⏳ {t("tabs.time")}<small>{unit ? i18n.unitName(unit) : t("tabs.milestones")}</small>
        </button>
      </nav>
      {notice && (
        <div key={notice.key} className="notice" role="status">
          <span>⏱ {notice.body}</span>
          <button onClick={() => setNotice(null)} aria-label={t("notice.dismiss")}>×</button>
        </div>
      )}
    </AppContext.Provider>
  );
}
