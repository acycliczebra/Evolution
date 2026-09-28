import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Brief, Filter, Taxon, View } from "../types";
import { getLineage, getTaxon } from "../data";
import { relation, type Relation, type TimeWindow } from "../sync";
import { MAJOR_RANKS, STATUS, glyphFor, isIncertae } from "../taxa";
import { useApp } from "../context";
import { useI18n } from "../i18n";
import { winMsg } from "../i18n/window";
import type { MsgKey } from "../i18n/en";
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

const FILTERS: [Filter, MsgKey][] = [["all", "filter.all"], ["living", "filter.living"], ["extinct", "filter.extinct"], ["time", "filter.aliveNone"]];

export function Explorer({ id, T, win, filter, setFilter, view, setView }: Props) {
  const i18n = useI18n();
  const { t, lang, fmtInt } = i18n;
  const [node, setNode] = useState<Taxon | null>(null);
  const [lineage, setLineage] = useState<Taxon[]>([]);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const tRef = useRef(t);
  tRef.current = t;

  useEffect(() => {
    let live = true;
    setLoading(true);
    (async () => {
      const n = await getTaxon(id, lang.code);
      if (!live) return;
      if (!n) { setMissing(true); setLoading(false); return; }
      const lin = await getLineage(id, lang.code);
      if (!live) return;
      setMissing(false);
      setNode(n);
      setLineage(lin);
      setLoading(false);
      const tr = tRef.current;
      document.title = n.i === 0 ? tr("app.docTitleHome") : tr("app.docTitle", { name: n.c ? `${n.c} (${n.n})` : n.n });
    })();
    return () => { live = false; };
  }, [id, lang.code]);

  const keep = useCallback((k: Brief) =>
    filter === "living" ? !k.x : filter === "extinct" ? !!k.x : filter === "time" && win ? relation(k, win) === "alive" : true,
  [filter, win]);

  if (missing) return <section className="explorer"><p>{t("explorer.notFound")}</p></section>;
  if (!node) return <section className="explorer"><article className="hero loading" /></section>;

  const kids = (node.k || []).filter(keep);
  const total = (node.k || []).length + (node.kmore || 0);

  return (
    <section className="explorer">
      <Crumbs lineage={lineage} />
      <Hero n={node} T={T} win={win} loading={loading} parent={lineage[lineage.length - 2]} />
      <div className="kids-head">
        <h2>
          {total ? (
            <>
              {t("explorer.subgroups")}{" "}
              <span className="muted">{kids.length !== total ? t("explorer.shownOf", { shown: kids.length, total }) : fmtInt(kids.length)}</span>
            </>
          ) : t("explorer.noSubgroups")}
        </h2>
        <div className="chips">
          {FILTERS.map(([f, label]) => (
            <button key={f} className={filter === f ? "on" : ""} onClick={() => setFilter(f)}>
              {f === "time" && win ? winMsg(i18n, win, "filter.aliveUnit", "filter.aliveAt") : t(label)}
            </button>
          ))}
        </div>
        <div className="chips">
          <button className={view === "cards" ? "on" : ""} onClick={() => setView("cards")}>▦ {t("view.cards")}</button>
          <button className={view === "tree" ? "on" : ""} onClick={() => setView("tree")}>⟜ {t("view.tree")}</button>
        </div>
      </div>
      {view === "tree" ? (
        <TreeView root={node} keep={keep} />
      ) : (
        <div className="kids">
          {kids.map(k => <KidCard key={k.i} k={k} T={T} win={win} />)}
          {!!node.kmore && (
            <div className="more">
              {t("explorer.more", { count: node.kmore })}{" "}
              <a href={i18n.wikiUrl(node.w || node.n, node.lw)} target="_blank" rel="noopener">{t("explorer.seeWikipedia")}</a>
            </div>
          )}
          {!kids.length && total > 0 && <div className="more">{t("explorer.noMatch")}</div>}
        </div>
      )}
    </section>
  );
}

/** Hover scrolling speed for the breadcrumb carets (px per frame), ramping up while hovered. */
const CARET_SPEED = 4, CARET_MAX_SPEED = 18, CARET_ACCEL = 0.25;

function Crumbs({ lineage }: { lineage: Taxon[] }) {
  const { t, rank } = useI18n();
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
        <button className="crumb-caret left" aria-label={t("explorer.scrollLeft")}
          onMouseEnter={() => startHover(-1)} onMouseLeave={stopHover} onClick={() => page(-1)}>‹</button>
      )}
      {edges.right && (
        <button className="crumb-caret right" aria-label={t("explorer.scrollRight")}
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
              title={a.c ? `${rank(a.r)} · ${a.c}` : rank(a.r)}
              className={`crumb ${MAJOR_RANKS.has(a.r || "") ? "major" : "minor"}${isIncertae(a) ? " incertae" : ""}${i === lineage.length - 1 ? " cur" : ""}`}
            >
              {a.i !== 0 && CRUMB_RANKS.has(a.r || "") && <RankTag rank={a.r} />}
              <span className="crumb-name">{a.i === 0 ? <>🌳 <bdi>{t("life")}</bdi></> : <SciName n={a} />}</span>
            </TaxonLink>
          </span>
        ))}
      </nav>
    </div>
  );
}

/** Label for how a taxon relates to the selected time. */
const RELATION_LABEL: Record<Exclude<Relation, "unknown">, [string, MsgKey]> = {
  alive: ["ok", "relation.alive"],
  extinct: ["no", "relation.extinct"],
  future: ["later", "relation.future"],
};
const RELATION_PILL: Record<Exclude<Relation, "unknown">, [MsgKey, MsgKey]> = {
  alive: ["relation.aliveUnit", "relation.aliveAt"],
  extinct: ["relation.extinctUnit", "relation.extinctAt"],
  future: ["relation.futureUnit", "relation.futureAt"],
};

function Hero({ n, T, win, loading, parent }: { n: Taxon; T: number | null; win: TimeWindow | null; loading: boolean; parent?: Taxon }) {
  const { go, jumpToTime } = useApp();
  const i18n = useI18n();
  const { t, tn, lang } = i18n;
  const stCode = n.st?.replace(/[^A-Z0-9]/g, "");
  const st = stCode ? STATUS[stCode] : undefined;
  const english = lang.code === "en";
  // English-only extras (short description) accompany an English lead, never a translated one
  const englishLead = !english && !n.ll;
  return (
    <article className={`hero${loading ? " loading" : ""}`}>
      <div className="hero-media">
        {n.m ? <Img file={n.m} width={500} className="hero-img" glyph={glyphFor(n.r)} /> : <div className="noimg hero-img">{n.i === 0 ? "🌳" : "🧬"}</div>}
        {n.m && !n.own ? <div className="imgnote">{t("hero.representative")}</div> : n.cap && english ? <div className="imgnote">{n.cap}</div> : null}
      </div>
      <div className="hero-body">
        <div className="rank">
          {n.i !== 0 && <RankTag rank={n.r} big />}
          {n.x ? <span className="ext">{t("hero.extinct")}</span> : null}
        </div>
        <h1>{n.x ? "† " : ""}{n.i === 0 ? t("life") : <SciName n={n} />}</h1>
        {isIncertae(n) && (
          <p className="incertae-note">{tn("hero.incertae", { parent: parent ? <SciName n={parent} /> : t("hero.parentGroup") })}</p>
        )}
        {n.c && !isIncertae(n) && <div className="common">{n.c}</div>}
        {n.au && <div className="author">{n.au}</div>}
        <div className="pills">
          {st && <span className="pill" style={{ background: st }}>{i18n.status(stCode!)}</span>}
          {!!n.s && <span className="pill">{t("hero.species", { count: n.s })}</span>}
          {!!n.t && <span className="pill">{t("hero.taxaBelow", { count: n.t })}</span>}
          {(() => {
            const rel = relation(n, win);
            if (rel === "unknown" || !win) return null;
            const [unitKey, atKey] = RELATION_PILL[rel];
            return <span className={`pill ${RELATION_LABEL[rel][0]}`}>{winMsg(i18n, win, unitKey, atKey)}</span>;
          })()}
        </div>
        {n.sd && (english || englishLead) && <p className="sd" lang={english ? undefined : "en"} dir="auto">{n.sd}</p>}
        <div className="range">
          <div className="range-t">
            <b>{t("hero.temporalRange")}</b> <bdi>{i18n.rangeText(n)}</bdi>
            {n.fr && english && <span className="muted"> · {n.fr}</span>}
          </div>
          {n.a != null && <><RangeBar n={n} big T={T} /><RangeAxis /></>}
        </div>
        {n.l && (
          <p className="lead" lang={englishLead ? "en" : undefined} dir={englishLead ? "ltr" : undefined}>
            {n.l}
            {englishLead && <span className="langlead" lang={lang.tag} dir="auto">{t("hero.englishLead")}</span>}
          </p>
        )}
        <div className="actions">
          {(n.w || n.lw) && <a className="btn" href={i18n.wikiUrl(n.w || n.n, n.lw)} target="_blank" rel="noopener">{t("hero.readWikipedia")}</a>}
          {n.a != null && <button className="btn ghost" onClick={() => jumpToTime(n.a!)}>{t("hero.showOrigin")}</button>}
          {n.p != null && <button className="btn ghost" onClick={() => go(n.p!)}>{t("hero.parent")}</button>}
        </div>
      </div>
    </article>
  );
}

function KidCard({ k, T, win }: { k: Brief; T: number | null; win: TimeWindow | null }) {
  const { t, rangeText } = useI18n();
  const rel = relation(k, win);
  return (
    <TaxonLink id={k.i} className={`card${k.x ? " extinct" : ""}${rel === "extinct" || rel === "future" ? " dim" : ""}`}>
      <div className="thumb">
        <Img file={k.m} width={250} glyph={glyphFor(k.r)} />
        {rel !== "unknown" && <span className={`when-tag ${RELATION_LABEL[rel][0]}`}>{t(RELATION_LABEL[rel][1])}</span>}
      </div>
      <div className="cbody">
        <div className="cname">{k.x ? "† " : ""}<SciName n={k} /></div>
        {k.c && <div className="ccommon">{k.c}</div>}
        <div className="cmeta">
          <RankTag rank={k.r} />
          {k.s ? ` · ${t("card.species", { count: k.s })}` : k.t ? ` · ${t("card.taxa", { count: k.t })}` : ""}
        </div>
        {k.a != null && <><div className="crange"><bdi>{rangeText(k)}</bdi></div><RangeBar n={k} T={T} /></>}
      </div>
    </TaxonLink>
  );
}
