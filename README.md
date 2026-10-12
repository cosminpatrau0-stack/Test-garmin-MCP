# 🏃 RunLab

**Ton tableau de bord running personnel, privé et gratuit, construit à partir de
tes données Garmin — avec un bilan prêt à coller dans Claude.**

Pas d'abonnement, pas de serveur, pas de compte. L'app tourne à 100 % dans ton
navigateur, et t'appartient entièrement.

👉 **Tu ne codes pas ? Suis le [GUIDE.md](GUIDE.md) pas à pas.**

---

## Ce que ça fait

- 📈 **Volume hebdomadaire**, tendance d'allure, temps total
- ❤️ **Zones de fréquence cardiaque** (réelles ou estimées)
- ⚡ **Charge & forme** (modèle type PMC : fitness vs fatigue)
- 🏅 **Records personnels** (5 km, 10 km, semi, marathon, D+…)
- 😴 **Récupération** (FC de repos, sommeil, stress)
- ✨ **Bilan pour Claude** en un clic, à coller dans une conversation

Tout est pensé **course à pied**.

## Comment c'est organisé

| Dossier / fichier | Rôle |
|---|---|
| `index.html`, `app.js`, `charts.js`, `styles.css` | L'app (PWA installable, hors-ligne) |
| `manifest.webmanifest`, `service-worker.js`, `icons/` | Rend l'app installable sur le téléphone |
| `sample-data.json` | Données de démo (bouton « Voir une démo ») |
| `fetcher/` | L'outil qui récupère tes données Garmin |
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

```bash
cd fetcher
python3 -m pip install -r requirements.txt
python3 fetch_garmin.py
```

(Ou double-clic sur `run-mac.command` / `run-windows.bat`.)

Le fichier `garmin-data.json` produit s'importe ensuite dans l'app.

---

## Technique (pour les curieux)

- App : HTML/CSS/JS **sans aucune dépendance** ni build ; graphiques en SVG maison.
- Données Garmin : via la librairie Python [`garminconnect`](https://pypi.org/project/garminconnect/)
  (non officielle), gère la double authentification et met en cache la session.
- Modèle de charge : CTL (42 j) / ATL (7 j) / TSB en EWMA, à partir de la charge
  d'entraînement Garmin, avec repli sur une estimation TRIMP si absente.
