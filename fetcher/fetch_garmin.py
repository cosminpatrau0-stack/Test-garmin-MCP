#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Récupère TOUTES tes données Garmin et les écrit dans un seul fichier
"garmin-data.json" que tu importes ensuite dans l'app RunLab.

Tes identifiants Garmin restent sur TON appareil. Ce script parle
directement aux serveurs Garmin et n'envoie rien à personne d'autre.

Usage simple (via les scripts run-mac.command / run-windows.bat), ou :
    python3 fetch_garmin.py
"""

import os
import sys
import json
import getpass
import datetime as dt

try:
    from garminconnect import Garmin
except ImportError:
    print("\n[!] La librairie 'garminconnect' n'est pas installée.")
    print("    Lance :  python3 -m pip install -r requirements.txt\n")
    sys.exit(1)

# -------------------------------------------------------------------------
# Réglages (tu peux les changer, mais les valeurs par défaut conviennent)
# -------------------------------------------------------------------------
DAYS_ACTIVITIES = int(os.environ.get("RUNLAB_DAYS", "400"))   # historique d'activités
DAYS_WELLNESS = int(os.environ.get("RUNLAB_WELLNESS_DAYS", "120"))  # sommeil / FC repos / stress
HR_ZONE_LIMIT = int(os.environ.get("RUNLAB_HRZONES", "80"))   # nb de courses récentes avec détail zones FC
TOKEN_DIR = os.path.join(os.path.expanduser("~"), ".garminconnect")
OUTPUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "garmin-data.json")


def log(msg):
    print(msg, flush=True)


def connect():
    """Se connecte à Garmin, en réutilisant un jeton en cache si possible."""
    email = os.environ.get("GARMIN_EMAIL")
    password = os.environ.get("GARMIN_PASSWORD")

    # 1) Tentative via un jeton déjà enregistré (pas de mot de passe à retaper)
    try:
        garmin = Garmin()
        garmin.login(TOKEN_DIR)
        log("✓ Connecté à Garmin (session mémorisée).")
        return garmin
    except Exception:
        pass

    # 2) Connexion avec identifiants
    if not email:
        log("\n--- Connexion à Garmin Connect ---")
        email = input("Email Garmin : ").strip()
    if not password:
        password = getpass.getpass("Mot de passe Garmin (invisible) : ")

    garmin = Garmin(email=email, password=password, return_on_mfa=True)
    result1, result2 = garmin.login()

    # 3) Double authentification (code reçu par e-mail / SMS) si activée
    if result1 == "needs_mfa":
        mfa = input("Code de vérification (MFA) reçu par Garmin : ").strip()
        garmin.resume_login(result2, mfa)

    # Mémorise la session pour les prochaines fois
    try:
        garmin.garth.dump(TOKEN_DIR)
    except Exception:
        pass

    log("✓ Connecté à Garmin.")
    return garmin


def safe(fn, *args, default=None):
    """Appelle une fonction Garmin sans faire planter tout le script si elle échoue."""
    try:
        return fn(*args)
    except Exception as e:
        log(f"  (info) donnée indisponible: {e}")
        return default


def norm_type(activity):
    key = ""
    t = activity.get("activityType") or {}
    if isinstance(t, dict):
        key = (t.get("typeKey") or "").lower()
    if "run" in key:
        return "running"
    if "walk" in key:
        return "walking"
    if "cycl" in key or "bik" in key:
        return "cycling"
    if "swim" in key:
        return "swimming"
    return key or "other"


def pace_s_per_km(distance_m, moving_s, elapsed_s):
    duration = moving_s or elapsed_s or 0
    if not distance_m or distance_m <= 0 or duration <= 0:
        return None
    return round(duration / (distance_m / 1000.0))


def build_activity(a, garmin, want_zones):
    dist_m = a.get("distance") or 0
    elapsed = a.get("duration") or 0
    moving = a.get("movingDuration") or 0
    atype = norm_type(a)

    act = {
        "id": a.get("activityId"),
        "name": a.get("activityName") or "Sans titre",
        "type": atype,
        "start": a.get("startTimeLocal"),
        "distance_km": round(dist_m / 1000.0, 3) if dist_m else 0,
        "duration_s": round(elapsed),
        "moving_s": round(moving) if moving else round(elapsed),
        "avg_pace_s_per_km": pace_s_per_km(dist_m, moving, elapsed),
        "avg_hr": a.get("averageHR"),
        "max_hr": a.get("maxHR"),
        "avg_cadence": a.get("averageRunningCadenceInStepsPerMinute"),
        "elevation_gain_m": round(a.get("elevationGain")) if a.get("elevationGain") else 0,
        "calories": a.get("calories"),
        "aerobic_te": a.get("aerobicTrainingEffect"),
        "anaerobic_te": a.get("anaerobicTrainingEffect"),
        "training_load": a.get("activityTrainingLoad"),
        "vo2max": a.get("vO2MaxValue"),
    }

    if want_zones and atype == "running" and act["id"]:
        zones = safe(garmin.get_activity_hr_in_timezones, act["id"])
        if zones:
            z = []
            for item in zones:
                secs = item.get("secsInZone")
                znum = item.get("zoneNumber")
                if secs and znum:
                    z.append({"zone": int(znum), "seconds": round(secs)})
            if z:
                act["hr_zones"] = z
    return act


def build_wellness(garmin, days):
    out = []
    today = dt.date.today()
    for i in range(days):
        d = today - dt.timedelta(days=i)
        ds = d.isoformat()
        summary = safe(garmin.get_user_summary, ds, default={}) or {}
        sleep = safe(garmin.get_sleep_data, ds, default={}) or {}
        daily = sleep.get("dailySleepDTO") or {}

        row = {
            "date": ds,
            "resting_hr": summary.get("restingHeartRate"),
            "steps": summary.get("totalSteps"),
            "stress_avg": summary.get("averageStressLevel"),
            "body_battery_high": summary.get("bodyBatteryHighestValue"),
            "body_battery_low": summary.get("bodyBatteryLowestValue"),
            "sleep_s": daily.get("sleepTimeSeconds"),
            "sleep_score": (daily.get("sleepScores") or {}).get("overall", {}).get("value")
            if isinstance(daily.get("sleepScores"), dict) else None,
        }
        # On ne garde la ligne que si elle contient au moins une donnée utile
        if any(v is not None for k, v in row.items() if k != "date"):
            out.append(row)
    return out


def main():
    log("=" * 56)
    log("  RunLab — récupération de tes données Garmin")
    log("=" * 56)

    garmin = connect()

    # Profil
    profile = {}
    try:
        profile["full_name"] = garmin.get_full_name()
    except Exception:
        pass
    try:
        prof = garmin.get_user_profile() or {}
        profile["display_name"] = prof.get("displayName")
    except Exception:
        pass

    # Activités
    start = (dt.date.today() - dt.timedelta(days=DAYS_ACTIVITIES)).isoformat()
    end = dt.date.today().isoformat()
    log(f"\n→ Récupération des activités depuis {start} ...")
    raw = safe(garmin.get_activities_by_date, start, end, default=[]) or []
    log(f"  {len(raw)} activités trouvées.")

    activities = []
    running_count = 0
    for a in raw:
        want_zones = running_count < HR_ZONE_LIMIT
        act = build_activity(a, garmin, want_zones)
        if act["type"] == "running":
            running_count += 1
            if want_zones and "hr_zones" in act:
                log(f"  zones FC ✓  {act['start']}  {act['distance_km']} km")
        activities.append(act)

    log(f"  dont {running_count} courses.")

    # Bien-être (sommeil, FC repos, stress...)
    log(f"\n→ Récupération du bien-être sur {DAYS_WELLNESS} jours ...")
    daily = build_wellness(garmin, DAYS_WELLNESS)
    log(f"  {len(daily)} journées récupérées.")

    # FC repos / VO2max les plus récents pour le profil
    if daily:
        for row in daily:
            if row.get("resting_hr"):
                profile["resting_hr"] = row["resting_hr"]
                break
    for a in activities:
        if a["type"] == "running" and a.get("vo2max"):
            profile["vo2max_running"] = a["vo2max"]
            break

    data = {
        "generated_at": dt.datetime.now().isoformat(timespec="seconds"),
        "source": "garmin-connect",
        "profile": profile,
        "activities": activities,
        "daily": daily,
    }

    with open(OUTPUT, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)

    log("\n" + "=" * 56)
    log(f"✓ Terminé ! Fichier créé :\n  {OUTPUT}")
    log("=" * 56)
    log("\nÉtape suivante : ouvre l'app RunLab et clique sur")
    log('« Importer mes données », puis choisis ce fichier garmin-data.json.\n')


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        log("\nInterrompu.")
    except Exception as e:
        log(f"\n[!] Erreur : {e}")
        log("    Vérifie ton email / mot de passe, ou réessaie dans quelques minutes.")
        sys.exit(1)
