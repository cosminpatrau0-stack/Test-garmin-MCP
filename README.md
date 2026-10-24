# 🏃 RunLab

**Ton tableau de bord running personnel, privé et gratuit, construit à partir de
tes données Garmin — avec un bilan prêt à coller dans Claude.**

Pas d'abonnement, pas de serveur, pas de compte. L'app tourne à 100 % dans ton
navigateur, et t'appartient entièrement.

👉 **Tu ne codes pas ? Suis le [GUIDE.md](GUIDE.md) pas à pas.**

---

## Ce que ça fait

- 📈 **Volume hebdomadaire**, tendance d'allure, temps total
- 🚀 **Progression** : VO2max dans le temps, **âge de forme**, **prédictions de course** (5K/10K/semi/marathon)
- ⚡ **Charge & forme** (modèle type PMC : fitness vs fatigue)
- 🫀 **Efficacité aérobie** : vitesse par battement (« cours-tu plus vite à FC égale ? »)
- 🏃 **Dynamique de course** : cadence, longueur de foulée, temps de contact au sol, oscillation verticale, **puissance** — avec tendances
- ❤️ **Zones FC + puissance** et **équilibre d'intensité 80/20** (polarisation)
- 🏅 **Records personnels** (5 km, 10 km, semi, marathon, D+…)
- 😴 **Récupération avancée** : HRV, FC de repos, **stades de sommeil**, stress, Body Battery, SpO2
- ✨ **Bilan pour Claude** en un clic, à coller dans une conversation

Tout est pensé **course à pied**, et exploite en profondeur l'export Garmin.

## Comment c'est organisé

| Dossier / fichier | Rôle |
|---|---|
| `index.html`, `app.js`, `charts.js`, `styles.css` | L'app (PWA installable, hors-ligne) |
| `manifest.webmanifest`, `service-worker.js`, `icons/` | Rend l'app installable sur le téléphone |
| `sample-data.json` | Données de démo (bouton « Voir une démo ») |
| `fetcher/` | Outils de récupération Garmin : **Personal API officielle** (`fetch_garmin_api.py`), connexion live, ou conversion de l'export ZIP officiel |
| `GUIDE.md` | Mode d'emploi non-technique |

## Confidentialité

- Tes identifiants Garmin ne quittent **jamais** ton ordinateur : l'outil
  `fetcher` parle directement aux serveurs Garmin.
- L'app lit le fichier `garmin-data.json` **localement** dans ton navigateur.
- Rien n'est envoyé à Claude tant que **tu** ne colles pas ton bilan toi-même.
- `garmin-data.json` est volontairement exclu de Git (`.gitignore`) : ne le
  publie pas.

---

## Mettre l'app en ligne (gratuit, avec GitHub Pages)

Pour l'installer sur le téléphone, il faut une adresse `https`. GitHub Pages le
fait gratuitement :

1. Sur la page GitHub de ce dépôt : **Settings** → **Pages**.
2. Sous **Build and deployment → Source**, choisis **Deploy from a branch**.
3. Branche : **main**, dossier : **/ (root)**. Clique **Save**.
4. Patiente ~1 min : ton app est en ligne à
   `https://<ton-identifiant>.github.io/test-garmin-mcp/`.

Ouvre cette adresse sur ton téléphone puis « Ajouter à l'écran d'accueil ».

## Lancer l'outil de récupération (résumé)

**Recommandé — Garmin Personal API officielle** (clé créée sur
`connect.garmin.com/app/settings/personalApiToken`) :
```bash
cd fetcher
python3 -m pip install -r requirements-api.txt
python3 fetch_garmin_api.py      # (ou double-clic sur RunLab-API.command)
```

Alternative — connexion login :
```bash
cd fetcher
python3 -m pip install -r requirements.txt
python3 fetch_garmin.py          # (ou double-clic sur run-mac.command / run-windows.bat)
```

Alternative — export officiel ZIP : `python3 convert_garmin_export.py export.zip`

Le fichier `garmin-data.json` produit s'importe ensuite dans l'app.

---

## Technique (pour les curieux)

- App : HTML/CSS/JS **sans aucune dépendance** ni build ; graphiques en SVG maison.
- Données Garmin : via la librairie Python [`garminconnect`](https://pypi.org/project/garminconnect/)
  (non officielle), gère la double authentification et met en cache la session.
- Modèle de charge : CTL (42 j) / ATL (7 j) / TSB en EWMA, à partir de la charge
  d'entraînement Garmin, avec repli sur une estimation TRIMP si absente.
