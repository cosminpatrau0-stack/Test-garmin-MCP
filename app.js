/* RunLab — logique de l'application (course à pied).
   100% dans le navigateur : rien n'est envoyé sur Internet. */
(function () {
  "use strict";

  const STORE_KEY = "runlab:data";
  const SET_KEY = "runlab:settings";
  const DAY = 86400000;

  let DATA = null;
  let settings = { periodDays: 84, maxHR: null, restHR: null };

  /* ---------------- utilitaires ---------------- */
  const $ = sel => document.querySelector(sel);
  const byId = id => document.getElementById(id);

  function parseDate(s) {
    if (!s) return null;
    const d = new Date(String(s).replace(" ", "T"));
    return isNaN(d) ? null : d;
  }
  function pad2(n) { return String(n).padStart(2, "0"); }
  function fmtPace(spk) {
    if (spk == null || !isFinite(spk) || spk <= 0) return "—";
    const m = Math.floor(spk / 60), s = Math.round(spk % 60);
    return `${m}:${pad2(s)}`;
  }
  function fmtDur(sec) {
    if (!sec) return "—";
    sec = Math.round(sec);
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    if (h) return `${h}h${pad2(m)}`;
    return `${m}:${pad2(s)}`;
  }
  function fmtKm(v) { return (Math.round(v * 10) / 10).toLocaleString("fr-FR"); }
  function dmy(d) { return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}`; }
  function longDate(d) {
    return d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" });
  }
  function isoWeekKey(d) {
    const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const day = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    const week = Math.ceil(((t - yearStart) / DAY + 1) / 7);
    return t.getUTCFullYear() + "-W" + pad2(week);
  }
  function weekStart(d) {
    const t = new Date(d);
    const day = (t.getDay() + 6) % 7; // lundi = 0
    t.setHours(0, 0, 0, 0);
    t.setDate(t.getDate() - day);
    return t;
  }

  /* ---------------- accès données ---------------- */
  function allActs() { return (DATA && DATA.activities) || []; }
  function runs() {
    return allActs()
      .filter(a => a.type === "running" && a.distance_km > 0)
      .map(a => ({ ...a, date: parseDate(a.start) }))
      .filter(a => a.date)
      .sort((a, b) => a.date - b.date);
  }
  function inPeriod(list, days) {
    if (!days || days === Infinity) return list;
    const cutoff = Date.now() - days * DAY;
    return list.filter(a => a.date.getTime() >= cutoff);
  }
  function maxHR() {
    if (settings.maxHR) return settings.maxHR;
    if (DATA && DATA.profile && DATA.profile.max_hr) return DATA.profile.max_hr;
    let m = 0; allActs().forEach(a => { if (a.max_hr) m = Math.max(m, a.max_hr); });
    return m || 190;
  }
  function restHR() {
    if (settings.restHR) return settings.restHR;
    if (DATA && DATA.profile && DATA.profile.resting_hr) return DATA.profile.resting_hr;
    return 55;
  }

  /* ---------------- calculs ---------------- */
  function sumDist(list) { return list.reduce((a, b) => a + (b.distance_km || 0), 0); }

  function weightedPace(list) {
    let dist = 0, time = 0;
    list.forEach(a => {
      if (a.avg_pace_s_per_km && a.distance_km) { dist += a.distance_km; time += a.avg_pace_s_per_km * a.distance_km; }
    });
    return dist ? time / dist : null;
  }

  function weeklyVolume(list, maxWeeks) {
    const map = new Map();
    list.forEach(a => {
      const ws = weekStart(a.date).getTime();
      map.set(ws, (map.get(ws) || 0) + a.distance_km);
    });
    // reconstruire une série continue de semaines jusqu'à cette semaine
    const out = [];
    const nowWeek = weekStart(new Date()).getTime();
    let start = map.size ? Math.min(...map.keys()) : nowWeek;
    for (let w = start; w <= nowWeek; w += 7 * DAY) {
      out.push({ ws: w, km: map.get(w) || 0 });
    }
    return maxWeeks ? out.slice(-maxWeeks) : out;
  }

  // Zones FC : renvoie {zones:[s1..s5], estimated:bool}
  function hrZones(list) {
    const secs = [0, 0, 0, 0, 0];
    let hasReal = false;
    list.forEach(a => {
      if (a.hr_zones && a.hr_zones.length) {
        hasReal = true;
        a.hr_zones.forEach(z => { if (z.zone >= 1 && z.zone <= 5) secs[z.zone - 1] += z.seconds || 0; });
      }
    });
    if (hasReal && secs.some(s => s > 0)) return { zones: secs, estimated: false };
    // estimation à partir de la FC moyenne
    const mhr = maxHR();
    const est = [0, 0, 0, 0, 0];
    list.forEach(a => {
      if (!a.avg_hr || !a.moving_s) return;
      const pct = a.avg_hr / mhr;
      let z = 0;
      if (pct < 0.6) z = 0; else if (pct < 0.7) z = 1; else if (pct < 0.8) z = 2; else if (pct < 0.9) z = 3; else z = 4;
      est[z] += a.moving_s;
    });
    return { zones: est, estimated: true };
  }

  // Modèle de charge (type PMC) sur TOUT l'historique
  function pmc() {
    const r = runs();
    if (!r.length) return null;
    const rh = restHR(), mh = maxHR();
    const loadByDay = new Map();
    allActs().forEach(a => {
      const d = parseDate(a.start); if (!d) return;
      const key = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
      let load = (typeof a.training_load === "number" && a.training_load > 0) ? a.training_load : null;
      if (load == null) {
        const mins = (a.moving_s || a.duration_s || 0) / 60;
        let intensity = 0.7;
        if (a.avg_hr && mh > rh) intensity = Math.max(0.1, Math.min(1, (a.avg_hr - rh) / (mh - rh)));
        load = mins * intensity * 2.2;
      }
      loadByDay.set(key, (loadByDay.get(key) || 0) + load);
    });
    const first = Math.min(...[...loadByDay.keys()]);
    const todayKey = (() => { const t = new Date(); return new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime(); })();
    const lamC = 2 / (42 + 1), lamA = 2 / (7 + 1);
    let ctl = 0, atl = 0; const series = [];
    for (let day = first; day <= todayKey; day += DAY) {
      const l = loadByDay.get(day) || 0;
      ctl = ctl + (l - ctl) * lamC;
      atl = atl + (l - atl) * lamA;
      series.push({ day, ctl, atl, tsb: ctl - atl });
    }
    return series;
  }

  function records(r) {
    if (!r.length) return [];
    const out = [];
    const longest = r.reduce((a, b) => b.distance_km > a.distance_km ? b : a);
    out.push({ k: "Plus longue sortie", v: fmtKm(longest.distance_km) + " km", d: longDate(longest.date) });
    const longestT = r.reduce((a, b) => (b.moving_s || 0) > (a.moving_s || 0) ? b : a);
    out.push({ k: "Plus longue durée", v: fmtDur(longestT.moving_s), d: fmtKm(longestT.distance_km) + " km" });
    const paced = r.filter(a => a.distance_km >= 3 && a.avg_pace_s_per_km);
    if (paced.length) {
      const best = paced.reduce((a, b) => b.avg_pace_s_per_km < a.avg_pace_s_per_km ? b : a);
      out.push({ k: "Meilleure allure (≥3 km)", v: fmtPace(best.avg_pace_s_per_km) + " /km", d: fmtKm(best.distance_km) + " km · " + longDate(best.date) });
    }
    const effort = (lo, hi, label) => {
      const cand = r.filter(a => a.distance_km >= lo && a.distance_km <= hi && a.moving_s);
      if (cand.length) {
        const best = cand.reduce((a, b) => b.moving_s < a.moving_s ? b : a);
        out.push({ k: "Meilleur " + label, v: fmtDur(best.moving_s), d: fmtPace(best.avg_pace_s_per_km) + " /km · " + longDate(best.date) });
      }
    };
    effort(4.7, 5.6, "5 km");
    effort(9.5, 10.7, "10 km");
    effort(20.5, 21.6, "semi");
    effort(41.5, 43, "marathon");
    const climb = r.reduce((a, b) => (b.elevation_gain_m || 0) > (a.elevation_gain_m || 0) ? b : a);
    if (climb.elevation_gain_m) out.push({ k: "Plus gros dénivelé", v: "+" + Math.round(climb.elevation_gain_m) + " m", d: fmtKm(climb.distance_km) + " km · " + longDate(climb.date) });
    const wk = weeklyVolume(r);
    if (wk.length) {
      const best = wk.reduce((a, b) => b.km > a.km ? b : a);
      out.push({ k: "Semaine la plus chargée", v: fmtKm(best.km) + " km", d: "semaine du " + dmy(new Date(best.ws)) });
    }
    return out.slice(0, 6);
  }

  function formLabel(tsb) {
    if (tsb > 8) return { t: "Frais", c: "good" };
    if (tsb > -10) return { t: "Optimal", c: "good" };
    if (tsb > -25) return { t: "Charge élevée", c: "warn" };
    return { t: "Fatigue importante", c: "fatigue" };
  }

  function recovery() {
    const d = (DATA && DATA.daily) || [];
    if (!d.length) return null;
    const rows = d.map(x => ({ ...x, date: parseDate(x.date) })).filter(x => x.date).sort((a, b) => b.date - a.date);
    const last7 = rows.slice(0, 7), last30 = rows.slice(0, 30);
    const avg = (arr, key) => { const v = arr.map(x => x[key]).filter(x => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
    const latestRhr = rows.find(x => x.resting_hr != null);
    return {
      rhrLatest: latestRhr ? latestRhr.resting_hr : null,
      rhr30: avg(last30, "resting_hr"),
      sleep7: avg(last7, "sleep_s"),
      stress7: avg(last7, "stress_avg"),
    };
  }

  /* ---------------- rendu ---------------- */
  function render() {
    if (!DATA || !runs().length) { showEmpty(); return; }
    byId("view-empty").classList.add("hidden");
    byId("view-dash").classList.remove("hidden");
    byId("import-btn").classList.remove("hidden");

    const days = settings.periodDays;
    const r = runs();
    const per = inPeriod(r, days);

    // bandeau méta
    const gen = DATA.generated_at ? parseDate(DATA.generated_at) : null;
    byId("data-meta").textContent =
      `${r.length} courses · ${allActs().length} activités` + (gen ? ` · données du ${longDate(gen)}` : "");

    renderStats(per, r, days);
    Charts.bars(byId("chart-volume"),
      weeklyVolume(per.length ? per : r, 16).map(w => ({ label: dmy(new Date(w.ws)), value: w.km })),
      { valueFmt: v => Math.round(v), labelEvery: 2 });

    renderPace(per);
    renderLoad();
    renderZones(per);
    renderRecords(r);
    renderRecovery();
    renderActs(per.length ? per : r);
  }

  function statDelta(cur, prev) {
    if (!prev) return { cls: "flat", txt: "" };
    const diff = cur - prev;
    const pct = Math.round((diff / prev) * 100);
    if (Math.abs(pct) < 2) return { cls: "flat", txt: "≈ stable" };
    return { cls: diff > 0 ? "up" : "down", txt: (diff > 0 ? "▲ " : "▼ ") + Math.abs(pct) + "%" };
  }

  function renderStats(per, all, days) {
    const dist = sumDist(per);
    let prev = null;
    if (days && days !== Infinity) {
      const now = Date.now();
      prev = sumDist(all.filter(a => {
        const t = a.date.getTime();
        return t < now - days * DAY && t >= now - 2 * days * DAY;
      }));
    }
    const d = statDelta(dist, prev);
    byId("stat-distance").innerHTML = `${fmtKm(dist)} <small>km</small>`;
    byId("stat-distance-d").className = "delta " + d.cls;
    byId("stat-distance-d").textContent = d.txt;
    byId("stat-runs").innerHTML = `${per.length} <small>sorties</small>`;
    const totS = per.reduce((a, b) => a + (b.moving_s || b.duration_s || 0), 0);
    byId("stat-time").innerHTML = fmtDur(totS);
    byId("stat-pace").innerHTML = `${fmtPace(weightedPace(per))} <small>/km</small>`;
  }

  function renderPace(per) {
    const pts = per.filter(a => a.distance_km >= 1.5 && a.avg_pace_s_per_km)
      .map(a => ({ y: -a.avg_pace_s_per_km })); // négatif => plus rapide = plus haut
    const labels = per.filter(a => a.distance_km >= 1.5 && a.avg_pace_s_per_km).map(a => dmy(a.date));
    Charts.lines(byId("chart-pace"), [{ name: "Allure", color: "var(--accent)", fill: true, points: pts }],
      { yFmt: v => fmtPace(-v), xLabels: labels });
  }

  function renderLoad() {
    const series = pmc();
    const card = byId("card-load");
    if (!series || series.length < 7) { card.classList.add("hidden"); return; }
    card.classList.remove("hidden");
    const days = settings.periodDays === Infinity ? 365 : Math.max(settings.periodDays, 42);
    const slice = series.slice(-days);
    const labels = slice.map(s => dmy(new Date(s.day)));
    Charts.lines(byId("chart-load"), [
      { name: "Forme (fitness)", color: "var(--fitness)", fill: true, points: slice.map(s => ({ y: s.ctl })) },
      { name: "Fatigue", color: "var(--fatigue)", points: slice.map(s => ({ y: s.atl })) },
    ], { yFmt: v => Math.round(v), xLabels: labels, minZero: true });

    const today = series[series.length - 1];
    const lab = formLabel(today.tsb);
    const pill = byId("form-pill");
    pill.className = "pill " + lab.c;
    pill.textContent = `${lab.t} · forme ${today.tsb > 0 ? "+" : ""}${Math.round(today.tsb)}`;
  }

  function renderZones(per) {
    const colors = ["var(--z1)", "var(--z2)", "var(--z3)", "var(--z4)", "var(--z5)"];
    const names = ["Z1 · récup", "Z2 · endurance", "Z3 · tempo", "Z4 · seuil", "Z5 · VO2max"];
    const z = hrZones(per);
    const total = z.zones.reduce((a, b) => a + b, 0) || 1;
    Charts.stackedBar(byId("chart-zones"), z.zones.map((s, i) => ({
      label: names[i], value: s, color: colors[i],
      display: `${fmtDur(s)} · ${Math.round(s / total * 100)}%`,
    })));
    byId("zones-note").textContent = z.estimated
      ? "Estimation à partir de la FC moyenne (FC max utilisée : " + maxHR() + ")."
      : "Temps réel passé dans chaque zone de fréquence cardiaque.";
  }

  function renderRecords(r) {
    const el = byId("records");
    const recs = records(r);
    el.innerHTML = recs.map(x =>
      `<div class="record"><div class="k">${x.k}</div><div class="v">${x.v}</div><div class="d">${x.d}</div></div>`
    ).join("");
  }

  function renderRecovery() {
    const rec = recovery();
    const card = byId("card-recovery");
    if (!rec || (rec.rhrLatest == null && rec.sleep7 == null)) { card.classList.add("hidden"); return; }
    card.classList.remove("hidden");
    byId("rec-rhr").textContent = rec.rhrLatest != null ? rec.rhrLatest + " bpm" : "—";
    byId("rec-rhr-d").textContent = rec.rhr30 != null ? "moy. 30j : " + Math.round(rec.rhr30) + " bpm" : "";
    byId("rec-sleep").textContent = rec.sleep7 != null ? fmtDur(rec.sleep7) : "—";
    byId("rec-sleep-d").textContent = rec.sleep7 != null ? "moyenne 7 jours" : "";
    byId("rec-stress").textContent = rec.stress7 != null ? Math.round(rec.stress7) + " /100" : "—";
    byId("rec-stress-d").textContent = rec.stress7 != null ? "stress moyen 7j" : "";
  }

  function renderActs(list) {
    const el = byId("acts");
    const recent = [...list].sort((a, b) => b.date - a.date).slice(0, 20);
    el.innerHTML = recent.map(a => `
      <div class="act">
        <div>
          <div class="name">${escapeHtml(a.name)}${a.avg_hr ? `<span class="badge">${a.avg_hr} bpm</span>` : ""}</div>
          <div class="meta">${longDate(a.date)}${a.elevation_gain_m ? " · +" + Math.round(a.elevation_gain_m) + " m" : ""}</div>
        </div>
        <div class="nums">
          <div class="big">${fmtKm(a.distance_km)} km</div>
          <div class="meta">${fmtPace(a.avg_pace_s_per_km)} /km · ${fmtDur(a.moving_s)}</div>
        </div>
      </div>`).join("");
  }

  function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

  function showEmpty() {
    byId("view-dash").classList.add("hidden");
    byId("view-empty").classList.remove("hidden");
  }

  /* ---------------- bilan pour Claude ---------------- */
  function buildReport() {
    const r = runs();
    const per = inPeriod(r, settings.periodDays);
    const periodName = { 28: "4 dernières semaines", 84: "12 dernières semaines", 365: "12 derniers mois" }[settings.periodDays] || "toute la période";
    const L = [];
    L.push("# Mes données de course à pied (export RunLab)\n");
    if (DATA.profile) {
      const p = DATA.profile;
      const bits = [];
      if (p.full_name || p.display_name) bits.push(p.full_name || p.display_name);
      if (p.vo2max_running) bits.push("VO2max ~" + p.vo2max_running);
      if (p.resting_hr) bits.push("FC repos " + p.resting_hr + " bpm");
      if (bits.length) L.push("**Profil :** " + bits.join(" · ") + "\n");
    }
    L.push(`## Volume (${periodName})`);
    L.push(`- Distance : ${fmtKm(sumDist(per))} km sur ${per.length} sorties`);
    L.push(`- Temps total : ${fmtDur(per.reduce((a, b) => a + (b.moving_s || b.duration_s || 0), 0))}`);
    L.push(`- Allure moyenne : ${fmtPace(weightedPace(per))} /km`);

    const wk = weeklyVolume(per.length ? per : r, 8);
    if (wk.length) {
      L.push("\n### Volume hebdomadaire (km)");
      wk.forEach(w => L.push(`- semaine du ${dmy(new Date(w.ws))} : ${fmtKm(w.km)} km`));
    }

    const series = pmc();
    if (series && series.length) {
      const t = series[series.length - 1];
      const lab = formLabel(t.tsb);
      L.push("\n## Charge & forme (modèle type PMC)");
      L.push(`- Forme/fitness (CTL) : ${Math.round(t.ctl)}`);
      L.push(`- Fatigue (ATL) : ${Math.round(t.atl)}`);
      L.push(`- Fraîcheur (TSB = CTL-ATL) : ${t.tsb > 0 ? "+" : ""}${Math.round(t.tsb)} → ${lab.t}`);
    }

    const z = hrZones(per);
    const ztot = z.zones.reduce((a, b) => a + b, 0);
    if (ztot) {
      const names = ["Z1 récup", "Z2 endurance", "Z3 tempo", "Z4 seuil", "Z5 VO2max"];
      L.push(`\n## Répartition par zones de FC${z.estimated ? " (estimée)" : ""}`);
      z.zones.forEach((s, i) => { if (s) L.push(`- ${names[i]} : ${fmtDur(s)} (${Math.round(s / ztot * 100)}%)`); });
    }

    const recs = records(r);
    if (recs.length) {
      L.push("\n## Records personnels");
      recs.forEach(x => L.push(`- ${x.k} : ${x.v} (${x.d})`));
    }

    const rec = recovery();
    if (rec && (rec.rhrLatest != null || rec.sleep7 != null)) {
      L.push("\n## Récupération");
      if (rec.rhrLatest != null) L.push(`- FC de repos : ${rec.rhrLatest} bpm (moy. 30j ${rec.rhr30 ? Math.round(rec.rhr30) : "—"})`);
      if (rec.sleep7 != null) L.push(`- Sommeil moyen (7j) : ${fmtDur(rec.sleep7)}`);
      if (rec.stress7 != null) L.push(`- Stress moyen (7j) : ${Math.round(rec.stress7)}/100`);
    }

    L.push("\n## Dernières sorties");
    [...per].sort((a, b) => b.date - a.date).slice(0, 12).forEach(a => {
      L.push(`- ${longDate(a.date)} — ${fmtKm(a.distance_km)} km en ${fmtDur(a.moving_s)} (${fmtPace(a.avg_pace_s_per_km)}/km${a.avg_hr ? ", " + a.avg_hr + " bpm" : ""})`);
    });

    L.push("\n---");
    L.push("**Peux-tu analyser ma progression, ma charge d'entraînement et ma forme actuelle, repérer les points à surveiller (risque de surmenage, déséquilibre d'intensité), et me proposer un plan de course détaillé pour les 2 prochaines semaines adapté à ces données ?**");
    return L.join("\n");
  }

  function openReport() {
    byId("report-text").value = buildReport();
    byId("modal").classList.add("open");
  }

  /* ---------------- import / persistance ---------------- */
  function validate(obj) {
    return obj && typeof obj === "object" && Array.isArray(obj.activities);
  }
  function loadInto(obj, persist) {
    if (!validate(obj)) { toast("Fichier non reconnu."); return false; }
    DATA = obj;
    if (persist !== false) { try { localStorage.setItem(STORE_KEY, JSON.stringify(obj)); } catch (e) {} }
    render();
    return true;
  }
  function handleFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try { if (loadInto(JSON.parse(reader.result))) toast("Données importées ✓"); }
      catch (e) { toast("Impossible de lire ce fichier JSON."); }
    };
    reader.readAsText(file);
  }

  function saveSettings() { try { localStorage.setItem(SET_KEY, JSON.stringify(settings)); } catch (e) {} }

  let toastTimer;
  function toast(msg) {
    const t = byId("toast"); t.textContent = msg; t.classList.add("show");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
  }

  /* ---------------- init ---------------- */
  function init() {
    try { const s = JSON.parse(localStorage.getItem(SET_KEY)); if (s) settings = { ...settings, ...s }; } catch (e) {}

    // période
    document.querySelectorAll("#period button").forEach(b => {
      b.addEventListener("click", () => {
        document.querySelectorAll("#period button").forEach(x => x.classList.remove("active"));
        b.classList.add("active");
        settings.periodDays = b.dataset.days === "all" ? Infinity : parseInt(b.dataset.days, 10);
        saveSettings(); render();
      });
      const cur = settings.periodDays === Infinity ? "all" : String(settings.periodDays);
      if (b.dataset.days === cur) b.classList.add("active");
    });

    // import
    const fileInput = byId("file");
    fileInput.addEventListener("change", e => { if (e.target.files[0]) handleFile(e.target.files[0]); });
    byId("import-btn").addEventListener("click", () => fileInput.click());
    byId("import-btn2").addEventListener("click", () => fileInput.click());
    byId("demo-btn").addEventListener("click", loadDemo);

    // glisser-déposer
    ["dragover", "drop"].forEach(ev => document.addEventListener(ev, e => e.preventDefault()));
    document.addEventListener("drop", e => { if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); });

    // bilan Claude
    byId("report-btn").addEventListener("click", openReport);
    byId("modal-close").addEventListener("click", () => byId("modal").classList.remove("open"));
    byId("modal").addEventListener("click", e => { if (e.target.id === "modal") byId("modal").classList.remove("open"); });
    byId("copy-btn").addEventListener("click", async () => {
      const txt = byId("report-text").value;
      try { await navigator.clipboard.writeText(txt); toast("Bilan copié ✓ Colle-le dans Claude"); }
      catch (e) { byId("report-text").select(); document.execCommand("copy"); toast("Bilan copié ✓"); }
    });

    // données déjà en mémoire ?
    try { const saved = JSON.parse(localStorage.getItem(STORE_KEY)); if (saved) loadInto(saved, false); } catch (e) {}
    if (!DATA) showEmpty();

    // service worker (mode hors-ligne / installable)
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("service-worker.js").catch(() => {});
    }
  }

  function loadDemo() {
    fetch("sample-data.json").then(r => r.json()).then(j => { if (loadInto(j, false)) toast("Démo chargée (données fictives)"); })
      .catch(() => toast("Démo indisponible."));
  }

  document.addEventListener("DOMContentLoaded", init);
})();
