import type { Brief, LocalEntry, LocalTime, Meta, SearchRow, Taxon, TimeData } from "./types";

const DATA = `${import.meta.env.BASE_URL}data/`;
const cache = new Map<string, Promise<unknown>>();

function getJSON<T>(path: string): Promise<T> {
  let p = cache.get(path);
  if (!p) {
    p = fetch(DATA + path).then(r => {
      if (!r.ok) throw new Error(`${r.status} ${path}`);
      return r.json();
    });
    p.catch(() => cache.delete(path));
    cache.set(path, p);
  }
  return p as Promise<T>;
}

export const loadMeta = () => getJSON<Meta>("meta.json");
export const loadTime = () => getJSON<TimeData>("time.json");

export interface LocalMeta {
  count: number;
  /** search shards: bucket count, and how many leading characters pick the bucket */
  buckets: number;
  prefix: number;
}

export const loadLocalMeta = (lang: string) => getJSON<LocalMeta>(`l/${lang}/meta.json`);
export const loadLocalTime = (lang: string) => getJSON<LocalTime>(`l/${lang}/time.json`);

/** Apply a localized entry (see scripts/i18n_build.py) to a brief: name, article and lead. */
export function localizeBrief<T extends Brief>(b: T, e: LocalEntry | undefined): T {
  if (!e) return b;
  const out: T = { ...b, lw: e.w ?? e.c };
  if (e.c != null) out.c = e.c || undefined;
  return out;
}

function localizeTaxon(n: Taxon, ov: Record<string, LocalEntry>): Taxon {
  const e = ov[n.i];
  const out = localizeBrief(n, e);
  if (e?.l) { out.l = e.l; out.ll = 1; }
  out.k = n.k.map(k => localizeBrief(k, ov[k.i]));
  return out;
}

/** Taxa are numbered in preorder and stored in fixed-size chunks; other languages overlay them. */
export async function getTaxon(id: number, lang = "en"): Promise<Taxon | undefined> {
  const meta = await loadMeta();
  const c = Math.floor(id / meta.chunk);
  const [chunk, ov] = await Promise.all([
    getJSON<Record<string, Taxon>>(`n/${c}.json`),
    lang === "en" ? null : getJSON<Record<string, LocalEntry>>(`l/${lang}/n/${c}.json`).catch(() => ({})),
  ]);
  const n = chunk[id];
  return n && ov ? localizeTaxon(n, ov) : n;
}

/** Ancestors from the root down to (and including) the taxon. */
export async function getLineage(id: number, lang = "en"): Promise<Taxon[]> {
  const out: Taxon[] = [];
  let cur = await getTaxon(id, lang);
  for (let guard = 0; cur && guard < 200; guard++) {
    out.unshift(cur);
    if (cur.p == null) break;
    cur = await getTaxon(cur.p, lang);
  }
  return out;
}

export function normalizeQuery(s: string): string {
  return s.toLowerCase().replace(/-/g, " ").replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Normalized search key for localized names; must match `search_key` in scripts/i18n_build.py.
 * Latin and Cyrillic scripts also drop diacritics so "cerf" finds "Cerf élaphe" and "ёж" = "еж".
 */
export function normalizeLocal(s: string, lang: string): string {
  let t = s.toLowerCase().normalize("NFKC").replace(/[-_]/g, " ");
  if (STRIP_MARKS.has(lang)) t = t.normalize("NFD").replace(/\p{M}/gu, "").normalize("NFC");
  return t.replace(/[^\p{L}\p{M}\p{N} ]/gu, "").replace(/\s+/g, " ").trim();
}
const STRIP_MARKS = new Set(["de", "es", "fr", "it", "pt", "ru", "tr", "vi"]);

/** Bucket of a localized key: 32-bit rolling hash of its first `prefix` code points. */
export function bucketOf(key: string, prefix: number, buckets: number): number {
  let h = 0;
  for (const ch of [...key].slice(0, prefix)) h = (h * 31 + ch.codePointAt(0)!) % 4294967296;
  return h % buckets;
}

/** Search English/scientific names, plus localized names for other languages. */
export async function search(query: string, lang = "en", limit = 25): Promise<SearchRow[]> {
  const [local, english] = await Promise.all([lang === "en" ? [] : searchLocal(query, lang, limit), searchEnglish(query, limit)]);
  const seen = new Set(local.map(r => r[1]));
  return [...local, ...english.filter(r => !seen.has(r[1]))].slice(0, limit);
}

async function searchLocal(query: string, lang: string, limit: number): Promise<SearchRow[]> {
  const q = normalizeLocal(query, lang);
  const meta = await loadLocalMeta(lang).catch(() => null);
  if (!meta || [...q].length < meta.prefix) return [];
  const rows = await getJSON<SearchRow[]>(`l/${lang}/s/${bucketOf(q, meta.prefix, meta.buckets)}.json`).catch(() => []);
  return prefixMatches(rows, q, limit);
}

/** Prefix search over the shard selected by the first two characters (rows are sorted by key). */
async function searchEnglish(query: string, limit: number): Promise<SearchRow[]> {
  const q = normalizeQuery(query);
  if (q.length < 2) return [];
  const meta = await loadMeta();
  const shard = q.slice(0, 2).padEnd(2, "_");
  if (!meta.shards.includes(shard)) return [];
  const rows = await getJSON<SearchRow[]>(`s/${shard}.json`);
  return prefixMatches(rows, q, limit);
}

function prefixMatches(rows: SearchRow[], q: string, limit: number): SearchRow[] {
  let lo = 0, hi = rows.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid][0] < q) lo = mid + 1; else hi = mid;
  }
  const seen = new Set<number>();
  const res: SearchRow[] = [];
  for (let i = lo; i < rows.length && rows[i][0].startsWith(q) && res.length < 400; i++) {
    if (!seen.has(rows[i][1])) { seen.add(rows[i][1]); res.push(rows[i]); }
  }
  res.sort((a, b) => Number(b[0] === q) - Number(a[0] === q) || b[5] - a[5]);
  return res.slice(0, limit);
}
