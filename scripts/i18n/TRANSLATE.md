# Translation brief (Tree of Life site)

The site (a tree-of-life + geologic time explorer built from Wikipedia) is being localized.
Two English source files need translating into your assigned language(s):

1. `D:/Evolution/web/src/i18n/en.ts` — UI strings (the `en` object, ~170 keys).
   Write `D:/Evolution/web/src/i18n/<lang>.json`: a flat JSON object with the SAME keys and translated values.
2. `D:/Evolution/scripts/i18n/content.en.json` — curated content: geologic unit names (`unitNames`),
   per-unit notes on Earth (`units`: earth/o2/co2/temp/sea), evolutionary milestones (`milestones`:
   keyed by English title, each with translated `title` and `desc`), globe map labels (`globeLabels`),
   and taxonomic rank names (`ranks`).
   Write `D:/Evolution/scripts/i18n/content.<lang>.json` with the SAME structure and keys (keys stay
   English, only values are translated).

Rules
- Keep every `{placeholder}` exactly as-is (same names), but move it wherever the grammar needs.
  Never translate placeholder names. Keep emoji, "†", "↗", "▲", "·", "→" and "…" as in the source.
- Plurals: a key whose text contains `{count}` may get plural variants using Intl.PluralRules
  categories for your language, e.g. `"hero.species_one"`, `"hero.species_few"`, `"hero.species_many"`,
  `"hero.species_other"`; always also keep the bare key (used as fallback). Only add variants where
  your language needs them (e.g. Russian one/few/many/other; languages like Chinese/Japanese/Korean
  need none).
- `{unit}` is a geologic unit name (e.g. "Cretaceous"), `{time}` a formatted time ("66 Ma"),
  `{taxon}`/`{target}` are organism names. English "the {unit}" constructions should be rendered
  naturally (drop the article, add case endings/particles/classifiers as needed; you may rephrase).
- `time.Ga`/`time.Ma`/`time.ka`/`time.yr` are compact axis labels: {n} billion / million / thousand
  years / years (a point on the time axis or an age, not "ago"). Use the conventional short form in
  your language (e.g. ru "{n} млн лет", zh "{n} 百万年" or keep "{n} Ma" if that is what textbooks use).
  Keep them short: they label timeline ticks.
- Geologic unit names: the standard term in your language as used on that language's Wikipedia /
  ICS chart translations (de "Kreide", ja "白亜紀", ru "Меловой период", fr "Crétacé"). Be consistent
  across eons, eras, periods, epochs and ages (e.g. "Early Ordovician" → the standard term).
- Rank names: standard biological nomenclature terms in your language (species, genus, family,
  subfamily …). Latin-only terms (e.g. "incertae sedis", "mirordo-mb") may be left as-is or given the
  closest standard equivalent.
- Persian = standard Iranian Persian.
  Portuguese = Brazilian Portuguese. Spanish = neutral/international.
- Accuracy matters more than literalness: this is science content; do not invent facts, keep numbers.
- Output must be valid UTF-8 JSON (no comments, no trailing commas). After writing each file, verify it
  with Python: every key of the source present, and every `{placeholder}` of a source value present in
  the translation. Example check:
  python -c "import json,re;..."   (write your own small script; en.ts keys can be parsed with a regex
  over lines like `  "key": "value",`).
- Do not edit any other files. Do not run git.
