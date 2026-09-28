"use strict";
/* Tree of Life explorer — static site, data in ./data (built by scripts/build.py) */

const DATA = "data/";
const state = { id: 0, unit: null, T: null, filter: "all", view: "cards", domain: [4567, 0], ms: null, playing: null };
const cache = new Map();
let META, TIME, UNITS, UNIT_BY, LEVELS = ["eon", "era", "period", "epoch", "age"];

const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtInt = n => (n ?? 0).toLocaleString("en-US");
const wikiUrl = t => "https://en.wikipedia.org/wiki/" + encodeURIComponent(String(t).replace(/ /g, "_")).replace(/%2F/g, "/").replace(/%3A/g, ":");

/* ---------------- time formatting & scale ---------------- */
function fmtMa(ma) {
  if (ma == null) return "?";
  if (ma === 0) return "present";
  if (ma >= 1000) return (ma / 1000).toFixed(ma % 1000 === 0 ? 0 : 2).replace(/\.?0+$/, "") + " billion years ago";
  if (ma >= 1) return (+ma.toFixed(ma < 10 ? 2 : 1)).toLocaleString("en-US") + " million years ago";
  const ky = ma * 1000;
  if (ky >= 1) return (+ky.toFixed(ky < 10 ? 1 : 0)).toLocaleString("en-US") + " thousand years ago";
  return Math.round(ma * 1e6).toLocaleString("en-US") + " years ago";
}
function fmtShort(ma) {
  if (ma == null) return "?";
  if (ma === 0) return "0";
  if (ma >= 1000) return (ma / 1000).toFixed(2).replace(/\.?0+$/, "") + " Ga";
  if (ma >= 1) return (+ma.toFixed(ma < 10 ? 2 : 1)) + " Ma";
  if (ma >= 0.001) return (+(ma * 1000).toFixed(1)) + " ka";
  return Math.round(ma * 1e6) + " yr";
}
// Piecewise-linear warp so the Phanerozoic gets room while the whole history stays visible.
const WARP = [[4567, 0], [2500, 0.12], [538.8, 0.26], [251.902, 0.47], [66, 0.7], [2.58, 0.95], [0, 1]];
function warp(t) {
  t = Math.max(0, Math.min(4567, t));
  for (let i = 0; i < WARP.length - 1; i++) {
    const [a, wa] = WARP[i], [b, wb] = WARP[i + 1];
    if (t <= a && t >= b) return wa + (a - t) / (a - b) * (wb - wa);
  }
  return 1;
}
function unwarp(w) {
  w = Math.max(0, Math.min(1, w));
  for (let i = 0; i < WARP.length - 1; i++) {
    const [a, wa] = WARP[i], [b, wb] = WARP[i + 1];
    if (w >= wa && w <= wb) return a - (w - wa) / (wb - wa) * (a - b);
  }
  return 0;
}
const alive = (n, T) => n.a != null && n.a >= T && (n.b ?? 0) <= T;

/* ---------------- images ---------------- */
function thumb(file, w) {
  if (!file) return null;
  const f = file.replace(/ /g, "_");
  const h = md5(f);
  let suffix = "";
  if (/\.svg$/i.test(f)) suffix = ".png";
  else if (/\.tiff?$/i.test(f)) return `https://en.wikipedia.org/wiki/Special:FilePath/${encodeURIComponent(f)}?width=${w}`;
  else if (/\.xcf$/i.test(f)) suffix = ".png";
  const enc = encodeURIComponent(f);
  return `https://upload.wikimedia.org/wikipedia/commons/thumb/${h[0]}/${h.slice(0, 2)}/${enc}/${w}px-${enc}${suffix}`;
}
window.imgFail = function (img) {
  const f = img.dataset.file;
  if (!img.dataset.tried && f) {
    img.dataset.tried = 1;
    img.src = `https://en.wikipedia.org/wiki/Special:FilePath/${encodeURIComponent(f.replace(/ /g, "_"))}?width=${img.dataset.w || 330}`;
  } else {
    img.replaceWith(Object.assign(document.createElement("div"), { className: "noimg", textContent: img.dataset.glyph || "🧬" }));
  }
};
function imgTag(file, w, cls = "", glyph = "🧬") {
  if (!file) return `<div class="noimg ${cls}">${glyph}</div>`;
  return `<img class="${cls}" loading="lazy" src="${thumb(file, w)}" data-file="${esc(file)}" data-w="${w}" data-glyph="${glyph}" alt="" onerror="imgFail(this)">`;
}

/* ---------------- data ---------------- */
async function getJSON(url) {
  if (!cache.has(url)) cache.set(url, fetch(url).then(r => { if (!r.ok) throw new Error(url); return r.json(); }));
  return cache.get(url);
}
async function getNode(id) {
  const c = Math.floor(id / META.chunk);
  const ch = await getJSON(`${DATA}n/${c}.json`);
  return ch[id];
}
const RANK_GLYPH = { species: "🔹", genus: "🔸", family: "🟢", order: "🟣", class: "🔷", phylum: "⬢", kingdom: "👑", domain: "🌐", root: "🌳" };
const ITALIC = new Set(["genus", "subgenus", "species", "subspecies", "variety", "form", "section", "subsection", "series", "species group", "species complex", "ichnogenus", "ichnospecies", "oogenus"]);
const sci = (n) => ITALIC.has(n.r) ? `<i>${esc(n.n)}</i>` : esc(n.n);

/* ---------------- router ---------------- */
function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  return { id: p.has("n") ? +p.get("n") : 0, unit: p.get("u") || null, ms: p.get("m") };
}
function writeHash(replace) {
  const p = new URLSearchParams();
  if (state.id) p.set("n", state.id);
  if (state.unit) p.set("u", state.unit);
  const h = "#" + p.toString();
  if (h !== location.hash) (replace ? history.replaceState(null, "", h) : history.pushState(null, "", h));
}
function go(id) { state.id = id; writeHash(); renderNode(); window.scrollTo({ top: $(".explorer").offsetTop - 70, behavior: "smooth" }); }
window.go = go;

/* ---------------- node view ---------------- */
async function lineage(id) {
  const out = [];
  let cur = await getNode(id);
  let guard = 0;
  while (cur && guard++ < 200) {
    out.unshift(cur);
    if (cur.p == null) break;
    cur = await getNode(cur.p);
  }
  return out;
}

function rangeBar(n, big) {
  // strip of eras with the taxon's range highlighted, on the warped scale
  const eras = UNITS.filter(u => u.level === (big ? "period" : "era") || (big && u.level === "era" && u.start > 538.8) || (big && u.level === "eon" && u.name === "Hadean"));
  let seg = eras.map(u => {
    const x0 = warp(u.start) * 100, x1 = warp(u.end) * 100;
    return `<i style="left:${x0}%;width:${x1 - x0}%;background:${u.color}" title="${esc(u.name)}"></i>`;
  }).join("");
  let hl = "";
  if (n.a != null) {
    const x0 = warp(n.a) * 100, x1 = Math.max(warp(n.b ?? 0) * 100, x0 + 0.6);
    hl = `<b style="left:${x0}%;width:${x1 - x0}%"></b>`;
  }
  const cur = state.T != null ? `<u style="left:${warp(state.T) * 100}%"></u>` : "";
  return `<div class="rbar ${big ? "big" : ""}">${seg}${hl}${cur}</div>`;
}

function rangeText(n) {
  if (n.a == null) return n.x ? "Extinct (age unknown)" : "Extant";
  const b = n.b ?? 0;
  if (!n.x && b === 0) return `${fmtShort(n.a)} – present`;
  return `${fmtShort(n.a)} – ${fmtShort(b)}`;
}

const STATUS = {
  EX: ["Extinct", "#5b1a1a"], EW: ["Extinct in the wild", "#6d2a44"], CR: ["Critically endangered", "#cc3333"],
  EN: ["Endangered", "#cc6633"], VU: ["Vulnerable", "#cc9900"], NT: ["Near threatened", "#7fa33a"],
  LC: ["Least concern", "#3a8f5a"], DD: ["Data deficient", "#777"], DOM: ["Domesticated", "#4a6fa5"],
  FOSSIL: ["Fossil", "#7a5c3e"], G5: ["Secure (NatureServe)", "#3a8f5a"], NE: ["Not evaluated", "#666"], PE: ["Possibly extinct", "#8a3030"],
};

async function renderNode() {
  const id = state.id;
  const hero = $("#hero");
  hero.classList.add("loading");
  const n = await getNode(id);
  if (!n) { hero.innerHTML = "<p>Not found.</p>"; return; }
  if (id !== state.id) return;
  const lin = await lineage(id);
  document.title = `${n.c ? n.c + " (" + n.n + ")" : n.n} — Tree of Life`;
  // breadcrumbs
  $("#crumbs").innerHTML = lin.map((a, i) => {
    const major = ["root", "domain", "kingdom", "phylum", "division", "class", "order", "family", "genus", "species"].includes(a.r);
    const last = i === lin.length - 1;
    return `<a href="#n=${a.i}" class="crumb ${major ? "major" : "minor"} ${last ? "cur" : ""}" onclick="go(${a.i});return false" title="${esc(a.r)}">${a.i === 0 ? "🌳 Life" : sci(a)}</a>`;
  }).join('<span class="sep">›</span>');
  const cr = $("#crumbs"); cr.scrollLeft = cr.scrollWidth;

  const st = n.st && STATUS[n.st.replace(/[^A-Z0-9]/g, "")];
  const img = n.m ? imgTag(n.m, 500, "hero-img", RANK_GLYPH[n.r] || "🧬") : `<div class="noimg hero-img">${n.i === 0 ? "🌳" : "🧬"}</div>`;
  const aliveNow = state.T != null && n.a != null ? (alive(n, state.T)
    ? `<span class="pill ok">Alive ${fmtShort(state.T)}</span>` : `<span class="pill no">Not alive ${fmtShort(state.T)}</span>`) : "";
  hero.innerHTML = `
    <div class="hero-media">${img}
      ${n.m && !n.own ? `<div class="imgnote">Representative image from a member group</div>` : (n.cap ? `<div class="imgnote">${esc(n.cap)}</div>` : "")}
    </div>
    <div class="hero-body">
      <div class="rank">${esc(n.r || "")}${n.x ? ' · <span class="ext">extinct †</span>' : ""}</div>
      <h1>${n.x ? "† " : ""}${n.i === 0 ? "Life" : sci(n)}</h1>
      ${n.c ? `<div class="common">${esc(n.c)}</div>` : ""}
      ${n.au ? `<div class="author">${esc(n.au)}</div>` : ""}
      <div class="pills">
        ${st ? `<span class="pill" style="background:${st[1]}">${st[0]}</span>` : ""}
        ${n.s ? `<span class="pill">${fmtInt(n.s)} species</span>` : ""}
        ${n.t ? `<span class="pill">${fmtInt(n.t)} taxa below</span>` : ""}
        ${aliveNow}
      </div>
      ${n.sd ? `<p class="sd">${esc(n.sd)}</p>` : ""}
      <div class="range">
        <div class="range-t"><b>Temporal range:</b> ${esc(rangeText(n))}${n.fr ? ` <span class="muted">· ${esc(n.fr)}</span>` : ""}</div>
        ${n.a != null ? rangeBar(n, true) + `<div class="rbar-axis">${[[4567, "4.57 Ga"], [2500, "2.5 Ga"], [538.8, "539 Ma"], [251.9, "252 Ma"], [66, "66 Ma"], [0, "now"]].map(([t, l]) => `<span style="left:${warp(t) * 100}%">${l}</span>`).join("")}</div>` : ""}
      </div>
      ${n.l ? `<p class="lead">${esc(n.l)}</p>` : ""}
      <div class="actions">
        ${n.w ? `<a class="btn" href="${wikiUrl(n.w)}" target="_blank" rel="noopener">Read on Wikipedia ↗</a>` : ""}
        ${n.a != null ? `<button class="btn ghost" onclick="jumpToTime(${n.a})">⏱ Show its origin in time</button>` : ""}
        ${n.p != null ? `<button class="btn ghost" onclick="go(${n.p})">↑ Parent group</button>` : ""}
      </div>
    </div>`;
  hero.classList.remove("loading");
  renderKids(n);
}

function kidCard(k) {
  const dim = state.filter === "time" && state.T != null && !alive(k, state.T);
  return `<a class="card ${k.x ? "extinct" : ""} ${dim ? "dim" : ""}" href="#n=${k.i}" onclick="go(${k.i});return false">
    <div class="thumb">${imgTag(k.m, 250, "", RANK_GLYPH[k.r] || "🧬")}</div>
    <div class="cbody">
      <div class="cname">${k.x ? "† " : ""}${sci(k)}</div>
      ${k.c ? `<div class="ccommon">${esc(k.c)}</div>` : ""}
      <div class="cmeta"><span class="crank">${esc(k.r || "")}</span>${k.s ? ` · ${fmtInt(k.s)} sp.` : k.t ? ` · ${fmtInt(k.t)} taxa` : ""}</div>
      ${k.a != null ? `<div class="crange">${esc(rangeText(k))}</div>${rangeBar(k, false)}` : ""}
    </div></a>`;
}

function filteredKids(n) {
  let ks = n.k || [];
  if (state.filter === "living") ks = ks.filter(k => !k.x);
  else if (state.filter === "extinct") ks = ks.filter(k => k.x);
  else if (state.filter === "time" && state.T != null) ks = ks.filter(k => alive(k, state.T));
  return ks;
}

function renderKids(n) {
  const ks = filteredKids(n);
  const total = (n.k || []).length + (n.kmore || 0);
  $("#kids-title").innerHTML = total ? `Subgroups <span class="muted">${ks.length}${ks.length !== total ? " of " + fmtInt(total) : ""}</span>` : "No subgroups";
  $("#f-time").textContent = state.T != null ? `Alive ${fmtShort(state.T)}` : "Alive at selected time";
  if (state.view === "tree") { $("#kids").hidden = true; $("#treeview").hidden = false; renderTree(n); return; }
  $("#kids").hidden = false; $("#treeview").hidden = true;
  $("#kids").innerHTML = ks.map(kidCard).join("") +
    (n.kmore ? `<div class="more">…and ${fmtInt(n.kmore)} more. <a href="${wikiUrl(n.w || n.n)}" target="_blank">See Wikipedia</a></div>` : "") +
    (!ks.length && total ? `<div class="more">No subgroups match this filter.</div>` : "");
}

/* ---------------- tree diagram (d3) ---------------- */
async function renderTree(n) {
  const el = $("#treeview");
  el.innerHTML = "";
  const W = el.clientWidth || 800;
  const rootData = { i: n.i, n: n.n, r: n.r, x: n.x, c: n.c, m: n.m, t: n.t, kids: n.k || [], loaded: true, open: true };
  const svg = d3.select(el).append("svg").attr("width", W).attr("height", 560);
  const g = svg.append("g");
  svg.call(d3.zoom().scaleExtent([0.2, 3]).on("zoom", e => g.attr("transform", e.transform)));
  const MAXK = 40;
  function childrenOf(d) {
    if (!d.open) return null;
    const ks = d.kids.filter(k => state.filter === "all" || (state.filter === "living" ? !k.x : state.filter === "extinct" ? k.x : state.T == null || alive(k, state.T)));
    const out = ks.slice(0, MAXK).map(k => (d._c ??= new Map()).get(k.i) || d._c.set(k.i, { ...k, kids: [], loaded: false, open: false }).get(k.i));
    if (ks.length > MAXK) out.push({ more: ks.length - MAXK, i: -1, n: `+${ks.length - MAXK} more`, kids: [] });
    return out;
  }
  async function toggle(d) {
    if (d.more) return;
    if (!d.loaded) { const full = await getNode(d.i); d.kids = full.k || []; d.loaded = true; }
    d.open = !d.open;
    draw();
  }
  function draw() {
    const root = d3.hierarchy(rootData, childrenOf);
    const leaves = root.leaves().length;
    const H = Math.max(520, leaves * 26);
    d3.tree().nodeSize([26, 230])(root);
    let minX = Infinity; root.each(d => { minX = Math.min(minX, d.x); });
    svg.attr("height", Math.min(H + 40, 900));
    g.selectAll("*").remove();
    const off = 30 - minX;
    g.append("g").selectAll("path").data(root.links()).join("path").attr("class", "link")
      .attr("d", d3.linkHorizontal().x(d => d.y + 60).y(d => d.x + off));
    const node = g.append("g").selectAll("g").data(root.descendants()).join("g")
      .attr("class", d => "tnode" + (d.data.x ? " ext" : "") + (d.data.more ? " more" : ""))
      .attr("transform", d => `translate(${d.y + 60},${d.x + off})`);
    node.append("circle").attr("r", d => d.data.more ? 3 : 4 + Math.min(8, Math.log10((d.data.t || 0) + 1) * 2))
      .on("click", (e, d) => toggle(d.data)).append("title").text(d => d.data.more ? "" : "Click to expand/collapse");
    node.append("text").attr("x", 14).attr("dy", "0.32em")
      .html(d => d.data.more ? esc(d.data.n) : `${d.data.x ? "† " : ""}${ITALIC.has(d.data.r) ? `<tspan font-style="italic">${esc(d.data.n)}</tspan>` : esc(d.data.n)}${d.data.c ? `<tspan class="tc"> · ${esc(d.data.c)}</tspan>` : ""}${d.data.t ? `<tspan class="tc"> (${fmtInt(d.data.t)})</tspan>` : ""}`)
      .on("click", (e, d) => { if (!d.data.more) go(d.data.i); });
  }
  draw();
}

/* ---------------- timeline ---------------- */
let tlSvg, tlW = 1000;
const ROW_H = 24, PIN_H = 34;
function tx(t) { const [a, b] = state.domain; const wa = warp(a), wb = warp(b); return (warp(t) - wa) / (wb - wa) * tlW; }
function txInv(x) { const [a, b] = state.domain; const wa = warp(a), wb = warp(b); return unwarp(wa + x / tlW * (wb - wa)); }

function drawTimeline() {
  const el = $("#timeline");
  tlW = el.clientWidth;
  const H = PIN_H + ROW_H * LEVELS.length + 22;
  el.innerHTML = "";
  const svg = d3.select(el).append("svg").attr("width", tlW).attr("height", H);
  tlSvg = svg;
  const [a, b] = state.domain;
  $("#tl-range").textContent = `· ${fmtShort(a)} → ${b === 0 ? "today" : fmtShort(b)}`;
  // bands
  LEVELS.forEach((lvl, row) => {
    const y = PIN_H + row * ROW_H;
    svg.append("text").attr("class", "rowlab").attr("x", 4).attr("y", y + 15).text("");
    const us = UNITS.filter(u => u.level === lvl && u.start > b && u.end < a);
    const g = svg.append("g");
    for (const u of us) {
      const x0 = Math.max(0, tx(u.start)), x1 = Math.min(tlW, tx(u.end));
      const w = x1 - x0;
      if (w < 0.3) continue;
      const sel = state.unit === u.name, inPath = state.unit && unitPath(state.unit).includes(u.name);
      const gr = g.append("g").attr("class", "band" + (sel ? " sel" : inPath ? " path" : "")).on("click", () => selectUnit(u.name, true))
        .on("mousemove", e => tip(e, `<b>${esc(u.name)}</b> <span class="muted">${u.level}</span><br>${fmtShort(u.start)} – ${fmtShort(u.end)}`)).on("mouseleave", hideTip);
      gr.append("rect").attr("x", x0).attr("y", y).attr("width", Math.max(w, 0.5)).attr("height", ROW_H - 1).attr("fill", u.color);
      const label = w > u.name.length * 6.6 + 8 ? u.name : w > 30 ? abbrev(u.name, Math.floor((w - 6) / 6.6)) : "";
      if (label) gr.append("text").attr("x", x0 + w / 2).attr("y", y + 16).attr("text-anchor", "middle").text(label);
    }
  });
  // axis ticks
  const ticks = niceTicks();
  const ay = PIN_H + ROW_H * LEVELS.length + 14;
  for (const t of ticks) {
    const x = tx(t);
    if (x < 0 || x > tlW) continue;
    svg.append("line").attr("class", "tick").attr("x1", x).attr("x2", x).attr("y1", PIN_H).attr("y2", ay - 10);
    svg.append("text").attr("class", "ticklab").attr("x", x).attr("y", ay).attr("text-anchor", x < 20 ? "start" : x > tlW - 20 ? "end" : "middle").text(fmtShort(t));
  }
  // milestones
  const ms = TIME.milestones.filter(m => m.ma <= a && m.ma >= b);
  let lastX = -99, lane = 0;
  ms.sort((p, q) => q.ma - p.ma).forEach(m => {
    const x = tx(m.ma);
    lane = x - lastX < 12 ? (lane + 1) % 3 : 0; lastX = x;
    const y = 8 + lane * 9;
    const gm = svg.append("g").attr("class", "pin " + m.cat + (state.ms === m.title ? " sel" : "")).attr("transform", `translate(${x},${y})`)
      .on("click", () => selectMilestone(m)).on("mousemove", e => tip(e, `<b>${esc(m.title)}</b><br><span class="muted">${fmtMa(m.ma)}</span><br>${esc(m.desc)}`)).on("mouseleave", hideTip);
    gm.append("line").attr("y1", 4).attr("y2", PIN_H - y);
    gm.append("circle").attr("r", 4.5);
  });
  // cursor
  if (state.T != null) {
    const x = tx(state.T);
    if (x >= 0 && x <= tlW) {
      svg.append("line").attr("class", "cursor").attr("x1", x).attr("x2", x).attr("y1", 0).attr("y2", ay - 8);
      svg.append("text").attr("class", "cursorlab").attr("x", Math.min(Math.max(x, 30), tlW - 30)).attr("y", H - 1).attr("text-anchor", "middle").text("▲ " + fmtShort(state.T));
    }
  }
  // wheel zoom + drag pan
  svg.on("wheel", e => {
    e.preventDefault();
    const [x] = d3.pointer(e);
    zoomAt(txInv(x), e.deltaY > 0 ? 1.25 : 0.8);
  }, { passive: false });
  let drag = null;
  svg.on("pointerdown", e => { drag = { x: e.clientX, d: [...state.domain], moved: false }; });
  window.onpointerup = () => { drag = null; };
  svg.on("pointermove", e => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    if (Math.abs(dx) < 4 && !drag.moved) return;
    drag.moved = true;
    const [a0, b0] = drag.d, wa = warp(a0), wb = warp(b0);
    const dw = -dx / tlW * (wb - wa);
    let na = wa + dw, nb = wb + dw;
    if (na < 0) { nb -= na; na = 0; } if (nb > 1) { na -= nb - 1; nb = 1; }
    state.domain = [unwarp(na), unwarp(nb)];
    drawTimeline();
  });
}
function abbrev(s, n) { if (n <= 1) return s[0]; return s.length <= n ? s : s.slice(0, Math.max(1, n - 1)) + "."; }
function niceTicks() {
  const [a, b] = state.domain, wa = warp(a), wb = warp(b);
  const out = [];
  const N = Math.max(4, Math.floor(tlW / 110));
  for (let i = 0; i <= N; i++) {
    let t = unwarp(wa + (wb - wa) * i / N);
    const mag = Math.pow(10, Math.floor(Math.log10(Math.max(t, 1e-6))));
    const step = t / mag >= 5 ? mag : t / mag >= 2 ? mag / 2 : mag / 5;
    t = Math.round(t / step) * step;
    out.push(+t.toPrecision(3));
  }
  return [...new Set(out)];
}
function zoomAt(t, f) {
  const [a, b] = state.domain, wa = warp(a), wb = warp(b), wt = warp(t);
  let na = wt - (wt - wa) * f, nb = wt + (wb - wt) * f;
  if (nb - na > 1) { na = 0; nb = 1; }
  if (nb - na < 0.00002) return;
  if (na < 0) { nb -= na; na = 0; } if (nb > 1) { na -= nb - 1; nb = 1; }
  state.domain = [unwarp(Math.max(0, na)), unwarp(Math.min(1, nb))];
  drawTimeline();
}
function zoomToUnit(u) {
  const pad = (warp(u.end) - warp(u.start)) * 0.35;
  let na = warp(u.start) - pad, nb = warp(u.end) + pad;
  state.domain = [unwarp(Math.max(0, na)), unwarp(Math.min(1, nb))];
}
function tip(e, html) { const t = $("#tip"); t.innerHTML = html; t.hidden = false; t.style.left = Math.min(e.clientX + 14, innerWidth - 300) + "px"; t.style.top = (e.clientY + 14) + "px"; }
function hideTip() { $("#tip").hidden = true; }

function unitPath(name) {
  const out = [];
  let u = UNIT_BY[name];
  while (u) { out.unshift(u.name); u = UNIT_BY[u.parent]; }
  return out;
}
function unitAt(T, level) {
  return UNITS.find(u => u.level === level && u.start >= T && u.end <= T && (u.end < T || T === 0));
}
window.jumpToTime = function (T) {
  const u = unitAt(T, "age") || unitAt(T, "period") || unitAt(T, "era") || unitAt(T, "eon");
  if (u) selectUnit(u.name, true, T);
  $("#timepanel").scrollIntoView({ behavior: "smooth" });
};

function selectUnit(name, zoom, T) {
  state.unit = name; state.ms = null;
  const u = UNIT_BY[name];
  state.T = T ?? (u.start + u.end) / 2;
  if (zoom) zoomToUnit(u.level === "age" ? UNIT_BY[u.parent] : u);
  writeHash(true);
  drawTimeline();
  renderTimePanel();
  if (state.filter === "time") getNode(state.id).then(renderKids);
  else getNode(state.id).then(n => { const h = $("#hero .rbar.big"); if (h && n.a != null) h.outerHTML = rangeBar(n, true); if (state.view === "cards") renderKids(n); });
}
function selectMilestone(m) {
  state.ms = m.title; state.T = m.ma;
  const u = unitAt(m.ma, "age") || unitAt(m.ma, "epoch") || unitAt(m.ma, "period") || unitAt(m.ma, "era") || unitAt(m.ma, "eon");
  state.unit = u ? u.name : state.unit;
  drawTimeline(); renderTimePanel(m);
}

/* ---------------- time panel ---------------- */
function miniCard(b, extra = "") {
  return `<a class="mini ${b.x ? "extinct" : ""}" href="#n=${b.i}" onclick="go(${b.i});return false" title="${esc(b.c || b.n)}">
    ${imgTag(b.m, 120, "", RANK_GLYPH[b.r] || "🧬")}
    <span><b>${b.x ? "† " : ""}${sci(b)}</b>${b.c ? `<small>${esc(b.c)}</small>` : ""}<small class="muted">${esc(b.r || "")}${extra}</small></span></a>`;
}
function inheritMap(u) {
  let cur = u;
  while (cur) { if (cur.map) return cur; cur = UNIT_BY[cur.parent]; }
  // look at children for a map (e.g. an era without one)
  const kid = UNITS.find(k => k.parent === u.name && k.map);
  return kid || null;
}
function renderTimePanel(milestone) {
  const el = $("#timepanel");
  if (!state.unit) { el.innerHTML = milestonesOverview(); return; }
  const u = UNIT_BY[state.unit];
  const path = unitPath(u.name);
  const kids = UNITS.filter(k => k.parent === u.name);
  const mu = inheritMap(u);
  const sib = UNITS.filter(k => k.level === u.level).sort((p, q) => q.start - p.start);
  const si = sib.indexOf(u);
  const prev = sib[si - 1], next = sib[si + 1];
  const ms = TIME.milestones.filter(m => m.ma <= u.start && m.ma >= u.end);
  const earthStats = [["o2", "Atmospheric O₂"], ["co2", "Atmospheric CO₂"], ["temp", "Mean surface temp."], ["sea", "Sea level"]]
    .filter(([k]) => u[k]).map(([k, l]) => `<div><small>${l}</small><b>${esc(u[k])}</b></div>`).join("");
  // curated notes may live on an ancestor
  let notes = u; while (notes && !notes.earth) notes = UNIT_BY[notes.parent];
  el.innerHTML = `
    ${milestone ? `<div class="msbox ${milestone.cat}"><div class="mslab">Milestone · ${fmtMa(milestone.ma)}</div><h3>${esc(milestone.title)}</h3><p>${esc(milestone.desc)}</p>
       ${milestone.taxon ? miniCard(milestone.taxon) : ""}<a href="${wikiUrl(milestone.wiki)}" target="_blank" rel="noopener">Wikipedia: ${esc(milestone.wiki)} ↗</a></div>` : ""}
    <div class="upath">${path.map(p => `<a onclick="selectUnit('${esc(p).replace(/'/g, "\\'")}',true)" style="--c:${UNIT_BY[p].color}">${esc(p)}</a>`).join("<span>›</span>")}</div>
    <div class="uhead" style="--c:${u.color}">
      <div class="ulevel">${esc(u.level)}</div>
      <h2>${esc(u.name)}</h2>
      <div class="udates">${fmtMa(u.start)} → ${u.end === 0 ? "today" : fmtMa(u.end)}<br><span class="muted">Lasted ${fmtShort(u.start - u.end).replace(" Ma", " million years").replace(" ka", " thousand years").replace(" Ga", " billion years")}</span></div>
      <div class="unav">${prev ? `<button onclick="selectUnit('${esc(prev.name).replace(/'/g, "\\'")}',true)">‹ ${esc(prev.name)}</button>` : "<span></span>"}${next ? `<button onclick="selectUnit('${esc(next.name).replace(/'/g, "\\'")}',true)">${esc(next.name)} ›</button>` : ""}</div>
    </div>
    ${mu ? `<figure class="umap">${imgTag(mu.map, 960, "", "🌍")}<figcaption>${esc(mu.mapcap || "")}${mu !== u ? ` <span class="muted">(map from the ${esc(mu.name)})</span>` : ""}</figcaption></figure>` : ""}
    ${notes ? `<section><h3>🌍 What Earth looked like</h3><p>${esc(notes.earth)}${notes !== u ? ` <span class="muted">(${esc(notes.name)})</span>` : ""}</p>${earthStats ? `<div class="estats">${earthStats}</div>` : ""}</section>` : (earthStats ? `<section><h3>🌍 Earth</h3><div class="estats">${earthStats}</div></section>` : "")}
    ${u.desc ? `<section><h3>📜 About the ${esc(u.name)}</h3><p>${esc(u.desc)}</p><a href="${wikiUrl(u.wiki)}" target="_blank" rel="noopener">Read more on Wikipedia ↗</a></section>` : `<section><a href="${wikiUrl(u.wiki)}" target="_blank" rel="noopener">${esc(u.name)} on Wikipedia ↗</a></section>`}
    ${ms.length ? `<section><h3>⭐ Milestones</h3><ul class="mslist">${ms.map(m => `<li class="${m.cat}" onclick='selectMilestone(TIME.milestones.find(x=>x.title===${JSON.stringify(m.title)}))'><b>${esc(m.title)}</b> <span class="muted">${fmtShort(m.ma)}</span><br><small>${esc(m.desc)}</small></li>`).join("")}</ul></section>` : ""}
    ${u.life && u.life.length ? `<section><h3>🦕 Iconic life</h3><div class="minis">${u.life.map(b => miniCard(b)).join("")}</div></section>` : ""}
    ${u.common && u.common.length ? `<section><h3>📈 Most diverse groups <span class="muted">by number of fossil genera on Wikipedia alive at this time</span></h3><div class="minis">${u.common.map(b => miniCard(b, ` · ${b.g} genera`)).join("")}</div></section>` : ""}
    ${(u.firsts_curated && u.firsts_curated.length) || (u.firsts && u.firsts.length) ? `<section><h3>🌱 First appeared</h3><div class="minis">${dedupe([...(u.firsts_curated || []), ...(u.firsts || [])]).slice(0, 18).map(b => miniCard(b, b.a ? ` · from ${fmtShort(b.a)}` : "")).join("")}</div></section>` : ""}
    ${u.firstgenera && u.firstgenera.length ? `<section><h3>🔎 Genera first recorded</h3><div class="minis">${u.firstgenera.slice(0, 12).map(b => miniCard(b)).join("")}</div></section>` : ""}
    ${kids.length ? `<section><h3>⏳ Subdivisions</h3><div class="subunits">${kids.map(k => `<button style="--c:${k.color}" onclick="selectUnit('${esc(k.name).replace(/'/g, "\\'")}',true)"><b>${esc(k.name)}</b><small>${fmtShort(k.start)} – ${fmtShort(k.end)}</small></button>`).join("")}</div></section>` : ""}
    <section class="muted small">${fmtInt(u.alive)} dated genera in the Wikipedia data were alive during this interval.</section>`;
}
function dedupe(list) { const s = new Set(); return list.filter(b => !s.has(b.i) && s.add(b.i)); }
function milestonesOverview() {
  return `<div class="uhead" style="--c:#6ee7b7"><div class="ulevel">overview</div><h2>Milestones of evolution</h2>
    <div class="udates">From the formation of Earth to today. Click one, or click any band of the timeline above.</div></div>
    <ul class="mslist big">${TIME.milestones.map(m => `<li class="${m.cat}" onclick='selectMilestone(TIME.milestones.find(x=>x.title===${JSON.stringify(m.title)}))'>
      <span class="when">${fmtShort(m.ma)}</span><b>${esc(m.title)}</b><br><small>${esc(m.desc)}</small></li>`).join("")}</ul>`;
}
window.selectUnit = selectUnit; window.selectMilestone = selectMilestone;

/* ---------------- play through time ---------------- */
function togglePlay() {
  const btn = $("#tl-play");
  if (state.playing) { clearInterval(state.playing); state.playing = null; btn.textContent = "▶ Journey through time"; return; }
  const seq = UNITS.filter(u => u.level === "period" || (u.level === "era" && u.start > 538.8 && !UNITS.some(k => k.parent === u.name)) || (u.level === "eon" && u.name === "Hadean") || (u.level === "era" && u.parent === "Archean"))
    .sort((a, b) => b.start - a.start);
  let i = Math.max(0, seq.findIndex(u => state.unit && unitPath(state.unit).includes(u.name)));
  if (!state.unit) i = 0;
  const step = () => { if (i >= seq.length) { togglePlay(); return; } selectUnit(seq[i].name, true); i++; };
  btn.textContent = "⏸ Pause";
  step();
  state.playing = setInterval(step, 7000);
}

/* ---------------- search ---------------- */
function normQ(s) { return s.toLowerCase().replace(/-/g, " ").replace(/[^a-z0-9 ]/g, "").trim(); }
let searchSeq = 0;
async function doSearch() {
  const q = normQ($("#search").value);
  const box = $("#search-results");
  if (q.length < 2) { box.hidden = true; return; }
  const seq = ++searchSeq;
  const sh = q.slice(0, 2).padEnd(2, "_");
  if (!META.shards.includes(sh)) { box.innerHTML = `<div class="sr none">No matches</div>`; box.hidden = false; return; }
  const list = await getJSON(`${DATA}s/${sh}.json`);
  if (seq !== searchSeq) return;
  // binary search for prefix start
  let lo = 0, hi = list.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (list[mid][0] < q) lo = mid + 1; else hi = mid; }
  const seen = new Set(), res = [];
  for (let i = lo; i < list.length && list[i][0].startsWith(q) && res.length < 400; i++) {
    const e = list[i];
    if (!seen.has(e[1])) { seen.add(e[1]); res.push(e); }
  }
  res.sort((a, b) => (b[0] === q) - (a[0] === q) || b[5] - a[5]);
  box.innerHTML = res.slice(0, 25).map(e => `<a class="sr" href="#n=${e[1]}" onclick="pickSearch(${e[1]});return false">
     <b>${ITALIC.has(e[3]) ? `<i>${esc(e[2])}</i>` : esc(e[2])}</b>${e[4] ? ` <span>${esc(e[4])}</span>` : ""}<small>${esc(e[3] || "")}${e[5] > 1 ? ` · ${fmtInt(e[5] - 1)} taxa` : ""}</small></a>`).join("") || `<div class="sr none">No matches</div>`;
  box.hidden = false;
}
window.pickSearch = id => { $("#search-results").hidden = true; $("#search").value = ""; go(id); };

/* ---------------- boot ---------------- */
async function boot() {
  [META, TIME] = await Promise.all([getJSON(DATA + "meta.json"), getJSON(DATA + "time.json")]);
  UNITS = TIME.units; UNIT_BY = Object.fromEntries(UNITS.map(u => [u.name, u]));
  $("#stats").innerHTML = `<b>${fmtInt(META.count)}</b> taxa<br><b>${fmtInt(META.species)}</b> species`;
  const h = readHash();
  state.id = h.id; state.unit = h.unit && UNIT_BY[h.unit] ? h.unit : null;
  if (state.unit) { const u = UNIT_BY[state.unit]; state.T = (u.start + u.end) / 2; zoomToUnit(u); }
  drawTimeline(); renderTimePanel(); renderNode();
  $("#search").addEventListener("input", () => { clearTimeout(window._st); window._st = setTimeout(doSearch, 120); });
  $("#search").addEventListener("keydown", e => { if (e.key === "Enter") { const a = $("#search-results .sr"); if (a && a.onclick) a.onclick(); } if (e.key === "Escape") $("#search-results").hidden = true; });
  document.addEventListener("click", e => { if (!e.target.closest(".search")) $("#search-results").hidden = true; });
  $("#filters").addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; state.filter = b.dataset.f; $("#filters .on").classList.remove("on"); b.classList.add("on"); getNode(state.id).then(renderKids); });
  $("#views").addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; state.view = b.dataset.v; $("#views .on").classList.remove("on"); b.classList.add("on"); getNode(state.id).then(renderKids); });
  $("#tl-all").onclick = () => { state.domain = [4567, 0]; drawTimeline(); };
  $("#tl-in").onclick = () => zoomAt(state.T ?? txInv(tlW / 2), 0.5);
  $("#tl-out").onclick = () => zoomAt(state.T ?? txInv(tlW / 2), 2);
  $("#tl-play").onclick = togglePlay;
  $("#home-link").onclick = e => { e.preventDefault(); state.unit = null; state.T = null; state.domain = [4567, 0]; go(0); drawTimeline(); renderTimePanel(); };
  window.addEventListener("popstate", () => { const h = readHash(); state.id = h.id; if (h.unit && UNIT_BY[h.unit]) state.unit = h.unit; renderNode(); drawTimeline(); renderTimePanel(); });
  window.addEventListener("resize", () => { clearTimeout(window._rt); window._rt = setTimeout(drawTimeline, 150); });
}
boot();
