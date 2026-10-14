/* RunLab — graphiques SVG interactifs, sans aucune librairie externe.
   Survol / tap : ligne de visée + infobulle montrant chaque point de donnée. */
(function () {
  "use strict";
  const NS = "http://www.w3.org/2000/svg";
  const W = 640, H = 240;
  const PAD = { l: 44, r: 14, t: 16, b: 34 };

  function el(name, attrs, text) {
    const e = document.createElementNS(NS, name);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    return e;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); node.style.position = "relative"; }
  function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
  function tipEl(node) { const t = document.createElement("div"); t.className = "charttip"; t.style.display = "none"; node.appendChild(t); return t; }

  function yAxis(svg, min, max, fmt) {
    for (let i = 0; i <= 4; i++) {
      const v = min + (max - min) * (i / 4);
      const y = H - PAD.b - (H - PAD.b - PAD.t) * (i / 4);
      svg.appendChild(el("line", { x1: PAD.l, y1: y, x2: W - PAD.r, y2: y, stroke: "var(--border)", "stroke-width": 1 }));
      svg.appendChild(el("text", { x: PAD.l - 8, y: y + 4, "text-anchor": "end", "font-size": 11, fill: "var(--muted)" }, fmt(v)));
    }
  }

  /* -------- barres verticales (interactives) -------- */
  function bars(node, items, opts) {
    opts = opts || {}; clear(node);
    if (!items.length) { node.appendChild(empty()); return; }
    const svg = root();
    const max = Math.max(opts.max || 0, ...items.map(d => d.value), 1);
    const fmt = opts.valueFmt || (v => Math.round(v));
    yAxis(svg, 0, max, fmt);
    const n = items.length, bw = (W - PAD.l - PAD.r) / n, iw = Math.min(bw * 0.62, 34);
    const rects = [];
    items.forEach((d, i) => {
      const x = PAD.l + bw * i + (bw - iw) / 2;
      const h = (H - PAD.b - PAD.t) * (d.value / max), y = H - PAD.b - h;
      const r = el("rect", { x, y, width: iw, height: Math.max(h, d.value > 0 ? 2 : 0), rx: 4, fill: opts.color || "var(--accent)" });
      svg.appendChild(r); rects.push(r);
      if (opts.labelEvery == null || i % opts.labelEvery === 0)
        svg.appendChild(el("text", { x: x + iw / 2, y: H - PAD.b + 16, "text-anchor": "middle", "font-size": 10.5, fill: "var(--muted)" }, d.label));
    });
    const tip = tipEl(node);
    const hit = el("rect", { x: 0, y: 0, width: W, height: H, fill: "transparent" }); svg.appendChild(hit);
    function show(cx) {
      const rc = svg.getBoundingClientRect();
      let i = Math.floor(((cx - rc.left) / rc.width * W - PAD.l) / bw);
      i = Math.max(0, Math.min(n - 1, i));
      rects.forEach((r, k) => r.setAttribute("opacity", k === i ? 1 : 0.4));
      tip.innerHTML = `<div class="tt-x">${esc(items[i].full || items[i].label)}</div><span><i style="background:${opts.color || 'var(--accent)'}"></i>${fmt(items[i].value)}${opts.unit || ''}</span>`;
      tip.style.display = "block";
      tip.style.left = Math.max(4, Math.min(96, (PAD.l + bw * i + bw / 2) / W * 100)) + "%";
    }
    function hide() { rects.forEach(r => r.setAttribute("opacity", 1)); tip.style.display = "none"; }
    hit.addEventListener("pointermove", e => show(e.clientX));
    hit.addEventListener("pointerdown", e => show(e.clientX));
    hit.addEventListener("pointerleave", hide);
    node.appendChild(svg);
  }

  /* -------- courbes (interactives) -------- */
  function lines(node, seriesArr, opts) {
    opts = opts || {}; clear(node);
    const all = seriesArr.flatMap(s => s.points.map(p => p.y)).filter(v => v != null);
    if (!all.length) { node.appendChild(empty()); return; }
    const svg = root();
    let min = opts.min != null ? opts.min : Math.min(...all);
    let max = opts.max != null ? opts.max : Math.max(...all);
    if (min === max) max = min + 1;
    const pad = (max - min) * 0.1; min -= pad; max += pad;
    if (opts.minZero) min = Math.min(0, min);
    const fmt = opts.yFmt || (v => Math.round(v));
    yAxis(svg, min, max, fmt);
    const len = Math.max(...seriesArr.map(s => s.points.length), 1);
    const xFor = i => PAD.l + (W - PAD.l - PAD.r) * (len <= 1 ? 0.5 : i / (len - 1));
    const yFor = v => H - PAD.b - (H - PAD.b - PAD.t) * ((v - min) / (max - min));

    if (opts.xLabels) {
      const every = Math.ceil(opts.xLabels.length / 6);
      opts.xLabels.forEach((lab, i) => { if (i % every === 0 && lab) svg.appendChild(el("text", { x: xFor(i), y: H - PAD.b + 16, "text-anchor": "middle", "font-size": 10.5, fill: "var(--muted)" }, lab)); });
    }
    const lastIdx = s => { for (let i = s.points.length - 1; i >= 0; i--) if (s.points[i].y != null) return i; return -1; };
    seriesArr.forEach(s => {
      let d = "";
      s.points.forEach((p, i) => { if (p.y == null) return; d += (d ? " L" : "M") + xFor(i).toFixed(1) + " " + yFor(p.y).toFixed(1); });
      if (s.fill) {
        const fi = s.points.findIndex(p => p.y != null), li = lastIdx(s);
        svg.appendChild(el("path", { d: d + ` L${xFor(li).toFixed(1)} ${H - PAD.b} L${xFor(fi).toFixed(1)} ${H - PAD.b} Z`, fill: s.color, opacity: 0.12 }));
      }
      svg.appendChild(el("path", { d, fill: "none", stroke: s.color, "stroke-width": 2.5, "stroke-linejoin": "round", "stroke-linecap": "round" }));
      const li = lastIdx(s); if (li >= 0) svg.appendChild(el("circle", { cx: xFor(li), cy: yFor(s.points[li].y), r: 3.5, fill: s.color }));
    });

    // interaction
    const tip = tipEl(node);
    const cross = el("line", { y1: PAD.t, y2: H - PAD.b, stroke: "var(--muted)", "stroke-width": 1, "stroke-dasharray": "3 3", opacity: 0 }); svg.appendChild(cross);
    const dots = seriesArr.map(s => { const c = el("circle", { r: 4.5, fill: s.color, stroke: "var(--surface)", "stroke-width": 2, opacity: 0 }); svg.appendChild(c); return c; });
    const hit = el("rect", { x: 0, y: 0, width: W, height: H, fill: "transparent" }); svg.appendChild(hit);
    function show(cx) {
      const rc = svg.getBoundingClientRect();
      let i = Math.round(((cx - rc.left) / rc.width * W - PAD.l) / (W - PAD.l - PAD.r) * (len - 1));
      i = Math.max(0, Math.min(len - 1, i));
      const x = xFor(i);
      cross.setAttribute("x1", x); cross.setAttribute("x2", x); cross.setAttribute("opacity", 0.5);
      let rows = "";
      seriesArr.forEach((s, si) => {
        const p = s.points[i], v = p ? p.y : null;
        if (v == null) { dots[si].setAttribute("opacity", 0); return; }
        dots[si].setAttribute("cx", x); dots[si].setAttribute("cy", yFor(v)); dots[si].setAttribute("opacity", 1);
        rows += `<span><i style="background:${s.color}"></i>${seriesArr.length > 1 ? esc(s.name) + ": " : ""}${fmt(v)}</span>`;
      });
      const lab = opts.xLabels && opts.xLabels[i] ? opts.xLabels[i] : "";
      tip.innerHTML = `<div class="tt-x">${esc(lab)}</div>${rows}`;
      tip.style.display = "block";
      tip.style.left = Math.max(4, Math.min(96, x / W * 100)) + "%";
    }
    function hide() { cross.setAttribute("opacity", 0); dots.forEach(d => d.setAttribute("opacity", 0)); tip.style.display = "none"; }
    hit.addEventListener("pointermove", e => show(e.clientX));
    hit.addEventListener("pointerdown", e => show(e.clientX));
    hit.addEventListener("pointerleave", hide);
    node.appendChild(svg);
  }

  /* -------- barres horizontales empilées (zones, sommeil) -------- */
  function stackedBar(node, items) {
    clear(node);
    const total = items.reduce((a, b) => a + b.value, 0);
    if (!total) { node.appendChild(empty()); return; }
    const barH = 26, gap = 10, labelW = 150, h = items.length * (barH + gap);
    const svg = el("svg", { viewBox: `0 0 ${W} ${h}`, preserveAspectRatio: "xMidYMid meet" });
    const maxV = Math.max(...items.map(i => i.value));
    items.forEach((it, i) => {
      const y = i * (barH + gap);
      svg.appendChild(el("text", { x: 0, y: y + barH * 0.7, "font-size": 13, fill: "var(--text)", "font-weight": 600 }, it.label));
      svg.appendChild(el("rect", { x: labelW, y, width: W - labelW - 60, height: barH, rx: 7, fill: "var(--surface-2)" }));
      svg.appendChild(el("rect", { x: labelW, y, width: Math.max((W - labelW - 60) * (it.value / maxV), 2), height: barH, rx: 7, fill: it.color }));
      svg.appendChild(el("text", { x: W - 54, y: y + barH * 0.7, "font-size": 12.5, fill: "var(--muted)" }, it.display || it.value));
    });
    node.appendChild(svg);
  }

  /* -------- sparkline -------- */
  function spark(node, values, opts) {
    opts = opts || {}; clear(node);
    const vals = values.filter(v => v != null && isFinite(v));
    if (vals.length < 2) { const d = document.createElement("div"); d.className = "muted small"; d.textContent = "—"; node.appendChild(d); return; }
    const w = 240, h = 60, p = 6;
    const svg = el("svg", { viewBox: `0 0 ${w} ${h}`, preserveAspectRatio: "none", class: "sparksvg" });
    let min = Math.min(...vals), max = Math.max(...vals); if (min === max) { max += 1; min -= 1; }
    const color = opts.color || "var(--accent)";
    const xFor = i => p + (w - 2 * p) * (i / (values.length - 1));
    const yFor = v => h - p - (h - 2 * p) * ((v - min) / (max - min));
    let d = "", first = -1, last = -1;
    values.forEach((v, i) => { if (v == null || !isFinite(v)) return; if (first < 0) first = i; last = i; d += (d ? " L" : "M") + xFor(i).toFixed(1) + " " + yFor(v).toFixed(1); });
    svg.appendChild(el("path", { d: d + ` L${xFor(last).toFixed(1)} ${h - p} L${xFor(first).toFixed(1)} ${h - p} Z`, fill: color, opacity: 0.12 }));
    svg.appendChild(el("path", { d, fill: "none", stroke: color, "stroke-width": 2.5, "stroke-linejoin": "round", "stroke-linecap": "round", "vector-effect": "non-scaling-stroke" }));
    svg.appendChild(el("circle", { cx: xFor(last), cy: yFor(values[last]), r: 3, fill: color }));
    node.appendChild(svg);
  }

  function root() { return el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", preserveAspectRatio: "xMidYMid meet" }); }
  function empty() { const d = document.createElement("div"); d.className = "muted small"; d.style.padding = "28px 0"; d.style.textAlign = "center"; d.textContent = "Pas assez de données pour cette période."; return d; }

  window.Charts = { bars, lines, stackedBar, spark };
})();
