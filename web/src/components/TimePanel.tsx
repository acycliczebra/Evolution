import { Suspense, lazy } from "react";
import type { Brief, Milestone, Unit } from "../types";
import { useApp } from "../context";
import { useI18n } from "../i18n";
import type { MsgKey } from "../i18n/en";
import { MiniCard } from "./common";

interface Props {
  unit: string | null;
  /** Selected time (Ma); the globe shows the reconstruction nearest to it. */
  T: number | null;
  milestone: Milestone | null;
  milestones: Milestone[];
}

// three.js is large: load the globe only when a time period is opened
const Globe = lazy(() => import("./Globe").then(m => ({ default: m.Globe })));

const EARTH_STATS: [keyof Unit, MsgKey][] = [["o2", "stat.o2"], ["co2", "stat.co2"], ["temp", "stat.temp"], ["sea", "stat.sea"]];

function dedupe(list: Brief[]): Brief[] {
  const seen = new Set<number>();
  return list.filter(b => !seen.has(b.i) && (seen.add(b.i), true));
}

function MilestoneList({ items, big = false }: { items: Milestone[]; big?: boolean }) {
  const { selectMilestone } = useApp();
  const { fmtShort, milestone } = useI18n();
  return (
    <ul className={`mslist${big ? " big" : ""}`}>
      {items.map(m => {
        const lm = milestone(m);
        return (
          <li key={m.title} className={m.cat} onClick={() => selectMilestone(m)}>
            {big && <span className="when">{fmtShort(m.ma)}</span>}
            <b>{lm.title}</b>{!big && <> <span className="muted">{fmtShort(m.ma)}</span></>}<br />
            <small>{lm.desc}</small>
          </li>
        );
      })}
    </ul>
  );
}

export function TimePanel({ unit, T, milestone, milestones }: Props) {
  const { scale, selectUnit } = useApp();
  const i18n = useI18n();
  const { t, fmtShort, fmtMa, unitName } = i18n;
  const english = i18n.lang.code === "en";

  if (!unit) {
    return (
      <aside className="timepanel">
        <div className="uhead" style={{ "--c": "#6ee7b7" } as React.CSSProperties}>
          <div className="ulevel">{t("panel.overview")}</div>
          <h2>{t("panel.milestonesTitle")}</h2>
          <div className="udates">{t("panel.milestonesIntro")}</div>
        </div>
        <MilestoneList items={milestones} big />
      </aside>
    );
  }

  const base = scale.byName[unit];
  const u = i18n.unit(base);
  const path = scale.path(u.name);
  const kids = scale.children(u.name);
  const notesUnit = scale.notesFor(base);
  const notes = notesUnit && i18n.unit(notesUnit);
  const siblings = scale.units.filter(k => k.level === u.level).sort((p, q) => q.start - p.start);
  const si = siblings.indexOf(base);
  const prev = siblings[si - 1], next = siblings[si + 1];
  const inUnit = milestones.filter(m => m.ma <= u.start && m.ma >= u.end);
  const stats = EARTH_STATS.filter(([k]) => u[k]);
  const firsts = dedupe([...(u.firsts_curated || []), ...(u.firsts || [])]).slice(0, 18);
  const color = (c: string) => ({ "--c": c }) as React.CSSProperties;
  const ms = milestone && i18n.milestone(milestone);

  return (
    <aside className="timepanel">
      {ms && (
        <div className={`msbox ${ms.cat}`}>
          <div className="mslab">{t("panel.milestone", { time: fmtMa(ms.ma) })}</div>
          <h3>{ms.title}</h3>
          <p>{ms.desc}</p>
          {ms.taxon && <MiniCard b={ms.taxon} />}
          <a href={i18n.wikiUrl(ms.wiki, ms.lw)} target="_blank" rel="noopener">{t("panel.wikipediaLink", { title: ms.lw ?? ms.wiki })}</a>
        </div>
      )}
      <div className="upath">
        {path.map((p, i) => (
          <span key={p} style={{ display: "contents" }}>
            {i > 0 && <span>›</span>}
            <a onClick={() => selectUnit(p, true)} style={color(scale.byName[p].color)}>{unitName(p)}</a>
          </span>
        ))}
      </div>
      <div className="uhead" style={color(u.color)}>
        <div className="ulevel">{t(`level.${u.level}`)}</div>
        <h2>{unitName(u.name)}</h2>
        <div className="udates">
          {fmtMa(u.start)} → {u.end === 0 ? t("time.today") : fmtMa(u.end)}<br />
          <span className="muted">{t("panel.lasted", { duration: i18n.fmtDuration(u.start - u.end) })}</span>
        </div>
        <div className="unav">
          {prev ? <button onClick={() => selectUnit(prev.name, true)}>‹ {unitName(prev.name)}</button> : <span />}
          {next && <button onClick={() => selectUnit(next.name, true)}>{unitName(next.name)} ›</button>}
        </div>
      </div>
      <Suspense fallback={<div className="globe"><div className="globe-canvas loading" /></div>}>
        <Globe T={T ?? (u.start + u.end) / 2} />
      </Suspense>
      {(notes || stats.length > 0) && (
        <section>
          <h3>{t("panel.earth")}</h3>
          {notes && <p>{notes.earth}{notes.name !== u.name && <span className="muted"> ({unitName(notes.name)})</span>}</p>}
          {stats.length > 0 && (
            <div className="estats">
              {stats.map(([k, label]) => <div key={k}><small>{t(label)}</small><b>{u[k] as string}</b></div>)}
            </div>
          )}
        </section>
      )}
      <section>
        {u.desc && (
          <>
            <h3>{t("panel.about", { unit: unitName(u.name) })}</h3>
            <p lang={u.ld || english ? undefined : "en"} dir={u.ld || english ? undefined : "ltr"}>
              {u.desc}
              {!u.ld && !english && <span className="langlead" lang={i18n.lang.tag} dir="auto">{t("hero.englishLead")}</span>}
            </p>
          </>
        )}
        <a href={i18n.wikiUrl(u.wiki, u.lw)} target="_blank" rel="noopener">
          {u.desc ? t("panel.readMore") : t("panel.onWikipedia", { unit: unitName(u.name) })}
        </a>
      </section>
      {inUnit.length > 0 && <section><h3>{t("panel.milestones")}</h3><MilestoneList items={inUnit} /></section>}
      {!!u.life?.length && (
        <section><h3>{t("panel.iconic")}</h3><div className="minis">{u.life.map(b => <MiniCard key={b.i} b={b} />)}</div></section>
      )}
      {!!u.common?.length && (
        <section>
          <h3>{t("panel.diverse")} <span className="muted">{t("panel.diverseNote")}</span></h3>
          <div className="minis">{u.common.map(b => <MiniCard key={b.i} b={b} extra={` · ${t("panel.genera", { count: b.g })}`} />)}</div>
        </section>
      )}
      {firsts.length > 0 && (
        <section>
          <h3>{t("panel.firsts")}</h3>
          <div className="minis">{firsts.map(b => <MiniCard key={b.i} b={b} extra={b.a ? ` · ${t("panel.from", { time: fmtShort(b.a) })}` : ""} />)}</div>
        </section>
      )}
      {!!u.firstgenera?.length && (
        <section>
          <h3>{t("panel.firstGenera")}</h3>
          <div className="minis">{u.firstgenera.slice(0, 12).map(b => <MiniCard key={b.i} b={b} />)}</div>
        </section>
      )}
      {kids.length > 0 && (
        <section>
          <h3>{t("panel.subdivisions")}</h3>
          <div className="subunits">
            {kids.map(k => (
              <button key={k.name} style={color(k.color)} onClick={() => selectUnit(k.name, true)}>
                <b>{unitName(k.name)}</b><small><bdi>{fmtShort(k.start)} – {fmtShort(k.end)}</bdi></small>
              </button>
            ))}
          </div>
        </section>
      )}
      <section className="muted small">{t("panel.alive", { count: u.alive ?? 0 })}</section>
    </aside>
  );
}
