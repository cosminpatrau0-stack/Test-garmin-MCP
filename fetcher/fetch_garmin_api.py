#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Récupère tes données via la GARMIN PERSONAL API officielle (lecture seule)
et écrit garmin-data.json pour l'app RunLab.

Ta clé Personal API reste sur TA machine (fichier local ou variable
d'environnement). Rien n'est envoyé ailleurs que vers Garmin.

Prérequis :
    python -m pip install garmin-connect-personal-api-python

Clé API : créée sur https://connect.garmin.com/app/settings/personalApiToken
Elle peut être fournie de 3 façons :
  1) variable d'environnement GARMIN_PERSONAL_API_KEY
  2) fichier ~/.config/garmin/connect-personal-api-key
  3) saisie au clavier au lancement (sauvegardée dans le fichier ci-dessus)

Usage :
    python3 fetch_garmin_api.py            # 400 jours d'activités, 180 j de bien-être
"""

import os
import sys
import json
import datetime as dt
from datetime import date, timedelta

try:
    import garmin_personal_api as gapi
except ImportError:
    print("\n[!] Le module officiel n'est pas installé. Lance :")
    print("    python -m pip install garmin-connect-personal-api-python\n")
    sys.exit(1)

DAYS_ACTIVITIES = int(os.environ.get("RUNLAB_DAYS", "400"))
DAYS_WELLNESS = int(os.environ.get("RUNLAB_WELLNESS_DAYS", "180"))
DETAIL_LIMIT = int(os.environ.get("RUNLAB_DETAIL", "120"))      # nb de courses enrichies (détail)
FITAGE_STEP = 10                                               # échantillonnage âge de forme (jours)
KEY_FILE = os.path.expanduser("~/.config/garmin/connect-personal-api-key")
OUT = os.environ.get("RUNLAB_OUT") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "garmin-data.json")
DEBUG = os.path.join(os.path.dirname(OUT), "garmin-api-debug.json")

RUN_KEYS = ("running", "treadmill_running", "trail_running", "track_running", "virtual_run", "indoor_running")


def log(m): print(m, flush=True)


def pick(d, *keys, default=None):
    if not isinstance(d, dict):
        return default
    for k in keys:
        v = d.get(k)
        if v is not None:
            return v
    return default


def get_key():
    # 1) env  2) fichier  3) saisie
    try:
        return gapi.resolve_api_key()
    except Exception:
        pass
    log("\n--- Clé Garmin Personal API ---")
    log("Crée-la sur https://connect.garmin.com/app/settings/personalApiToken")
    key = input("Colle ta clé Personal API : ").strip()
    if not key:
        raise SystemExit("[!] Aucune clé fournie.")
    os.makedirs(os.path.dirname(KEY_FILE), exist_ok=True)
    with open(KEY_FILE, "w") as f:
        f.write(key)
    try:
        os.chmod(KEY_FILE, 0o600)
    except Exception:
        pass
    log(f"✓ Clé enregistrée dans {KEY_FILE} (tu n'auras plus à la retaper).")
    return key


def as_list(v, inner=None):
    """Normalise une réponse en liste de dicts (gère list ou dict{inner:[...]})."""
    if isinstance(v, list):
        return v
    if isinstance(v, dict):
        if inner and isinstance(v.get(inner), list):
            return v[inner]
        for val in v.values():
            if isinstance(val, list):
                return val
    return []


def norm_type(t):
    t = (t or "").lower()
    if any(k in t for k in ("run",)):
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


def stride_to_m(v):
    if v is None:
        return None
    return round(v / 100.0, 2) if v > 3 else round(v, 2)   # cm -> m (garde si déjà en m)


def convert_activity(a, detail=None):
    src = dict(a)
    if isinstance(detail, dict):
        # le détail porte souvent les métriques dans summaryDTO
        src = {**src, **(detail.get("summaryDTO") or detail)}
        at = detail.get("activityTypeDTO") or {}
        if at.get("typeKey"):
            src.setdefault("activityType", {"typeKey": at["typeKey"]})

    tkey = ""
    at = src.get("activityType")
    if isinstance(at, dict):
        tkey = at.get("typeKey") or ""
    elif isinstance(at, str):
        tkey = at
    atype = norm_type(tkey)

    dist_m = pick(src, "distance", default=0) or 0
    dur_s = pick(src, "duration", "elapsedDuration", default=0) or 0
    mov_s = pick(src, "movingDuration", default=0) or dur_s
    km = dist_m / 1000.0
    pace = round(mov_s / km) if km > 0 and mov_s > 0 else None
    gap_speed = pick(src, "avgGradeAdjustedSpeed")
    gap = round(1000.0 / gap_speed) if gap_speed else None

    def rnd(v, nd=None):
        return None if v is None else (round(v, nd) if nd is not None else round(v))

    act = {
        "id": pick(src, "activityId", "id"),
        "name": pick(src, "activityName", "name", default="Sans titre"),
        "type": atype,
        "start": pick(src, "startTimeLocal"),
        "distance_km": round(km, 3),
        "duration_s": rnd(dur_s),
        "moving_s": rnd(mov_s),
        "avg_pace_s_per_km": pace,
        "gap_pace_s_per_km": gap,
        "avg_hr": rnd(pick(src, "averageHR", "avgHr")),
        "max_hr": rnd(pick(src, "maxHR", "maxHr")),
        "avg_cadence": rnd(pick(src, "averageRunningCadenceInStepsPerMinute", "averageRunCadence", "avgRunCadence", "avgDoubleCadence")),
        "max_cadence": rnd(pick(src, "maxRunningCadenceInStepsPerMinute", "maxRunCadence", "maxDoubleCadence")),
        "avg_stride_m": stride_to_m(pick(src, "avgStrideLength", "averageStrideLength")),
        "avg_gct_ms": rnd(pick(src, "avgGroundContactTime", "groundContactTime")),
        "avg_vosc_cm": rnd(pick(src, "avgVerticalOscillation", "verticalOscillation"), 1),
        "avg_vratio": rnd(pick(src, "avgVerticalRatio", "verticalRatio"), 1),
        "avg_power": rnd(pick(src, "avgPower", "averagePower")),
        "max_power": rnd(pick(src, "maxPower")),
        "norm_power": rnd(pick(src, "normPower", "normalizedPower")),
        "elevation_gain_m": rnd(pick(src, "elevationGain", default=0) or 0),
        "calories": rnd(pick(src, "calories")),
        "aerobic_te": rnd(pick(src, "aerobicTrainingEffect"), 1),
        "anaerobic_te": rnd(pick(src, "anaerobicTrainingEffect"), 1),
        "te_label": pick(src, "trainingEffectLabel"),
        "training_load": rnd(pick(src, "activityTrainingLoad")),
        "vo2max": rnd(pick(src, "vO2MaxValue")),
        "intensity_mod": pick(src, "moderateIntensityMinutes"),
        "intensity_vig": pick(src, "vigorousIntensityMinutes"),
        "steps": rnd(pick(src, "steps")),
    }

    # zones FC par activité si présentes dans le détail
    zones = detail.get("hrTimeInZones") if isinstance(detail, dict) else None
    if isinstance(zones, list):
        z = []
        for item in zones:
            secs = pick(item, "secsInZone", "seconds")
            zn = pick(item, "zoneNumber", "zone")
            if secs and zn:
                z.append({"zone": int(zn), "seconds": round(secs)})
        if z:
            act["hr_zones"] = z

    return {k: v for k, v in act.items() if v is not None}


def build(client):
    today = date.today()
    start = today - timedelta(days=DAYS_ACTIVITIES)

    # ---- activités (pagination) ----
    log(f"→ Activités depuis {start} ...")
    acts_raw, offset = [], 0
    while True:
        batch = as_list(client.search_activities(start=offset, limit=50, start_date=start.isoformat(), end_date=today.isoformat()), "activities")
        if not batch:
            break
        acts_raw += batch
        offset += len(batch)
        if len(batch) < 50 or offset > 2000:
            break
    log(f"  {len(acts_raw)} activités.")

    # détail pour les courses (dynamique + zones FC)
    activities = []
    detailed = 0
    for a in acts_raw:
        tkey = ""
        at = a.get("activityType")
        if isinstance(at, dict):
            tkey = (at.get("typeKey") or "").lower()
        detail = None
        if any(k in tkey for k in ("run",)) and detailed < DETAIL_LIMIT:
            try:
                detail = client.get_activity(pick(a, "activityId", "id"))
                detailed += 1
            except Exception as e:
                log(f"  (détail indisponible: {e})")
        activities.append(convert_activity(a, detail))
    activities.sort(key=lambda x: x.get("start") or "")
    runs = [a for a in activities if a["type"] == "running"]
    log(f"  dont {len(runs)} courses ({detailed} enrichies en détail).")

    # ---- bien-être (plages) ----
    ws = (today - timedelta(days=DAYS_WELLNESS)).isoformat()
    we = today.isoformat()
    daily = {}

    def merge(rows, fn):
        for r in as_list(rows):
            if not isinstance(r, dict):
                continue
            d = pick(r, "calendarDate", "calendar_date", "date")
            if not d:
                continue
            d = str(d)[:10]
            row = daily.setdefault(d, {"date": d})
            fn(r, row)

    def safe(name, fn):
        try:
            fn()
        except Exception as e:
            log(f"  (bien-être '{name}' indisponible: {e})")

    safe("résumés quotidiens", lambda: merge(client.get_daily_summaries(ws, we), lambda r, row: row.update({
        "resting_hr": pick(r, "restingHeartRate"), "steps": pick(r, "totalSteps", "steps"),
        "intensity_mod": pick(r, "moderateIntensityMinutes"), "intensity_vig": pick(r, "vigorousIntensityMinutes"),
    })))
    safe("stress", lambda: merge(client.get_daily_stress(ws, we), lambda r, row: row.update({
        "stress_avg": pick(r, "averageStressLevel", "overallStressLevel", "avgStressLevel"),
    })))
    safe("body battery", lambda: merge(client.get_daily_body_battery(ws, we), lambda r, row: row.update({
        "body_battery_high": pick(r, "charged", "bodyBatteryHigh", "highestValue", "max"),
        "body_battery_low": pick(r, "drained", "bodyBatteryLow", "lowestValue", "min"),
    })))
    safe("sommeil", lambda: merge(client.get_daily_sleep_summaries(ws, we), lambda r, row: row.update({
        "sleep_s": (pick(r, "deepSleepSeconds", default=0) or 0) + (pick(r, "lightSleepSeconds", default=0) or 0) + (pick(r, "remSleepSeconds", default=0) or 0) or pick(r, "sleepTimeSeconds"),
        "deep_s": pick(r, "deepSleepSeconds"), "light_s": pick(r, "lightSleepSeconds"),
        "rem_s": pick(r, "remSleepSeconds"), "awake_s": pick(r, "awakeSleepSeconds"),
        "sleep_score": pick((pick(r, "sleepScores") or {}), "overallScore") if isinstance(pick(r, "sleepScores"), dict) else pick(r, "sleepScore", "overallSleepScore"),
    })))

    hrv_series = []
    def hrv_fn():
        for r in as_list(client.get_daily_hrv_summaries(ws, we)):
            d = pick(r, "calendarDate", "date")
            v = pick(r, "weeklyAvg", "lastNightAvg", "hrvValue", "avgHrv", "value")
            if d and v:
                hrv_series.append({"date": str(d)[:10], "value": round(v)})
    safe("HRV", hrv_fn)

    daily_rows = sorted(daily.values(), key=lambda r: r["date"], reverse=True)
    daily_rows = [{k: v for k, v in r.items() if v is not None} for r in daily_rows]
    daily_rows = [r for r in daily_rows if len(r) > 1]
    log(f"  {len(daily_rows)} journées de bien-être, {len(hrv_series)} points HRV.")

    # ---- séries de progression ----
    series = {}
    if hrv_series:
        series["hrv"] = sorted({x["date"]: x for x in hrv_series}.values(), key=lambda x: x["date"])

    vo = {}
    for a in runs:
        if a.get("vo2max") and a.get("start"):
            vo.setdefault(a["start"][:10], a["vo2max"])
    if vo:
        series["vo2max"] = [{"date": d, "value": vo[d]} for d in sorted(vo)]

    fitness_age = []
    def fitage():
        d = start
        while d <= today:
            try:
                r = client.get_fitness_age(d.isoformat())
                fa = pick(r, "fitnessAge", "currentBioAge", "bioAge", "achievableFitnessAge")
                ch = pick(r, "chronologicalAge")
                if fa is not None:
                    fitness_age.append({"date": d.isoformat(), "fitness_age": round(fa, 1), "chrono_age": ch})
            except Exception:
                pass
            d += timedelta(days=FITAGE_STEP)
    safe("âge de forme", fitage)
    if fitness_age:
        series["fitness_age"] = fitness_age

    # ---- profil + zones ----
    profile = {}
    try:
        up = client.get_user_profile_settings() or {}
        ud = up.get("userData") if isinstance(up, dict) else None
        ud = ud or up
        fn = pick(ud, "firstName")
        ln = pick(ud, "lastName")
        if fn or ln:
            profile["full_name"] = " ".join(x for x in (fn, ln) if x)
        profile["display_name"] = pick(up, "userName", "displayName") if isinstance(up, dict) else None
        if pick(ud, "birthDate"):
            profile["birth_date"] = pick(ud, "birthDate")
    except Exception as e:
        log(f"  (profil indisponible: {e})")
    try:
        hz = client.get_heart_rate_zones()
        zlist = as_list(hz)
        runz = next((z for z in zlist if (pick(z, "sport") or "").upper() == "RUNNING"), (zlist[0] if zlist else None))
        if runz:
            floors = [pick(runz, f"zone{i}Floor") for i in range(1, 6)]
            if any(floors):
                profile["hr_zone_floors"] = floors
            if pick(runz, "maxHeartRateUsed"):
                profile["max_hr"] = pick(runz, "maxHeartRateUsed")
            if pick(runz, "restingHeartRateUsed"):
                profile["resting_hr"] = pick(runz, "restingHeartRateUsed")
    except Exception as e:
        log(f"  (zones FC indisponibles: {e})")
    for r in daily_rows:
        if r.get("resting_hr"):
            profile["resting_hr"] = r["resting_hr"]
            break
    for a in reversed(runs):
        if a.get("vo2max"):
            profile["vo2max_running"] = a["vo2max"]
            break
    if fitness_age:
        profile["fitness_age"] = fitness_age[-1]["fitness_age"]

    return {
        "generated_at": dt.datetime.now().isoformat(timespec="seconds"),
        "source": "garmin-personal-api",
        "profile": profile,
        "activities": activities,
        "daily": daily_rows,
        "series": series,
    }, acts_raw


def main():
    log("=" * 56)
    log("  RunLab — récupération via Garmin Personal API")
    log("=" * 56)
    key = get_key()
    log("→ Obtention du jeton d'accès (valable 24 h)...")
    with gapi.PersonalApiAuthenticator() as auth:
        token = auth.obtain_token(key)
    with gapi.GarminPersonalApiClient(token.access_token) as client:
        data, raw = build(client)

    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)

    # petit dump de structure (noms de champs) pour diagnostic si besoin
    try:
        sample = {"activity_keys": sorted((raw[0] or {}).keys()) if raw else [],
                  "counts": {"activities": len(data["activities"]), "daily": len(data["daily"]), "series": {k: len(v) for k, v in data["series"].items()}}}
        with open(DEBUG, "w", encoding="utf-8") as f:
            json.dump(sample, f, ensure_ascii=False, indent=1)
    except Exception:
        pass

    log("\n" + "=" * 56)
    log(f"✓ Terminé : {OUT}")
    log(f"  {len(data['activities'])} activités · {len(data['daily'])} jours · séries: {', '.join(data['series']) or 'aucune'}")
    log("=" * 56)
    log("Importe garmin-data.json dans l'app RunLab (« Importer mes données »).")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        log("\nInterrompu.")
    except Exception as e:
        log(f"\n[!] Erreur : {e}")
        sys.exit(1)
