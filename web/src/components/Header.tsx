import { useEffect, useRef, useState } from "react";
import type { Meta, SearchRow } from "../types";
import { search } from "../data";
import { ITALIC_RANKS } from "../taxa";
import { useI18n } from "../i18n";
import { LanguageMenu } from "./LanguageMenu";

interface Props {
  meta: Meta;
  onPick: (id: number) => void;
  onHome: () => void;
}

export function Header({ onPick, onHome }: Props) {
  const { t, lang, rank } = useI18n();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchRow[] | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const seq = useRef(0);

  useEffect(() => {
    if (q.trim().length < 2) { setResults(null); return; }
    const mine = ++seq.current;
    const timer = setTimeout(async () => {
      const rows = await search(q, lang.code);
      if (mine === seq.current) setResults(rows);
    }, 120);
    return () => clearTimeout(timer);
  }, [q, lang.code]);

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
        <span><b>{t("app.title")}</b><small>{t("app.tagline")}</small></span>
      </a>
      <div className="search" ref={box}>
        <input
          type="search"
          value={q}
          placeholder={innerWidth < 720 ? t("search.placeholderShort") : t("search.placeholder")}
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
            {results.length === 0 && <div className="sr none">{t("search.none")}</div>}
            {results.map(([key, id, name, r, common, total]) => (
              <a key={`${key}-${id}`} className="sr" href={`#n=${id}`} onClick={e => { e.preventDefault(); pick(id); }}>
                <b>{ITALIC_RANKS.has(r) ? <i>{name}</i> : name}</b>
                {common && !name.toLowerCase().startsWith(common.toLowerCase()) && <> <span>{common}</span></>}
                <small>{rank(r)}{total > 1 ? ` · ${t("search.taxa", { count: total - 1 })}` : ""}</small>
              </a>
            ))}
          </div>
        )}
      </div>
      <LanguageMenu />
    </header>
  );
}
