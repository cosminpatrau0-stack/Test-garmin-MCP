# RunLab — config « 100% téléphone » (proxy Cloudflare, gratuit)

Objectif : brancher ta clé Garmin **une seule fois**, puis tout faire depuis
le téléphone (l'app RunLab se synchronise toute seule, sans ordinateur,
sans fichier à importer).

Pourquoi un proxy ? Le navigateur du téléphone ne peut pas appeler Garmin
directement (sécurité « CORS »), et on ne veut pas mettre ta clé dans l'app
(elle serait visible). Le proxy Cloudflare **garde ta clé** et parle à Garmin
à la place de l'app. C'est gratuit et ça t'appartient.

⏱️ ~10 minutes, tout depuis le navigateur du téléphone.

---

## 1. Crée ta clé Garmin Personal API (si pas déjà fait)
- Va sur **https://connect.garmin.com/app/settings/personalApiToken**
- Crée une clé (choisis une durée longue, ex. 1 an). **Copie-la** (affichée une seule fois).

## 2. Crée un compte Cloudflare gratuit
- Va sur **https://dash.cloudflare.com/sign-up**, crée un compte (email + mot de passe).

## 3. Crée un Worker
- Dans **Workers & Pages**, tape le bouton bleu **« Create application »**.
- Choisis **« Start with Hello World! »** (parfois « Create Worker »).
- Donne-lui un nom (ex. `runlab-garmin`) → **Deploy** (déploie l'exemple par défaut).

## 4. Colle le code du proxy
- Sur la page du Worker : **Edit code** (ou **Edit**).
- **Efface** tout le code présent, puis **colle** le contenu du fichier
  [`worker.js`](worker.js) (je te l'ai fourni).
- Clique **Deploy** (en haut à droite).

## 5. Ajoute ta clé et ton code secret
- Reviens sur le Worker → onglet **Settings** → **Variables and Secrets** (Variables et secrets).
- Ajoute **deux secrets** (type « Secret », pas « Text ») :
  | Nom | Valeur |
  |---|---|
  | `GARMIN_API_KEY` | ta clé Garmin Personal API (étape 1) |
  | `PROXY_SECRET` | un mot de passe que **tu inventes** (ex. `monCodeRunLab2026`) |
- **Enregistre / Deploy** après ajout.

## 6. Récupère l'adresse du Worker
- En haut de la page du Worker, copie son URL :
  `https://runlab-garmin.<ton-sous-domaine>.workers.dev`
- Teste-la dans le navigateur : tu dois voir `{"ok":true,"service":"runlab-garmin-proxy"}`.

## 7. Connecte RunLab
- Ouvre l'app RunLab sur ton téléphone → **📲 Connecter Garmin (API)**.
- **Adresse du proxy** : l'URL de l'étape 6.
- **Code secret** : le `PROXY_SECRET` de l'étape 5.
- Choisis l'historique → **⟳ Synchroniser maintenant**.

🎉 C'est fini ! Ensuite, un simple appui sur **⟳ Synchroniser** met tout à jour.
Ta clé ne quitte jamais le proxy.

---

### Sécurité
- Ne partage pas ton URL de Worker **avec** ton `PROXY_SECRET`.
- Tu peux changer ou révoquer la clé Garmin à tout moment (recrée-la à
  l'étape 1 et mets à jour `GARMIN_API_KEY` dans Cloudflare).

### En cas de souci
- `{"error":"forbidden"}` → le code secret de l'app ne correspond pas à `PROXY_SECRET`.
- `{"error":"GARMIN_API_KEY manquant…"}` → le secret n'a pas été ajouté/déployé.
- « Aucune activité reçue » → vérifie l'adresse, la clé, et que la clé n'a pas expiré.
- Un graphe vide / une valeur bizarre → dis-le moi : les noms de champs de
  l'API peuvent varier légèrement, j'ajuste en 2 minutes (l'app se met à jour toute seule).

Le plan gratuit Cloudflare (100 000 requêtes/jour) est **très largement**
suffisant pour un usage perso.
