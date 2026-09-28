"""Pass 2 for translations: build the per-language data overlays the web app loads.

Inputs
  web/public/data                 English site data (from build.py)
  <i18n dir>/<lang>.jsonl         local articles from i18n_extract.py: {"en", "t", "l"}
  scripts/i18n/content.<lang>.json  translated curated content (unit names, notes, milestones, ranks)

Outputs, in web/public/data/l/<lang>/
  n/<chunk>.json   {id: {c, w, l}} for the chunk's taxa (and names for their children)
  time.json        unit names/descriptions/notes, milestones, names of taxa in time.json, ranks
  s/<bucket>.json  search rows [key, id, name, rank, local name, size], sorted by key
  meta.json        {count, buckets, prefix}

Usage: python i18n_build.py <site dir> <i18n dir> lang [lang …]
"""
import glob
import json
import math
import os
import re
import shutil
import sys
import unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
STRIP_MARKS = {"de", "es", "fr", "it", "pt", "ru", "tr", "vi"}
ONE_CHAR_PREFIX = {"ja", "ko"}
ROWS_PER_BUCKET = 4000


def norm_title(t):
    t = t.replace("_", " ").strip()
    return t[:1].upper() + t[1:] if t else t


def search_key(s, lang):
    """Must match normalizeLocal() in web/src/data.ts."""
    t = unicodedata.normalize("NFKC", s.lower())
    t = t.replace("-", " ").replace("_", " ")
    if lang in STRIP_MARKS:
        t = unicodedata.normalize("NFC", "".join(ch for ch in unicodedata.normalize("NFD", t) if not unicodedata.category(ch).startswith("M")))
    t = "".join(ch for ch in t if ch == " " or unicodedata.category(ch)[0] in "LMN")
    return re.sub(r"\s+", " ", t).strip()


def bucket_of(key, prefix, buckets):
    """Must match bucketOf() in web/src/data.ts."""
    h = 0
    for ch in key[:prefix]:
        h = (h * 31 + ord(ch)) % 4294967296
    return h % buckets


def same_name(a, b):
    f = lambda s: re.sub(r"[\s†\"'«»“”]+", " ", s).strip().lower()
    return f(a) == f(b)


LATIN_RE = re.compile(r"[A-Z][a-z]+(?: \(?[A-Z]?[a-z-]+\)?){1,3}")


def latin_relative(title, sci):
    """A binomial/trinomial in the same genus, e.g. "Illecebrum verticillatum" for genus Illecebrum."""
    return bool(LATIN_RE.fullmatch(title)) and title.split()[0] == sci.split()[0]


def dump(obj, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))


def build_lang(lang, data, i18n_dir):
    articles = {}
    with open(os.path.join(i18n_dir, f"{lang}.jsonl"), encoding="utf-8") as f:
        for line in f:
            r = json.loads(line)
            articles.setdefault(norm_title(r["en"]), r)
    content = json.load(open(os.path.join(HERE, "i18n", f"content.{lang}.json"), encoding="utf-8"))
    meta = json.load(open(os.path.join(data, "meta.json"), encoding="utf-8"))
    time_data = json.load(open(os.path.join(data, "time.json"), encoding="utf-8"))
    out = os.path.join(data, "l", lang)
    if os.path.isdir(out):
        shutil.rmtree(out)

    def entry(b, with_lead):
        """Localized entry for a taxon with English article b['w'], or None."""
        w = b.get("w")
        a = articles.get(norm_title(w)) if w else None
        if not a or not a["t"]:
            return None
        title = a["t"]
        # the local title is a common name unless it is just the scientific name — of this taxon, or
        # of the relative whose article it shares (a monotypic genus and its species, say)
        scientific = (same_name(title, b["n"]) or same_name(title, w) and not (b.get("c") and same_name(title, b["c"]))
                      or latin_relative(title, b["n"]))
        e = {"c": "" if scientific else title}
        if title != e["c"]:
            e["w"] = title
        if with_lead and a.get("l"):
            e["l"] = a["l"]
        return e

    # every taxon's English article title, so children and time.json briefs can be localized
    chunks = sorted(glob.glob(os.path.join(data, "n", "*.json")), key=lambda p: int(os.path.basename(p)[:-5]))
    all_taxa = {}
    for fn in chunks:
        for k, v in json.load(open(fn, encoding="utf-8")).items():
            all_taxa[int(k)] = v

    rows, translated, lead_bytes = [], 0, 0
    for fn in chunks:
        chunk = json.load(open(fn, encoding="utf-8"))
        ov = {}
        for k, v in chunk.items():
            e = entry(v, True)
            if e:
                ov[k] = e
                translated += 1
                lead_bytes += len(e.get("l", "").encode())
                if e["c"]:
                    key = search_key(e["c"], lang)
                    if key:
                        rows.append([key, v["i"], v["n"], v.get("r", ""), e["c"], (v.get("t") or 0) + 1])
            for kid in v.get("k", []):
                ks = str(kid["i"])
                if ks in ov or ks in chunk:
                    continue
                full = all_taxa.get(kid["i"])
                ke = full and entry(full, False)
                if ke:
                    ov[ks] = ke
        if ov:
            dump(ov, os.path.join(out, "n", os.path.basename(fn)))

    # time scale and curated content
    names = {}
    def note(b):
        full = all_taxa.get(b["i"])
        e = full and entry(full, False)
        if e:
            names[str(b["i"])] = e
    for u in time_data["units"]:
        for key in ("life", "common", "firsts", "firstgenera", "firsts_curated"):
            for b in u.get(key) or []:
                note(b)
    for m in time_data["milestones"]:
        if m.get("taxon"):
            note(m["taxon"])
    units = {}
    for u in time_data["units"]:
        lu = {}
        name = content["unitNames"].get(u["name"])
        if name:
            lu["n"] = name
        a = articles.get(norm_title(u["wiki"]))
        if a:
            lu["w"] = a["t"]
            if a.get("l"):
                lu["d"] = a["l"]
        lu.update({k: v for k, v in content["units"].get(u["name"], {}).items() if v})
        if lu:
            units[u["name"]] = lu
    milestones = {}
    for m in time_data["milestones"]:
        lm = dict(content["milestones"].get(m["title"], {}))
        a = articles.get(norm_title(m["wiki"]))
        if a:
            lm["w"] = a["t"]
        milestones[m["title"]] = lm
    dump({"units": units, "milestones": milestones, "names": names, "globe": content["globeLabels"],
          "ranks": content["ranks"]}, os.path.join(out, "time.json"))

    # search shards
    prefix = 1 if lang in ONE_CHAR_PREFIX else 2
    buckets = max(1, math.ceil(len(rows) / ROWS_PER_BUCKET))
    shards = {}
    for r in rows:
        shards.setdefault(bucket_of(r[0], prefix, buckets), []).append(r)
    for b, lst in shards.items():
        lst.sort(key=lambda r: (r[0].encode("utf-16-be"), -r[5]))
        dump(lst, os.path.join(out, "s", f"{b}.json"))
    dump({"count": translated, "buckets": buckets, "prefix": prefix}, os.path.join(out, "meta.json"))
    size = sum(os.path.getsize(p) for p in glob.glob(os.path.join(out, "**", "*.json"), recursive=True))
    print(f"{lang}: {translated} taxa translated ({len(rows)} with local names), leads {lead_bytes / 1e6:.1f} MB, "
          f"{len(articles)} articles, output {size / 1e6:.1f} MB", flush=True)


def main():
    site, i18n_dir, *langs = sys.argv[1:]
    data = os.path.join(site, "web", "public", "data")
    for lang in langs:
        build_lang(lang, data, i18n_dir)


if __name__ == "__main__":
    main()
