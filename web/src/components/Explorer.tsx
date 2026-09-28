import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Brief, Filter, Taxon, View } from "../types";
import { getLineage, getTaxon } from "../data";
import { rangeText } from "../time";
import { relation, type Relation, type TimeWindow } from "../sync";
import { MAJOR_RANKS, STATUS, fmtInt, glyphFor, isIncertae, wikiUrl } from "../taxa";
import { useApp } from "../context";
import { Img } from "./Img";
import { RangeAxis, RangeBar } from "./RangeBar";
import { RankTag, SciName, TaxonLink } from "./common";
import { TreeView } from "./TreeView";

interface Props {
  id: number;
  T: number | null;
  /** Selected span of geologic time (unit), used for "alive then" labels and filtering. */
  win: TimeWindow | null;
  filter: Filter;
  setFilter: (f: Filter) => void;
  view: View;
  setView: (v: View) => void;
}

/** Breadcrumbs only tag the principal ranks ("division" is the botanical phylum). */
const CRUMB_RANKS = new Set(["domain", "kingdom", "phylum", "division", "class", "order", "family", "genus", "species"]);

const FILTERS: [Filter, string][] = [["all", "All"], ["living", "Living"], ["extinct", "Extinct †"], ["time", ""]];

export function Explorer({ id, T, win, filter, setFilter, view, setView }: Props) {
  const [node, setNode] = useState<Taxon | null>(null);
  const [lineage, setLineage] = useState<Taxon[]>([]);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let live = true;
    setLoading(true);
    (async () => {
      const n = await getTaxon(id);
      if (!live) return;
      if (!n) { setMissing(true); setLoading(false); return; }
      const lin = await getLineage(id);
      if (!live) return;
      setMissing(false);
      setNode(n);
      setLineage(lin);
      setLoading(false);
      document.title = `${n.c ? `${n.c} (${n.n})` : n.n} — Tree of Life`;
    })();
    return () => { live = false; };
  }, [id]);

  const keep = useCallback((k: Brief) =>
    filter === "living" ? !k.x : filter === "extinct" ? !!k.x : filter === "time" && win ? relation(k, win) === "alive" : true,
  [filter, win]);

  if (missing) return <section className="explorer"><p>Taxon not found.</p></section>;
  if (!node) return <section className="explorer"><article className="hero loading" /></section>;

  const kids = (node.k || []).filter(keep);
  const total = (node.k || []).length + (node.kmore || 0);

  return (
    <section className="explorer">
      <Crumbs lineage={lineage} />
      <Hero n={node} T={T} win={win} loading={loading} parent={lineage[lineage.length - 2]} />
      <div className="kids-head">
        <h2>
          {total ? <>Subgroups <span className="muted">{kids.length}{kids.length !== total ? ` of ${fmtInt(total)}` : ""}</span></> : "No subgroups"}
        </h2>
        <div className="chips">
          {FILTERS.map(([f, label]) => (
            <button key={f} className={filter === f ? "on" : ""} onClick={() => setFilter(f)}>
              {f === "time" ? (win ? `Alive in ${win.label.replace(/^the /, "")}` : "Alive at selected time") : label}
            </button>
          ))}
        </div>
        <div className="chips">
          <button className={view === "cards" ? "on" : ""} onClick={() => setView("cards")}>▦ Cards</button>
          <button className={view === "tree" ? "on" : ""} onClick={() => setView("tree")}>⟜ Tree</button>
        </div>
      </div>
      {view === "tree" ? (
        <TreeView root={node} keep={keep} />
      ) : (
        <div className="kids">
          {kids.map(k => <KidCard key={k.i} k={k} T={T} win={win} />)}
          {!!node.kmore && (
            <div className="more">…and {fmtInt(node.kmore)} more. <a href={wikiUrl(node.w || node.n)} target="_blank" rel="noopener">See Wikipedia</a></div>
          )}
          {!kids.length && total > 0 && <div className="more">No subgroups match this filter.</div>}
        </div>
      )}
    </section>
  );
}

/** Hover scrolling speed for the breadcrumb carets (px per frame), ramping up while hovered. */
const CARET_SPEED = 4, CARET_MAX_SPEED = 18, CARET_ACCEL = 0.25;

function Crumbs({ lineage }: { lineage: Taxon[] }) {
  const nav = useRef<HTMLElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const hover = useRef<{ dir: -1 | 1; frame: number } | null>(null);

  const updateEdges = useCallback(() => {
    const el = nav.current;
    if (!el) return;
    const left = el.scrollLeft > 1;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setEdges(e => (e.left === left && e.right === right ? e : { left, right }));
  }, []);

  // keep the current taxon in view when the lineage is long
  useLayoutEffect(() => {
    const el = nav.current;
    if (el) el.scrollLeft = el.scrollWidth;
    updateEdges();
  }, [lineage, updateEdges]);

  useEffect(() => {
    const el = nav.current!;
    const ro = new ResizeObserver(updateEdges);
    ro.observe(el);
    return () => { ro.disconnect(); stopHover(); };
  }, [updateEdges]);

  const startHover = (dir: -1 | 1) => {
    stopHover();
    let speed = CARET_SPEED;
    const step = () => {
      const el = nav.current;
      if (!el || !hover.current) return;
      el.scrollLeft += dir * speed;
      speed = Math.min(CARET_MAX_SPEED, speed + CARET_ACCEL);
      // the caret unmounts (no mouseleave) once that end is reached, so stop here
      const atEnd = dir < 0 ? el.scrollLeft <= 0 : el.scrollLeft + el.clientWidth >= el.scrollWidth - 1;
      if (atEnd) { hover.current = null; return; }
      hover.current.frame = requestAnimationFrame(step);
    };
    hover.current = { dir, frame: requestAnimationFrame(step) };
  };
  function stopHover() {
    if (hover.current) cancelAnimationFrame(hover.current.frame);
    hover.current = null;
  }
  const page = (dir: -1 | 1) => {
    const el = nav.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: "smooth" });
  };

  return (
    <div className="crumbs-wrap">
      {edges.left && (
        <button className="crumb-caret left" aria-label="Scroll path left"
          onMouseEnter={() => startHover(-1)} onMouseLeave={stopHover} onClick={() => page(-1)}>‹</button>
      )}
      {edges.right && (
        <button className="crumb-caret right" aria-label="Scroll path right"
          onMouseEnter={() => startHover(1)} onMouseLeave={stopHover} onClick={() => page(1)}>›</button>
      )}
      <nav
        ref={nav}
        className={`crumbs${edges.left ? " fade-left" : ""}${edges.right ? " fade-right" : ""}`}
        onScroll={updateEdges}
      >
        {lineage.map((a, i) => (
          <span key={a.i} style={{ display: "contents" }}>
            {i > 0 && <span className="sep">›</span>}
            <TaxonLink
              id={a.i}
              title={a.r}
              className={`crumb ${MAJOR_RANKS.has(a.r || "") ? "major" : "minor"}${isIncertae(a) ? " incertae" : ""}${i === lineage.length - 1 ? " cur" : ""}`}
            >
              {a.i !== 0 && CRUMB_RANKS.has(a.r || "") && <RankTag rank={a.r} />}
              <span className="crumb-name">{a.i === 0 ? "🌳 Life" : <SciName n={a} />}</span>
            </TaxonLink>
          </span>
        ))}
      </nav>
    </div>
  );
}

/** Label for how a taxon relates to the selected time. */
const RELATION_LABEL: Record<Exclude<Relation, "unknown">, [string, string]> = {
  alive: ["ok", "Alive then"],
  extinct: ["no", "† Extinct by then"],
  future: ["later", "Not yet evolved"],
};

function Hero({ n, T, win, loading, parent }: { n: Taxon; T: number | null; win: TimeWindow | null; loading: boolean; parent?: Taxon }) {
  const { go, jumpToTime } = useApp();
  const st = n.st ? STATUS[n.st.replace(/[^A-Z0-9]/g, "")] : undefined;
  return (
    <article className={`hero${loading ? " loading" : ""}`}>
      <div className="hero-media">
        {n.m ? <Img file={n.m} width={500} className="hero-img" glyph={glyphFor(n.r)} /> : <div className="noimg hero-img">{n.i === 0 ? "🌳" : "🧬"}</div>}
        {n.m && !n.own ? <div className="imgnote">Representative image from a member group</div> : n.cap ? <div className="imgnote">{n.cap}</div> : null}
      </div>
      <div className="hero-body">
        <div className="rank">
          {n.i !== 0 && <RankTag rank={n.r} big />}
          {n.x ? <span className="ext">extinct †</span> : null}
        </div>
        <h1>{n.x ? "† " : ""}{n.i === 0 ? "Life" : <SciName n={n} />}</h1>
        {isIncertae(n) && (
          <p className="incertae-note">
            <i>Incertae sedis</i> ("of uncertain placement") is not a taxon: it collects members of
            {parent ? <> <SciName n={parent} /></> : " the parent group"} whose exact position within it is unresolved.
          </p>
        )}
        {n.c && !isIncertae(n) && <div className="common">{n.c}</div>}
        {n.au && <div className="author">{n.au}</div>}
        <div className="pills">
          {st && <span className="pill" style={{ background: st[1] }}>{st[0]}</span>}
          {!!n.s && <span className="pill">{fmtInt(n.s)} species</span>}
          {!!n.t && <span className="pill">{fmtInt(n.t)} taxa below</span>}
          {(() => {
            const rel = relation(n, win);
            if (rel === "unknown" || !win) return null;
            const text = rel === "alive" ? `Alive in ${win.label}` : rel === "extinct" ? `Extinct by ${win.label}` : `Not yet evolved in ${win.label}`;
            return <span className={`pill ${RELATION_LABEL[rel][0]}`}>{text}</span>;
          })()}
        </div>
        {n.sd && <p className="sd">{n.sd}</p>}
        <div className="range">
          <div className="range-t"><b>Temporal range:</b> {rangeText(n)}{n.fr && <span className="muted"> · {n.fr}</span>}</div>
          {n.a != null && <><RangeBar n={n} big T={T} /><RangeAxis /></>}
        </div>
        {n.l && <p className="lead">{n.l}</p>}
        <div className="actions">
          {n.w && <a className="btn" href={wikiUrl(n.w)} target="_blank" rel="noopener">Read on Wikipedia ↗</a>}
          {n.a != null && <button className="btn ghost" onClick={() => jumpToTime(n.a!)}>⏱ Show its origin in time</button>}
          {n.p != null && <button className="btn ghost" onClick={() => go(n.p!)}>↑ Parent group</button>}
        </div>
      </div>
    </article>
  );
}

function KidCard({ k, T, win }: { k: Brief; T: number | null; win: TimeWindow | null }) {
  const rel = relation(k, win);
  return (
    <TaxonLink id={k.i} className={`card${k.x ? " extinct" : ""}${rel === "extinct" || rel === "future" ? " dim" : ""}`}>
      <div className="thumb">
        <Img file={k.m} width={250} glyph={glyphFor(k.r)} />
        {rel !== "unknown" && <span className={`when-tag ${RELATION_LABEL[rel][0]}`}>{RELATION_LABEL[rel][1]}</span>}
      </div>
      <div className="cbody">
        <div className="cname">{k.x ? "† " : ""}<SciName n={k} /></div>
        {k.c && <div className="ccommon">{k.c}</div>}
        <div className="cmeta">
          <RankTag rank={k.r} />
          {k.s ? ` · ${fmtInt(k.s)} sp.` : k.t ? ` · ${fmtInt(k.t)} taxa` : ""}
        </div>
        {k.a != null && <><div className="crange">{rangeText(k)}</div><RangeBar n={k} T={T} /></>}
      </div>
    </TaxonLink>
  );
}
