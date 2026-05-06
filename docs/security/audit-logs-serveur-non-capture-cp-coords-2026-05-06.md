# Audit logs serveur — non-capture CP / coords consumer (T-249)

> **Cluster** : T-261 (RGPD pré-Live consolidé) / T-200 r1 (doctrine privacy).
> **Scope** : confirmer qu'aucun code postal ni coordonnée lat/lng saisi /
> calculé pour un consumer ne fuit côté serveur (Vercel function logs,
> `audit_logs` Supabase, Resend metadata, Stripe metadata, futurs Sentry /
> session-replay).
> **Méthode** : grep exhaustif des call sites de logging et d'envoi externe
> sur les patterns `latitude|longitude|\blat\b|\blng\b|code_postal|cp|
> postal_code|postalCode|adresse|address`, suivi d'une revue de chaque
> match pour qualifier la nature de la donnée (consumer vs producteur).
> **Date** : 2026-05-06.

---

## TL;DR

**Audit conforme T-200 r1.** Aucune fuite consumer-side identifiée.
- Aucun CP consumer dans `audit_logs` ni Resend metadata ni Stripe metadata.
- Aucune coord lat/lng consumer (issue géoloc ou résolue depuis CP) loggée
  côté serveur ni transmise à un service tiers.
- 2 lignes `console.error` dans le cache géocodage embarquent le CP saisi
  en cas d'erreur DB — qualifié **conforme** (CP français = donnée publique
  INSEE, doctrine T-200 r1 explicite). Détail § Findings B1.
- Adresses producteur (`producers.adresse`, `code_postal`, `commune`)
  manipulées dans 3 cron / route confirm — qualifié **hors scope T-249**
  (donnée publique fiche producteur, pas PII consumer).
- Aucun outil de session-replay / RUM tiers (Sentry, Datadog, LogRocket,
  FullStory, PostHog, Plausible, GA) installé à date — conforme T-274.

Conséquence : **T-249 peut être marqué ✅ dans la checklist pré-Live**, sous
réserve de la doctrine défensive ajoutée § Recommandations (R1) pour border
le findng B1 explicitement.

---

## Méthodologie

### Patterns grepés
- Identifiants directs : `latitude`, `longitude`, `\blat\b`, `\blng\b`.
- CP : `code_postal`, `postal_code`, `postalCode`, `\bcp\b` (avec
  désambiguïsation manuelle vs occurrences fortuites).
- Adresse : `adresse`, `address` (revue manuelle producer vs consumer).
- Logging : `console\.(log|warn|error|info|debug)`.
- Audit cluster : `logAuthEvent`, `logPaymentEvent`, `logAdminInviteEvent`,
  `logCategorisationEvent`, `logReviewEvent`, `logLegalEvent`,
  `logPickupEvent` (helpers consolidés `lib/audit-logs/`).
- Outils tiers : `Sentry`, `Datadog`, `LogRocket`, `FullStory`, `PostHog`,
  `Plausible`, `gtag`, `googletagmanager`.

### Périmètre
- `app/api/**/route.{ts,tsx}` — toutes les routes serveur.
- `app/**/actions.ts` — server actions (Next App Router).
- `lib/**/*.ts` — toutes les libs serveur (audit-logs, geo, resend, stripe,
  notifications, etc.).
- `middleware.ts` — interception edge runtime.
- `next.config.js` — headers + télémétrie build.

### Hors scope (couvert par autres tasks privacy)
- `sessionStorage` côté navigateur → T-253 + T-274.
- Wording RGPD in-situ → T-263 + T-272.
- Trackers analytics futurs (PostHog) → T-265.
- Re-identification croisement public → T-227.

---

## Findings

### A. Routes critiques widget distance — conformes

#### A1. `app/api/geocode/route.ts` (T-219)
- **CP entrant en GET querystring** `?cp=XXXXX` validé Zod regex `^\d{5}$`.
- **Aucun log applicatif du CP saisi** dans la route :
  - L'unique `console.warn` (ligne 61) ne logge que l'IP du rate-limit hit
    (`[GEOCODE_RATE_LIMIT] ip=...`), pas le CP.
  - Pas d'écriture `audit_logs`, pas d'INSERT `notifications`.
- **Coordonnées résolues** retournées au client uniquement, jamais
  persistées avec un identifiant user.

#### A2. `app/api/producers/search/route.ts` (T-236)
- **Lat/lng entrants** (querystring visiteur, position consumer) : pas
  loggés. L'unique `console.warn` (ligne 25) trace uniquement l'IP du
  rate-limit hit, pas les coords.
- **Lat/lng sortants** (résultats producteurs) systématiquement floutés via
  `roundCoord` (lignes 96-98). Cohérent T-217 / T-218-bis.
- Pas d'audit log applicatif (commentaire explicite ligne 17 : pattern
  T-200 r1 sur routes publiques anonymes).

### B. Cache serveur géocodage — borderline conforme

#### B1. `lib/geo/geocode-cache.ts:57` et `:99` — `console.error` logge le CP
- En cas d'erreur DB sur les RPC `bump_geocode_cache` /
  `upsert_geocode_cache`, le helper logge :
  ```
  [GEOCODE_CACHE_HIT_ERROR] cp=<CP> error=<message>
  [GEOCODE_CACHE_WRITE_ERROR] cp=<CP> error=<message>
  ```
- **Qualification** : conforme T-200 r1, qui qualifie explicitement le CP
  comme « donnée publique INSEE » (cf. CLAUDE.md § Doctrine privacy + cf.
  commentaire `lib/geo/geocode-cache.ts:18-22` qui formalise le raisonnement).
- **Risque résiduel** : ces logs Vercel ne sont pas joints à un user_id
  (pas de session côté `/api/geocode`), donc aucun lien CP → consumer
  identifiable n'est créable depuis ces lignes seules.
- **Borderline** parce que dans les vues Vercel Logs, l'IP source de la
  requête est joignable au CP via timestamp (corrélation triviale). Cf.
  recommandation R1 ci-dessous pour borner le risque.

### C. Audit logs Supabase — conformes

Grep exhaustif des 12 helpers `lib/audit-logs/*.ts` :
- `lib/audit-logs/log-auth-event.ts`
- `lib/audit-logs/log-payment-event.ts`
- `lib/audit-logs/log-admin-invite-event.ts`
- `lib/audit-logs/log-categorisation-event.ts`
- `lib/audit-logs/log-legal-event.ts`
- `lib/audit-logs/log-pickup-event.ts`
- `lib/audit-logs/log-review-event.ts`
- + 5 autres (export-filename, serialize-csv, stats, email-lookup, labels).

→ **Zéro occurrence** des patterns `latitude|longitude|\blat\b|\blng\b|
code_postal|postal_code|postalCode|adresse`.

La signature standard du metadata embed (vu sur tous les call sites) est
de l'ordre de `{ order_id, code_commande, producer_id, route, … }`.
Aucun champ géolocalisation ni CP n'apparaît jamais.

### D. Resend metadata — conformes

`lib/resend/send.ts` — fonction unique `sendTemplate({ metadata })` :
- Le `metadata` passé par l'appelant est concaténé dans la row
  `notifications` (DB) et dans les logs `[EMAIL_SEND_*]` côté Vercel.
- Grep des call sites (`sendTemplate(`) sur tout le repo : tous les
  `metadata` portent uniquement `{ order_id, code_commande, producer_id,
  invitation_id, … }`. Aucun champ CP / coords.
- L'email destinataire est toujours masqué via `maskEmail(to)` dans les
  logs `console.error/log` (cf. lignes 58, 77, 100, 123).

### E. Stripe metadata — conformes

`lib/stripe/handle-*.tsx` + `app/api/stripe/**/route.ts` :
- Les `metadata: { … }` Stripe (PaymentIntent / Charge / EFW / payout /
  dispute / account-deauthorized) embarquent uniquement des identifiants
  techniques (`application_id`, `stripe_account_id`, `producer_id`,
  `producer_match`, `order_id`, etc.).
- **Zéro occurrence** des patterns `latitude|longitude|\blat\b|\blng\b|
  code_postal|postal_code|postalCode` dans `lib/stripe/`.
- Cohérent T-228 (audit dédié Stripe metadata anti-fuite T-200, cf.
  checklist pré-Live).

### F. Adresses producteur (cron / confirm) — hors scope T-249

3 call sites manipulent `producers.adresse` + `producers.code_postal`
(donnée publique fiche producteur, pas PII consumer) :
- `app/api/cron/reminder-sms/route.ts:49,54,64`
- `app/api/cron/reminder-consumer/route.tsx:36,67,73,82-83`
- `app/api/orders/[id]/confirm/route.tsx:111,121,145-146`

Usage : composer un `googleMapsUrl(...)` pour l'email / SMS de rappel
retrait commande. La concat `adresse, code_postal, commune` reste en
mémoire serveur le temps du send + est embarquée dans le HTML email
producer (donnée publique destinée au consumer pour récupérer la commande).
**Aucun log Vercel** ne capture cette concat (pas de `console.*` adjacent).

→ Hors scope T-249 (qui cible le CP consumer + coords consumer issues
géoloc/widget distance).

### G. Outils tiers (session-replay / RUM / analytics) — conformes T-274

Grep `Sentry|Datadog|LogRocket|FullStory|PostHog|Plausible|gtag|
googletagmanager` sur tout le repo (hors `docs/` + `package-lock.json`) :
- **Aucune dépendance NPM installée** (pas de match dans `package.json`,
  pas de match dans `app/` ou `components/` ou `lib/`).
- Vercel Analytics (`va.vercel-scripts.com`) chargé via `<Analytics />`
  (Speed Insights + Web Vitals) — capture des **métriques agrégées
  techniques** (LCP, FID, CLS), aucune capture form / DOM / sessionStorage.
  Cohérent T-274.

### H. Middleware + next.config — conformes

- `middleware.ts` : ne touche jamais aux query strings `cp` ni aux body
  payloads. Manipule uniquement les cookies de session Supabase + role
  snapshot HMAC.
- `next.config.js` : pas de telemetry plugin tiers, pas de bundleur
  d'instrumentation. Le seul header CSP `Content-Security-Policy-Report-
  Only` n'a pas d'endpoint `report-uri` (= pas de POST de rapport
  exfiltrant l'URL visitée). Cf. T-264.

---

## Recommandations

### R1. Borner défensivement le findng B1 (cache géocodage)
**Priorité** : faible (audit conforme T-200 r1 actuel — recommandation de
defense in depth pour audit T-003 externe).

Remplacer dans `lib/geo/geocode-cache.ts:57` et `:99` les logs :
```
[GEOCODE_CACHE_HIT_ERROR] cp=<CP> error=<message>
[GEOCODE_CACHE_WRITE_ERROR] cp=<CP> error=<message>
```
par :
```
[GEOCODE_CACHE_HIT_ERROR] error=<message>
[GEOCODE_CACHE_WRITE_ERROR] error=<message>
```

Bénéfice : élimine la corrélation IP↔CP via timestamp dans Vercel Logs sans
perte signal opérationnel (l'erreur DB est typée + le contexte CP est
récupérable côté tracing applicatif si besoin).

Si conservation du CP jugée utile pour debug : préfixer du flag explicite
`cp_redacted=<masque>` (5 chiffres → `XXXXX`, ou les 2 premiers seulement
`72XXX` pour préserver la granularité département). Décision Romain.

→ **Non bloquant pré-Live**. À traiter post-Live ou pendant audit T-003.

### R2. Ajouter doctrine opposable « pas de log CP / coords consumer »
**Priorité** : moyenne (formalise une règle déjà respectée mais non
opposable).

Compléter `docs/conventions/` avec un doc dédié « doctrine logging
sensible » qui rend opposable :
- Pas de CP / coords consumer dans `console.*`.
- Pas de CP / coords consumer dans `metadata` audit_logs.
- Pas de CP / coords consumer dans `metadata` Stripe / Resend.

→ Voir aussi T-275 (garde-fou doctrinal autocomplétion CP futur) — mêmes
principes peuvent partager le même doc.

### R3. Articulation T-265 (trackers front)
**Priorité** : forte si décision PostHog confirmée pré-Live (cf. T-201 +
T-245 + T-246).

À l'introduction de PostHog :
- Helper centralisé `lib/analytics/track.ts` avec assertion runtime
  bloquant tout event embarquant `lat | lng | cp | latitude | longitude |
  code_postal | adresse | email | phone`.
- Throw en mode dev, swallow + console.error en prod (fail-safe).

Cf. décision archi déjà prise (mémo `project_event_tracking_archi.md`).

---

## Cross-références

- **CLAUDE.md** § Doctrine privacy (T-200 r1, T-218 + T-218-bis,
  doctrine anti-PII tracking).
- **docs/runbooks/checklist-pre-live-2026-05-06.md** § P0 RGPD pré-Live
  consolidé (T-261).
- **docs/security/audit-rpc-acl-hardening-t295-bis-2026-05-06.md** —
  durcissement ACL RPC `bump_geocode_cache` + `upsert_geocode_cache`
  (cluster T-227 cache poisoning).
- **docs/fixes/geocode-cache-2026-05-06.md** — implémentation T-219.
- **Tasks liées** :
  - T-253 : audit sessionStorage non-fuite tiers.
  - T-263 : revue wording in-situ.
  - T-265 : exclusion CP des trackers front.
  - T-275 : garde-fou doctrinal autocomplétion CP futur.
  - T-274 : vérification absence session-replay (déjà couverte § G).

---

## Conclusion

T-249 ✅ — la doctrine T-200 r1 est respectée sur l'ensemble des call
sites de logging et d'envoi externe inspectés. Le widget distance et le
cache géocodage `/api/geocode` ne fuitent ni le CP saisi par le consumer
ni les coordonnées résolues vers `audit_logs`, Resend, Stripe, Vercel
Analytics ou un outil tiers de session-replay (aucun installé).

Recommandation R1 (border le log B1) à acter avant ou pendant l'audit
T-003 externe.

---

## Note de clôture R1 — 2026-05-06

**Statut R1** : ✅ **résolu** (commit `5f03916`).

Le finding B1 (`lib/geo/geocode-cache.ts:57,99` — CP saisi présent dans
`console.error` en cas d'erreur DB) est corrigé : le CP a été retiré
des 2 messages d'erreur, seul le message d'erreur DB (`error.message`)
est conservé. Le commentaire ligne 117-118 de `geocode-cache.ts` a été
mis à jour en cohérence pour refléter la nouvelle absence du CP.

**Avant** :
```ts
console.error(`[GEOCODE_CACHE_HIT_ERROR] cp=${parsed.data} error=${error.message}`);
console.error(`[GEOCODE_CACHE_WRITE_ERROR] cp=${parsed.data} error=${error.message}`);
```

**Après** :
```ts
console.error(`[GEOCODE_CACHE_HIT_ERROR] error=${error.message}`);
console.error(`[GEOCODE_CACHE_WRITE_ERROR] error=${error.message}`);
```

**Impact tests** : 0 test impacté (grep `GEOCODE_CACHE_HIT_ERROR` /
`GEOCODE_CACHE_WRITE_ERROR` côté `tests/` → aucun match).

**Doctrine étendue** (à porter au backlog T-249-bis) : tout
`console.error` / `console.warn` / `console.log` dans `lib/geo/*` doit
exclure le CP et autres champs géoloc. Pattern à étendre par audit
transverse de tous les `console.*` dans `lib/*` pour chasser d'autres
leaks défensifs similaires (hors scope cette session).

→ **Findings § B1 désormais résolu**. La conformité T-200 r1 sur les
logs serveur est désormais sans nuance.
