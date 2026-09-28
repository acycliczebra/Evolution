import { useEffect, useRef, useState } from "react";
import type { Meta, SearchRow } from "../types";
import { search } from "../data";
import { ITALIC_RANKS, fmtInt } from "../taxa";

interface Props {
  meta: Meta;
  onPick: (id: number) => void;
  onHome: () => void;
}

export function Header({ meta, onPick, onHome }: Props) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchRow[] | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const seq = useRef(0);

  useEffect(() => {
    if (q.trim().length < 2) { setResults(null); return; }
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      const rows = await search(q);
      if (mine === seq.current) setResults(rows);
    }, 120);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setResults(null); };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);

  const pick = (id: number) => { setResults(null); setQ(""); onPick(id); };

  return (
    <header className="top">
      <a className="brand" href="#" onClick={e => { e.preventDefault(); onHome(); }}>
        <span className="logo">🌳</span>
        <span><b>Tree of Life</b><small>4.5 billion years of evolution</small></span>
      </a>
      <div className="search" ref={box}>
        <input
          type="search"
          value={q}
          placeholder="Search any organism — e.g. guinea pig, Tyrannosaurus, oak…"
          autoComplete="off"
          spellCheck={false}
          onChange={e => setQ(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter" && results?.length) pick(results[0][1]);
            if (e.key === "Escape") setResults(null);
          }}
        />
        {results && (
          <div className="search-results">
            {results.length === 0 && <div className="sr none">No matches</div>}
            {results.map(([key, id, name, rank, common, total]) => (
              <a key={`${key}-${id}`} className="sr" href={`#n=${id}`} onClick={e => { e.preventDefault(); pick(id); }}>
                <b>{ITALIC_RANKS.has(rank) ? <i>{name}</i> : name}</b>
                {common && <> <span>{common}</span></>}
                <small>{rank}{total > 1 ? ` · ${fmtInt(total - 1)} taxa` : ""}</small>
              </a>
            ))}
          </div>
        )}
      </div>
      <div className="stats"><b>{fmtInt(meta.count)}</b> taxa<br /><b>{fmtInt(meta.species)}</b> species</div>
    </header>
  );
}
