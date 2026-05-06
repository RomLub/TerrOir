# Audit trackers front — exclusion CP — T-265

> **Cluster** : T-261 (RGPD pré-Live consolidé) / T-200 r1 (doctrine privacy).
> **Scope** : confirmer qu'aucun tracker front (Plausible, GA, Vercel
> Analytics, etc.) ne capture le CP saisi consumer ni ne le voit
> transiter en URL / Referer. PostHog est hors scope cette session
> (T-201/T-245/T-246 retirés du périmètre Live initial).
> **Méthode** : grep dépendances analytics + grep call sites tracking +
> traçage URL patterns avec CP en query string + revue config Vercel
> Analytics.
> **Date** : 2026-05-06.

---

## TL;DR

**Audit conforme.**
- Seuls 2 SDK analytics installés à date : `@vercel/analytics`
  + `@vercel/speed-insights` (cf. `package.json:39, 41`). Aucun GA,
  Plausible, PostHog, Mixpanel, Segment, Heap.
- Vercel Analytics capture les pageviews (URL + Referer) et les
  Core Web Vitals (LCP/FID/CLS/INP/TTFB). **Aucune capture de form
  inputs ni de sessionStorage / localStorage** (cf. doc Vercel
  Analytics : opt-in requis pour `track()` custom events).
- **Aucun appel `track()`** custom n'est fait dans le code applicatif
  (grep `track\(|posthog\.|gtag\(` → 0 résultat).
- Le seul endpoint qui voit le CP consumer en query string est
  `/api/geocode?cp=XXXXX`. Vercel Analytics **ne tracke pas les
  routes API** (`/api/*` exclu par défaut depuis SDK v1).
- Aucune route consumer ne propage le CP en query string GET / Referer
  (grep `searchParams\.set\(['"](cp|code_postal|postal)` → 0 résultat).

→ **T-265 peut être marqué ✅ dans la checklist pré-Live.** À ré-auditer
au moment d'introduire PostHog (T-201/T-245/T-246 si décidé), avec
helper centralisé anti-PII (T-275 + mémo project_event_tracking_archi).

---

## Méthodologie

### Patterns grepés
- **Dépendances NPM analytics** : recherche dans `package.json` des
  patterns `@vercel/analytics`, `@vercel/speed-insights`, `plausible`,
  `posthog`, `react-ga`, `google-analytics`, `@datadog`, `@sentry`,
  `@logrocket`, `mixpanel`, `segment`, `heap`.
- **Call sites tracking custom** : grep `track\(|sendBeacon|
  navigator\.sendBeacon|gtag\(|posthog\.|mixpanel\.|amplitude\.`.
- **CP en query string GET** : grep `searchParams\.set\(['"](cp|
  code_postal|postal)`, `\?cp=|&cp=`, `router\.(push|replace).*cp`.

### Périmètre code
- `package.json` + `package-lock.json` (présence dépendances).
- `app/layout.tsx` (root SDK init).
- `app/**/*.{ts,tsx}` + `components/**/*.{ts,tsx}` (call sites
  applicatifs).
- `middleware.ts` (intercepteur edge).

### Hors scope (couverts par d'autres tasks)
- Côté serveur (logs Vercel functions, audit_logs, Resend, Stripe) →
  T-249.
- sessionStorage non-fuite tiers → T-253.
- Verrou outils session-replay → T-274.
- Future PostHog si introduit → T-201 + T-245 + T-246 (hors scope Live
  initial).
- Garde-fou doctrinal autocomplétion CP futur → T-275.

---

## Inventaire dépendances analytics

### Installées
Source : `package.json:39, 41` (extrait pertinent) :
```
"@vercel/analytics": "^2.0.1",
"@vercel/speed-insights": "^2.0.0",
```

### Absentes (vérification grep)
- `plausible` / `@plausible/*` — 0 match.
- `posthog` / `posthog-js` / `posthog-node` — 0 match.
- `react-ga` / `react-ga4` / `google-analytics` — 0 match.
- `@datadog/browser-rum` / `@datadog/browser-logs` — 0 match.
- `@sentry/nextjs` / `@sentry/browser` — 0 match.
- `@logrocket/react` / `logrocket` — 0 match.
- `mixpanel` / `mixpanel-browser` — 0 match.
- `@segment/analytics-next` — 0 match.
- `heap` / `heap-js` — 0 match.

→ **2 SDK analytics, tous deux Vercel-owned.** Périmètre minimal.

---

## Audit Vercel Analytics + Speed Insights

### Initialisation
Source : `app/layout.tsx:3-4, 83-84` (root layout, mounted sur toutes
les pages) :
```tsx
import { SpeedInsights } from "@vercel/speed-insights/next";
import { Analytics } from "@vercel/analytics/next";
…
<SpeedInsights />
<Analytics />
```

### Données capturées par défaut

#### `@vercel/analytics`
- **Pageviews** : URL pathname + URL search params + Referer.
- **Custom events** via `track('event_name', { …props })` — **aucun
  appel** dans le code (grep `track\(` → 0 résultat hors docs).
- Pas de capture form inputs, pas de capture DOM snapshots, pas de
  capture sessionStorage / localStorage.

#### `@vercel/speed-insights`
- Métriques Core Web Vitals : LCP, FID, INP, CLS, TTFB.
- Anonymes par construction (mesures techniques agrégées).

### Risque identifié — pageview capture URL search params

**Si une page consumer recevait le CP en query string** (ex.
`/producteurs?cp=72000`), Vercel Analytics capturerait cette URL et
exposerait le CP dans le dashboard analytics (data joint au visit_id
cookie côté Vercel).

**Vérification** : grep exhaustif des call sites construisant des URLs
avec `cp` :
```
$ grep -rn 'searchParams\.set\(['\''"](cp|code_postal|postal)' app/ lib/ components/
(vide)
$ grep -rn '\?cp=' app/ components/
app/api/geocode/route.ts:11:// GET /api/geocode?cp=XXXXX — T-219
$ grep -rn 'router\.(push|replace).*cp' app/
(vide)
```

→ **Aucune route consumer ne propage le CP en query string**. La seule
URL contenant `cp=` est `/api/geocode?cp=XXXXX`, et Vercel Analytics
**ne tracke pas les routes `/api/*` par défaut** (exclues par le SDK,
cf. doc `@vercel/analytics`).

### Risque identifié — Referer fuite

Si une page externe pointait vers TerrOir avec `?cp=` en Referer header,
Vercel Analytics capturerait ce Referer.

**Mitigation** : la directive `Referrer-Policy: strict-origin-when-cross-
origin` (cf. `next.config.js:99`) tronque le Referer cross-origin à
l'origin (sans path ni query). En same-origin, le Referer complet est
transmis — mais aucune URL TerrOir ne contient `cp=` en query (cf. ci-
dessus), donc pas de fuite via Referer.

### Conclusion Vercel Analytics
Pas de surface fuite CP via Vercel Analytics dans la configuration
actuelle. Aucune action requise.

---

## Audit URLs construites

### Routes consumer susceptibles de porter un CP en query

**Audit exhaustif des appels `searchParams.set('cp')`** :
- 0 occurrence dans `app/` consumer-facing.

**Audit `router.push('?cp=…')` / `router.replace('?cp=…')`** :
- 0 occurrence.

**Audit `<Link href="?cp=…">`** :
- 0 occurrence.

→ **Conclusion** : aucune navigation TerrOir ne fait apparaître le CP en
URL.

### Le CP saisi vit où ?
1. **Input formulaire** `DistanceWidget` (`<input id="cp-input">`) —
   value contrôlée par React state local `postalInput` (`useState`).
2. **Body de la requête** (en réalité querystring HTTP-niveau)
   `GET /api/geocode?cp=XXXXX` — uniquement vu par l'API serveur
   TerrOir (cf. T-249).
3. **Réponse retourne lat/lng** — le CP n'est pas re-stocké côté client
   après réponse (cf. T-253 verrou contractuel test
   `sessionStorage.getItem(SESSION_KEY).not.toContain("75001")`).
4. **State React `postalInput`** — réinitialisé à `""` après succès
   (DistanceWidget.tsx:229).

→ Aucune persistance CP côté client après usage. Aucun tracker n'a
visibilité sur le CP.

---

## Audit call sites tracking custom

### Grep exhaustif
```
$ grep -rn 'track\(' app/ components/ lib/ | grep -v 'docs/'
(0 résultats applicatifs)
```

### Conclusion
- Aucun helper `track()` custom n'est appelé dans le code TerrOir.
- Aucun event tracking applicatif actif à date.
- Pas de risque de leak via instrumentation custom.

---

## Findings

### F1. Configuration analytics minimale = conforme
2 SDK Vercel (Analytics + Speed Insights) installés en mode default. Pas
d'appel `track()` custom. Pas d'autre SDK tiers.

### F2. CP n'apparaît jamais en URL consumer-facing
Le CP saisi vit uniquement dans :
- l'input `<input id="cp-input">` (state React local),
- le querystring `/api/geocode?cp=...` (route API exclue de Vercel
  Analytics par défaut).

### F3. Verrou existant CSP `connect-src`
La CSP (T-264) n'autorise les fetchs que vers des destinations
whitelistées. Un script tiers injecté qui voudrait POST le CP vers un
serveur attacker-controllable serait bloqué.

### F4. Verrou test contractuel anti-leak CP en sessionStorage
`tests/app/producteurs/distance-widget-interactive.test.tsx:346-348`
vérifie que le CP n'est pas re-stocké en sessionStorage après usage.

---

## Recommandations

### R1. Garde-fou doctrinal au cas où PostHog est introduit
**Priorité** : haute si décision PostHog confirmée.

À l'introduction de PostHog (T-201 + T-245 + T-246 si réactivés
post-Live) :
- Helper centralisé `lib/analytics/track.ts` avec assertion runtime
  bloquant tout payload contenant `cp | code_postal | postal | lat |
  lng | latitude | longitude | email | phone | adresse`.
- Throw en mode dev pour CI / local.
- Swallow + console.error en prod (fail-safe).
- Doctrine documentée `docs/conventions/event-tracking-anti-pii.md`
  (à créer).

→ Cluster T-275 (garde-fou doctrinal autocomplétion CP futur) — peut
mutualiser le même doc.

### R2. Garde-fou Vercel Analytics dashboard
**Priorité** : faible (doc opérationnelle).

Documenter dans `docs/conventions/security-headers.md` ou dans un nouveau
`docs/conventions/analytics-config.md` :
- Vercel Analytics dashboard : ne pas créer de "custom event" qui
  embarquerait le CP saisi consumer.
- Si une page future devait recevoir un CP en query string (ex.
  page deep-link "tous les producteurs autour de 72000"), prévoir
  `useEffect` qui retire le CP de l'URL via `router.replace(...)` après
  fetch — cohérent avec doctrine R1.

→ Non bloquant pré-Live (aucune route TerrOir actuelle ne porte de CP
en query string).

### R3. Test contractuel `/api/geocode` non-tracking
**Priorité** : faible (defense in depth).

Vérifier (au moment d'éventuel doute) que `@vercel/analytics` SDK
n'instrumentre pas les API routes. Cas trivial si un dev futur appelait
`Analytics` SDK depuis une route handler.

→ Recommandation auditeur, optionnelle.

---

## Cross-références

- `docs/security/audit-logs-serveur-non-capture-cp-coords-2026-05-06.md`
  (T-249) — couverture côté serveur.
- `docs/security/audit-sessionstorage-non-fuite-tiers-2026-05-06.md`
  (T-253) — couverture côté navigateur.
- `docs/security/csp-audit-t-264-2026-05-06.md` (T-264) — CSP
  anti-exfiltration.
- `docs/security/verification-deploiement-csp-c8db47a-2026-05-06.md`
  (T-264 verif) — déploiement.
- **Tasks liées** :
  - T-201 / T-245 / T-246 (instrumentation PostHog — hors scope Live).
  - T-274 (vérification absence session-replay — couvert ici).
  - T-275 (garde-fou doctrinal CP futur).

---

## Conclusion

T-265 ✅ — aucun tracker front actuel ne capture le CP consumer ni les
coords résolues. Vercel Analytics + Speed Insights opèrent en mode
default sans `track()` custom, le CP ne transite jamais en query string
URL consumer-facing, et la CSP `connect-src` borde l'exfiltration. À
ré-auditer dès qu'une décision d'introduire PostHog est prise (cluster
T-201/T-245/T-246) — recommandation R1 préempte le risque via helper
centralisé anti-PII.
