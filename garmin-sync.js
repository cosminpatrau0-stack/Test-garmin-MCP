/* RunLab — synchronisation Garmin Personal API via ton proxy Cloudflare.
   Appelle les endpoints officiels (à travers le Worker qui ajoute le token
   et le CORS) et construit le même objet de données que l'app analyse.
   100% dans le navigateur du téléphone. */
(function () {
  "use strict";

  const RUN = "run";
  function pick(d, keys, def) { if (!d || typeof d !== "object") return def; for (const k of keys) { if (d[k] != null) return d[k]; } return def; }
  function asList(v, inner) {
    if (Array.isArray(v)) return v;
    if (v && typeof v === "object") { if (inner && Array.isArray(v[inner])) return v[inner]; for (const k in v) if (Array.isArray(v[k])) return v[k]; }
    return [];
  }
  function iso(d) { return d.toISOString().slice(0, 10); }
  function daysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return d; }
  function rnd(v, nd) { return v == null ? null : (nd != null ? Math.round(v * 10 ** nd) / 10 ** nd : Math.round(v)); }
  function normType(t) { t = (t || "").toLowerCase(); if (t.includes("run")) return "running"; if (t.includes("walk")) return "walking"; if (t.includes("hik")) return "hiking"; if (t.includes("cycl") || t.includes("bik")) return "cycling"; if (t.includes("swim")) return "swimming"; if (t.includes("strength")) return "strength_training"; return t || "other"; }
  function strideM(v) { return v == null ? null : (v > 3 ? Math.round(v) / 100 : Math.round(v * 100) / 100); }

  function convertActivity(a, detail) {
    let src = Object.assign({}, a);
    if (detail && typeof detail === "object") {
      const sum = detail.summaryDTO || detail;
      src = Object.assign({}, src, sum);
      const at = detail.activityTypeDTO;
      if (at && at.typeKey && !src.activityType) src.activityType = { typeKey: at.typeKey };
    }
    let tkey = "";
    const at = src.activityType;
    if (at && typeof at === "object") tkey = at.typeKey || "";
    else if (typeof at === "string") tkey = at;
    const atype = normType(tkey);
    const distM = pick(src, ["distance"], 0) || 0;
    const durS = pick(src, ["duration", "elapsedDuration"], 0) || 0;
    const movS = pick(src, ["movingDuration"], 0) || durS;
    const km = distM / 1000;
    const pace = km > 0 && movS > 0 ? Math.round(movS / km) : null;
    const gapSpeed = pick(src, ["avgGradeAdjustedSpeed"]);
    const act = {
      id: pick(src, ["activityId", "id"]),
      name: pick(src, ["activityName", "name"], "Sans titre"),
      type: atype,
      start: pick(src, ["startTimeLocal"]),
      distance_km: Math.round(km * 1000) / 1000,
      duration_s: rnd(durS), moving_s: rnd(movS),
      avg_pace_s_per_km: pace,
      gap_pace_s_per_km: gapSpeed ? Math.round(1000 / gapSpeed) : null,
      avg_hr: rnd(pick(src, ["averageHR", "avgHr"])),
      max_hr: rnd(pick(src, ["maxHR", "maxHr"])),
      avg_cadence: rnd(pick(src, ["averageRunningCadenceInStepsPerMinute", "averageRunCadence", "avgRunCadence", "avgDoubleCadence"])),
      max_cadence: rnd(pick(src, ["maxRunningCadenceInStepsPerMinute", "maxRunCadence", "maxDoubleCadence"])),
      avg_stride_m: strideM(pick(src, ["avgStrideLength", "averageStrideLength"])),
      avg_gct_ms: rnd(pick(src, ["avgGroundContactTime", "groundContactTime"])),
      avg_vosc_cm: rnd(pick(src, ["avgVerticalOscillation", "verticalOscillation"]), 1),
      avg_vratio: rnd(pick(src, ["avgVerticalRatio", "verticalRatio"]), 1),
      avg_power: rnd(pick(src, ["avgPower", "averagePower"])),
      max_power: rnd(pick(src, ["maxPower"])),
      norm_power: rnd(pick(src, ["normPower", "normalizedPower"])),
      elevation_gain_m: rnd(pick(src, ["elevationGain"], 0) || 0),
      calories: rnd(pick(src, ["calories"])),
      aerobic_te: rnd(pick(src, ["aerobicTrainingEffect"]), 1),
      anaerobic_te: rnd(pick(src, ["anaerobicTrainingEffect"]), 1),
      te_label: pick(src, ["trainingEffectLabel"]),
      training_load: rnd(pick(src, ["activityTrainingLoad"])),
      vo2max: rnd(pick(src, ["vO2MaxValue"])),
      intensity_mod: pick(src, ["moderateIntensityMinutes"]),
      intensity_vig: pick(src, ["vigorousIntensityMinutes"]),
      steps: rnd(pick(src, ["steps"])),
    };
    const zones = detail && detail.hrTimeInZones;
    if (Array.isArray(zones)) {
      const z = [];
      zones.forEach(it => { const s = pick(it, ["secsInZone", "seconds"]); const zn = pick(it, ["zoneNumber", "zone"]); if (s && zn) z.push({ zone: +zn, seconds: Math.round(s) }); });
      if (z.length) act.hr_zones = z;
    }
    const out = {}; for (const k in act) if (act[k] != null) out[k] = act[k];
    return out;
  }

  async function run(cfg, onProgress) {
    const base = cfg.base.replace(/\/+$/, "");
    const prog = (m, p) => { try { onProgress && onProgress(m, p); } catch (e) {} };
    async function api(path, params) {
      const u = new URL(base + "/garmin" + path);
      if (params) for (const k in params) if (params[k] != null) u.searchParams.set(k, params[k]);
      if (cfg.secret) u.searchParams.set("s", cfg.secret);
      const r = await fetch(u.toString(), { headers: { Accept: "application/json" } });
      if (!r.ok) throw new Error(path.split("?")[0] + " → HTTP " + r.status);
      const t = await r.text();
      return t ? JSON.parse(t) : null;
    }

    const days = cfg.days || 400, wdays = cfg.wellnessDays || 180;
    const start = iso(daysAgo(days)), end = iso(new Date());

    // Activités
    prog("Récupération des activités…", 5);
    let rawActs = [], offset = 0;
    while (true) {
      const batch = asList(await api("/activitylist-service/activities/search/activities",
        { start: offset, limit: 50, startDate: start, endDate: end }), "activities");
      if (!batch.length) break;
      rawActs = rawActs.concat(batch); offset += batch.length;
      if (batch.length < 50 || offset > 2000) break;
    }

    // Détail des courses (dynamique + zones FC)
    const activities = []; let detailed = 0; const DETAIL = 60;
    for (let i = 0; i < rawActs.length; i++) {
      const a = rawActs[i];
      let tkey = ""; const at = a.activityType; if (at && typeof at === "object") tkey = (at.typeKey || "").toLowerCase();
      let detail = null;
      if (tkey.includes(RUN) && detailed < DETAIL) {
        try { detail = await api("/activity-service/activity/" + pick(a, ["activityId", "id"])); detailed++; } catch (e) {}
        prog("Détail des courses… (" + detailed + ")", 10 + Math.round(detailed / Math.max(1, rawActs.length) * 40));
      }
      activities.push(convertActivity(a, detail));
    }
    activities.sort((x, y) => (x.start || "") < (y.start || "") ? -1 : 1);
    const runs = activities.filter(a => a.type === "running");

    // Bien-être
    prog("Sommeil, HRV, stress, FC repos…", 55);
    const ws = iso(daysAgo(wdays)), we = iso(new Date());
    const daily = {};
    const merge = (rows, fn) => asList(rows).forEach(r => { if (!r || typeof r !== "object") return; let d = pick(r, ["calendarDate", "calendar_date", "date"]); if (!d) return; d = String(d).slice(0, 10); const row = daily[d] || (daily[d] = { date: d }); fn(r, row); });
    const safe = async (fn) => { try { await fn(); } catch (e) {} };

    await safe(async () => merge(await api("/usersummary-service/v2/dailysummaries", { startDate: ws, endDate: we }), (r, row) => { row.resting_hr = pick(r, ["restingHeartRate"]); row.steps = pick(r, ["totalSteps", "steps"]); row.intensity_mod = pick(r, ["moderateIntensityMinutes"]); row.intensity_vig = pick(r, ["vigorousIntensityMinutes"]); }));
    await safe(async () => merge(await api("/usersummary-service/stats/stress/daily/" + ws + "/" + we), (r, row) => { row.stress_avg = pick(r, ["averageStressLevel", "overallStressLevel", "value"]); }));
    await safe(async () => merge(await api("/wellness-service/wellness/bodyBattery/reports/daily", { startDate: ws, endDate: we }), (r, row) => { row.body_battery_high = pick(r, ["charged", "highestValue", "max", "bodyBatteryHigh"]); row.body_battery_low = pick(r, ["drained", "lowestValue", "min", "bodyBatteryLow"]); }));
    await safe(async () => merge(await api("/sleep-service/sleep/dailySleepSummariesByDate", { startDate: ws, endDate: we }), (r, row) => {
      const deep = pick(r, ["deepSleepSeconds"], 0) || 0, light = pick(r, ["lightSleepSeconds"], 0) || 0, rem = pick(r, ["remSleepSeconds"], 0) || 0;
      row.sleep_s = (deep + light + rem) || pick(r, ["sleepTimeSeconds"]); row.deep_s = deep || null; row.light_s = light || null; row.rem_s = rem || null; row.awake_s = pick(r, ["awakeSleepSeconds"]);
      const sc = pick(r, ["sleepScores"]); row.sleep_score = (sc && typeof sc === "object") ? pick(sc, ["overallScore"]) : pick(r, ["sleepScore", "overallSleepScore"]);
    }));
    const hrvArr = [];
    await safe(async () => asList(await api("/hrv-service/hrv/daily/" + ws + "/" + we)).forEach(r => { const d = pick(r, ["calendarDate", "date"]); const v = pick(r, ["weeklyAvg", "lastNightAvg", "hrvValue", "avgHrv", "value"]); if (d && v) hrvArr.push({ date: String(d).slice(0, 10), value: Math.round(v) }); }));

    let dailyRows = Object.values(daily).map(r => { const o = {}; for (const k in r) if (r[k] != null) o[k] = r[k]; return o; }).filter(r => Object.keys(r).length > 1);
    dailyRows.sort((a, b) => a.date < b.date ? 1 : -1);

    // Séries
    prog("Progression (VO2max, âge de forme)…", 80);
    const series = {};
    if (hrvArr.length) { const m = {}; hrvArr.forEach(x => m[x.date] = x); series.hrv = Object.values(m).sort((a, b) => a.date < b.date ? -1 : 1); }
    const vo = {}; runs.forEach(a => { if (a.vo2max && a.start) { const d = a.start.slice(0, 10); if (vo[d] == null) vo[d] = a.vo2max; } });
    if (Object.keys(vo).length) series.vo2max = Object.keys(vo).sort().map(d => ({ date: d, value: vo[d] }));

    const fitAge = [];
    for (let n = days; n >= 0; n -= 14) {
      const d = iso(daysAgo(n));
      try { const r = await api("/fitnessage-service/fitnessage/v2/" + d); const fa = pick(r, ["fitnessAge", "currentBioAge", "bioAge", "achievableFitnessAge"]); const ch = pick(r, ["chronologicalAge"]); if (fa != null) fitAge.push({ date: d, fitness_age: Math.round(fa * 10) / 10, chrono_age: ch }); } catch (e) {}
    }
    if (fitAge.length) series.fitness_age = fitAge;

    // Profil + zones
    prog("Profil et zones…", 92);
    const profile = {};
    await safe(async () => {
      const up = await api("/userprofile-service/userprofile/settings") || {};
      const ud = up.userData || up;
      const fn = pick(ud, ["firstName"]), ln = pick(ud, ["lastName"]);
      if (fn || ln) profile.full_name = [fn, ln].filter(Boolean).join(" ");
      profile.display_name = pick(up, ["userName", "displayName"]);
      if (pick(ud, ["birthDate"])) profile.birth_date = pick(ud, ["birthDate"]);
    });
    await safe(async () => {
      const zl = asList(await api("/biometric-service/heartRateZones/v2"));
      const rz = zl.find(z => (pick(z, ["sport"]) || "").toUpperCase() === "RUNNING") || zl[0];
      if (rz) { const floors = [1, 2, 3, 4, 5].map(i => pick(rz, ["zone" + i + "Floor"])); if (floors.some(x => x != null)) profile.hr_zone_floors = floors; if (pick(rz, ["maxHeartRateUsed"])) profile.max_hr = pick(rz, ["maxHeartRateUsed"]); if (pick(rz, ["restingHeartRateUsed"])) profile.resting_hr = pick(rz, ["restingHeartRateUsed"]); }
    });
    for (const r of dailyRows) if (r.resting_hr) { profile.resting_hr = r.resting_hr; break; }
    for (let i = runs.length - 1; i >= 0; i--) if (runs[i].vo2max) { profile.vo2max_running = runs[i].vo2max; break; }
    if (fitAge.length) profile.fitness_age = fitAge[fitAge.length - 1].fitness_age;

    prog("Terminé ✓", 100);
    return {
      generated_at: new Date().toISOString().slice(0, 19),
      source: "garmin-personal-api",
      profile, activities, daily: dailyRows, series,
    };
  }

  window.RunLabSync = { run };
})();
