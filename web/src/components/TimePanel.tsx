import type { Brief, Milestone, Unit } from "../types";
import { fmtDuration, fmtMa, fmtShort } from "../time";
import { wikiUrl, fmtInt } from "../taxa";
import { useApp } from "../context";
import { Img } from "./Img";
import { MiniCard } from "./common";

interface Props {
  unit: string | null;
  milestone: Milestone | null;
  milestones: Milestone[];
}

const EARTH_STATS: [keyof Unit, string][] = [["o2", "Atmospheric O₂"], ["co2", "Atmospheric CO₂"], ["temp", "Mean surface temp."], ["sea", "Sea level"]];

function dedupe(list: Brief[]): Brief[] {
  const seen = new Set<number>();
  return list.filter(b => !seen.has(b.i) && (seen.add(b.i), true));
}

function MilestoneList({ items, big = false }: { items: Milestone[]; big?: boolean }) {
  const { selectMilestone } = useApp();
  return (
    <ul className={`mslist${big ? " big" : ""}`}>
      {items.map(m => (
        <li key={m.title} className={m.cat} onClick={() => selectMilestone(m)}>
          {big && <span className="when">{fmtShort(m.ma)}</span>}
          <b>{m.title}</b>{!big && <> <span className="muted">{fmtShort(m.ma)}</span></>}<br />
          <small>{m.desc}</small>
        </li>
      ))}
    </ul>
  );
}

export function TimePanel({ unit, milestone, milestones }: Props) {
  const { scale, selectUnit } = useApp();

  if (!unit) {
    return (
      <aside className="timepanel">
        <div className="uhead" style={{ "--c": "#6ee7b7" } as React.CSSProperties}>
          <div className="ulevel">overview</div>
          <h2>Milestones of evolution</h2>
          <div className="udates">From the formation of Earth to today. Click one, or click any band of the timeline above.</div>
        </div>
        <MilestoneList items={milestones} big />
      </aside>
    );
  }

  const u = scale.byName[unit];
  const path = scale.path(u.name);
  const kids = scale.children(u.name);
  const mapUnit = scale.mapFor(u);
  const notes = scale.notesFor(u);
  const siblings = scale.units.filter(k => k.level === u.level).sort((p, q) => q.start - p.start);
  const si = siblings.indexOf(u);
  const prev = siblings[si - 1], next = siblings[si + 1];
  const inUnit = milestones.filter(m => m.ma <= u.start && m.ma >= u.end);
  const stats = EARTH_STATS.filter(([k]) => u[k]);
  const firsts = dedupe([...(u.firsts_curated || []), ...(u.firsts || [])]).slice(0, 18);
  const color = (c: string) => ({ "--c": c }) as React.CSSProperties;

  return (
    <aside className="timepanel">
      {milestone && (
        <div className={`msbox ${milestone.cat}`}>
          <div className="mslab">Milestone · {fmtMa(milestone.ma)}</div>
          <h3>{milestone.title}</h3>
          <p>{milestone.desc}</p>
          {milestone.taxon && <MiniCard b={milestone.taxon} />}
          <a href={wikiUrl(milestone.wiki)} target="_blank" rel="noopener">Wikipedia: {milestone.wiki} ↗</a>
        </div>
      )}
      <div className="upath">
        {path.map((p, i) => (
          <span key={p} style={{ display: "contents" }}>
            {i > 0 && <span>›</span>}
            <a onClick={() => selectUnit(p, true)} style={color(scale.byName[p].color)}>{p}</a>
          </span>
        ))}
      </div>
      <div className="uhead" style={color(u.color)}>
        <div className="ulevel">{u.level}</div>
        <h2>{u.name}</h2>
        <div className="udates">
          {fmtMa(u.start)} → {u.end === 0 ? "today" : fmtMa(u.end)}<br />
          <span className="muted">Lasted {fmtDuration(u.start - u.end)}</span>
        </div>
        <div className="unav">
          {prev ? <button onClick={() => selectUnit(prev.name, true)}>‹ {prev.name}</button> : <span />}
          {next && <button onClick={() => selectUnit(next.name, true)}>{next.name} ›</button>}
        </div>
      </div>
      {mapUnit?.map && (
        <figure className="umap">
          <Img file={mapUnit.map} width={960} glyph="🌍" />
          <figcaption>
            {mapUnit.mapcap}
            {mapUnit !== u && <span className="muted"> (map from the {mapUnit.name})</span>}
          </figcaption>
        </figure>
      )}
      {(notes || stats.length > 0) && (
        <section>
          <h3>🌍 What Earth looked like</h3>
          {notes && <p>{notes.earth}{notes !== u && <span className="muted"> ({notes.name})</span>}</p>}
          {stats.length > 0 && (
            <div className="estats">
              {stats.map(([k, label]) => <div key={k}><small>{label}</small><b>{u[k] as string}</b></div>)}
            </div>
          )}
        </section>
      )}
      <section>
        {u.desc && <><h3>📜 About the {u.name}</h3><p>{u.desc}</p></>}
        <a href={wikiUrl(u.wiki)} target="_blank" rel="noopener">{u.desc ? "Read more on Wikipedia ↗" : `${u.name} on Wikipedia ↗`}</a>
      </section>
      {inUnit.length > 0 && <section><h3>⭐ Milestones</h3><MilestoneList items={inUnit} /></section>}
      {!!u.life?.length && (
        <section><h3>🦕 Iconic life</h3><div className="minis">{u.life.map(b => <MiniCard key={b.i} b={b} />)}</div></section>
      )}
      {!!u.common?.length && (
        <section>
          <h3>📈 Most diverse groups <span className="muted">by number of fossil genera on Wikipedia alive at this time</span></h3>
          <div className="minis">{u.common.map(b => <MiniCard key={b.i} b={b} extra={` · ${b.g} genera`} />)}</div>
        </section>
      )}
      {firsts.length > 0 && (
        <section>
          <h3>🌱 First appeared</h3>
          <div className="minis">{firsts.map(b => <MiniCard key={b.i} b={b} extra={b.a ? ` · from ${fmtShort(b.a)}` : ""} />)}</div>
        </section>
      )}
      {!!u.firstgenera?.length && (
        <section>
          <h3>🔎 Genera first recorded</h3>
          <div className="minis">{u.firstgenera.slice(0, 12).map(b => <MiniCard key={b.i} b={b} />)}</div>
        </section>
      )}
      {kids.length > 0 && (
        <section>
          <h3>⏳ Subdivisions</h3>
          <div className="subunits">
            {kids.map(k => (
              <button key={k.name} style={color(k.color)} onClick={() => selectUnit(k.name, true)}>
                <b>{k.name}</b><small>{fmtShort(k.start)} – {fmtShort(k.end)}</small>
              </button>
            ))}
          </div>
        </section>
      )}
      <section className="muted small">{fmtInt(u.alive)} dated genera in the Wikipedia data were alive during this interval.</section>
    </aside>
  );
}
