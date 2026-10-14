/* RunLab — petits graphiques SVG, sans aucune librairie externe.
   Les couleurs viennent des variables CSS pour s'adapter au thème clair/sombre. */
(function () {
  "use strict";
  const NS = "http://www.w3.org/2000/svg";
  const W = 640, H = 240;              // viewBox (responsive via width:100%)
  const PAD = { l: 44, r: 14, t: 16, b: 34 };

  function el(name, attrs, text) {
    const e = document.createElementNS(NS, name);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    return e;
  }
  function svgRoot() {
    return el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", preserveAspectRatio: "xMidYMid meet" });
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function yAxis(svg, min, max, fmt) {
    const steps = 4;
    for (let i = 0; i <= steps; i++) {
      const v = min + (max - min) * (i / steps);
      const y = H - PAD.b - (H - PAD.b - PAD.t) * (i / steps);
      svg.appendChild(el("line", { x1: PAD.l, y1: y, x2: W - PAD.r, y2: y, stroke: "var(--border)", "stroke-width": 1 }));
      svg.appendChild(el("text", { x: PAD.l - 8, y: y + 4, "text-anchor": "end", "font-size": 11, fill: "var(--muted)" }, fmt(v)));
    }
  }

  // Graphique en barres verticales : items = [{label, value}]
  function bars(node, items, opts) {
    opts = opts || {};
    clear(node);
    if (!items.length) { node.appendChild(emptyMsg()); return; }
    const svg = svgRoot();
    const max = Math.max(opts.max || 0, ...items.map(d => d.value), 1);
    const fmt = opts.valueFmt || (v => Math.round(v));
    yAxis(svg, 0, max, fmt);
    const n = items.length;
    const bw = (W - PAD.l - PAD.r) / n;
    const innerW = Math.min(bw * 0.62, 34);
    items.forEach((d, i) => {
      const x = PAD.l + bw * i + (bw - innerW) / 2;
      const h = (H - PAD.b - PAD.t) * (d.value / max);
      const y = H - PAD.b - h;
      svg.appendChild(el("rect", { x, y, width: innerW, height: Math.max(h, d.value > 0 ? 2 : 0), rx: 4, fill: opts.color || "var(--accent)" }));
      if (opts.labelEvery == null || i % opts.labelEvery === 0) {
        svg.appendChild(el("text", { x: x + innerW / 2, y: H - PAD.b + 16, "text-anchor": "middle", "font-size": 10.5, fill: "var(--muted)" }, d.label));
      }
    });
    node.appendChild(svg);
  }

  // Une ou plusieurs courbes : series = [{name, color, points:[{x,y}]}]  (x = index 0..n-1)
  function lines(node, series, opts) {
    opts = opts || {};
    clear(node);
    const all = series.flatMap(s => s.points.map(p => p.y)).filter(v => v != null);
    if (!all.length) { node.appendChild(emptyMsg()); return; }
    const svg = svgRoot();
    let min = opts.min != null ? opts.min : Math.min(...all);
    let max = opts.max != null ? opts.max : Math.max(...all);
    if (min === max) { max = min + 1; }
    const pad = (max - min) * 0.1; min -= pad; max += pad;
    if (opts.minZero) min = Math.min(0, min);
    const fmt = opts.yFmt || (v => Math.round(v));
    yAxis(svg, min, max, fmt);
    const len = Math.max(...series.map(s => s.points.length), 1);
    const xFor = i => PAD.l + (W - PAD.l - PAD.r) * (len <= 1 ? 0.5 : i / (len - 1));
    const yFor = v => H - PAD.b - (H - PAD.b - PAD.t) * ((v - min) / (max - min));

    // étiquettes X
    if (opts.xLabels) {
      const every = Math.ceil(opts.xLabels.length / 6);
      opts.xLabels.forEach((lab, i) => {
        if (i % every === 0 && lab) svg.appendChild(el("text", { x: xFor(i), y: H - PAD.b + 16, "text-anchor": "middle", "font-size": 10.5, fill: "var(--muted)" }, lab));
      });
    }

    series.forEach(s => {
      let d = "";
      s.points.forEach((p, i) => {
        if (p.y == null) return;
        d += (d ? " L" : "M") + xFor(i).toFixed(1) + " " + yFor(p.y).toFixed(1);
      });
      if (s.fill) {
        const first = s.points.findIndex(p => p.y != null);
        const last = (() => { for (let i = s.points.length - 1; i >= 0; i--) if (s.points[i].y != null) return i; return 0; })();
        const area = d + ` L${xFor(last).toFixed(1)} ${(H - PAD.b)} L${xFor(first).toFixed(1)} ${(H - PAD.b)} Z`;
        svg.appendChild(el("path", { d: area, fill: s.color, opacity: 0.12 }));
      }
      svg.appendChild(el("path", { d, fill: "none", stroke: s.color, "stroke-width": 2.5, "stroke-linejoin": "round", "stroke-linecap": "round" }));
      // dernier point mis en avant
      const li = (() => { for (let i = s.points.length - 1; i >= 0; i--) if (s.points[i].y != null) return i; return -1; })();
      if (li >= 0) svg.appendChild(el("circle", { cx: xFor(li), cy: yFor(s.points[li].y), r: 3.5, fill: s.color }));
    });
    node.appendChild(svg);
  }

  // Barres horizontales empilées pour les zones FC : items=[{label,value,color}]
  function stackedBar(node, items) {
    clear(node);
    const total = items.reduce((a, b) => a + b.value, 0);
    if (!total) { node.appendChild(emptyMsg()); return; }
    const barH = 26, gap = 10, labelW = 150;
    const h = items.length * (barH + gap);
    const svg = el("svg", { viewBox: `0 0 ${W} ${h}`, preserveAspectRatio: "xMidYMid meet" });
    const maxV = Math.max(...items.map(i => i.value));
    items.forEach((it, i) => {
      const y = i * (barH + gap);
      svg.appendChild(el("text", { x: 0, y: y + barH * 0.7, "font-size": 13, fill: "var(--text)", "font-weight": 600 }, it.label));
      const track = el("rect", { x: labelW, y, width: W - labelW - 60, height: barH, rx: 7, fill: "var(--surface-2)" });
      svg.appendChild(track);
      const w = (W - labelW - 60) * (it.value / maxV);
      svg.appendChild(el("rect", { x: labelW, y, width: Math.max(w, 2), height: barH, rx: 7, fill: it.color }));
      svg.appendChild(el("text", { x: W - 54, y: y + barH * 0.7, "font-size": 12.5, fill: "var(--muted)", "text-anchor": "start" }, it.display || it.value));
    });
    node.appendChild(svg);
  }

  function emptyMsg() {
    const d = document.createElement("div");
    d.className = "muted small";
    d.style.padding = "28px 0";
    d.style.textAlign = "center";
    d.textContent = "Pas assez de données pour cette période.";
    return d;
  }

  // Mini-courbe sans axes (pour les grilles de métriques). values = nombres.
  function spark(node, values, opts) {
    opts = opts || {};
    clear(node);
    const vals = values.filter(v => v != null && isFinite(v));
    if (vals.length < 2) { const d = document.createElement("div"); d.className = "muted small"; d.textContent = "—"; node.appendChild(d); return; }
    const w = 240, h = 60, p = 6;
    const svg = el("svg", { viewBox: `0 0 ${w} ${h}`, preserveAspectRatio: "none", class: "sparksvg" });
    let min = Math.min(...vals), max = Math.max(...vals);
    if (min === max) { max += 1; min -= 1; }
    const color = opts.color || "var(--accent)";
    const xFor = i => p + (w - 2 * p) * (i / (values.length - 1));
    const yFor = v => h - p - (h - 2 * p) * ((v - min) / (max - min));
    let d = "", first = -1, last = -1;
    values.forEach((v, i) => {
      if (v == null || !isFinite(v)) return;
      if (first < 0) first = i; last = i;
      d += (d ? " L" : "M") + xFor(i).toFixed(1) + " " + yFor(v).toFixed(1);
    });
    const area = d + ` L${xFor(last).toFixed(1)} ${h - p} L${xFor(first).toFixed(1)} ${h - p} Z`;
    svg.appendChild(el("path", { d: area, fill: color, opacity: 0.12 }));
    svg.appendChild(el("path", { d, fill: "none", stroke: color, "stroke-width": 2.5, "stroke-linejoin": "round", "stroke-linecap": "round", "vector-effect": "non-scaling-stroke" }));
    svg.appendChild(el("circle", { cx: xFor(last), cy: yFor(values[last]), r: 3, fill: color }));
    node.appendChild(svg);
  }

  window.Charts = { bars, lines, stackedBar, spark };
})();
