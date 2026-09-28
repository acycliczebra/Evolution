# 🌳 Tree of Life — 4.5 billion years of evolution

**Live site: https://acycliczebra.github.io/Evolution/**

An interactive, static explorer of the tree of life and the geologic time scale, built by
scanning **every page of the English Wikipedia dump** (2026-09-01, 25.9 M pages) and extracting
every taxobox.

* **544,356 taxa / 392,921 species** (extinct and extant), from domains down to subspecies
* Every taxon shows its picture, scientific & common name, rank, authority, conservation status,
  temporal (fossil) range, summary and a link to its Wikipedia article
* Drill down via breadcrumbs, subgroup cards or an expandable tree diagram; search any name
* A zoomable **geologic time strip** — eon, era, period, epoch and age in official ICS colours —
  with **54 evolutionary milestones**
* Click any time unit (or press *Journey through time*) to see what Earth looked like
  (paleogeographic maps), a description, the iconic and most diverse life, and what first appeared
* Filter any group to the members **alive at the selected time**

## Data dump

`data/` contains the organized dump:

| file | content |
|---|---|
| `taxa-NN.jsonl.gz` | one taxon per line, preorder over the tree (parents before children) |
| `timescale.json` | geologic units (eon → age) with dates, maps, descriptions and per-unit life, plus milestones |

Taxon record fields:

```json
{"id": 354124, "name": "Cavia porcellus", "rank": "species", "parent_id": 354123,
 "lineage": ["Life", "Eukaryota", "…", "Caviidae", "Caviinae", "Cavia"],
 "extinct": false, "range_end_ma": 0,
 "image": "George the amazing guinea pig.jpg", "common_name": "Guinea pig",
 "authority": "(Linnaeus, 1758)", "conservation_status": "DOM",
 "short_description": "Domesticated rodent from South America", "summary": "The guinea pig …",
 "wikipedia": "Guinea pig", "species_count": 1, "descendant_count": 0}
```

`image` is a Wikimedia Commons/Wikipedia file name
(`https://en.wikipedia.org/wiki/Special:FilePath/<image>`).

## How it is built

```
python scripts/download.py <dump url> enwiki.xml.bz2          # parallel, resumable download
python scripts/extract.py enwiki.xml.bz2 enwiki-index.txt.bz2 out/ 30   # ~10 min on 30 cores
python scripts/build.py out/ .                                 # ~3 min → data/ and docs/data/
```

1. **extract.py** streams the *multistream* dump in parallel and pulls out
   `Template:Taxonomy/*` pages (the backbone that Wikipedia's automatic taxoboxes use),
   every article containing a `Taxobox`, `Automatic taxobox`, `Speciesbox`, `Subspeciesbox`,
   `Infraspeciesbox`, `Virusbox`, `Ichnobox` or `Oobox`, all `Infobox geologic timespan`s,
   and redirects.
2. **build.py** resolves the taxonomy templates into a tree (following `same as`, `/skip` and
   `/?` variants), attaches articles to their taxa, places Speciesbox/manual-taxobox species
   under their genus, parses fossil ranges into millions of years, derives extinct/extant
   status and ranges bottom-up, and computes for every geologic unit the most diverse groups
   (by number of dated genera alive) and first appearances.
3. **curated.py** holds the ICS time scale skeleton and colours, per-unit notes on Earth's
   geography/climate and iconic life, and the milestones. Dates and paleomaps from Wikipedia's
   period articles override the skeleton when present.

The site (`docs/`) is plain HTML/CSS/JS plus D3; data is lazy-loaded in 1,000-taxon chunks and
the search index is sharded by prefix. Images are hot-linked from Wikimedia Commons.

Text and images © Wikipedia / Wikimedia Commons contributors, CC BY-SA 4.0.
