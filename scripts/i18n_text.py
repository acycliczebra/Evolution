"""Plain-text leads and titles from non-English Wikipedias (see i18n_extract.py)."""
import re

from wikitext import parse_params, strip_noise, to_text, remove_templates

# namespaces whose [[links]] are media or categories (never prose), in every language we read
MEDIA_NS = (
    "file|image|media|category|datei|bild|kategorie|fichier|catégorie|archivo|imagen|categoría|"
    "ficheiro|arquivo|imagem|categoria|файл|изображение|категория|ファイル|画像|カテゴリ|文件|檔案|"
    "图像|圖像|分类|分類|tập tin|hình|thể loại|dosya|resim|kategori|پرونده|تصویر|رده|파일|그림|분류|"
    "चित्र|फ़ाइल|श्रेणी"
)
MEDIA_RE = re.compile(r"\[\[\s*(?:" + MEDIA_NS + r")\s*:", re.I)

MIN_LEN = {"ja": 12, "ko": 25}
MAX_LEN = {"ja": 350, "ko": 450}
SENTENCE_END = re.compile(r"(?<=[.!?])\s|(?<=[。！？])|(?<=[।؟])\s?")

# inline templates whose last positional parameter is visible text
TEXT_TEMPLATES = {
    "sname", "snamei", "sname2", "btname", "taxon italics", "lang", "transl", "nobr", "nowrap",
    "noitalic", "small", "sc", "script", "polytonic", "近日公開", "nihongo", "font", "japanese",
    "訳語疑問点", "仮リンク", "illm", "ill", "interlanguage link", "link-interwiki", "jl",
    "lien", "ill-wd", "ixl", "ilh", "link-en", "vxl", "tsl", "llang",
}
# templates whose first positional parameter is the visible text (rare-character and ruby helpers)
FIRST_TEMPLATES = {"ruby", "ruby-ja", "rubyh", "linktext", "le", "lj", "jk"}
JOIN_TEMPLATES = {"unité", "nombre", "nb", "formatnum", "val", "cvt", "convert"}


def _keep(name, body):
    ln = name.strip().lower().replace("_", " ")
    if ln in ("extinct", "†", "вымер", "vm", "éteint", "ex"):
        return "†"
    if ln in ("nbsp", "unicode"):
        return " "
    if ln in ("ndash", "snd"):
        return "–"
    if ln == "mdash":
        return "—"
    if ln.startswith("lang-") or ln.startswith("lang ") or ln in TEXT_TEMPLATES:
        _, named, pos = parse_params(body)
        if ln in ("仮リンク", "illm", "ill", "interlanguage link", "link-interwiki", "jl", "lien", "ill-wd",
                  "ixl", "ilh", "link-en", "vxl", "tsl", "llang"):
            # interlanguage links show their first argument (the local title)
            return pos[0] if pos else named.get("fr", named.get("trad", ""))
        return pos[-1] if pos else ""
    if ln in FIRST_TEMPLATES:
        _, named, pos = parse_params(body)
        return pos[0] if pos else ""
    if ln in JOIN_TEMPLATES:
        _, named, pos = parse_params(body)
        return " ".join(p for p in pos[:2] if p)
    return None


def remove_media_links(text):
    out, i = [], 0
    while True:
        m = MEDIA_RE.search(text, i)
        if not m:
            out.append(text[i:])
            return "".join(out)
        out.append(text[i:m.start()])
        depth, k = 0, m.start()
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


def tidy(s):
    s = re.sub(r"''+", "", s)                                    # unbalanced bold/italic markup
    s = re.sub(r"^[\s'\"’,;:.]+", "", s)
    s = re.sub(r"\s+", " ", s)
    s = re.sub(r"[（(]\s*[、,;；，:：]?\s*[）)]", "", s)          # empty brackets left by templates
    s = re.sub(r"([（(])\s*[、,;；，]\s*", r"\1", s)
    s = re.sub(r"\s*[、,;；，]\s*([）)])", r"\1", s)
    s = re.sub(r"\s+([,.;:!?،])", r"\1", s)
    return s.strip()


# magic words for the page's own title ({{PAGENAME}} in every language we read)
PAGENAME_RE = re.compile(r"\{\{\s*(?:PAGENAME|PAGENAMEE|BASEPAGENAME|SAYFAADI|SAYFAADı|НАЗВАНИЕ_СТРАНИЦЫ|НАЗВАНИЕСТРАНИЦЫ|ИМЯ_СТРАНИЦЫ|نام‌صفحه|نام_صفحه|페이지이름|TÊNTRANG|NOMEPAGINA|SEITENNAME|NOMBREPAGINA|NOMPAGE)\s*\}\}", re.I)


def local_lead(text, lang, title=""):
    """The first real prose paragraph of a local article, as plain text."""
    text = PAGENAME_RE.sub(lambda m: title, text)
    t = strip_noise(text)
    t = remove_templates(t, _keep)
    t = remove_media_links(t)
    t = re.sub(r"\{\|.*?\|\}", "", t, flags=re.S)
    t = re.sub(r"__[A-ZÄÖÜ_]+__", "", t)
    lo, hi = MIN_LEN.get(lang, 40), MAX_LEN.get(lang, 900)
    for para in re.split(r"\n\s*\n", t):
        p = para.strip()
        if not p or p[0] in "=*#:;|!{}<_[" and not p.startswith("[[") or p.startswith("[[") and p.endswith("]]") and "\n" not in p and len(p) < 120:
            continue
        s = tidy(to_text(p, keep=None))
        if len(s) < lo:
            continue
        if len(s) > hi:
            cut = s[:hi]
            ends = [m.end() for m in SENTENCE_END.finditer(cut)]
            s = cut[:ends[-1]].rstrip() if ends and ends[-1] > hi // 4 else cut.rstrip() + "…"
        return s
    return ""


def clean_title(title, lang):
    t = re.sub(r"\s*[（(][^()（）]*[)）]\s*$", "", title).strip() or title
    return t
