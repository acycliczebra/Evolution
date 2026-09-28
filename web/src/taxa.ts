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

export const STATUS: Record<string, [string, string]> = {
  EX: ["Extinct", "#5b1a1a"], EW: ["Extinct in the wild", "#6d2a44"], CR: ["Critically endangered", "#cc3333"],
  EN: ["Endangered", "#cc6633"], VU: ["Vulnerable", "#cc9900"], NT: ["Near threatened", "#7fa33a"],
  LC: ["Least concern", "#3a8f5a"], DD: ["Data deficient", "#777"], DOM: ["Domesticated", "#4a6fa5"],
  FOSSIL: ["Fossil", "#7a5c3e"], G5: ["Secure (NatureServe)", "#3a8f5a"], NE: ["Not evaluated", "#666"], PE: ["Possibly extinct", "#8a3030"],
};

export const fmtInt = (n?: number) => (n ?? 0).toLocaleString("en-US");

export const wikiUrl = (title: string) =>
  "https://en.wikipedia.org/wiki/" +
  encodeURIComponent(title.replace(/ /g, "_")).replace(/%2F/g, "/").replace(/%3A/g, ":");
