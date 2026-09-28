"""Pass 2: build the tree of life from extracted data and write
  - data/taxa.jsonl.gz       full organized data dump (one taxon per line)
  - docs/data/...            chunked JSON consumed by the static site

Usage: python build.py <extract_dir> <repo_root>
"""
import gzip
import hashlib
import json
import math
import os
import re
import shutil
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(__file__))
from wikitext import to_text, parse_params, find_template, split_params  # noqa: E402
import curated  # noqa: E402

sys.setrecursionlimit(100000)

LATIN_RANK = {
    "domain": "domain", "superregnum": "superkingdom", "regnum": "kingdom", "subregnum": "subkingdom",
    "infraregnum": "infrakingdom", "superdivisio": "superdivision", "superphylum": "superphylum",
    "divisio": "division", "phylum": "phylum", "subdivisio": "subdivision", "subphylum": "subphylum",
    "infraphylum": "infraphylum", "microphylum": "microphylum", "nanophylum": "nanophylum",
    "superclassis": "superclass", "classis": "class", "subclassis": "subclass", "infraclassis": "infraclass",
    "subterclassis": "subterclass", "parvclassis": "parvclass", "legio": "legion", "cohort": "cohort", "cohors": "cohort",
    "subcohors": "subcohort", "magnordo": "magnorder", "superordo": "superorder", "grandordo": "grandorder",
    "mirordo": "mirorder", "ordo": "order", "subordo": "suborder", "infraordo": "infraorder", "parvordo": "parvorder",
    "zoodivisio": "division", "zoosectio": "section", "zoosubsectio": "subsection",
    "superfamilia": "superfamily", "familia": "family", "subfamilia": "subfamily", "supertribus": "supertribe",
    "tribus": "tribe", "subtribus": "subtribe", "alliance": "alliance", "genus": "genus", "subgenus": "subgenus",
    "sectio": "section", "subsectio": "subsection", "series": "series", "subseries": "subseries",
    "species_group": "species group", "species_subgroup": "species subgroup", "species_complex": "species complex",
    "species": "species", "subspecies": "subspecies", "varietas": "variety", "variety": "variety", "forma": "form",
    "cladus": "clade", "clade": "clade", "unranked": "clade", "stem group": "stem group",
    "ichnogenus": "ichnogenus", "oogenus": "oogenus", "ichnofamilia": "ichnofamily", "oofamilia": "oofamily",
    "virus_group": "group", "realm": "realm", "subrealm": "subrealm", "informal": "informal group",
    "morphotype": "morphotype", "plesion": "plesion", "grade": "grade", "ichnospecies": "ichnospecies",
}
MANUAL_ORDER = ["virus_group", "realm", "subrealm", "domain", "superregnum", "regnum", "subregnum", "infraregnum",
                "superdivisio", "superphylum", "divisio", "phylum", "subdivisio", "subphylum", "infraphylum",
                "microphylum", "nanophylum", "superclassis", "classis", "subclassis", "infraclassis", "subterclassis",
                "parvclassis", "legio", "cohors", "subcohors", "magnordo", "superordo", "grandordo", "mirordo",
                "ordo", "subordo", "infraordo", "parvordo", "zoodivisio", "zoosectio", "zoosubsectio",
                "superfamilia", "familia", "subfamilia", "supertribus", "tribus", "subtribus", "alliance",
                "genus", "subgenus", "sectio", "subsectio", "series", "subseries", "species_group",
                "species_subgroup", "species_complex", "species", "subspecies"]
MAJOR_RANKS = {"domain", "kingdom", "phylum", "division", "class", "order", "family", "genus", "species"}
SPECIES_RANKS = {"species", "ichnospecies", "oospecies"}

UNIT_ALIASES = {"recent": 0, "present": 0, "today": 0, "holocene": (0.0117, 0), "modern": 0, "now": 0}


def norm_rank(r):
    r = (r or "").strip().lower().replace("_", " ")
    r = re.sub(r"<.*?>|\[\[|\]\]|'", "", r)
    return LATIN_RANK.get(r.replace(" ", "_"), LATIN_RANK.get(r, r or "clade"))


def clean_name(wt):
    s = to_text(wt).replace("†", "").replace("?", "").strip()
    s = re.sub(r"\s+", " ", s)
    s = s.strip(" \"'.,;:")
    return s


# ---------------------------------------------------------------- time scale
def load_units(extract_dir, redirects):
    geo = {}
    path = os.path.join(extract_dir, "geo.jsonl")
    if os.path.exists(path):
        for line in open(path, encoding="utf-8"):
            r = json.loads(line)
            geo[r["title"]] = r
    units = []
    for (name, level, parent, start, end, color, wiki) in curated.UNITS:
        wiki = wiki or name
        u = {"name": name, "level": level, "parent": parent, "start": start, "end": end, "color": color, "wiki": wiki}
        rec = geo.get(wiki) or geo.get(redirects.get(wiki, ""))
        shared = wiki != name  # e.g. Mississippian epochs share one article
        if rec:
            p = rec["p"]
            if not shared:
                for k, dst in (("time_start", "start"), ("time_end", "end")):
                    v = to_text(p.get(k, "")).replace(",", "")
                    try:
                        u[dst] = float(v)
                        u["_dump"] = True
                    except ValueError:
                        pass
            img = extract_file(p.get("image_map", "")) or extract_file(p.get("image_art", "")) or extract_file(p.get("image_outcrop", ""))
            if img:
                u["map"] = img
                cap = p.get("caption_map") if extract_file(p.get("image_map", "")) else (p.get("caption_art") or p.get("caption_outcrop"))
                u["mapcap"] = to_text(cap or "")[:300]
            if rec.get("lead") and not shared:
                u["desc"] = rec["lead"]
            for key, label in (("atmos_o2", "o2"), ("atmos_co2", "co2"), ("temp", "temp"), ("sea_level", "sea")):
                for k2 in p:
                    if k2.replace("-", "_").startswith(key):
                        v = to_text(p[k2])
                        if v:
                            u[label] = v[:120]
                        break
        n = curated.NOTES.get(name)
        if n:
            u["earth"] = n["earth"]
            u["life_names"] = n["life"]
            u["first_names"] = n["firsts"]
        units.append(u)
    # Make boundaries consistent: a boundary updated from the dump (e.g. base of the Cretaceous)
    # must also move the end of the preceding unit and the edges of the child units.
    by = {u["name"]: u for u in units}
    for lvl in ("eon", "era", "period", "epoch", "age"):
        same = sorted([u for u in units if u["level"] == lvl], key=lambda x: -x["start"])
        for u in same:  # children inherit outer edges from the parent
            p = by.get(u["parent"]) if u["parent"] else None
            if p:
                sib = [s for s in same if s["parent"] == u["parent"]]
                if u is max(sib, key=lambda x: x["start"]):
                    u["start"] = p["start"]
                if u is min(sib, key=lambda x: x["start"]):
                    u["end"] = p["end"]
        for a, b in zip(same, same[1:]):  # adjacent units share a boundary
            if abs(a["end"] - b["start"]) < 5 and a["end"] != b["start"]:
                if b.get("_dump") or (b["parent"] and by[b["parent"]]["start"] == b["start"]):
                    a["end"] = b["start"]
                else:
                    b["start"] = a["end"]
    for u in units:
        u.pop("_dump", None)
    return units


def unit_lookup(units):
    lk = {}
    for u in units:
        lk[u["name"].lower()] = (u["start"], u["end"])
    extra = {}
    for u in units:
        n = u["name"].lower()
        for pre in ("early ", "middle ", "late "):
            if n.startswith(pre):
                extra[pre.replace("early", "lower").replace("late", "upper") + n[len(pre):]] = (u["start"], u["end"])
    # generic splits for periods with no named epochs in the table
    for u in units:
        if u["level"] in ("period", "era", "epoch"):
            s, e = u["start"], u["end"]
            d = s - e
            n = u["name"].lower()
            extra.setdefault("early " + n, (s, s - d / 3))
            extra.setdefault("middle " + n, (s - d / 3, s - 2 * d / 3))
            extra.setdefault("late " + n, (s - 2 * d / 3, e))
            extra.setdefault("lower " + n, extra["early " + n])
            extra.setdefault("upper " + n, extra["late " + n])
            extra.setdefault("latest " + n, (e + d / 10, e))
            extra.setdefault("earliest " + n, (s, s - d / 10))
    extra.update({"mississippian": (358.9, 323.4), "pennsylvanian": (323.4, 298.9), "tertiary": (66, 2.58),
                  "precambrian": (4567, 538.8), "recent": (0, 0), "present": (0, 0), "holocene": lk.get("holocene", (0.0117, 0)),
                  "series 2": lk.get("cambrian series 2"), "stage 2": lk.get("cambrian stage 2"),
                  "stage 3": lk.get("cambrian stage 3"), "stage 4": lk.get("cambrian stage 4"), "stage 10": lk.get("cambrian stage 10"),
                  "wuchiapingian": lk.get("wuchiapingian"), "lower triassic": lk.get("early triassic")})
    for k, v in extra.items():
        if v:
            lk.setdefault(k, v)
    return lk


RANGE_TPL_RE = re.compile(r"\{\{\s*(fossil\s*range|fossilrange|geological\s*range|period\s*range|period\s*fossil\s*range|fossil\s*range/bar)\s*\|", re.I)


def to_ma(v, lk, which):
    if v is None:
        return None
    s = to_text(v).strip().lower().replace("ma", "").replace("mya", "").strip()
    s = s.replace(",", "")
    try:
        return float(s)
    except ValueError:
        pass
    s = re.sub(r"[\[\]']", "", s).strip()
    if s in lk:
        return lk[s][0] if which == 0 else lk[s][1]
    return None


def parse_fossil_range(wt, lk):
    """Return (start_Ma, end_Ma, text) or (None, None, text)."""
    if not wt:
        return None, None, ""
    start = end = None
    pos = []
    m = RANGE_TPL_RE.search(wt)
    if m:
        from wikitext import find_close
        e = find_close(wt, m.start())
        if e > 0:
            _, named, pos = parse_params(wt[m.start() + 2:e - 2])
            pos = [p for p in pos if p]
            if pos:
                start = to_ma(pos[0], lk, 0)
                end = to_ma(pos[1], lk, 1) if len(pos) > 1 else to_ma(pos[0], lk, 1)
            if start is None and named.get("earliest"):
                start = to_ma(named["earliest"], lk, 0)
    text = to_text(re.sub(r"\{\{\s*(fossil\s*range|fossilrange|geological\s*range|period\s*range|period\s*fossil\s*range)[^{}]*(\{\{[^{}]*\}\}[^{}]*)*\}\}", "", wt, flags=re.I))
    text = re.sub(r"\s+", " ", text).strip(" ,;")
    if not text and m:
        extra = [p for p in pos[2:] if p and not re.match(r"^[\d.\s]+$", p)]
        if extra:
            text = re.sub(r"\s+", " ", to_text(extra[0])).strip(" ,;")
    if start is None:
        # scan text for unit names, first mention = start, last = end
        low = text.lower()
        found = []
        for name in sorted(lk, key=len, reverse=True):
            if len(name) < 5:
                continue
            for mm in re.finditer(r"\b" + re.escape(name) + r"\b", low):
                if not any(a <= mm.start() < b for (a, b, _) in found):
                    found.append((mm.start(), mm.end(), name))
        found.sort()
        if found:
            start = lk[found[0][2]][0]
            end = lk[found[-1][2]][1]
            if re.search(r"\b(recent|present|today)\b", low):
                end = 0
        else:
            nums = re.findall(r"(\d+(?:\.\d+)?)\s*(?:–|-|to)\s*(\d+(?:\.\d+)?)\s*(?:ma|mya|million)", low)
            if nums:
                start, end = float(nums[0][0]), float(nums[0][1])
    if start is not None and end is not None and end > start:
        start, end = end, start
    return start, end, text[:200]


def extract_file(wt):
    """Get a bare image filename from an image parameter."""
    if not wt:
        return None
    s = wt.strip()
    m = re.search(r"(?:file|image)\s*:\s*([^|\]\n]+)", s, re.I)
    if m:
        s = m.group(1)
    elif "{{" in s:
        m2 = re.search(r"\|\s*(?:image\d*\s*=\s*)?([^|{}=]+\.(?:jpe?g|png|gif|svg|tiff?|webp))", s, re.I)
        if not m2:
            return None
        s = m2.group(1)
    s = s.split("|")[0].strip()
    s = re.sub(r"<.*?>", "", s).strip()
    if not re.search(r"\.(jpe?g|png|gif|svg|tiff?|webp|xcf)$", s, re.I):
        return None
    s = s.replace("_", " ")
    return s[0].upper() + s[1:] if s else None


# ---------------------------------------------------------------- main build
def main():
    extract_dir, root = sys.argv[1], sys.argv[2]
    out_site = os.path.join(root, "docs", "data")
    out_dump = os.path.join(root, "data")

    print("loading redirects…", flush=True)
    redirects, tredirects = {}, {}
    for line in open(os.path.join(extract_dir, "redirects.tsv"), encoding="utf-8"):
        parts = line.rstrip("\n").split("\t")
        if len(parts) != 3:
            continue
        ns, a, b = parts
        if ns == "10":
            tredirects[a[len("Template:Taxonomy/"):]] = b.split("Template:Taxonomy/", 1)[-1]
        else:
            redirects[a] = b.split("#")[0]

    units = load_units(extract_dir, redirects)
    lk = unit_lookup(units)

    # --------------------------------------------- taxonomy templates
    print("loading taxonomy templates…", flush=True)
    tt = {}
    for line in open(os.path.join(extract_dir, "taxonomy.jsonl"), encoding="utf-8"):
        r = json.loads(line)
        tt[r["t"]] = r
    for a, b in tredirects.items():
        if a not in tt:
            tt[a] = {"t": a, "alias": b}

    def variant_suffix(name):
        suf = name.split("/", 1)[1].lower()
        return all(p in ("?", "skip", "displayed", "showdomain", "variant", "display") for p in suf.split("/"))

    def canon(name, depth=0):
        """Resolve a template name to the canonical template key."""
        if name is None or depth > 20:
            return None
        name = name.strip()
        if name not in tt:
            name2 = name[0].upper() + name[1:] if name else name
            if name2 in tt:
                name = name2
            elif "/" in name and name.split("/")[0] in tt and variant_suffix(name):
                return canon(name.split("/")[0], depth + 1)
            else:
                return None
        r = tt[name]
        if "alias" in r:
            return canon(r["alias"], depth + 1)
        if "/" in name and variant_suffix(name):
            base = name.split("/")[0]
            if base in tt and not tt[base].get("blank"):
                return canon(base, depth + 1)
        sa = r.get("same_as")
        if sa and not r.get("rank") and "/" in name:
            return canon(sa, depth + 1)
        return name

    nodes = {}  # key -> dict

    def get_node(key):
        n = nodes.get(key)
        if n is None:
            n = nodes[key] = {"key": key}
        return n

    for name, r in tt.items():
        if "alias" in r or canon(name) != name:
            continue
        if r.get("blank") and name != "Life":
            continue
        low = name.lower()
        if "/sandbox" in low or low.endswith("/doc") or low.startswith("dummy") or "/test" in low:
            continue
        n = get_node(name)
        src = r
        if r.get("same_as") and not r.get("rank"):
            src = {**tt.get(canon(r["same_as"]) or "", {}), **{k: v for k, v in r.items() if v}}
        link = src.get("link") or name
        parts = split_params(link)
        target = parts[0].strip()
        disp = parts[1].strip() if len(parts) > 1 and parts[1].strip() else re.sub(r"\s*\(.*\)$", "", name.split("/")[0])
        n["name"] = clean_name(disp) or name
        if n["name"].lower() == "incertae sedis" and "/" in name:
            n["name"] = f"Incertae sedis ({name.split('/', 1)[1]})"
        n["rank"] = norm_rank(src.get("rank"))
        n["wiki"] = to_text(target) or None
        ext = (src.get("extinct") or "").strip().lower()
        n["tex"] = ext in ("yes", "true", "y", "1")
        par = src.get("parent")
        if par:
            n["parent"] = ("T", canon(to_text(par)))
    if "Life" in nodes:
        nodes["Life"].update({"name": "Life", "rank": "root", "wiki": "Life"})
        nodes["Life"].pop("parent", None)
    else:
        get_node("Life").update({"name": "Life", "rank": "root", "wiki": "Life"})

    # --------------------------------------------- articles with boxes
    print("loading boxes…", flush=True)
    by_taxon_article = {}
    articles = []
    for line in open(os.path.join(extract_dir, "boxes.jsonl"), encoding="utf-8"):
        articles.append(json.loads(line))
    print(f"  {len(articles)} articles with boxes, {len(nodes)} template nodes", flush=True)

    def art_data(a):
        p = a["p"]
        d = {"wiki": a["title"]}
        img = extract_file(p.get("image", "")) or extract_file(p.get("image2", ""))
        if img:
            d["img"] = img
            cap = to_text(p.get("image_caption", ""))
            if cap:
                d["cap"] = cap[:220]
        fr = p.get("fossil_range")
        if fr:
            s, e, txt = parse_fossil_range(fr, lk)
            d["fr"] = txt
            if s is not None:
                d["fa"] = round(s, 4)
                d["fb"] = round(e if e is not None else s, 4)
        st = to_text(p.get("status", "")).strip().upper()
        if st:
            d["st"] = st[:12]
        au = to_text(p.get("authority", "") or p.get("binomial_authority", "") or p.get("trinomial_authority", ""))
        if au:
            d["au"] = au[:160]
        if a.get("sd"):
            d["sd"] = to_text(a["sd"])[:160]
        if a.get("lead"):
            d["lead"] = a["lead"]
        nm = to_text(p.get("name", ""))
        if nm:
            d["cn"] = nm
        return d

    def attach(n, a):
        if "art" in n:
            return
        d = art_data(a)
        n["art"] = d

    synth_count = 0

    def synth(parent_key, rank, name, parent_kind="T"):
        nonlocal synth_count
        key = f"{parent_key}>{name}"
        n = nodes.get(key)
        if n is None:
            synth_count += 1
            n = get_node(key)
            n.update({"name": name, "rank": rank, "parent": ("N", parent_key), "synthetic": True})
        return key

    name_index = defaultdict(list)  # sci name -> template keys
    for k, n in nodes.items():
        if "name" in n:
            name_index[n["name"].lower()].append(k)

    def find_by_name(name, rank=None):
        c = canon(name)
        if c and c in nodes:
            return c
        ks = name_index.get(name.lower(), [])
        if rank:
            for k in ks:
                if nodes[k].get("rank") == rank:
                    return k
        return ks[0] if ks else None

    unplaced = 0
    for a in articles:
        p = a["p"]
        box = a["box"]
        title = a["title"]
        if box == "paraphyletic group" or box == "hybridbox":
            unplaced += 1
            continue
        if box in ("automatic taxobox", "virusbox", "ichnobox", "oobox") and not p.get("species"):
            taxon = to_text(p.get("taxon", "")) or title
            k = canon(taxon)
            if k and k in nodes:
                attach(nodes[k], a)
                continue
            par = canon(to_text(p.get("parent", ""))) if p.get("parent") else None
            if par:
                key = synth(par, norm_rank(p.get("rank") or "genus"), clean_name(taxon))
                attach(nodes[key], a)
                continue
            unplaced += 1
            continue
        if box in ("speciesbox", "virusbox", "ichnobox", "oobox") or (box.startswith("automatic") and p.get("species")):
            taxon = to_text(p.get("taxon", ""))
            genus = to_text(p.get("genus", ""))
            sp = to_text(p.get("species", ""))
            if taxon and " " in taxon:
                genus, sp = taxon.split(" ", 1)
            elif box == "virusbox" and sp:
                taxon = sp
            full = (f"{genus} {sp}".strip() if genus else sp).replace("†", "").strip()
            if not full:
                unplaced += 1
                continue
            # a dedicated taxonomy template for the species?
            k = canon(full)
            if k and k in nodes:
                attach(nodes[k], a)
                continue
            par = canon(to_text(p.get("parent", ""))) if p.get("parent") else canon(genus)
            if not par or par not in nodes:
                unplaced += 1
                continue
            key = synth(par, "species", full)
            attach(nodes[key], a)
            continue
        if box in ("subspeciesbox", "infraspeciesbox"):
            genus = to_text(p.get("genus", ""))
            sp = to_text(p.get("species", ""))
            sub = to_text(p.get("subspecies", "") or p.get("variety", "") or p.get("varietas", "") or p.get("forma", ""))
            par = canon(to_text(p.get("parent", ""))) if p.get("parent") else canon(genus)
            if not (genus and sp and sub and par):
                unplaced += 1
                continue
            spk = canon(f"{genus} {sp}")
            if not spk:
                spk = synth(par, "species", f"{genus} {sp}")
            rank = "subspecies" if p.get("subspecies") else ("variety" if (p.get("variety") or p.get("varietas")) else "form")
            conn = {"subspecies": "", "variety": "var. ", "form": "f. "}[rank]
            key = synth(spk, rank, f"{genus} {sp} {conn}{sub}")
            attach(nodes[key], a)
            continue
        # ---- manual taxobox
        chain = []
        for r in MANUAL_ORDER:
            for pre in ("unranked_" + r, r):
                if pre in p and p[pre].strip():
                    nm = clean_name(p[pre])
                    if not nm:
                        continue
                    chain.append((norm_rank(r) if not pre.startswith("unranked") else "clade", nm))
        if p.get("binomial"):
            bn = clean_name(p["binomial"])
            chain = [c for c in chain if c[0] != "species"] + [("species", bn)]
        elif chain and chain[-1][0] == "species":
            nm = chain[-1][1]
            g = next((c[1] for c in chain if c[0] == "genus"), None)
            if g and re.match(r"^[A-Z]\.\s", nm):
                chain[-1] = ("species", g + " " + nm.split(" ", 1)[1])
        if p.get("trinomial"):
            chain.append(("subspecies", clean_name(p["trinomial"])))
        if not chain:
            unplaced += 1
            continue
        # deepest element matching an existing node
        anchor_i, anchor = -1, None
        for i in range(len(chain) - 1, -1, -1):
            rk, nm = chain[i]
            k = find_by_name(nm, rk)
            if k:
                anchor_i, anchor = i, k
                break
        if anchor is None:
            unplaced += 1
            continue
        cur = anchor
        for rk, nm in chain[anchor_i + 1:]:
            cur = synth(cur, rk, nm)
        attach(nodes[cur], a)
    print(f"  synthetic nodes: {synth_count}, unplaced articles: {unplaced}", flush=True)

    # secondary: template nodes without an article but whose link article has a box elsewhere
    art_by_title = {a["title"]: a for a in articles}
    for k, n in nodes.items():
        if "art" not in n and n.get("wiki"):
            t = n["wiki"]
            a = art_by_title.get(t) or art_by_title.get(redirects.get(t, ""))
            if a:
                n["art"] = art_data(a)
                n["art_shared"] = True

    # --------------------------------------------- parents / children
    print("linking tree…", flush=True)
    children = defaultdict(list)
    for k, n in nodes.items():
        if k == "Life":
            continue
        par = n.get("parent")
        pk = par[1] if par else None
        if pk is None or pk not in nodes or pk == k:
            pk = "__unplaced"
        n["pk"] = pk
    # break cycles
    for k in list(nodes):
        seen = set()
        cur = k
        while cur and cur != "Life" and cur != "__unplaced":
            if cur in seen:
                nodes[cur]["pk"] = "__unplaced"
                break
            seen.add(cur)
            cur = nodes[cur].get("pk")
    nodes["__unplaced"] = {"key": "__unplaced", "name": "Unplaced taxa", "rank": "group", "pk": "Life",
                           "wiki": None, "note": "Taxa whose taxonomy template has no resolvable parent"}
    for k, n in nodes.items():
        if k != "Life":
            children[n["pk"]].append(k)

    # prune empty leaves (template-only taxa with no article and nothing below them)
    changed = True
    while changed:
        changed = False
        for k in list(nodes):
            if k in ("Life", "__unplaced") or k not in nodes:
                continue
            n = nodes[k]
            if "art" not in n and not children.get(k):
                pk = n["pk"]
                del nodes[k]
                if k in children.get(pk, []):
                    children[pk].remove(k)
                changed = True
    # compute aggregates bottom-up (iterative postorder)
    order = []
    stack = [("Life", False)]
    while stack:
        k, done = stack.pop()
        if done:
            order.append(k)
            continue
        stack.append((k, True))
        for c in children.get(k, []):
            stack.append((c, False))
    reach = set(order)
    print(f"  reachable {len(reach)} / {len(nodes)}", flush=True)

    for k in order:
        n = nodes[k]
        art = n.get("art", {})
        fa, fb = art.get("fa"), art.get("fb")
        st = art.get("st", "")
        extinct_self = n.get("tex") or st in ("EX", "FOSSIL", "EW") or (fb is not None and fb > 0.05 and st not in ("DOM",) and not art.get("st"))
        if n.get("tex") is False and fb is not None and fb > 0.05 and not st:
            extinct_self = True
        if k in ("Life", "__unplaced"):
            extinct_self = False
        kids = children.get(k, [])
        nsp = 1 if n.get("rank") in SPECIES_RANKS else 0
        total = 1
        kfa, kfb = [], []
        any_extant = False
        for c in kids:
            cn = nodes[c]
            nsp += cn["nsp"]
            total += cn["tot"]
            if cn.get("fa") is not None:
                kfa.append(cn["fa"]); kfb.append(cn["fb"])
            if not cn["ex"]:
                any_extant = True
        if fa is None and kfa:
            fa = max(kfa)
        elif fa is not None and kfa:
            fa = max(fa, max(kfa)) if max(kfa) < fa * 1.5 + 5 else fa
        if kfb:
            fb = min(kfb) if fb is None else min(fb, min(kfb))
        if kids:
            ex = not any_extant and (extinct_self or all(nodes[c]["ex"] for c in kids))
            if n.get("tex"):
                ex = True
        else:
            ex = bool(extinct_self)
        if not ex and fb is None and fa is not None:
            fb = 0
        if not ex and fb is not None and fb > 0.05 and not kids:
            fb = 0
        n["fa"], n["fb"] = fa, fb
        n["ex"] = ex
        n["nsp"] = nsp
        n["tot"] = total
        n["img"] = art.get("img")
        n["hasart"] = "art" in n
    # images bubble up so higher taxa without a picture show a representative one
    for k in order:
        n = nodes[k]
        if not n.get("img"):
            best = None
            for c in children.get(k, []):
                cn = nodes[c]
                im = cn.get("img") or cn.get("rimg")
                if im and (best is None or cn["tot"] > best[0]):
                    best = (cn["tot"], im)
            if best:
                n["rimg"] = best[1]

    # --------------------------------------------- order + numbering
    def sort_key(c):
        cn = nodes[c]
        return (c == "__unplaced", -cn["tot"], cn.get("name", c).lower())

    for k in children:
        children[k].sort(key=sort_key)
    ids = {}
    pre = []
    stack = ["Life"]
    while stack:
        k = stack.pop()
        ids[k] = len(pre)
        pre.append(k)
        for c in reversed(children.get(k, [])):
            stack.append(c)
    print(f"  {len(pre)} nodes in tree", flush=True)

    # --------------------------------------------- dump
    os.makedirs(out_dump, exist_ok=True)
    CH = 1000
    shutil.rmtree(out_site, ignore_errors=True)
    os.makedirs(os.path.join(out_site, "n"), exist_ok=True)
    os.makedirs(os.path.join(out_site, "s"), exist_ok=True)

    def rounded(x):
        if x is None:
            return None
        return round(x, 4) if x < 10 else round(x, 2)

    def lineage(k):
        out = []
        cur = nodes[k].get("pk")
        while cur and cur in nodes:
            out.append(nodes[cur].get("name"))
            cur = nodes[cur].get("pk") if cur != "Life" else None
        return list(reversed(out))

    dump_parts = []
    part_idx = 0
    part_f = None
    part_n = 0

    def open_part():
        nonlocal part_f, part_idx, part_n
        if part_f:
            part_f.close()
        fn = os.path.join(out_dump, f"taxa-{part_idx:02d}.jsonl.gz")
        dump_parts.append(os.path.basename(fn))
        part_f = gzip.open(fn, "wt", encoding="utf-8")
        part_idx += 1
        part_n = 0

    for fn in os.listdir(out_dump):
        if fn.startswith("taxa-"):
            os.remove(os.path.join(out_dump, fn))
    open_part()
    for k in pre:
        n = nodes[k]
        art = n.get("art", {})
        rec = {"id": ids[k], "name": n.get("name"), "rank": n.get("rank"), "parent_id": ids.get(n.get("pk")),
               "lineage": lineage(k), "extinct": n["ex"],
               "range_start_ma": rounded(n["fa"]), "range_end_ma": rounded(n["fb"]),
               "fossil_range_text": art.get("fr"), "image": art.get("img"), "image_caption": art.get("cap"),
               "common_name": (art.get("cn") or (art["wiki"] if art.get("wiki") and art["wiki"] != n.get("name") else None)) if art else None,
               "authority": art.get("au"), "conservation_status": art.get("st"), "short_description": art.get("sd"),
               "summary": art.get("lead"), "wikipedia": art.get("wiki") or n.get("wiki"),
               "taxonomy_template": None if n.get("synthetic") or k.startswith("__") else k,
               "species_count": n["nsp"], "descendant_count": n["tot"] - 1}
        part_f.write(json.dumps({a: b for a, b in rec.items() if b is not None}, ensure_ascii=False) + "\n")
        part_n += 1
        if part_n >= 250000:
            open_part()
    part_f.close()

    # --------------------------------------------- site chunks
    def common_name(n):
        art = n.get("art") or {}
        cn = art.get("cn")
        w = art.get("wiki")
        nm = n.get("name") or ""
        c = cn if cn and cn.lower() != nm.lower() else (w if w and w.lower() != nm.lower() and not n.get("art_shared") else None)
        if c:
            c = re.sub(r"\s*\(.*?\)$", "", c)
            if c.lower() == nm.lower():
                c = None
        return c

    def brief(k):
        n = nodes[k]
        b = {"i": ids[k], "n": n.get("name"), "r": n.get("rank")}
        cn = common_name(n)
        if cn:
            b["c"] = cn
        im = n.get("img") or n.get("rimg")
        if im:
            b["m"] = im
        if n["ex"]:
            b["x"] = 1
        if n["fa"] is not None:
            b["a"] = rounded(n["fa"])
            b["b"] = rounded(n["fb"])
        if n["nsp"]:
            b["s"] = n["nsp"]
        if n["tot"] > 1:
            b["t"] = n["tot"] - 1
        return b

    chunks = defaultdict(dict)
    for k in pre:
        n = nodes[k]
        i = ids[k]
        art = n.get("art", {})
        rec = brief(k)
        rec["p"] = ids.get(n.get("pk")) if k != "Life" else None
        kids = children.get(k, [])
        rec["k"] = [brief(c) for c in kids[:400]]
        if len(kids) > 400:
            rec["kmore"] = len(kids) - 400
        for f_src, f_dst in (("fr", "fr"), ("au", "au"), ("sd", "sd"), ("cap", "cap"), ("st", "st")):
            if art.get(f_src):
                rec[f_dst] = art[f_src]
        if art.get("lead"):
            ld = art["lead"]
            if len(ld) > 700:
                cut = ld[:700]
                dot = cut.rfind(". ")
                ld = cut[:dot + 1] if dot > 250 else cut.rstrip() + "…"
            rec["l"] = ld
        w = art.get("wiki") or n.get("wiki")
        if w:
            rec["w"] = w
        if n.get("img"):
            rec["own"] = 1
        chunks[i // CH][i] = rec
    for c, recs in chunks.items():
        with open(os.path.join(out_site, "n", f"{c}.json"), "w", encoding="utf-8") as f:
            json.dump(recs, f, ensure_ascii=False, separators=(",", ":"))

    # search index sharded by first two letters of each indexed word
    def norm(s):
        s = s.lower()
        s = re.sub(r"[^a-z0-9 ]", "", s.replace("-", " "))
        return s

    shards = defaultdict(list)
    for k in pre:
        n = nodes[k]
        nm = n.get("name") or ""
        cn = common_name(n) or ""
        entry = [ids[k], nm, n.get("rank"), cn, n["tot"]]
        keys = set()
        for text in (nm, cn):
            t = norm(text)
            if not t:
                continue
            keys.add(t)
            words = t.split()
            for w in words[1:]:
                if len(w) >= 3:
                    keys.add(w)
        for key in keys:
            sh = key[:2].ljust(2, "_")
            shards[sh].append([key] + entry)
    for sh, lst in shards.items():
        lst.sort(key=lambda e: (e[0], -e[5]))
        with open(os.path.join(out_site, "s", f"{sh}.json"), "w", encoding="utf-8") as f:
            json.dump(lst, f, ensure_ascii=False, separators=(",", ":"))

    # --------------------------------------------- time: per-unit taxa
    print("time-scale analysis…", flush=True)
    by_name = {}
    for k in pre:
        n = nodes[k]
        nm = (n.get("name") or "").lower()
        if nm not in by_name or n["tot"] > nodes[by_name[nm]]["tot"]:
            by_name[nm] = k
    for alias, target in (("angiosperms", "Angiosperms"), ("angiosperms", "Magnoliophyta")):
        if alias not in by_name and target.lower() in by_name:
            by_name[alias] = by_name[target.lower()]

    def resolve(names):
        out = []
        for nm in names:
            k = by_name.get(nm.lower()) or (canon(nm) if canon(nm) in ids else None)
            if k:
                out.append(brief(k))
            else:
                print(f"    [warn] curated taxon not found: {nm}", flush=True)
        return out

    GOOD = {"class", "subclass", "order", "suborder", "infraorder", "superfamily", "family", "clade", "phylum",
            "subphylum", "superorder", "infraclass", "genus"}
    cand = [k for k in pre if nodes[k].get("fa") is not None and nodes[k]["rank"] in GOOD and nodes[k]["hasart"]
            and (nodes[k].get("img") or nodes[k].get("rimg"))]
    leaf_ranges = [(nodes[k]["fa"], nodes[k]["fb"], k) for k in pre if nodes[k]["rank"] in ("genus",) and nodes[k].get("fa") is not None]
    print(f"  {len(cand)} candidate groups, {len(leaf_ranges)} dated genera", flush=True)

    # genus -> ancestors map for diversity counting
    anc_cache = {}

    def ancestors(k):
        out = []
        cur = nodes[k].get("pk")
        while cur and cur in nodes and cur != "Life":
            out.append(cur)
            cur = nodes[cur].get("pk")
        return out

    for u in units:
        s, e = u["start"], u["end"]
        span = s - e
        # first appearances: groups whose first appearance falls inside the unit
        firsts = [k for k in cand if e <= nodes[k]["fa"] <= s and nodes[k]["tot"] > 1 and nodes[k]["rank"] != "genus"]
        firsts.sort(key=lambda k: -nodes[k]["tot"])
        fg = [k for k in cand if nodes[k]["rank"] == "genus" and e <= nodes[k]["fa"] <= s]
        fg.sort(key=lambda k: (-(nodes[k]["hasart"] and len((nodes[k].get("art") or {}).get("lead", ""))), ))
        # diversity: count dated genera alive during the unit per ancestor group
        count = defaultdict(int)
        for (fa, fb, gk) in leaf_ranges:
            if fa >= e and (fb if fb is not None else 0) <= s:
                if gk not in anc_cache:
                    anc_cache[gk] = ancestors(gk)
                for a in anc_cache[gk][:6]:
                    count[a] += 1
        common = [a for a in count if nodes[a]["rank"] in ("order", "family", "class", "superfamily", "suborder", "clade", "infraorder", "subclass")
                  and (nodes[a].get("img") or nodes[a].get("rimg")) and nodes[a]["hasart"]]
        common.sort(key=lambda a: -count[a])
        # avoid showing a parent and its child both: keep diverse spread
        picked, seen_anc = [], set()
        for a in common:
            if a in seen_anc:
                continue
            anc = set(anc_cache.get(a) or ancestors(a))
            if any(p in anc for p in picked):
                continue
            picked.append(a)
            seen_anc |= anc
            if len(picked) >= 12:
                break
        u["common"] = [dict(brief(a), g=count[a]) for a in picked]
        u["firsts"] = [brief(k) for k in firsts[:16]]
        u["firstgenera"] = [brief(k) for k in fg[:16]]
        u["alive"] = sum(1 for (fa, fb, gk) in leaf_ranges if fa >= e and (fb or 0) <= s)
        u["life"] = resolve(u.pop("life_names", []))
        u["firsts_curated"] = resolve(u.pop("first_names", []))

    ms = []
    for (ma, title, desc, taxon, wiki, cat) in curated.MILESTONES:
        m = {"ma": ma, "title": title, "desc": desc, "wiki": wiki, "cat": cat}
        if taxon:
            r = resolve([taxon])
            if r:
                m["taxon"] = r[0]
        ms.append(m)

    meta = {"chunk": CH, "count": len(pre), "species": nodes["Life"]["nsp"], "shards": sorted(shards),
            "dump": dump_parts}
    with open(os.path.join(out_site, "meta.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f)
    with open(os.path.join(out_site, "time.json"), "w", encoding="utf-8") as f:
        json.dump({"units": units, "milestones": ms}, f, ensure_ascii=False, separators=(",", ":"))
    with open(os.path.join(out_dump, "timescale.json"), "w", encoding="utf-8") as f:
        json.dump({"units": units, "milestones": ms}, f, ensure_ascii=False, indent=1)
    print(f"done: {len(pre)} nodes, {nodes['Life']['nsp']} species", flush=True)


if __name__ == "__main__":
    main()
