"""Minimal wikitext helpers: balanced template finding, param splitting, plain-text cleanup."""
import re
import html

COMMENT_RE = re.compile(r"<!--.*?-->", re.S)
REF_RE = re.compile(r"<ref[^>/]*/>|<ref[^>]*>.*?</ref>", re.S | re.I)
NOWIKI_RE = re.compile(r"<(nowiki|math|score|syntaxhighlight|gallery|timeline)[^>]*>.*?</\1>", re.S | re.I)


def strip_noise(text):
    text = COMMENT_RE.sub("", text)
    text = NOWIKI_RE.sub("", text)
    text = REF_RE.sub("", text)
    return text


def find_close(text, start):
    """text[start:start+2] == '{{'. Return index just past matching '}}' (or -1)."""
    depth = 0
    i = start
    n = len(text)
    while i < n:
        j = text.find("{{", i)
        k = text.find("}}", i)
        if k == -1:
            return -1
        if j != -1 and j < k:
            depth += 1
            i = j + 2
        else:
            depth -= 1
            i = k + 2
            if depth == 0:
                return i
    return -1


def find_template(text, name_re):
    """Find first template whose name matches compiled regex name_re (anchored at '{{').
    Returns (name, body_without_braces, start, end) or None."""
    for m in name_re.finditer(text):
        s = m.start()
        e = find_close(text, s)
        if e == -1:
            continue
        return m.group(1), text[s + 2:e - 2], s, e
    return None


def split_params(body):
    """Split template body on top-level '|'. First element is the template name."""
    parts = []
    depth_t = 0  # {{ }}
    depth_l = 0  # [[ ]]
    cur = []
    i = 0
    n = len(body)
    while i < n:
        c = body[i]
        two = body[i:i + 2]
        if two == "{{":
            depth_t += 1; cur.append(two); i += 2; continue
        if two == "}}" and depth_t > 0:
            depth_t -= 1; cur.append(two); i += 2; continue
        if two == "[[":
            depth_l += 1; cur.append(two); i += 2; continue
        if two == "]]" and depth_l > 0:
            depth_l -= 1; cur.append(two); i += 2; continue
        if c == "|" and depth_t == 0 and depth_l == 0:
            parts.append("".join(cur)); cur = []; i += 1; continue
        cur.append(c); i += 1
    parts.append("".join(cur))
    return parts


def parse_params(body):
    """Return (name, named dict, positional list)."""
    parts = split_params(body)
    name = parts[0].strip()
    named, pos = {}, []
    for p in parts[1:]:
        eq = _top_level_eq(p)
        if eq >= 0:
            k = p[:eq].strip().lower().replace(" ", "_")
            named[k] = p[eq + 1:].strip()
        else:
            pos.append(p.strip())
    return name, named, pos


def _top_level_eq(p):
    depth = 0
    i = 0
    while i < len(p):
        two = p[i:i + 2]
        if two in ("{{", "[["):
            depth += 1; i += 2; continue
        if two in ("}}", "]]"):
            depth -= 1; i += 2; continue
        if p[i] == "=" and depth == 0:
            return i
        i += 1
    return -1


LINK_RE = re.compile(r"\[\[([^\[\]|]*)(?:\|([^\[\]]*))?\]\]")
EXTLINK_RE = re.compile(r"\[(?:https?:)?//[^\s\]]+\s*([^\]]*)\]")
TAG_RE = re.compile(r"<[^>]+>")
FILE_PREFIX = re.compile(r"^\s*(file|image|category|media):", re.I)


def remove_templates(text, keep=None):
    """Remove all templates; `keep(name, body)` may return replacement string."""
    out = []
    i = 0
    n = len(text)
    while i < n:
        j = text.find("{{", i)
        if j == -1:
            out.append(text[i:]); break
        out.append(text[i:j])
        e = find_close(text, j)
        if e == -1:
            out.append(text[j:]); break
        rep = ""
        if keep:
            body = text[j + 2:e - 2]
            nm = body.split("|", 1)[0].strip()
            r = keep(nm, body)
            if r is not None:
                rep = r
        out.append(rep)
        i = e
    return "".join(out)


def remove_file_links(text):
    out = []
    i = 0
    while True:
        m = re.search(r"\[\[\s*(file|image|category|media)\s*:", text[i:], re.I)
        if not m:
            out.append(text[i:]); break
        s = i + m.start()
        out.append(text[i:s])
        depth = 0
        k = s
        while k < len(text):
            if text.startswith("[[", k):
                depth += 1; k += 2
            elif text.startswith("]]", k):
                depth -= 1; k += 2
                if depth == 0:
                    break
            else:
                k += 1
        i = k
    return "".join(out)


INLINE_KEEP = {
    "extinct": "†", "ex": "†", "†": "†",
    "nbsp": " ", "snd": " – ", "ndash": "–", "mdash": "—", "spaced ndash": " – ", "·": " · ", "dot": " · ",
}


def _inline_keep(name, body):
    ln = name.lower()
    if ln in INLINE_KEEP:
        return INLINE_KEEP[ln]
    if ln in ("small", "smaller", "nowrap", "nobr", "big", "center", "sc", "smallcaps", "lang", "transl", "noitalic", "not a typo", "sic", "taxon italics", "linktext"):
        _, named, pos = parse_params(body)
        if ln in ("lang", "transl"):
            return pos[1] if len(pos) > 1 else ""
        return " ".join(pos)
    if ln in ("sp", "species", "ssp", "sepsl", "genus"):
        _, named, pos = parse_params(body)
        return " ".join(pos)
    if ln in ("convert", "cvt"):
        _, named, pos = parse_params(body)
        if len(pos) >= 2:
            if len(pos) >= 4 and pos[1] in ("-", "–", "to", "and"):
                return f"{pos[0]}–{pos[2]} {pos[3]}"
            return f"{pos[0]} {pos[1]}"
    if ln in ("mya", "ma"):
        _, named, pos = parse_params(body)
        return (" – ".join(pos) + " million years ago") if pos else ""
    if ln in ("circa", "c.", "c"):
        _, named, pos = parse_params(body)
        return "c. " + (pos[0] if pos else "")
    return None


def to_text(wt, keep=_inline_keep):
    """Convert a wikitext fragment to plain text."""
    if not wt:
        return ""
    t = strip_noise(wt)
    t = remove_templates(t, keep)
    t = remove_file_links(t)
    t = LINK_RE.sub(lambda m: (m.group(2) if m.group(2) is not None else m.group(1)).split("#")[0] if not m.group(2) else m.group(2), t)
    t = EXTLINK_RE.sub(lambda m: m.group(1), t)
    t = re.sub(r"<br\s*/?>", " ", t, flags=re.I)
    t = TAG_RE.sub("", t)
    t = t.replace("'''", "").replace("''", "")
    t = html.unescape(t)
    t = re.sub(r"\(\s*[;,]?\s*\)", "", t)
    t = re.sub(r"\(\s*[;,]\s*", "(", t)
    t = re.sub(r"[ \t ]+", " ", t)
    t = re.sub(r"\s+([,.;:])", r"\1", t)
    return t.strip()


def lead_paragraph(text, maxlen=900):
    """Extract the first real prose paragraph of an article as plain text."""
    t = strip_noise(text)
    t = remove_templates(t)
    t = remove_file_links(t)
    t = re.sub(r"\{\|.*?\|\}", "", t, flags=re.S)
    for para in re.split(r"\n\s*\n", t):
        p = para.strip()
        if not p or p[0] in "=*#:;|!{<_":
            continue
        s = to_text(p, keep=None)
        s = re.sub(r"\s+", " ", s)
        if len(s) < 60:
            continue
        if len(s) > maxlen:
            cut = s[:maxlen]
            dot = cut.rfind(". ")
            s = cut[:dot + 1] if dot > 200 else cut.rstrip() + "…"
        return s
    return ""
