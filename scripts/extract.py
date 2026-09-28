"""Pass 1: scan the English Wikipedia multistream dump in parallel and extract
  - Template:Taxonomy/* pages            -> taxonomy.jsonl
  - articles with a taxobox-family box    -> boxes.jsonl
  - articles with Infobox geologic timespan -> geo.jsonl
  - article + taxonomy-template redirects -> redirects.tsv

Usage: python extract.py <dump.xml.bz2> <index.txt.bz2> <outdir> [workers]
"""
import bz2
import html
import json
import os
import re
import sys
import time
from multiprocessing import Pool

sys.path.insert(0, os.path.dirname(__file__))
from wikitext import find_template, parse_params, strip_noise, lead_paragraph, to_text  # noqa: E402

PAGE_RE = re.compile(r"<page>(.*?)</page>", re.S)
TITLE_RE = re.compile(r"<title>(.*?)</title>")
NS_RE = re.compile(r"<ns>(\d+)</ns>")
REDIR_RE = re.compile(r'<redirect title="([^"]*)"')
TEXT_RE = re.compile(r"<text[^>]*>(.*?)</text>", re.S)
TEXT_EMPTY_RE = re.compile(r"<text[^>]*/>")

BOX_NAMES = r"(automatic[ _]taxobox|taxobox|speciesbox|subspeciesbox|infraspeciesbox|virusbox|hybridbox|ichnobox|oobox|paraphyletic[ _]group)"
BOX_RE = re.compile(r"\{\{\s*" + BOX_NAMES + r"\s*(?=[|}\n<])", re.I)
GEO_RE = re.compile(r"\{\{\s*(infobox[ _]geologic[ _]timespan)\s*(?=[|}\n<])", re.I)
TAXO_RE = re.compile(r"\{\{\s*(don't edit this line)", re.I)
SHORTDESC_RE = re.compile(r"\{\{\s*short description\s*\|([^}]*)\}\}", re.I)

KEEP_BOX_KEYS = None  # keep all params; filtered later


def box_record(title, text, box):
    name, body, s, e = box
    _, named, pos = parse_params(body)
    rec = {"title": title, "box": name.strip().lower().replace("_", " "), "p": named}
    m = SHORTDESC_RE.search(text[:3000])
    if m:
        rec["sd"] = m.group(1).split("|")[0].strip()
    try:
        rec["lead"] = lead_paragraph(text[e:e + 60000])
    except Exception:
        rec["lead"] = ""
    return rec


def process_page(raw, out):
    t = TITLE_RE.search(raw)
    ns = NS_RE.search(raw)
    if not t or not ns:
        return
    title = html.unescape(t.group(1))
    ns = int(ns.group(1))
    if ns not in (0, 10):
        return
    if ns == 10 and not title.startswith("Template:Taxonomy/"):
        return
    r = REDIR_RE.search(raw)
    if r:
        target = html.unescape(r.group(1))
        out["redirects"].append(f"{ns}\t{title}\t{target}\n")
        return
    tm = TEXT_RE.search(raw)
    if not tm:
        return
    text = tm.group(1)
    if ns == 10:
        text = html.unescape(text)
        t2 = strip_noise(text)
        found = find_template(t2, TAXO_RE)
        rec = {"t": title[len("Template:Taxonomy/"):]}
        if found:
            _, named, _ = parse_params(found[1])
            for k in ("rank", "link", "parent", "extinct", "same_as", "always_display"):
                if k in named:
                    rec[k] = named[k]
        else:
            rec["blank"] = True
        out["taxonomy"].append(json.dumps(rec, ensure_ascii=False) + "\n")
        return
    # ns 0: cheap pre-filter on escaped text
    low = text[:200000]
    has_box = ("axobox" in low or "box" in low) and BOX_RE.search(low)
    has_geo = "eologic" in low and GEO_RE.search(low)
    if not has_box and not has_geo:
        return
    text = html.unescape(text)
    clean = strip_noise(text)
    if has_box:
        box = find_template(clean, BOX_RE)
        if box:
            out["boxes"].append(json.dumps(box_record(title, clean, box), ensure_ascii=False) + "\n")
    if has_geo:
        geo = find_template(clean, GEO_RE)
        if geo:
            _, named, _ = parse_params(geo[1])
            rec = {"title": title, "p": named, "lead": lead_paragraph(clean[geo[3]:geo[3] + 60000])}
            out["geo"].append(json.dumps(rec, ensure_ascii=False) + "\n")


def worker(args):
    wid, path, ranges, outdir = args
    out = {"taxonomy": [], "boxes": [], "geo": [], "redirects": []}
    files = {k: open(os.path.join(outdir, f"{k}.{wid:03d}.part"), "w", encoding="utf-8") for k in out}
    n_pages = 0
    with open(path, "rb") as f:
        for (a, b) in ranges:
            f.seek(a)
            data = f.read(b - a) if b else f.read()
            while data:
                d = bz2.BZ2Decompressor()
                try:
                    xml = d.decompress(data)
                except OSError:
                    break
                data = d.unused_data
                s = xml.decode("utf-8", "replace")
                for m in PAGE_RE.finditer(s):
                    n_pages += 1
                    try:
                        process_page(m.group(1), out)
                    except Exception as ex:  # never let one page kill a worker
                        sys.stderr.write(f"[w{wid}] error: {ex!r}\n")
            for k, lst in out.items():
                if lst:
                    files[k].writelines(lst)
                    lst.clear()
    for fh in files.values():
        fh.close()
    return wid, n_pages


def main():
    dump, index, outdir = sys.argv[1:4]
    workers = int(sys.argv[4]) if len(sys.argv) > 4 else 30
    os.makedirs(outdir, exist_ok=True)
    t0 = time.time()
    offsets = set()
    with bz2.open(index, "rt", encoding="utf-8") as f:
        for line in f:
            offsets.add(int(line.split(":", 1)[0]))
    offsets = sorted(offsets)
    size = os.path.getsize(dump)
    print(f"{len(offsets)} streams, index read in {time.time() - t0:.0f}s", flush=True)
    bounds = offsets + [size]
    streams = [(bounds[i], bounds[i + 1]) for i in range(len(offsets))]
    # group consecutive streams into ~64MB reads, then deal them round-robin into many tasks
    groups, cur, cur_sz = [], [], 0
    for a, b in streams:
        if cur and cur_sz + (b - a) > 64 << 20:
            groups.append((cur[0][0], cur[-1][1])); cur, cur_sz = [], 0
        cur.append((a, b)); cur_sz += b - a
    if cur:
        groups.append((cur[0][0], cur[-1][1]))
    tasks = [(i, dump, [g], outdir) for i, g in enumerate(groups)]
    print(f"{len(tasks)} tasks on {workers} workers", flush=True)
    done = 0
    total_pages = 0
    with Pool(workers) as pool:
        for wid, n in pool.imap_unordered(worker, tasks):
            done += 1
            total_pages += n
            if done % 20 == 0 or done == len(tasks):
                print(f"{done}/{len(tasks)} tasks, {total_pages} pages, {time.time() - t0:.0f}s", flush=True)
    # merge parts
    for k in ("taxonomy", "boxes", "geo", "redirects"):
        ext = "tsv" if k == "redirects" else "jsonl"
        with open(os.path.join(outdir, f"{k}.{ext}"), "w", encoding="utf-8") as out:
            for fn in sorted(os.listdir(outdir)):
                if fn.startswith(k + ".") and fn.endswith(".part"):
                    p = os.path.join(outdir, fn)
                    with open(p, encoding="utf-8") as src:
                        out.write(src.read())
                    os.remove(p)
    print(f"done in {time.time() - t0:.0f}s", flush=True)


if __name__ == "__main__":
    main()
