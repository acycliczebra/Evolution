import type { Brief } from "../types";
import { glyphFor, isIncertae, isItalic, rankColor } from "../taxa";
import { useApp } from "../context";
import { Img } from "./Img";

/** Small rank indicator ("phylum", "genus", …); incertae sedis is flagged as a placement note, not a rank. */
export function RankTag({ rank, big = false }: { rank?: string; big?: boolean }) {
  if (!rank) return null;
  if (rank === "incertae sedis") {
    return <span className={`ranktag incertae${big ? " big" : ""}`} title="Incertae sedis: members whose placement within the parent group is uncertain">uncertain placement</span>;
  }
  const c = rankColor(rank);
  return (
    <span className={`ranktag${c ? " major" : ""}${big ? " big" : ""}`} style={c ? ({ "--rc": c } as React.CSSProperties) : undefined}>
      {rank}
    </span>
  );
}

/** Display name; incertae sedis groups read "Incertae sedis" with their parent shown in the path. */
export function displayName(n: Pick<Brief, "n" | "r">): string {
  return isIncertae(n) ? "Incertae sedis" : n.n;
}

/** Scientific name, italicised for genus and below. */
export function SciName({ n }: { n: Pick<Brief, "n" | "r"> }) {
  if (isIncertae(n)) return <i className="incertae-name">{displayName(n)}</i>;
  return isItalic(n) ? <i>{n.n}</i> : <>{n.n}</>;
}

/** In-app link to a taxon (keeps a real href so it can be opened in a new tab). */
export function TaxonLink({ id, className, title, children }: { id: number; className?: string; title?: string; children: React.ReactNode }) {
  const { go } = useApp();
  return (
    <a
      className={className}
      title={title}
      href={`#n=${id}`}
      onClick={e => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        go(id);
      }}
    >
      {children}
    </a>
  );
}

/** Small image + name tile used in the time panel. */
export function MiniCard({ b, extra = "" }: { b: Brief; extra?: string }) {
  return (
    <TaxonLink id={b.i} className={`mini ${b.x ? "extinct" : ""}`} title={b.c || b.n}>
      <Img file={b.m} width={120} glyph={glyphFor(b.r)} />
      <span>
        <b>{b.x ? "† " : ""}<SciName n={b} /></b>
        {b.c && <small>{b.c}</small>}
        <small className="muted">{b.r || ""}{extra}</small>
      </span>
    </TaxonLink>
  );
}
