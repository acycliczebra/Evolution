/**
 * Localization: UI messages, number/time formatting and localized data (see scripts/i18n_build.py).
 *
 * The URL (#n=…&u=…) always uses the English/scientific identifiers, so switching the language
 * keeps the open taxon and time; only what is displayed changes. The choice is kept in localStorage,
 * together with the order in which languages were picked (most recent first in the menu).
 */
import { createContext, Fragment, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { en, type MsgKey, type Messages } from "./en";
import type { Brief, LocalTime, Milestone, Unit } from "../types";
import { loadLocalTime, localizeBrief } from "../data";

export interface Language {
  code: string;
  /** name in the language itself */
  native: string;
  /** English name (the menu is alphabetical by this) */
  english: string;
  /** BCP 47 tag for Intl formatting and <html lang> */
  tag: string;
  rtl?: boolean;
  /** extra web font for this script, loaded when the language is first selected (see styles.css) */
  font?: string;
}

export const LANGUAGES: Language[] = ([
  { code: "en", native: "English", english: "English", tag: "en" },
  { code: "fr", native: "Français", english: "French", tag: "fr" },
  { code: "hi", native: "हिन्दी", english: "Hindi", tag: "hi" },
  { code: "it", native: "Italiano", english: "Italian", tag: "it" },
  { code: "ja", native: "日本語", english: "Japanese", tag: "ja" },
  { code: "ko", native: "한국어", english: "Korean", tag: "ko" },
  { code: "fa", native: "فارسی", english: "Persian", tag: "fa", rtl: true,
    font: "https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;500;600;700&display=swap" },
  { code: "pt", native: "Português", english: "Portuguese", tag: "pt-BR" },
  { code: "ru", native: "Русский", english: "Russian", tag: "ru" },
  { code: "es", native: "Español", english: "Spanish", tag: "es" },
  { code: "tr", native: "Türkçe", english: "Turkish", tag: "tr" },
  { code: "vi", native: "Tiếng Việt", english: "Vietnamese", tag: "vi" },
] as Language[]).sort((a, b) => a.english.localeCompare(b.english, "en"));

const BY_CODE = Object.fromEntries(LANGUAGES.map(l => [l.code, l]));
const STORE_LANG = "tol.lang";
const STORE_RECENT = "tol.langRecent";

const catalogs = import.meta.glob<{ default: Messages }>("./*.json");

function readStore(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function writeStore(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* private mode */ }
}

function initialLanguage(): string {
  const saved = readStore(STORE_LANG);
  if (saved && BY_CODE[saved]) return saved;
  for (const tag of navigator.languages ?? [navigator.language]) {
    const code = tag.toLowerCase().split("-")[0];
    if (BY_CODE[code]) return code;
  }
  return "en";
}

function readRecent(): string[] {
  try {
    const v = JSON.parse(readStore(STORE_RECENT) || "[]");
    return Array.isArray(v) ? v.filter((c): c is string => typeof c === "string" && !!BY_CODE[c]) : [];
  } catch { return []; }
}

export type Vars = Record<string, ReactNode>;

export interface I18n {
  lang: Language;
  /** Languages for the menu: most recently picked first, then the rest alphabetically. */
  menu: Language[];
  setLang: (code: string) => void;
  /** Message as a string (placeholders filled with stringified values). */
  t: (key: MsgKey, vars?: Record<string, string | number>) => string;
  /** Message with React nodes in placeholders. */
  tn: (key: MsgKey, vars: Vars) => ReactNode;
  fmtInt: (n?: number) => string;
  fmtNum: (n: number, maxFrac?: number) => string;
  /** "66 million years ago" */
  fmtMa: (ma: number | undefined | null) => string;
  /** "66 Ma" */
  fmtShort: (ma: number | undefined | null) => string;
  /** "79 million years" */
  fmtDuration: (ma: number) => string;
  /** "66 Ma – present", "Extant", … */
  rangeText: (n: Brief) => string;
  rank: (r?: string) => string;
  status: (code: string) => string;
  /** Display name of a geologic unit (units are identified by their English name). */
  unitName: (name: string) => string;
  /** A unit with localized description, notes and Wikipedia title (`lw`). */
  unit: (u: Unit) => Unit & { lw?: string; ld?: 1 };
  milestone: (m: Milestone) => Milestone & { lw?: string };
  /** A brief from time.json with its localized name. */
  brief: <T extends Brief>(b: T) => T;
  globeLabel: (label: string) => string;
  /** Link to the local article when there is one, else to English Wikipedia. */
  wikiUrl: (english: string, local?: string) => string;
  /** Localized Wikipedia name, e.g. "Wikipedia en français". */
  wikiName: string;
}

export function wikiLink(host: string, title: string): string {
  return `https://${host}.wikipedia.org/wiki/` +
    encodeURIComponent(title.replace(/ /g, "_")).replace(/%2F/g, "/").replace(/%3A/g, ":");
}

const I18nContext = createContext<I18n | null>(null);

export function useI18n(): I18n {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n outside I18nProvider");
  return ctx;
}

const PLACEHOLDER = /\{(\w+)\}/g;

export function I18nProvider({ children }: { children: ReactNode }) {
  const [code, setCode] = useState(initialLanguage);
  const [recent, setRecent] = useState(readRecent);
  // the catalog in use; the displayed language switches only once its catalog has loaded
  const [cat, setCat] = useState<{ code: string; msgs: Messages; loc: LocalTime | null } | null>(
    code === "en" ? { code, msgs: {}, loc: null } : null,
  );
  const lang = BY_CODE[cat?.code ?? code];

  useEffect(() => {
    let live = true;
    const load = catalogs[`./${code}.json`];
    if (code === "en" || !load) { setCat({ code, msgs: {}, loc: null }); return; }
    Promise.all([load().then(m => m.default).catch(() => ({})), loadLocalTime(code).catch(() => null)])
      .then(([msgs, loc]) => { if (live) setCat({ code, msgs, loc }); });
    return () => { live = false; };
  }, [code]);

  useEffect(() => {
    // the layout stays left-to-right in every language; right-to-left text sets its own direction (styles.css)
    document.documentElement.lang = lang.tag;
    if (lang.font && !document.querySelector(`link[href="${lang.font}"]`)) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = lang.font;
      document.head.appendChild(link);
    }
  }, [lang]);

  const setLang = useCallback((next: string) => {
    if (!BY_CODE[next]) return;
    setCode(next);
    writeStore(STORE_LANG, next);
    setRecent(r => {
      const upd = [next, ...r.filter(c => c !== next)];
      writeStore(STORE_RECENT, JSON.stringify(upd));
      return upd;
    });
  }, []);

  const value = useMemo<I18n>(() => {
    const msgs = cat?.msgs ?? {};
    const plural = new Intl.PluralRules(lang.tag);
    const nf = new Intl.NumberFormat(lang.tag);
    const raw = (key: MsgKey, count: unknown): string => {
      if (typeof count === "number") {
        const v = msgs[`${key}_${plural.select(count)}`];
        if (v) return v;
      }
      return msgs[key] ?? en[key] ?? key;
    };
    const fmtVar = (v: unknown) => (typeof v === "number" ? nf.format(v) : String(v));
    const t = (key: MsgKey, vars?: Record<string, string | number>) =>
      raw(key, vars?.count).replace(PLACEHOLDER, (m, k) => (vars && k in vars ? fmtVar(vars[k]) : m));
    const tn = (key: MsgKey, vars: Vars) => {
      const s = raw(key, vars.count);
      const out: ReactNode[] = [];
      let last = 0, i = 0;
      for (const m of s.matchAll(PLACEHOLDER)) {
        out.push(s.slice(last, m.index));
        const v = vars[m[1]];
        out.push(<Fragment key={i++}>{typeof v === "number" ? nf.format(v) : v ?? m[0]}</Fragment>);
        last = m.index! + m[0].length;
      }
      out.push(s.slice(last));
      return <>{out}</>;
    };
    const menu = [...recent.map(c => BY_CODE[c]), ...LANGUAGES.filter(l => !recent.includes(l.code))];
    const loc = cat?.loc ?? null;
    const nfs = new Map<number, Intl.NumberFormat>();
    const fmtNum = (n: number, maxFrac = 2) => {
      let f = nfs.get(maxFrac);
      if (!f) nfs.set(maxFrac, (f = new Intl.NumberFormat(lang.tag, { maximumFractionDigits: maxFrac })));
      return f.format(n);
    };
    const num = (v: number) => fmtNum(v, 2);
    const fmtShort = (ma: number | undefined | null) => {
      if (ma == null) return "?";
      if (ma === 0) return num(0);
      if (ma >= 1000) return t("time.Ga", { n: num(+(ma / 1000).toFixed(2)) });
      if (ma >= 1) return t("time.Ma", { n: num(+ma.toFixed(ma < 10 ? 2 : 1)) });
      if (ma >= 0.001) return t("time.ka", { n: num(+(ma * 1000).toFixed(1)) });
      return t("time.yr", { n: num(Math.round(ma * 1e6)) });
    };
    const fmtMa = (ma: number | undefined | null) => {
      if (ma == null) return "?";
      if (ma === 0) return t("time.present");
      if (ma >= 1000) return t("time.gyaAgo", { n: num(+(ma / 1000).toFixed(2)) });
      if (ma >= 1) return t("time.myaAgo", { n: num(+ma.toFixed(ma < 10 ? 2 : 1)) });
      const ky = ma * 1000;
      if (ky >= 1) return t("time.kyaAgo", { n: num(+ky.toFixed(ky < 10 ? 1 : 0)) });
      return t("time.yaAgo", { n: num(Math.round(ma * 1e6)) });
    };
    const fmtDuration = (ma: number) => {
      if (ma >= 1000) return t("time.gy", { n: num(+(ma / 1000).toFixed(2)) });
      if (ma >= 1) return t("time.my", { n: num(+ma.toFixed(ma < 10 ? 2 : 1)) });
      if (ma >= 0.001) return t("time.ky", { n: num(+(ma * 1000).toFixed(1)) });
      return t("time.y", { n: num(Math.round(ma * 1e6)) });
    };
    const host = lang.code;
    const wikiUrl = (english: string, local?: string) => (local ? wikiLink(host, local) : wikiLink("en", english));
    return {
      lang, menu, setLang, t, tn,
      fmtInt: n => nf.format(n ?? 0),
      fmtNum, fmtMa, fmtShort, fmtDuration,
      rangeText: n => {
        if (n.a == null) return n.x ? t("range.unknownExtinct") : t("range.extant");
        const b = n.b ?? 0;
        if (!n.x && b === 0) return t("range.toPresent", { start: fmtShort(n.a) });
        return `${fmtShort(n.a)} – ${fmtShort(b)}`;
      },
      rank: r => (r ? loc?.ranks[r] ?? r : ""),
      status: c => t(`status.${c}` as MsgKey),
      unitName: name => loc?.units[name]?.n ?? name,
      unit: u => {
        const l = loc?.units[u.name];
        if (!l) return u;
        return {
          ...u, desc: l.d ?? u.desc, ld: l.d ? 1 : undefined, lw: l.w, earth: l.earth ?? u.earth,
          o2: l.o2 ?? u.o2, co2: l.co2 ?? u.co2, temp: l.temp ?? u.temp, sea: l.sea ?? u.sea,
        };
      },
      milestone: m => {
        const l = loc?.milestones[m.title];
        const taxon = m.taxon && localizeBrief(m.taxon, loc?.names[m.taxon.i]);
        return l ? { ...m, title: l.title ?? m.title, desc: l.desc ?? m.desc, lw: l.w, taxon } : { ...m, taxon };
      },
      brief: b => localizeBrief(b, loc?.names[b.i]),
      globeLabel: label => loc?.globe[label] ?? label,
      wikiUrl,
      wikiName: t("footer.wikiName"),
    };
  }, [lang, cat, recent, setLang]);

  // hold rendering until the catalog is in, so English never flashes before the translation
  if (!cat) return null;
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
