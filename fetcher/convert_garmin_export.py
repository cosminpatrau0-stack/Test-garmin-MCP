#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Convertit l'EXPORT OFFICIEL Garmin (le gros ZIP « Exporter vos données »
demandé depuis le compte Garmin) en un fichier garmin-data.json prêt pour
l'app RunLab.

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
    """Renvoie un dossier contenant l'export (décompresse le ZIP si besoin)."""
    if os.path.isdir(path):
        return path, None
    if zipfile.is_zipfile(path):
        tmp = tempfile.mkdtemp(prefix="garmin_export_")
        with zipfile.ZipFile(path) as z:
            z.extractall(tmp)
        return tmp, tmp
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
    # startTimeLocal est déjà décalé en heure locale : on lit en UTC pour
    # garder l'heure « au mur » sans re-décaler.
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


def hr_zones(a):
    """hrTimeInZone_X est en millisecondes ; _0 = sous la zone 1."""
    z = []
    for i in range(1, 6):
        ms = a.get(f"hrTimeInZone_{i}") or 0
        if i == 1:
            ms += a.get("hrTimeInZone_0") or 0
        if i == 5:
            ms += a.get("hrTimeInZone_6") or 0
        if ms:
            z.append({"zone": i, "seconds": round(ms / 1000)})
    return z


def convert_activity(a):
    dist_m = (a.get("distance") or 0) / 100.0          # cm -> m
    dur_s = (a.get("duration") or 0) / 1000.0          # ms -> s
    mov_s = (a.get("movingDuration") or 0) / 1000.0 or dur_s
    km = dist_m / 1000.0
    atype = norm_type(a.get("activityType"))
    pace = round(mov_s / km) if km > 0 and mov_s > 0 else None
    act = {
        "id": a.get("activityId"),
        "name": a.get("name") or "Sans titre",
        "type": atype,
        "start": local_iso(a["startTimeLocal"]) if a.get("startTimeLocal") else None,
        "distance_km": round(km, 3),
        "duration_s": round(dur_s),
        "moving_s": round(mov_s),
        "avg_pace_s_per_km": pace,
        "avg_hr": round(a["avgHr"]) if a.get("avgHr") else None,
        "max_hr": round(a["maxHr"]) if a.get("maxHr") else None,
        "avg_cadence": round(a["avgDoubleCadence"]) if a.get("avgDoubleCadence") else None,
        "elevation_gain_m": round((a.get("elevationGain") or 0) / 100.0),   # cm -> m
        "calories": round(a["calories"]) if a.get("calories") else None,
        "aerobic_te": round(a["aerobicTrainingEffect"], 1) if a.get("aerobicTrainingEffect") else None,
        "anaerobic_te": round(a["anaerobicTrainingEffect"], 1) if a.get("anaerobicTrainingEffect") else None,
        "training_load": round(a["activityTrainingLoad"]) if a.get("activityTrainingLoad") else None,
        "vo2max": round(a["vO2MaxValue"]) if a.get("vO2MaxValue") else None,
    }
    if atype == "running":
        z = hr_zones(a)
        if z:
            act["hr_zones"] = z
    return act


def build_daily(uds, sleep):
    # sommeil indexé par date
    sleep_by_date = {}
    for s in (sleep or []):
        if not isinstance(s, dict):
            continue
        cd = s.get("calendarDate")
        if not cd:
            continue
        secs = sum(s.get(k) or 0 for k in ("deepSleepSeconds", "lightSleepSeconds", "remSleepSeconds"))
        score = (s.get("sleepScores") or {}).get("overallScore")
        sleep_by_date[cd] = {"sleep_s": secs or None, "sleep_score": score}

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
            "sleep_s": sl.get("sleep_s"),
            "sleep_score": sl.get("sleep_score"),
        }
        if any(v is not None for k, v in row.items() if k != "date"):
            rows.append(row)
    rows.sort(key=lambda r: r["date"], reverse=True)
    return rows


def main():
    if len(sys.argv) < 2:
        log(__doc__)
        raise SystemExit(1)
    src = os.path.expanduser(sys.argv[1])
    out = os.path.expanduser(sys.argv[2]) if len(sys.argv) > 2 else \
        os.path.join(os.path.dirname(os.path.abspath(src)) if os.path.isfile(src) else src, "garmin-data.json")

    root, _tmp = find_root(src)
    log("→ Lecture de l'export Garmin...")

    sa_path = first(root, "*summarizedActivities.json")
    if not sa_path:
        raise SystemExit("[!] Fichier des activités introuvable (summarizedActivities.json).")
    sa_raw = load(sa_path)
    acts_raw = sa_raw[0]["summarizedActivitiesExport"] if isinstance(sa_raw, list) else sa_raw.get("summarizedActivitiesExport", [])
    activities = [convert_activity(a) for a in acts_raw if a.get("startTimeLocal")]
    activities.sort(key=lambda a: a["start"] or "")
    runs = [a for a in activities if a["type"] == "running"]
    log(f"  {len(activities)} activités ({len(runs)} courses).")

    # bien-être
    uds = load(first(root, "UDSFile_*.json")) or []
    sleep = load(first(root, "*sleepData.json")) or []
    daily = build_daily(uds, sleep)
    log(f"  {len(daily)} journées de bien-être.")

    # profil
    profile = {}
    up = load(first(root, "user_profile.json")) or {}
    fn, ln = up.get("firstName"), up.get("lastName")
    if fn or ln:
        profile["full_name"] = " ".join(x for x in (fn, ln) if x)
    profile["display_name"] = up.get("userName")
    hz = load(first(root, "*heartRateZones.json"))
    if isinstance(hz, list) and hz:
        run_z = next((z for z in hz if z.get("sport") == "RUNNING"), hz[0])
        if run_z.get("maxHeartRateUsed"):
            profile["max_hr"] = run_z["maxHeartRateUsed"]
        if run_z.get("restingHeartRateUsed"):
            profile["resting_hr"] = run_z["restingHeartRateUsed"]
    # FC repos la plus récente depuis le bien-être
    for r in daily:
        if r.get("resting_hr"):
            profile["resting_hr"] = r["resting_hr"]
            break
    # VO2max le plus récent
    for a in reversed(runs):
        if a.get("vo2max"):
            profile["vo2max_running"] = a["vo2max"]
            break

    data = {
        "generated_at": dt.datetime.now().isoformat(timespec="seconds"),
        "source": "garmin-export",
        "profile": profile,
        "activities": activities,
        "daily": daily,
    }
    with open(out, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    log(f"\n✓ Fichier créé : {out}")
    log("  Importe-le dans l'app RunLab (« Importer mes données »).")


if __name__ == "__main__":
    main()
