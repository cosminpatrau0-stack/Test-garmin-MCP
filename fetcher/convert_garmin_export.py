#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Convertit l'EXPORT OFFICIEL Garmin (le gros ZIP « Exporter vos données »
demandé depuis le compte Garmin) en un fichier garmin-data.json riche,
prêt pour l'app RunLab.

Usage :
    python3 convert_garmin_export.py  CHEMIN_DU_ZIP_OU_DU_DOSSIER  [sortie.json]

Exemple :
    python3 convert_garmin_export.py ~/Downloads/export-garmin.zip

Tout se passe sur ta machine : rien n'est envoyé sur Internet.
"""

import os
import sys
import json
import glob
import zipfile
import tempfile
import datetime as dt
from datetime import timezone

RUN_TYPES = {"running", "treadmill_running", "trail_running", "track_running", "virtual_run"}


def log(m): print(m, flush=True)


def find_root(path):
    if os.path.isdir(path):
        return path
    if zipfile.is_zipfile(path):
        tmp = tempfile.mkdtemp(prefix="garmin_export_")
        with zipfile.ZipFile(path) as z:
            z.extractall(tmp)
        return tmp
    raise SystemExit(f"[!] '{path}' n'est ni un dossier ni un ZIP valide.")


def first(root, pattern):
    hits = glob.glob(os.path.join(root, "**", pattern), recursive=True)
    return hits[0] if hits else None


def load(path):
    if not path or not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def local_iso(ms):
    d = dt.datetime.fromtimestamp(ms / 1000, tz=timezone.utc)
    return d.strftime("%Y-%m-%d %H:%M:%S")


def norm_type(t):
    t = (t or "").lower()
    if t in RUN_TYPES or "run" in t:
        return "running"
    if "walk" in t:
        return "walking"
    if "hik" in t:
        return "hiking"
    if "cycl" in t or "bik" in t:
        return "cycling"
    if "swim" in t:
        return "swimming"
    if "strength" in t:
        return "strength_training"
    return t or "other"


def zone_buckets(a, prefix):
    """hr/powerTimeInZone_X en millisecondes ; _0 sous zone 1, _6 au-dessus zone 5."""
    z = []
    for i in range(1, 6):
        ms = a.get(f"{prefix}{i}") or 0
        if i == 1:
            ms += a.get(f"{prefix}0") or 0
        if i == 5:
            ms += a.get(f"{prefix}6") or 0
        if ms:
            z.append({"zone": i, "seconds": round(ms / 1000)})
    return z


def num(v, nd=None):
    if v is None:
        return None
    return round(v, nd) if nd is not None else round(v)


def convert_activity(a):
    dist_m = (a.get("distance") or 0) / 100.0          # cm -> m
    dur_s = (a.get("duration") or 0) / 1000.0          # ms -> s
    mov_s = (a.get("movingDuration") or 0) / 1000.0 or dur_s
    km = dist_m / 1000.0
    atype = norm_type(a.get("activityType"))
    pace = round(mov_s / km) if km > 0 and mov_s > 0 else None
    gap = round(100.0 / a["avgGradeAdjustedSpeed"]) if a.get("avgGradeAdjustedSpeed") else None
    act = {
        "id": a.get("activityId"),
        "name": a.get("name") or "Sans titre",
        "type": atype,
        "start": local_iso(a["startTimeLocal"]) if a.get("startTimeLocal") else None,
        "distance_km": round(km, 3),
        "duration_s": round(dur_s),
        "moving_s": round(mov_s),
        "avg_pace_s_per_km": pace,
        "gap_pace_s_per_km": gap,                       # allure ajustée au dénivelé
        "avg_hr": num(a.get("avgHr")),
        "max_hr": num(a.get("maxHr")),
        "avg_cadence": num(a.get("avgDoubleCadence")),
        "max_cadence": num(a.get("maxDoubleCadence")),
        "avg_stride_m": num(a.get("avgStrideLength") and a["avgStrideLength"] / 100.0, 2),
        "avg_gct_ms": num(a.get("avgGroundContactTime")),
        "avg_vosc_cm": num(a.get("avgVerticalOscillation"), 1),
        "avg_vratio": num(a.get("avgVerticalRatio"), 1),
        "avg_power": num(a.get("avgPower")),
        "max_power": num(a.get("maxPower")),
        "norm_power": num(a.get("normPower")),
        "elevation_gain_m": round((a.get("elevationGain") or 0) / 100.0),   # cm -> m
        "calories": num(a.get("calories")),
        "aerobic_te": num(a.get("aerobicTrainingEffect"), 1),
        "anaerobic_te": num(a.get("anaerobicTrainingEffect"), 1),
        "te_label": a.get("trainingEffectLabel"),
        "training_load": num(a.get("activityTrainingLoad")),
        "vo2max": num(a.get("vO2MaxValue")),
        "intensity_mod": a.get("moderateIntensityMinutes"),
        "intensity_vig": a.get("vigorousIntensityMinutes"),
        "steps": num(a.get("steps")),
        "bb_cost": a.get("differenceBodyBattery"),
        "rpe": a.get("workoutRpe"),
        "feel": a.get("workoutFeel"),
    }
    if atype == "running":
        z = zone_buckets(a, "hrTimeInZone_")
        if z:
            act["hr_zones"] = z
        pz = zone_buckets(a, "powerTimeInZone_")
        if pz:
            act["power_zones"] = pz
    # nettoyage des None pour alléger
    return {k: v for k, v in act.items() if v is not None}


def build_daily(uds, sleep):
    sleep_by_date = {}
    for s in (sleep or []):
        if not isinstance(s, dict):
            continue
        cd = s.get("calendarDate")
        if not cd:
            continue
        deep = s.get("deepSleepSeconds") or 0
        light = s.get("lightSleepSeconds") or 0
        rem = s.get("remSleepSeconds") or 0
        awake = s.get("awakeSleepSeconds") or 0
        sleep_by_date[cd] = {
            "sleep_s": (deep + light + rem) or None,
            "sleep_score": (s.get("sleepScores") or {}).get("overallScore"),
            "deep_s": deep or None, "light_s": light or None,
            "rem_s": rem or None, "awake_s": awake or None,
        }

    rows = []
    for d in (uds or []):
        cd = d.get("calendarDate")
        if not cd:
            continue
        stress = None
        for agg in (d.get("allDayStress") or {}).get("aggregatorList", []):
            if agg.get("type") == "TOTAL":
                stress = agg.get("averageStressLevel")
        bb_hi = bb_lo = None
        for st in (d.get("bodyBattery") or {}).get("bodyBatteryStatList", []):
            if st.get("bodyBatteryStatType") == "HIGHEST":
                bb_hi = st.get("statsValue")
            elif st.get("bodyBatteryStatType") == "LOWEST":
                bb_lo = st.get("statsValue")
        sl = sleep_by_date.get(cd, {})
        row = {
            "date": cd,
            "resting_hr": d.get("restingHeartRate") or d.get("currentDayRestingHeartRate"),
            "steps": d.get("totalSteps"),
            "stress_avg": stress,
            "body_battery_high": bb_hi,
            "body_battery_low": bb_lo,
            "spo2_avg": d.get("averageSpo2Value"),
            "spo2_low": d.get("lowestSpo2Value"),
            "intensity_mod": d.get("moderateIntensityMinutes"),
            "intensity_vig": d.get("vigorousIntensityMinutes"),
            **sl,
        }
        if any(v is not None for k, v in row.items() if k != "date"):
            rows.append({k: v for k, v in row.items() if v is not None})
    rows.sort(key=lambda r: r["date"], reverse=True)
    return rows


def dedupe_latest(items, key="date"):
    """Garde la dernière entrée par date."""
    out = {}
    for it in items:
        out[it[key]] = it
    return [out[k] for k in sorted(out)]


def build_series(root, runs):
    series = {}

    # Prédictions de course
    rp = load(first(root, "*RunRacePredictions*.json")) or []
    preds = []
    for e in rp:
        cd = e.get("calendarDate")
        if cd and e.get("raceTime5K"):
            preds.append({"date": cd, "t5k": e.get("raceTime5K"), "t10k": e.get("raceTime10K"),
                          "half": e.get("raceTimeHalf"), "marathon": e.get("raceTimeMarathon")})
    if preds:
        series["race_predictions"] = dedupe_latest(preds)

    # VO2max running (MaxMet + par sortie)
    vo = {}
    mm = load(first(root, "*MetricsMaxMetData*.json")) or []
    for e in mm:
        if (e.get("sport") or "").upper() == "RUNNING" and e.get("vo2MaxValue"):
            vo[e["calendarDate"]] = round(e["vo2MaxValue"])
    for a in runs:
        if a.get("vo2max") and a.get("start"):
            vo.setdefault(a["start"][:10], a["vo2max"])
    if vo:
        series["vo2max"] = [{"date": d, "value": vo[d]} for d in sorted(vo)]

    # Âge de forme
    fa = load(first(root, "*fitnessAgeData.json")) or []
    ages = []
    for e in fa:
        d = (e.get("asOfDateGmt") or "")[:10]
        if d and e.get("currentBioAge") is not None:
            ages.append({"date": d, "fitness_age": round(e["currentBioAge"], 1),
                         "chrono_age": e.get("chronologicalAge"),
                         "bmi": round(e["bmi"], 1) if e.get("bmi") else None,
                         "rhr": e.get("rhr")})
    if ages:
        series["fitness_age"] = dedupe_latest(ages)

    # HRV (statut de santé)
    hs = load(first(root, "*healthStatusData.json")) or []
    hrv = []
    for e in hs:
        cd = e.get("calendarDate")
        val = None
        for mtr in (e.get("metrics") or []):
            if mtr.get("type") == "HRV" and mtr.get("value"):
                val = round(mtr["value"])
        if cd and val:
            hrv.append({"date": cd, "value": val})
    if hrv:
        series["hrv"] = dedupe_latest([{"date": h["date"], "value": h["value"]} for h in hrv])

    # Définitions de zones de puissance (running)
    pz = load(first(root, "*powerZones.json")) or []
    run_pz = next((z for z in pz if (z.get("sport") or "").upper() == "RUNNING"), None)
    if run_pz and run_pz.get("functionalThresholdPower"):
        series["power_zones_def"] = {
            "ftp": round(run_pz["functionalThresholdPower"]),
            "floors": [run_pz.get(f"zone{i}Floor") for i in range(1, 6)],
        }
    return series


def main():
    if len(sys.argv) < 2:
        log(__doc__)
        raise SystemExit(1)
    src = os.path.expanduser(sys.argv[1])
    out = os.path.expanduser(sys.argv[2]) if len(sys.argv) > 2 else \
        os.path.join(os.path.dirname(os.path.abspath(src)) if os.path.isfile(src) else src, "garmin-data.json")

    root = find_root(src)
    log("→ Lecture de l'export Garmin...")

    sa_path = first(root, "*summarizedActivities.json")
    if not sa_path:
        raise SystemExit("[!] Fichier des activités introuvable (summarizedActivities.json).")
    sa_raw = load(sa_path)
    acts_raw = sa_raw[0]["summarizedActivitiesExport"] if isinstance(sa_raw, list) else sa_raw.get("summarizedActivitiesExport", [])
    activities = [convert_activity(a) for a in acts_raw if a.get("startTimeLocal")]
    activities.sort(key=lambda a: a.get("start") or "")
    runs = [a for a in activities if a["type"] == "running"]
    log(f"  {len(activities)} activités ({len(runs)} courses).")

    uds = load(first(root, "UDSFile_*.json")) or []
    sleep = load(first(root, "*sleepData.json")) or []
    daily = build_daily(uds, sleep)
    log(f"  {len(daily)} journées de bien-être.")

    series = build_series(root, runs)
    log("  séries de progression : " + (", ".join(series.keys()) or "aucune"))

    profile = {}
    up = load(first(root, "user_profile.json")) or {}
    fn, ln = up.get("firstName"), up.get("lastName")
    if fn or ln:
        profile["full_name"] = " ".join(x for x in (fn, ln) if x)
    profile["display_name"] = up.get("userName")
    if up.get("birthDate"):
        profile["birth_date"] = up["birthDate"]
    if up.get("gender"):
        profile["gender"] = up["gender"]
    hz = load(first(root, "*heartRateZones.json"))
    if isinstance(hz, list) and hz:
        run_z = next((z for z in hz if z.get("sport") == "RUNNING"), hz[0])
        if run_z.get("maxHeartRateUsed"):
            profile["max_hr"] = run_z["maxHeartRateUsed"]
        if run_z.get("restingHeartRateUsed"):
            profile["resting_hr"] = run_z["restingHeartRateUsed"]
        profile["hr_zone_floors"] = [run_z.get(f"zone{i}Floor") for i in range(1, 6)]
    for r in daily:
        if r.get("resting_hr"):
            profile["resting_hr"] = r["resting_hr"]
            break
    for a in reversed(runs):
        if a.get("vo2max"):
            profile["vo2max_running"] = a["vo2max"]
            break
    if series.get("fitness_age"):
        profile["fitness_age"] = series["fitness_age"][-1]["fitness_age"]

    data = {
        "generated_at": dt.datetime.now().isoformat(timespec="seconds"),
        "source": "garmin-export",
        "profile": profile,
        "activities": activities,
        "daily": daily,
        "series": series,
    }
    with open(out, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    log(f"\n✓ Fichier créé : {out}")
    log("  Importe-le dans l'app RunLab (« Importer mes données »).")


if __name__ == "__main__":
    main()
