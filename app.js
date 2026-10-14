/* RunLab — analyse running avancée à partir de l'export Garmin.
   100% dans le navigateur : rien n'est envoyé sur Internet. */
(function () {
  "use strict";

  const STORE_KEY = "runlab:data";
  const SET_KEY = "runlab:settings";
  const DAY = 86400000;

  let DATA = null;
  let settings = { periodDays: 84 };

  const byId = id => document.getElementById(id);

  /* ---------------- formats ---------------- */
  function parseDate(s) { if (!s) return null; const d = new Date(String(s).replace(" ", "T")); return isNaN(d) ? null : d; }
  function parseDay(s) { if (!s) return null; const d = new Date(s + "T00:00:00"); return isNaN(d) ? null : d; }
  function pad2(n) { return String(n).padStart(2, "0"); }
  function fmtPace(spk) { if (spk == null || !isFinite(spk) || spk <= 0) return "—"; const m = Math.floor(spk / 60), s = Math.round(spk % 60); return `${m}:${pad2(s)}`; }
  function fmtDur(sec) { if (!sec) return "—"; sec = Math.round(sec); const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60; return h ? `${h}h${pad2(m)}` : `${m}:${pad2(s)}`; }
  function fmtRace(sec) { if (!sec) return "—"; sec = Math.round(sec); const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60; return h ? `${h}h${pad2(m)}` : `${m}:${pad2(s)}`; }
  function fmtKm(v) { return (Math.round(v * 10) / 10).toLocaleString("fr-FR"); }
  function dmy(d) { return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}`; }
  function longDate(d) { return d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" }); }
  function weekStart(d) { const t = new Date(d); const day = (t.getDay() + 6) % 7; t.setHours(0, 0, 0, 0); t.setDate(t.getDate() - day); return t; }
  function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

  /* ---------------- accès données ---------------- */
  function series(k) { return (DATA && DATA.series && DATA.series[k]) || null; }
  function allActs() { return (DATA && DATA.activities) || []; }
  function runs() {
    return allActs().filter(a => a.type === "running" && a.distance_km > 0)
      .map(a => ({ ...a, date: parseDate(a.start) })).filter(a => a.date)
      .sort((a, b) => a.date - b.date);
  }
  function inPeriod(list, days) { if (!days || days === Infinity) return list; const c = Date.now() - days * DAY; return list.filter(a => a.date.getTime() >= c); }
  function profile() { return (DATA && DATA.profile) || {}; }
  function maxHR() { return profile().max_hr || 194; }
  function restHR() { return profile().resting_hr || 55; }

  /* ---------------- calculs de base ---------------- */
  function sumDist(l) { return l.reduce((a, b) => a + (b.distance_km || 0), 0); }
  function weightedPace(l) { let d = 0, t = 0; l.forEach(a => { if (a.avg_pace_s_per_km && a.distance_km) { d += a.distance_km; t += a.avg_pace_s_per_km * a.distance_km; } }); return d ? t / d : null; }

  function weeklyVolume(l, maxW) {
    const map = new Map();
    l.forEach(a => { const w = weekStart(a.date).getTime(); map.set(w, (map.get(w) || 0) + a.distance_km); });
    const out = []; const now = weekStart(new Date()).getTime();
    let start = map.size ? Math.min(...map.keys()) : now;
    for (let w = start; w <= now; w += 7 * DAY) out.push({ ws: w, km: map.get(w) || 0 });
    return maxW ? out.slice(-maxW) : out;
  }

  // tendance d'une série de nombres : {current, start, delta, pct}
  function trend(values) {
    const v = values.filter(x => x != null && isFinite(x));
    if (!v.length) return null;
    const current = v[v.length - 1], start = v[0];
    const delta = current - start;
    return { current, start, delta, pct: start ? (delta / start) * 100 : 0 };
  }
  // couleur d'une variation selon le "bon sens" (up/down/neutral)
  function dirClass(delta, dir) {
    if (!dir || dir === "neutral" || Math.abs(delta) < 1e-9) return "flat";
    const good = dir === "up" ? delta > 0 : delta < 0;
    return good ? "up" : "down";
  }

  /* ================= PROGRESSION ================= */
  function renderProgression() {
    const card = byId("card-progress");
    const vo2 = series("vo2max"), fa = series("fitness_age"), rp = series("race_predictions");
    if (!vo2 && !fa && !rp) { card.classList.add("hidden"); return; }
    card.classList.remove("hidden");

    // tuiles phares
    const tiles = byId("progress-tiles"); tiles.innerHTML = "";
    const addTile = (label, valueHtml, sub, dir, delta, values, color) => {
      const el = document.createElement("div"); el.className = "mcard";
      const t = delta != null ? `<span class="delta ${dirClass(delta, dir)}">${delta > 0 ? "▲" : delta < 0 ? "▼" : "="} ${Math.abs(Math.round(delta * 10) / 10)}</span>` : "";
      el.innerHTML = `<div class="mlabel">${label}</div><div class="mval">${valueHtml}</div><div class="msub">${sub} ${t}</div><div class="mspark"></div>`;
      tiles.appendChild(el);
      if (values) Charts.spark(el.querySelector(".mspark"), values, { color: color || "var(--accent)" });
    };

    if (vo2) { const t = trend(vo2.map(x => x.value)); addTile("VO2max", `${t.current}`, "depuis le début", "up", t.delta, vo2.map(x => x.value), "var(--fitness)"); }
    if (fa) { const t = trend(fa.map(x => x.fitness_age)); const chrono = fa[fa.length - 1].chrono_age; addTile("Âge de forme", `${t.current}<small> ans</small>`, chrono ? `âge réel ${chrono}` : "", "down", t.delta, fa.map(x => x.fitness_age), "var(--good)"); }
    if (rp) { const t = trend(rp.map(x => x.t10k)); addTile("Prédiction 10 km", fmtRace(t.current), "estimation Garmin", "down", Math.round(t.delta), rp.map(x => -x.t10k), "var(--accent)"); }

    // prédictions de course (dernières)
    if (rp) {
      const last = rp[rp.length - 1];
      const preds = [["5 km", last.t5k], ["10 km", last.t10k], ["Semi", last.half], ["Marathon", last.marathon]];
      byId("pred-tiles").innerHTML = preds.map(([k, v]) => `<div class="record"><div class="k">${k}</div><div class="v">${fmtRace(v)}</div></div>`).join("");
      // courbe prédiction 10K (inversée : plus haut = plus rapide)
      Charts.lines(byId("chart-pred"), [{ name: "10 km", color: "var(--accent)", fill: true, points: rp.map(x => ({ y: -x.t10k })) }],
        { yFmt: v => fmtRace(-v), xLabels: rp.map(x => dmy(parseDay(x.date))) });
      byId("pred-note").textContent = "Temps de course estimés par Garmin — courbe du 10 km (plus haut = plus rapide).";
    } else { byId("card-pred").classList.add("hidden"); }

    // VO2max dans le temps
    if (vo2) {
      Charts.lines(byId("chart-vo2"), [{ name: "VO2max", color: "var(--fitness)", fill: true, points: vo2.map(x => ({ y: x.value })) }],
        { yFmt: v => Math.round(v), xLabels: vo2.map(x => dmy(parseDay(x.date))) });
    } else { byId("vo2-wrap").classList.add("hidden"); }
  }

  /* ================= VOLUME / PMC / ALLURE ================= */
  function renderVolume(per, all) {
    Charts.bars(byId("chart-volume"), weeklyVolume(per.length ? per : all, 16).map(w => ({ label: dmy(new Date(w.ws)), value: w.km })),
      { valueFmt: v => Math.round(v), labelEvery: 2 });
  }

  function pmc() {
    const r = runs(); if (!r.length) return null;
    const rh = restHR(), mh = maxHR();
    const byDay = new Map();
    allActs().forEach(a => {
      const d = parseDate(a.start); if (!d) return;
      const key = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
      let load = (typeof a.training_load === "number" && a.training_load > 0) ? a.training_load : null;
      if (load == null) { const mins = (a.moving_s || a.duration_s || 0) / 60; let it = 0.7; if (a.avg_hr && mh > rh) it = Math.max(0.1, Math.min(1, (a.avg_hr - rh) / (mh - rh))); load = mins * it * 2.2; }
      byDay.set(key, (byDay.get(key) || 0) + load);
    });
    const first = Math.min(...byDay.keys());
    const today = (() => { const t = new Date(); return new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime(); })();
    const lc = 2 / 43, la = 2 / 8; let ctl = 0, atl = 0; const s = [];
    for (let d = first; d <= today; d += DAY) { const l = byDay.get(d) || 0; ctl += (l - ctl) * lc; atl += (l - atl) * la; s.push({ day: d, ctl, atl, tsb: ctl - atl }); }
    return s;
  }
  function formLabel(tsb) { if (tsb > 8) return { t: "Frais", c: "good" }; if (tsb > -10) return { t: "Optimal", c: "good" }; if (tsb > -25) return { t: "Charge élevée", c: "warn" }; return { t: "Fatigue importante", c: "fatigue" }; }

  function renderLoad() {
    const s = pmc(); const card = byId("card-load");
    if (!s || s.length < 7) { card.classList.add("hidden"); return; } card.classList.remove("hidden");
    const days = settings.periodDays === Infinity ? 365 : Math.max(settings.periodDays, 42);
    const sl = s.slice(-days);
    Charts.lines(byId("chart-load"), [
      { name: "Forme", color: "var(--fitness)", fill: true, points: sl.map(x => ({ y: x.ctl })) },
      { name: "Fatigue", color: "var(--fatigue)", points: sl.map(x => ({ y: x.atl })) },
    ], { yFmt: v => Math.round(v), xLabels: sl.map(x => dmy(new Date(x.day))), minZero: true });
    const t = s[s.length - 1], lab = formLabel(t.tsb);
    const pill = byId("form-pill"); pill.className = "pill " + lab.c; pill.textContent = `${lab.t} · forme ${t.tsb > 0 ? "+" : ""}${Math.round(t.tsb)}`;
  }

  function renderPace(per) {
    const f = per.filter(a => a.distance_km >= 1.5 && a.avg_pace_s_per_km);
    Charts.lines(byId("chart-pace"), [{ name: "Allure", color: "var(--accent)", fill: true, points: f.map(a => ({ y: -a.avg_pace_s_per_km })) }],
      { yFmt: v => fmtPace(-v), xLabels: f.map(a => dmy(a.date)) });
  }

  // Efficacité aérobie : vitesse (m/min) par battement — monte = tu progresses
  function renderEfficiency(per) {
    const f = per.filter(a => a.avg_hr && a.avg_pace_s_per_km && a.distance_km >= 1.5);
    if (f.length < 3) { byId("card-eff").classList.add("hidden"); return; } byId("card-eff").classList.remove("hidden");
    const ef = a => (60000 / a.avg_pace_s_per_km) / a.avg_hr;
    Charts.lines(byId("chart-eff"), [{ name: "Efficacité", color: "var(--good)", fill: true, points: f.map(a => ({ y: ef(a) })) }],
      { yFmt: v => v.toFixed(2), xLabels: f.map(a => dmy(a.date)) });
    const t = trend(f.map(ef));
    const pill = byId("eff-pill"); const cls = dirClass(t.delta, "up");
    pill.className = "pill " + (cls === "up" ? "good" : cls === "down" ? "fatigue" : "warn");
    pill.textContent = t.delta >= 0 ? `↗ +${(t.pct).toFixed(0)}% depuis le début` : `↘ ${(t.pct).toFixed(0)}%`;
  }

  /* ================= DYNAMIQUE DE COURSE ================= */
  const DYN = [
    { key: "avg_cadence", label: "Cadence", unit: "spm", dir: "up", fmt: v => Math.round(v) },
    { key: "avg_stride_m", label: "Longueur de foulée", unit: "m", dir: "up", fmt: v => v.toFixed(2) },
    { key: "avg_gct_ms", label: "Contact au sol", unit: "ms", dir: "down", fmt: v => Math.round(v) },
    { key: "avg_vosc_cm", label: "Oscillation vert.", unit: "cm", dir: "down", fmt: v => v.toFixed(1) },
    { key: "avg_power", label: "Puissance", unit: "W", dir: "neutral", fmt: v => Math.round(v) },
  ];
  function renderDynamics(per) {
    const grid = byId("dyn-grid"); grid.innerHTML = "";
    let any = false;
    DYN.forEach(m => {
      const vals = per.filter(a => a[m.key] != null).map(a => a[m.key]);
      if (vals.length < 2) return; any = true;
      const t = trend(vals);
      const el = document.createElement("div"); el.className = "mcard";
      const deltaTxt = m.dir === "neutral" ? "" : `<span class="delta ${dirClass(t.delta, m.dir)}">${t.delta > 0 ? "▲" : "▼"} ${Math.abs(Math.round(t.delta * 100) / 100)}</span>`;
      el.innerHTML = `<div class="mlabel">${m.label}</div><div class="mval">${m.fmt(t.current)}<small> ${m.unit}</small></div><div class="msub">moy ${m.fmt(vals.reduce((a, b) => a + b, 0) / vals.length)} · ${deltaTxt}</div><div class="mspark"></div>`;
      grid.appendChild(el);
      Charts.spark(el.querySelector(".mspark"), vals, { color: "var(--accent)" });
    });
    byId("card-dynamics").classList.toggle("hidden", !any);
  }

  /* ================= ZONES & INTENSITÉ ================= */
  function aggZones(per, key) {
    const secs = [0, 0, 0, 0, 0]; let has = false;
    per.forEach(a => { if (a[key]) { has = true; a[key].forEach(z => { if (z.zone >= 1 && z.zone <= 5) secs[z.zone - 1] += z.seconds || 0; }); } });
    return has ? secs : null;
  }
  function renderZones(per) {
    const colors = ["var(--z1)", "var(--z2)", "var(--z3)", "var(--z4)", "var(--z5)"];
    const names = ["Z1 · récup", "Z2 · endurance", "Z3 · tempo", "Z4 · seuil", "Z5 · VO2max"];
    let z = aggZones(per, "hr_zones"), estimated = false;
    if (!z) {
      z = [0, 0, 0, 0, 0]; estimated = true; const mhr = maxHR();
      per.forEach(a => { if (!a.avg_hr || !a.moving_s) return; const p = a.avg_hr / mhr; let i = p < 0.6 ? 0 : p < 0.7 ? 1 : p < 0.8 ? 2 : p < 0.9 ? 3 : 4; z[i] += a.moving_s; });
    }
    const tot = z.reduce((a, b) => a + b, 0) || 1;
    Charts.stackedBar(byId("chart-zones"), z.map((s, i) => ({ label: names[i], value: s, color: colors[i], display: `${fmtDur(s)} · ${Math.round(s / tot * 100)}%` })));
    byId("zones-note").textContent = estimated ? "Estimation à partir de la FC moyenne." : "Temps réel passé dans chaque zone de FC.";

    // polarisation 80/20
    const easy = z[0] + z[1], mod = z[2], hard = z[3] + z[4];
    const pe = Math.round(easy / tot * 100), pm = Math.round(mod / tot * 100), ph = Math.round(hard / tot * 100);
    byId("polar-bar").innerHTML =
      `<div class="polseg" style="width:${pe}%;background:var(--z2)"></div><div class="polseg" style="width:${pm}%;background:var(--z3)"></div><div class="polseg" style="width:${ph}%;background:var(--z5)"></div>`;
    let verdict, vc;
    if (pe >= 75) { verdict = "Bien polarisé — excellente base aérobie 👏"; vc = "good"; }
    else if (pe >= 60) { verdict = "Un peu trop d'intensité — vise ~80% facile"; vc = "warn"; }
    else { verdict = "Trop d'intensité — privilégie l'endurance facile"; vc = "fatigue"; }
    byId("polar-legend").innerHTML = `<span><i style="background:var(--z2)"></i> Facile ${pe}%</span><span><i style="background:var(--z3)"></i> Modéré ${pm}%</span><span><i style="background:var(--z5)"></i> Intense ${ph}%</span>`;
    const pill = byId("polar-pill"); pill.className = "pill " + vc; pill.textContent = verdict;

    // zones de puissance
    const pz = aggZones(per, "power_zones");
    const def = series("power_zones_def");
    if (pz) {
      byId("powerzones-wrap").classList.remove("hidden");
      const ptot = pz.reduce((a, b) => a + b, 0) || 1;
      const pnames = ["Z1 · récup", "Z2 · endurance", "Z3 · tempo", "Z4 · seuil", "Z5 · anaérobie"];
      Charts.stackedBar(byId("chart-powerzones"), pz.map((s, i) => ({ label: pnames[i], value: s, color: colors[i], display: `${fmtDur(s)} · ${Math.round(s / ptot * 100)}%` })));
      byId("powerzones-note").textContent = def ? `Basé sur ta puissance seuil (FTP) de ${def.ftp} W.` : "Temps passé dans chaque zone de puissance.";
    } else { byId("powerzones-wrap").classList.add("hidden"); }
  }

  /* ================= RECORDS ================= */
  function records(r) {
    if (!r.length) return [];
    const out = [];
    const longest = r.reduce((a, b) => b.distance_km > a.distance_km ? b : a);
    out.push({ k: "Plus longue sortie", v: fmtKm(longest.distance_km) + " km", d: longDate(longest.date) });
    const lt = r.reduce((a, b) => (b.moving_s || 0) > (a.moving_s || 0) ? b : a);
    out.push({ k: "Plus longue durée", v: fmtDur(lt.moving_s), d: fmtKm(lt.distance_km) + " km" });
    const paced = r.filter(a => a.distance_km >= 3 && a.avg_pace_s_per_km);
    if (paced.length) { const b = paced.reduce((x, y) => y.avg_pace_s_per_km < x.avg_pace_s_per_km ? y : x); out.push({ k: "Meilleure allure (≥3 km)", v: fmtPace(b.avg_pace_s_per_km) + " /km", d: fmtKm(b.distance_km) + " km · " + longDate(b.date) }); }
    const eff = (lo, hi, label) => { const c = r.filter(a => a.distance_km >= lo && a.distance_km <= hi && a.moving_s); if (c.length) { const b = c.reduce((x, y) => y.moving_s < x.moving_s ? y : x); out.push({ k: "Meilleur " + label, v: fmtDur(b.moving_s), d: fmtPace(b.avg_pace_s_per_km) + " /km · " + longDate(b.date) }); } };
    eff(4.7, 5.6, "5 km"); eff(9.5, 10.7, "10 km"); eff(20.5, 21.6, "semi"); eff(41.5, 43, "marathon");
    const climb = r.reduce((a, b) => (b.elevation_gain_m || 0) > (a.elevation_gain_m || 0) ? b : a);
    if (climb.elevation_gain_m) out.push({ k: "Plus gros dénivelé", v: "+" + Math.round(climb.elevation_gain_m) + " m", d: fmtKm(climb.distance_km) + " km · " + longDate(climb.date) });
    const wk = weeklyVolume(r); if (wk.length) { const b = wk.reduce((x, y) => y.km > x.km ? y : x); out.push({ k: "Semaine la plus chargée", v: fmtKm(b.km) + " km", d: "semaine du " + dmy(new Date(b.ws)) }); }
    return out.slice(0, 6);
  }
  function renderRecords(r) { byId("records").innerHTML = records(r).map(x => `<div class="record"><div class="k">${x.k}</div><div class="v">${x.v}</div><div class="d">${x.d}</div></div>`).join(""); }

  /* ================= RÉCUPÉRATION ================= */
  function dailySorted() { return ((DATA && DATA.daily) || []).map(x => ({ ...x, d: parseDay(x.date) })).filter(x => x.d).sort((a, b) => a.d - b.d); }
  function renderRecovery() {
    const card = byId("card-recovery");
    const d = dailySorted(); const hrv = series("hrv");
    if (!d.length && !hrv) { card.classList.add("hidden"); return; } card.classList.remove("hidden");

    // HRV
    if (hrv && hrv.length > 1) { byId("hrv-wrap").classList.remove("hidden"); Charts.lines(byId("chart-hrv"), [{ name: "HRV", color: "var(--fitness)", fill: true, points: hrv.map(x => ({ y: x.value })) }], { yFmt: v => Math.round(v), xLabels: hrv.map(x => dmy(parseDay(x.date))) }); }
    else byId("hrv-wrap").classList.add("hidden");

    // FC repos
    const rhr = d.filter(x => x.resting_hr != null);
    if (rhr.length > 1) { byId("rhr-wrap").classList.remove("hidden"); Charts.lines(byId("chart-rhr"), [{ name: "FC repos", color: "var(--accent)", fill: true, points: rhr.map(x => ({ y: x.resting_hr })) }], { yFmt: v => Math.round(v), xLabels: rhr.map(x => dmy(x.d)) }); }
    else byId("rhr-wrap").classList.add("hidden");

    // sommeil (stades moyens sur 14 nuits)
    const sl = d.filter(x => x.deep_s != null || x.light_s != null || x.rem_s != null).slice(-14);
    if (sl.length) {
      const avg = k => { const v = sl.map(x => x[k]).filter(x => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0; };
      Charts.stackedBar(byId("chart-sleep"), [
        { label: "Profond", value: avg("deep_s"), color: "var(--fitness)", display: fmtDur(avg("deep_s")) },
        { label: "Léger", value: avg("light_s"), color: "var(--z1)", display: fmtDur(avg("light_s")) },
        { label: "Paradoxal", value: avg("rem_s"), color: "var(--z4)", display: fmtDur(avg("rem_s")) },
      ]);
      const tot = avg("deep_s") + avg("light_s") + avg("rem_s");
      byId("sleep-note").textContent = `Durée moyenne ${fmtDur(tot)} / nuit (14 dernières nuits).`;
      byId("sleep-wrap").classList.remove("hidden");
    } else byId("sleep-wrap").classList.add("hidden");

    // tuiles
    const last = n => d.slice(-n);
    const avg = (arr, k) => { const v = arr.map(x => x[k]).filter(x => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
    const tiles = [];
    const curRhr = [...rhr].reverse()[0];
    if (curRhr) tiles.push(["FC de repos", curRhr.resting_hr + " bpm", "moy 30j " + (avg(last(30), "resting_hr") ? Math.round(avg(last(30), "resting_hr")) : "—")]);
    if (hrv && hrv.length) tiles.push(["HRV (actuel)", hrv[hrv.length - 1].value + " ms", "variabilité cardiaque"]);
    const st = avg(last(7), "stress_avg"); if (st != null) tiles.push(["Stress (7j)", Math.round(st) + "/100", "plus bas = mieux"]);
    const bb = avg(last(7), "body_battery_high"); if (bb != null) tiles.push(["Body Battery", Math.round(bb), "recharge max (7j)"]);
    const sp = avg(last(7), "spo2_avg"); if (sp != null) tiles.push(["SpO2 (7j)", Math.round(sp) + "%", "saturation O₂"]);
    byId("recovery-tiles").innerHTML = tiles.map(t => `<div class="record"><div class="k">${t[0]}</div><div class="v">${t[1]}</div><div class="d">${t[2]}</div></div>`).join("");
  }

  /* ================= SORTIES ================= */
  function renderActs(list) {
    byId("acts").innerHTML = [...list].sort((a, b) => b.date - a.date).slice(0, 20).map(a => {
      const extra = [];
      if (a.avg_cadence) extra.push(a.avg_cadence + " spm");
      if (a.avg_power) extra.push(a.avg_power + " W");
      if (a.aerobic_te) extra.push("TE " + a.aerobic_te);
      return `<div class="act"><div><div class="name">${escapeHtml(a.name)}${a.avg_hr ? `<span class="badge">${a.avg_hr} bpm</span>` : ""}</div><div class="meta">${longDate(a.date)}${extra.length ? " · " + extra.join(" · ") : ""}</div></div><div class="nums"><div class="big">${fmtKm(a.distance_km)} km</div><div class="meta">${fmtPace(a.avg_pace_s_per_km)} /km · ${fmtDur(a.moving_s)}</div></div></div>`;
    }).join("");
  }

  /* ================= STATS HERO ================= */
  function statDelta(cur, prev) { if (!prev) return { cls: "flat", txt: "" }; const diff = cur - prev; const pct = Math.round((diff / prev) * 100); if (Math.abs(pct) < 2) return { cls: "flat", txt: "≈ stable" }; return { cls: diff > 0 ? "up" : "down", txt: (diff > 0 ? "▲ " : "▼ ") + Math.abs(pct) + "%" }; }
  function renderStats(per, all, days) {
    const dist = sumDist(per); let prev = null;
    if (days && days !== Infinity) { const now = Date.now(); prev = sumDist(all.filter(a => { const t = a.date.getTime(); return t < now - days * DAY && t >= now - 2 * days * DAY; })); }
    const d = statDelta(dist, prev);
    byId("stat-distance").innerHTML = `${fmtKm(dist)} <small>km</small>`;
    byId("stat-distance-d").className = "delta " + d.cls; byId("stat-distance-d").textContent = d.txt;
    byId("stat-runs").innerHTML = `${per.length} <small>sorties</small>`;
    byId("stat-time").innerHTML = fmtDur(per.reduce((a, b) => a + (b.moving_s || b.duration_s || 0), 0));
    byId("stat-pace").innerHTML = `${fmtPace(weightedPace(per))} <small>/km</small>`;
  }

  /* ================= RENDU GLOBAL ================= */
  function render() {
    if (!DATA || !runs().length) { showEmpty(); return; }
    byId("view-empty").classList.add("hidden");
    byId("view-dash").classList.remove("hidden");
    byId("import-btn").classList.remove("hidden");

    const days = settings.periodDays, r = runs(), per = inPeriod(r, days);
    const gen = DATA.generated_at ? parseDate(DATA.generated_at) : null;
    byId("data-meta").textContent = `${r.length} courses · ${allActs().length} activités` + (gen ? ` · ${longDate(gen)}` : "");

    renderStats(per, r, days);
    renderProgression();
    renderVolume(per, r);
    renderLoad();
    renderPace(per);
    renderEfficiency(per);
    renderDynamics(per);
    renderZones(per);
    renderRecords(r);
    renderRecovery();
    renderActs(per.length ? per : r);
  }

  /* ================= BILAN CLAUDE ================= */
  function buildReport() {
    const r = runs(), per = inPeriod(r, settings.periodDays);
    const pName = { 28: "4 dernières semaines", 84: "12 dernières semaines", 365: "12 derniers mois" }[settings.periodDays] || "toute la période";
    const L = [];
    L.push("# Mon bilan running détaillé (export RunLab)\n");
    const p = profile(); const bits = [];
    if (p.full_name) bits.push(p.full_name);
    if (p.vo2max_running) bits.push("VO2max " + p.vo2max_running);
    if (p.fitness_age) bits.push("âge de forme " + p.fitness_age + " ans");
    if (p.resting_hr) bits.push("FC repos " + p.resting_hr + " bpm");
    if (bits.length) L.push("**Profil :** " + bits.join(" · ") + "\n");

    L.push(`## Volume (${pName})`);
    L.push(`- ${fmtKm(sumDist(per))} km · ${per.length} sorties · ${fmtDur(per.reduce((a, b) => a + (b.moving_s || 0), 0))} · allure moy ${fmtPace(weightedPace(per))}/km`);
    weeklyVolume(per.length ? per : r, 8).forEach(w => L.push(`  - sem. ${dmy(new Date(w.ws))} : ${fmtKm(w.km)} km`));

    const vo2 = series("vo2max"), rp = series("race_predictions"), fa = series("fitness_age");
    if (vo2 || rp || fa) {
      L.push("\n## Progression");
      if (vo2) { const t = trend(vo2.map(x => x.value)); L.push(`- VO2max : ${t.current} (départ ${t.start}, ${t.delta >= 0 ? "+" : ""}${t.delta})`); }
      if (fa) { const f = fa[fa.length - 1]; L.push(`- Âge de forme : ${f.fitness_age} ans (âge réel ${f.chrono_age})`); }
      if (rp) { const l = rp[rp.length - 1]; L.push(`- Prédictions course : 5K ${fmtRace(l.t5k)} · 10K ${fmtRace(l.t10k)} · semi ${fmtRace(l.half)} · marathon ${fmtRace(l.marathon)}`); }
    }

    const s = pmc();
    if (s && s.length) { const t = s[s.length - 1]; L.push("\n## Charge & forme (PMC)"); L.push(`- Fitness ${Math.round(t.ctl)} · Fatigue ${Math.round(t.atl)} · Fraîcheur ${t.tsb > 0 ? "+" : ""}${Math.round(t.tsb)} (${formLabel(t.tsb).t})`); }

    // efficacité
    const fe = per.filter(a => a.avg_hr && a.avg_pace_s_per_km && a.distance_km >= 1.5);
    if (fe.length >= 3) { const ef = a => (60000 / a.avg_pace_s_per_km) / a.avg_hr; const t = trend(fe.map(ef)); L.push("\n## Efficacité aérobie"); L.push(`- Vitesse par battement : ${t.current.toFixed(2)} (${t.pct >= 0 ? "+" : ""}${t.pct.toFixed(0)}% depuis le début → ${t.pct >= 0 ? "tu cours plus vite à FC égale" : "en baisse"})`); }

    // dynamique
    const dyn = DYN.map(m => { const v = per.filter(a => a[m.key] != null).map(a => a[m.key]); if (v.length < 2) return null; const t = trend(v); return `- ${m.label} : ${m.fmt(t.current)} ${m.unit} (moy ${m.fmt(v.reduce((a, b) => a + b, 0) / v.length)})`; }).filter(Boolean);
    if (dyn.length) { L.push("\n## Dynamique de course"); dyn.forEach(x => L.push(x)); }

    // zones / polarisation
    const z = aggZones(per, "hr_zones"); if (z) { const tot = z.reduce((a, b) => a + b, 0) || 1; const names = ["Z1", "Z2", "Z3", "Z4", "Z5"]; L.push("\n## Zones de FC"); z.forEach((x, i) => { if (x) L.push(`- ${names[i]} : ${fmtDur(x)} (${Math.round(x / tot * 100)}%)`); }); const easy = Math.round((z[0] + z[1]) / tot * 100); L.push(`- Répartition : ${easy}% facile / ${Math.round(z[2] / tot * 100)}% modéré / ${Math.round((z[3] + z[4]) / tot * 100)}% intense`); }

    // récup
    const d = dailySorted(); const hrv = series("hrv");
    if (d.length || hrv) {
      L.push("\n## Récupération");
      const rhr = d.filter(x => x.resting_hr != null); if (rhr.length) L.push(`- FC repos actuelle : ${rhr[rhr.length - 1].resting_hr} bpm`);
      if (hrv && hrv.length) { const t = trend(hrv.map(x => x.value)); L.push(`- HRV : ${t.current} ms (départ ${t.start})`); }
      const sl = d.filter(x => x.sleep_s != null).slice(-7); if (sl.length) L.push(`- Sommeil moyen 7j : ${fmtDur(sl.reduce((a, b) => a + b.sleep_s, 0) / sl.length)}`);
    }

    L.push("\n## Records");
    records(r).forEach(x => L.push(`- ${x.k} : ${x.v} (${x.d})`));

    L.push("\n---");
    L.push("**Analyse ma progression (VO2max, prédictions, efficacité aérobie), ma dynamique de course, mon équilibre d'intensité et ma récupération. Repère mes points forts et mes points à améliorer, et propose-moi un plan d'entraînement détaillé sur 2 semaines.**");
    return L.join("\n");
  }
  function openReport() { byId("report-text").value = buildReport(); byId("modal").classList.add("open"); }

  /* ================= IMPORT / PERSISTANCE ================= */
  function validate(o) { return o && typeof o === "object" && Array.isArray(o.activities); }
  function loadInto(o, persist) { if (!validate(o)) { toast("Fichier non reconnu."); return false; } DATA = o; if (persist !== false) { try { localStorage.setItem(STORE_KEY, JSON.stringify(o)); } catch (e) { } } render(); return true; }
  function handleFile(file) { const r = new FileReader(); r.onload = () => { try { if (loadInto(JSON.parse(r.result))) toast("Données importées ✓"); } catch (e) { toast("Impossible de lire ce fichier JSON."); } }; r.readAsText(file); }
  function saveSettings() { try { localStorage.setItem(SET_KEY, JSON.stringify(settings)); } catch (e) { } }
  let toastTimer; function toast(m) { const t = byId("toast"); t.textContent = m; t.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 2200); }
  function showEmpty() { byId("view-dash").classList.add("hidden"); byId("view-empty").classList.remove("hidden"); }

  function init() {
    try { const s = JSON.parse(localStorage.getItem(SET_KEY)); if (s) settings = { ...settings, ...s }; } catch (e) { }
    document.querySelectorAll("#period button").forEach(b => {
      b.addEventListener("click", () => {
        document.querySelectorAll("#period button").forEach(x => x.classList.remove("active"));
        b.classList.add("active"); settings.periodDays = b.dataset.days === "all" ? Infinity : parseInt(b.dataset.days, 10); saveSettings(); render();
      });
      const cur = settings.periodDays === Infinity ? "all" : String(settings.periodDays);
      if (b.dataset.days === cur) b.classList.add("active");
    });
    const fi = byId("file"); fi.addEventListener("change", e => { if (e.target.files[0]) handleFile(e.target.files[0]); });
    byId("import-btn").addEventListener("click", () => fi.click());
    byId("import-btn2").addEventListener("click", () => fi.click());
    byId("demo-btn").addEventListener("click", () => fetch("sample-data.json").then(r => r.json()).then(j => { if (loadInto(j, false)) toast("Démo chargée"); }).catch(() => toast("Démo indisponible.")));
    ["dragover", "drop"].forEach(ev => document.addEventListener(ev, e => e.preventDefault()));
    document.addEventListener("drop", e => { if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); });
    byId("report-btn").addEventListener("click", openReport);
    byId("modal-close").addEventListener("click", () => byId("modal").classList.remove("open"));
    byId("modal").addEventListener("click", e => { if (e.target.id === "modal") byId("modal").classList.remove("open"); });
    byId("copy-btn").addEventListener("click", async () => { const t = byId("report-text").value; try { await navigator.clipboard.writeText(t); toast("Bilan copié ✓ Colle-le dans Claude"); } catch (e) { byId("report-text").select(); document.execCommand("copy"); toast("Bilan copié ✓"); } });
    try { const sv = JSON.parse(localStorage.getItem(STORE_KEY)); if (sv) loadInto(sv, false); } catch (e) { }
    if (!DATA) showEmpty();
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("service-worker.js").catch(() => { });
  }
  document.addEventListener("DOMContentLoaded", init);
})();
