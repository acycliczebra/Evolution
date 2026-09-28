"""Pass 1 for translations: for each language, find the local Wikipedia article linked to every
English article the site uses (taxa, geologic units, milestones) and extract its title and lead.

  1. <lang>wiki langlinks table        -> local page id -> English title (interlanguage links)
  2. <lang>wiki multistream dump parts  -> downloaded one part at a time, only the streams holding
                                           wanted pages are decompressed, then the part is deleted

Output: <outdir>/<lang>.jsonl, one {"en": English title, "t": local title, "l": lead} per article.

Usage: python i18n_extract.py <site dir> <enwiki redirects.tsv> <outdir> <dump date> lang [lang …]
"""
import bz2
import glob
import gzip
import html
import json
import os
import re
import sys
import threading
import time
import urllib.request
from concurrent.futures import ProcessPoolExecutor

sys.path.insert(0, os.path.dirname(__file__))
from download import download  # noqa: E402
from i18n_text import local_lead, clean_title  # noqa: E402

DUMPS = "https://dumps.wikimedia.org"
UA = {"User-Agent": "EvolutionTreeBuilder/1.0"}
PAGE_RE = re.compile(r"<page>(.*?)</page>", re.S)
TITLE_RE = re.compile(r"<title>(.*?)</title>")
NS_RE = re.compile(r"<ns>(\d+)</ns>")
ID_RE = re.compile(r"<id>(\d+)</id>")
TEXT_RE = re.compile(r"<text[^>]*>(.*?)</text>", re.S)
LL_RE = re.compile(r"\((\d+),'((?:[^'\\]|\\.)*)','((?:[^'\\]|\\.)*)'\)")
ESC_RE = re.compile(r"\\(.)")


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


def norm(t):
    t = t.replace("_", " ").strip()
    return t[:1].upper() + t[1:] if t else t


def wanted_titles(site):
    """English article titles referenced by the site data (web/public/data)."""
    data = os.path.join(site, "web", "public", "data")
    out = set()
    for fn in glob.glob(os.path.join(data, "n", "*.json")):
        for rec in json.load(open(fn, encoding="utf-8")).values():
            if rec.get("w"):
                out.add(norm(rec["w"]))
    time_data = json.load(open(os.path.join(data, "time.json"), encoding="utf-8"))
    for u in time_data["units"]:
        out.add(norm(u["wiki"]))
    for m in time_data["milestones"]:
        out.add(norm(m["wiki"]))
    return out


def canonical_map(redirects, wanted):
    """English title -> the site's title, for titles that are the site's or redirect to/from it."""
    fwd = {}
    with open(redirects, encoding="utf-8") as f:
        for line in f:
            ns, src, dst = line.rstrip("\n").split("\t")
            if ns == "0":
                fwd[src] = norm(dst.split("#")[0])
    # the site's title may itself be a redirect: key everything by the redirect target
    site_by_canon = {}
    for w in wanted:
        site_by_canon.setdefault(fwd.get(w, w), w)
    out = {w: w for w in wanted}
    for src, dst in fwd.items():
        if dst in site_by_canon and src not in out:
            out[src] = site_by_canon[dst]
    for c, w in site_by_canon.items():
        out.setdefault(c, w)
    return out


def fetch_json(url):
    return json.load(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120))


def langlinks(lang, date, workdir, canon):
    """Local page id -> site English title, from the local wiki's links to enwiki."""
    fn = os.path.join(workdir, f"{lang}wiki-{date}-langlinks.sql.gz")
    if not os.path.exists(fn):
        download(f"{DUMPS}/{lang}wiki/{date}/{lang}wiki-{date}-langlinks.sql.gz", fn, 4, log=lambda s: None)
    out = {}
    with gzip.open(fn, "rt", encoding="utf-8", errors="replace") as f:
        for line in f:  # rows may share one INSERT line or sit one per line
            if "'en'" not in line:
                continue
            for m in LL_RE.finditer(line):
                if m.group(2) != "en":
                    continue
                en = norm(ESC_RE.sub(r"\1", m.group(3)))
                w = canon.get(en)
                if w:
                    out[int(m.group(1))] = w
    return out


def parts(lang, date):
    """[(xml file, index file)] of the multistream dump."""
    st = fetch_json(f"{DUMPS}/{lang}wiki/{date}/dumpstatus.json")["jobs"]["articlesmultistreamdump"]
    if st["status"] != "done":
        raise RuntimeError(f"{lang}: multistream dump not done")
    files = sorted(st["files"])
    xmls = [f for f in files if "-multistream" in f and ".xml" in f and "-index" not in f]
    out = []
    for x in xmls:
        idx = x.replace("-multistream", "-multistream-index", 1).replace(".xml", ".txt", 1)
        if idx not in st["files"]:
            raise RuntimeError(f"no index for {x}")
        out.append((x, idx))
    return out


def extract_streams(args):
    """Decompress the given (start, end) byte ranges and pull out the wanted pages."""
    path, ranges, want, lang = args
    res = []
    with open(path, "rb") as f:
        for a, b in ranges:
            f.seek(a)
            data = f.read(b - a)
            xml = bz2.BZ2Decompressor().decompress(data).decode("utf-8", "replace")
            for m in PAGE_RE.finditer(xml):
                raw = m.group(1)
                pid = ID_RE.search(raw)
                if not pid or int(pid.group(1)) not in want:
                    continue
                if NS_RE.search(raw).group(1) != "0" or "<redirect" in raw[:2000]:
                    continue
                t = TEXT_RE.search(raw)
                title = html.unescape(TITLE_RE.search(raw).group(1))
                text = html.unescape(t.group(1)) if t else ""
                try:
                    lead = local_lead(text, lang, title)
                except Exception:
                    lead = ""
                res.append((want[int(pid.group(1))], clean_title(title, lang), lead))
    return res


def process_lang(lang, date, workdir, outdir, canon, pool):
    done_fn = os.path.join(outdir, f"{lang}.parts.done")
    done = set(open(done_fn).read().split()) if os.path.exists(done_fn) else set()
    ll = langlinks(lang, date, workdir, canon)
    log(f"{lang}: {len(ll)} local articles linked to the site's English titles")
    todo = [p for p in parts(lang, date) if p[0] not in done]
    base = f"{DUMPS}/{lang}wiki/{date}/"

    # download one part ahead while the previous one is being extracted
    ready = {}
    def fetch(i):
        x, idx = todo[i]
        xf, jf = os.path.join(workdir, x), os.path.join(workdir, idx)
        download(base + idx, jf, 2, log=lambda s: None)
        download(base + x, xf, 8, log=lambda s: None)
        ready[i] = (xf, jf)
    th = threading.Thread(target=fetch, args=(0,)) if todo else None
    if th:
        th.start()
    for i, (x, idx) in enumerate(todo):
        t0 = time.time()
        th.join()
        if i not in ready:
            raise RuntimeError(f"download failed: {x}")
        xf, jf = ready.pop(i)
        th = threading.Thread(target=fetch, args=(i + 1,)) if i + 1 < len(todo) else None
        if th:
            th.start()
        # streams holding wanted pages
        offsets, hit = [], {}
        with bz2.open(jf, "rt", encoding="utf-8") as f:
            for line in f:
                off, pid, _ = line.split(":", 2)
                off, pid = int(off), int(pid)
                if not offsets or offsets[-1] != off:
                    offsets.append(off)
                if pid in ll:
                    hit.setdefault(off, {})[pid] = ll[pid]
        bounds = offsets + [os.path.getsize(xf)]
        ranges = [(bounds[k], bounds[k + 1]) for k in range(len(offsets)) if offsets[k] in hit]
        tasks = []
        for k in range(0, len(ranges), 200):
            g = ranges[k:k + 200]
            want = {pid: w for a, _ in g for pid, w in hit[a].items()}
            tasks.append((xf, g, want, lang))
        with open(os.path.join(outdir, f"{lang}.{len(done):03d}.part"), "w", encoding="utf-8") as out:
            for res in pool.map(extract_streams, tasks):
                for en, t, l in res:
                    out.write(json.dumps({"en": en, "t": t, "l": l}, ensure_ascii=False) + "\n")
        os.remove(xf)
        os.remove(jf)
        done.add(x)
        with open(done_fn, "a") as f:
            f.write(x + "\n")
        log(f"{lang}: {x} — {len(ranges)}/{len(offsets)} streams, {time.time() - t0:.0f}s")
    with open(os.path.join(outdir, f"{lang}.jsonl"), "w", encoding="utf-8") as out:
        for fn in sorted(glob.glob(os.path.join(outdir, f"{lang}.*.part"))):
            out.write(open(fn, encoding="utf-8").read())
    log(f"{lang}: complete")


def main():
    site, redirects, outdir, date, *langs = sys.argv[1:]
    os.makedirs(outdir, exist_ok=True)
    workdir = os.path.join(outdir, "dl")
    os.makedirs(workdir, exist_ok=True)
    wanted = wanted_titles(site)
    canon = canonical_map(redirects, wanted)
    log(f"{len(wanted)} English titles wanted, {len(canon)} with redirects")
    with ProcessPoolExecutor(max(1, (os.cpu_count() or 4) - 4)) as pool:
        for lang in langs:
            if os.path.exists(os.path.join(outdir, f"{lang}.jsonl")):
                log(f"{lang}: already extracted")
                continue
            process_lang(lang, date, workdir, outdir, canon, pool)


if __name__ == "__main__":
    main()
