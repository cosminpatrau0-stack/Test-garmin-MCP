# Guide RunLab — pas à pas (aucune compétence technique requise)

RunLab, c'est **ton** app running privée. Elle transforme tes données Garmin
en tableau de bord, et te prépare un bilan à coller dans Claude.

Rien de ce qui te concerne ne part sur Internet : l'app tourne entièrement
dans ton navigateur, et tes identifiants Garmin ne quittent jamais ton ordinateur.

Il y a **2 choses** :
1. **L'app RunLab** (le tableau de bord, sur ton téléphone/ordi).
2. **L'outil RunLab Fetcher** (un petit programme à lancer sur ton ordi pour
   récupérer tes données Garmin dans un fichier).

---

## 🏃 Étape 1 — Récupérer tes données Garmin (sur ordinateur)

> À faire sur un **ordinateur** (Mac ou Windows), pas sur le téléphone.

1. Installe **Python** si tu ne l'as pas : https://www.python.org/downloads/
   - Sur **Windows**, pendant l'installation, **coche la case « Add Python to PATH »**.

### Le plus simple sur Mac : le fichier tout-en-un

Utilise **`RunLab-Garmin.command`** (dossier `fetcher`). C'est un **seul fichier
autonome** : pose-le où tu veux (ex. le Bureau), il n'a besoin d'aucun fichier
voisin, et il crée `garmin-data.json` juste à côté de lui.

Comme macOS bloque les scripts téléchargés, lance-le **depuis le Terminal**
(une fois pour toutes) :
1. Ouvre **Terminal** (Cmd + Espace → `Terminal`).
2. Tape `chmod +x ` (avec un espace), **glisse le fichier** dans la fenêtre, **Entrée**.
3. **Glisse à nouveau le fichier** dans la fenêtre, **Entrée** → il démarre.

### Tu as fait l'export officiel Garmin ? (le gros ZIP)

Si tu as demandé *« Exporter vos données »* depuis ton compte Garmin et reçu un
gros fichier ZIP, pas besoin de l'outil ci-dessus : convertis-le directement.

```bash
cd fetcher
python3 convert_garmin_export.py  CHEMIN/DU/export-garmin.zip
```

(Astuce : tape `python3 convert_garmin_export.py ` puis **glisse le ZIP** dans
le Terminal, puis Entrée.) Ça crée `garmin-data.json` à côté du ZIP, prêt à
importer dans l'app.

### Méthode dossier (Mac ou Windows)

Garde tous les fichiers du dossier `fetcher` ensemble, puis :
   - **Mac** : double-clic sur `run-mac.command`
     (si Mac refuse : clic droit → *Ouvrir* → *Ouvrir*).
   - **Windows** : double-clic sur `run-windows.bat`.
   ⚠️ Ne déplace pas `run-mac.command` tout seul : il lui faut `fetch_garmin.py`
   et `requirements.txt` à côté. Le fichier tout-en-un ci-dessus évite ce piège.
4. Une fenêtre noire s'ouvre. La première fois, elle installe le nécessaire (1–2 min).
5. Entre ton **email Garmin**, ton **mot de passe** (il reste invisible à l'écran),
   et, si Garmin te le demande, le **code de vérification** reçu par mail/SMS.
6. C'est fini ! Un fichier **`garmin-data.json`** apparaît dans le dossier `fetcher`.

> Les fois suivantes, tu n'auras même plus à retaper ton mot de passe.
> Relance simplement l'outil quand tu veux mettre tes stats à jour.

---

## 📲 Étape 2 — Ouvrir l'app RunLab

Tu as deux façons de l'utiliser :

### Option A — En ligne (recommandé, installable sur le téléphone)
1. Mets l'app en ligne gratuitement avec **GitHub Pages** (voir `README.md`,
   section « Mettre l'app en ligne »). Tu obtiens une adresse du type
   `https://TON-NOM.github.io/test-garmin-mcp/`.
2. Ouvre cette adresse dans le navigateur de ton téléphone.
3. Pour l'installer comme une vraie app :
   - **iPhone (Safari)** : bouton *Partager* → *Sur l'écran d'accueil*.
   - **Android (Chrome)** : menu ⋮ → *Installer l'application* / *Ajouter à l'écran d'accueil*.

### Option B — En local (le plus simple pour tester tout de suite)
Double-clique sur `index.html` : l'app s'ouvre dans ton navigateur.
*(En local, l'installation sur l'écran d'accueil n'est pas possible — c'est pour ça
que l'option A est recommandée pour le téléphone.)*

---

## 📊 Étape 3 — Importer tes données

1. Dans l'app, clique sur **« Importer mes données »**.
2. Choisis le fichier **`garmin-data.json`** créé à l'étape 1.
3. Ton tableau de bord s'affiche : volume, allure, zones de FC, charge & forme,
   records, récupération, dernières sorties.

> Tu veux juste voir à quoi ça ressemble ? Clique sur **« Voir une démo »**
> (données fictives).

Pour **mettre à jour** plus tard : relance l'outil (étape 1) puis réimporte le
fichier via le bouton **↻ Mettre à jour**.

---

## ✨ Étape 4 — Analyser avec Claude

1. Clique sur le bouton **« ✨ Bilan pour Claude »** en bas de l'écran.
2. Clique sur **« 📋 Copier le bilan »**.
3. Ouvre **Claude** (app ou claude.ai) et **colle** le texte dans une conversation.
4. Claude analyse ta progression, ta charge, ta forme, et te propose un plan.

C'est gratuit : tu utilises le Claude que tu as déjà, sans clé API.

---

## ❓ Questions fréquentes

**Est-ce que mes données partent quelque part ?**
Non. L'outil parle directement à Garmin depuis ton ordi. L'app lit le fichier
localement dans ton navigateur. Ton bilan ne va dans Claude que si *toi* tu le colles.

**L'outil demande un code à chaque fois ?**
Non, seulement si Garmin l'exige (double authentification). La session est
ensuite mémorisée sur ton ordi.

**Ça marche sans connexion Internet ?**
Une fois l'app ouverte une première fois en ligne et installée, oui — le
tableau de bord fonctionne hors-ligne. Seule la récupération de nouvelles
données Garmin nécessite Internet.

**Sur Mac : « run-mac.command non ouvert » ou « privilèges d'accès » ?**
C'est normal quand on télécharge le projet en ZIP (macOS bloque les scripts
externes). Deux étapes :
1. *« Apple n'a pas pu confirmer… »* → clique **Terminé** (pas la corbeille !),
   puis menu  → **Réglages Système** → **Confidentialité et sécurité** →
   section **Sécurité** → **Ouvrir quand même**.
2. *« …n'a pas pu être exécuté car vous ne disposez pas des privilèges »* →
   ouvre **Terminal** (Cmd+Espace → `Terminal`), tape `chmod +x ` (avec un
   espace), **glisse le fichier `run-mac.command`** dans la fenêtre, puis
   **Entrée**. Ensuite le double-clic fonctionne.

> Astuce : tu peux aussi tout lancer depuis le Terminal, sans double-clic :
> `cd ` puis glisse le dossier `fetcher`, Entrée, puis
> `python3 -m pip install -r requirements.txt` et `python3 fetch_garmin.py`.

**Je ne vois pas certaines zones de FC ?**
Si une sortie n'a pas le détail des zones, RunLab les estime à partir de ta FC
moyenne et de ta FC max. Tu peux affiner en réglant ta FC max dans Garmin.
