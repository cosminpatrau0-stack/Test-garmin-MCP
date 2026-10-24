/* RunLab — proxy Garmin Personal API (Cloudflare Worker)
 *
 * Rôle : garder TA clé Garmin en sécurité (côté serveur), échanger la clé
 * contre un jeton 24 h, et transmettre les requêtes de l'app vers Garmin en
 * ajoutant les en-têtes CORS (sans quoi le navigateur du téléphone refuse).
 *
 * Variables à définir dans Cloudflare (Settings → Variables and Secrets) :
 *   GARMIN_API_KEY  (secret)  : ta clé Personal API Garmin.
 *   PROXY_SECRET    (secret)  : un mot de passe que tu inventes ; l'app devra
 *                               l'envoyer (champ « Code secret » dans RunLab).
 *                               Empêche n'importe qui d'utiliser ton proxy.
 *
 * L'app appelle :  https://<ton-worker>.workers.dev/garmin/<chemin-garmin>?...&s=<PROXY_SECRET>
 */

const BASE = "https://personal.connectapi.garmin.com";
const TOKEN_PATH = "/personalapitoken-service/personal-api/personal-api-key/token";

let cachedToken = null; // { token, exp }  (persiste tant que l'isolat reste chaud)

function jwtExp(jwt) {
  try {
    const payload = JSON.parse(atob(jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload.exp || 0;
  } catch (e) { return 0; }
}

async function getToken(env) {
  const now = Date.now() / 1000;
  if (cachedToken && cachedToken.exp > now + 120) return cachedToken.token;
  const r = await fetch(BASE + TOKEN_PATH, {
    method: "POST",
    headers: { "Accept": "*/*", "Authorization": "ApiKey " + env.GARMIN_API_KEY },
  });
  if (!r.ok) throw new Error("token HTTP " + r.status);
  const token = (await r.text()).trim();
  cachedToken = { token, exp: jwtExp(token) || now + 3600 };
  return token;
}

function withCors(resp) {
  const h = new Headers(resp.headers);
  h.set("Access-Control-Allow-Origin", "*");
  h.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  h.set("Access-Control-Allow-Headers", "*");
  h.set("Cache-Control", "no-store");
  return new Response(resp.body, { status: resp.status, headers: h });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return withCors(new Response(null, { status: 204 }));

    const url = new URL(request.url);

    // page d'accueil / test
    if (url.pathname === "/" || url.pathname === "") {
      return withCors(new Response(JSON.stringify({ ok: true, service: "runlab-garmin-proxy" }),
        { headers: { "Content-Type": "application/json" } }));
    }

    // contrôle du code secret
    if (env.PROXY_SECRET && url.searchParams.get("s") !== env.PROXY_SECRET) {
      return withCors(new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: { "Content-Type": "application/json" } }));
    }
    if (!env.GARMIN_API_KEY) {
      return withCors(new Response(JSON.stringify({ error: "GARMIN_API_KEY manquant côté Worker" }), { status: 500, headers: { "Content-Type": "application/json" } }));
    }

    // chemin Garmin : /garmin/<service>/...
    let path = url.pathname.replace(/^\/garmin/, "");
    if (!path.startsWith("/")) path = "/" + path;
    const target = new URL(BASE + path);
    url.searchParams.forEach((v, k) => { if (k !== "s") target.searchParams.set(k, v); });

    try {
      let token = await getToken(env);
      let r = await fetch(target.toString(), { headers: { "Accept": "application/json", "Authorization": "Bearer " + token } });
      if (r.status === 401) { cachedToken = null; token = await getToken(env); r = await fetch(target.toString(), { headers: { "Accept": "application/json", "Authorization": "Bearer " + token } }); }
      const body = await r.text();
      return withCors(new Response(body, { status: r.status, headers: { "Content-Type": "application/json" } }));
    } catch (e) {
      return withCors(new Response(JSON.stringify({ error: String(e && e.message || e) }), { status: 502, headers: { "Content-Type": "application/json" } }));
    }
  },
};
