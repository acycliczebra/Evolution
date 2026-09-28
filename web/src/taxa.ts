import type { Brief } from "./types";

export const RANK_GLYPH: Record<string, string> = {
  species: "🔹", genus: "🔸", family: "🟢", order: "🟣", class: "🔷", phylum: "⬢", kingdom: "👑", domain: "🌐", root: "🌳",
};
export const glyphFor = (rank?: string) => (rank && RANK_GLYPH[rank]) || "🧬";

/** Ranks whose names are italicised by convention. */
export const ITALIC_RANKS = new Set([
  "genus", "subgenus", "species", "subspecies", "variety", "form", "section", "subsection", "series",
  "species group", "species complex", "ichnogenus", "ichnospecies", "oogenus",
]);
export const isItalic = (n: Pick<Brief, "r">) => !!n.r && ITALIC_RANKS.has(n.r);

export const MAJOR_RANKS = new Set(["root", "domain", "kingdom", "phylum", "division", "class", "order", "family", "genus", "species"]);

export const INCERTAE = "incertae sedis";
export const isIncertae = (n: Pick<Brief, "r">) => n.r === INCERTAE;

/** Placeholder groups for members of unknown placement ("Unplaced taxa", "Unassigned", …), whatever rank slot they sit in. */
const UNPLACED_RE = /^(unplaced|unassigned|uncertain)( taxa)?$/i;
/** Rank to display: placeholders read "uncertain placement" like incertae sedis. */
export const rankOf = (n: Pick<Brief, "r" | "n">) => (UNPLACED_RE.test(n.n.trim()) ? INCERTAE : n.r);
export const isUncertainPlacement = (n: Pick<Brief, "r" | "n">) => rankOf(n) === INCERTAE;
/** Subgroups hidden unless "Show uncertain" is on: uncertain placement and informal groups. */
export const isUncertainGroup = (n: Pick<Brief, "r" | "n">) => isUncertainPlacement(n) || n.r === "informal group";

/** Colour per major rank (and its sub/super/infra variants), used for rank tags. */
const RANK_COLOR: Record<string, string> = {
  root: "#6ee7b7", domain: "#f472b6", kingdom: "#fb923c", phylum: "#facc15", division: "#facc15",
  class: "#4ade80", order: "#22d3ee", family: "#60a5fa", tribe: "#818cf8", genus: "#a78bfa",
  species: "#e879f9", variety: "#e879f9", form: "#e879f9",
};
export function rankColor(rank?: string): string | undefined {
  if (!rank) return undefined;
  const base = rank.replace(/^(super|sub|infra|parv|magn|grand|mir|micro|nano)/, "");
  return RANK_COLOR[rank] ?? RANK_COLOR[base];
}

/** Conservation status colours; labels are the `status.<code>` messages. */
export const STATUS: Record<string, string> = {
  EX: "#5b1a1a", EW: "#6d2a44", CR: "#cc3333", EN: "#cc6633", VU: "#cc9900", NT: "#7fa33a", LC: "#3a8f5a",
  DD: "#777", DOM: "#4a6fa5", FOSSIL: "#7a5c3e", G5: "#3a8f5a", NE: "#666", PE: "#8a3030",
};
