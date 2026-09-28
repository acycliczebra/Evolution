import type { Meta, SearchRow, Taxon, TimeData } from "./types";

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

/** Taxa are numbered in preorder and stored in fixed-size chunks. */
export async function getTaxon(id: number): Promise<Taxon | undefined> {
  const meta = await loadMeta();
  const chunk = await getJSON<Record<string, Taxon>>(`n/${Math.floor(id / meta.chunk)}.json`);
  return chunk[id];
}

/** Ancestors from the root down to (and including) the taxon. */
export async function getLineage(id: number): Promise<Taxon[]> {
  const out: Taxon[] = [];
  let cur = await getTaxon(id);
  for (let guard = 0; cur && guard < 200; guard++) {
    out.unshift(cur);
    if (cur.p == null) break;
    cur = await getTaxon(cur.p);
  }
  return out;
}

export function normalizeQuery(s: string): string {
  return s.toLowerCase().replace(/-/g, " ").replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}

/** Prefix search over the shard selected by the first two characters (rows are sorted by key). */
export async function search(query: string, limit = 25): Promise<SearchRow[]> {
  const q = normalizeQuery(query);
  if (q.length < 2) return [];
  const meta = await loadMeta();
  const shard = q.slice(0, 2).padEnd(2, "_");
  if (!meta.shards.includes(shard)) return [];
  const rows = await getJSON<SearchRow[]>(`s/${shard}.json`);
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
