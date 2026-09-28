/** Compact taxon summary, as stored in child lists and search/time data (see scripts/build.py). */
export interface Brief {
  /** id (preorder index) */
  i: number;
  /** scientific name */
  n: string;
  /** rank */
  r?: string;
  /** common name */
  c?: string;
  /** image file name (own or representative) */
  m?: string;
  /** extinct */
  x?: 1;
  /** range start / end, Ma */
  a?: number;
  b?: number;
  /** species count below */
  s?: number;
  /** number of taxa below */
  t?: number;
  /** title of the article on the current language's Wikipedia (set by localization) */
  lw?: string;
}

/** Full taxon record from a data/n/<chunk>.json file. */
export interface Taxon extends Brief {
  p: number | null;
  k: Brief[];
  kmore?: number;
  fr?: string;
  au?: string;
  sd?: string;
  cap?: string;
  st?: string;
  l?: string;
  w?: string;
  own?: 1;
  /** the lead `l` comes from the current language's Wikipedia (not English) */
  ll?: 1;
}

/**
 * Localized taxon data from data/l/<lang>/n/<chunk>.json. `c` is the local article's title as a
 * common name ("" when that title is just the scientific name); `w` the article title when it
 * differs from `c`; `l` its lead.
 */
export interface LocalEntry {
  c?: string;
  w?: string;
  l?: string;
}

/** Localized time scale and curated content, data/l/<lang>/time.json. */
export interface LocalTime {
  units: Record<string, { n?: string; d?: string; w?: string; earth?: string; o2?: string; co2?: string; temp?: string; sea?: string }>;
  milestones: Record<string, { title?: string; desc?: string; w?: string }>;
  /** localized entries for every taxon referenced by time.json */
  names: Record<string, LocalEntry>;
  globe: Record<string, string>;
  ranks: Record<string, string>;
  wiki: string;
}

export type UnitLevel = "eon" | "era" | "period" | "epoch" | "age";

export interface Unit {
  name: string;
  level: UnitLevel;
  parent: string | null;
  start: number;
  end: number;
  color: string;
  wiki: string;
  map?: string;
  mapcap?: string;
  desc?: string;
  earth?: string;
  o2?: string;
  co2?: string;
  temp?: string;
  sea?: string;
  life?: Brief[];
  common?: (Brief & { g: number })[];
  firsts?: Brief[];
  firstgenera?: Brief[];
  firsts_curated?: Brief[];
  alive?: number;
}

export type MilestoneCategory = "life" | "extinction" | "earth";

export interface Milestone {
  ma: number;
  title: string;
  desc: string;
  wiki: string;
  cat: MilestoneCategory;
  taxon?: Brief;
}

export interface Meta {
  chunk: number;
  count: number;
  species: number;
  shards: string[];
  dump: string[];
}

export interface TimeData {
  units: Unit[];
  milestones: Milestone[];
}

/** Search index row: [key, id, name, rank, common, total] */
export type SearchRow = [string, number, string, string, string, number];

export type Filter = "all" | "living" | "extinct" | "time";
export type View = "cards" | "tree";
