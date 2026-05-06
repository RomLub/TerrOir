# Validation remise commande producer + boucle feedback avis

> **Date** : 2026-05-06
> **Branche** : master
> **Tickets** : aucun (chantier hors numérotation T-XXX selon directive)
> **Sessions** : 2 enchaînées sur terminal TC (1 prompt unique, 8 LOTs séquentiels)
> **Commits** : `4c8e2e1` → `8f1755e` (LOTs 1-5), `75123e4` (LOT 4 UI), `96c5ee4` (LOT 7 tests)

---

## Contexte — l'audit a corrigé le brief initial

### Brief théorique vs réalité

Le brief initial postulait un workflow 4 états (`pending → confirmed → ready → completed`) où le producer marquerait explicitement la commande "prête au retrait" avant que le consumer arrive. Pendant **LOT 0 (audit READ-ONLY obligatoire)**, l'audit complet du codebase a montré que :

1. La feature pickup **existait déjà à ~80%** :
   - Colonne `orders.code_commande` (TEXT UNIQUE, format `TRR-XXXXX` avec charset sans confusion `23456789ABCDEFGHJKLMNPQRSTUVWXYZ`) générée par trigger Postgres `orders_set_code_before_insert` → fonction `generate_order_code()`. Source : `supabase/migrations/20260419000000_initial_schema.sql:99-100, 256-282`.
   - Code exposé consumer : page détail `/compte/commandes/[id]` + email confirmation `order-confirmed-consumer` (gros code centré vert) + email rappel J-1 retrait.
   - Route `POST /api/orders/[id]/complete` existante, faisant validation code + transition vers `completed` + envoi email review-request J0.
   - Cron `/api/cron/review-followup` existant avec relances **J+2 et J+7** (pas J+4/J+9 du brief).
   - State machine déjà définie avec les 4 états `pending/confirmed/ready/completed` + 2 terminaux `cancelled/refunded`.

2. **Mais l'état `ready` était MORT en pratique** : aucune route applicative ne le set. La section "Validation du retrait" sur la page détail commande producer (`OrderDetailClient.tsx`, gate `status === 'ready'`) n'était donc **jamais atteignable**. Le bouton du producer n'avait pas de chemin pour apparaître.

### Décision : modèle 3 états réel

Romain a arbitré 5 questions au sortir du LOT 0. La plus structurante : **le modèle métier réel est `pending → confirmed → completed` (3 états)**. L'état `ready` est dormant (gardé en state machine pour ne pas casser d'éventuels enregistrements historiques, mais aucune route ne l'utilise).

Conséquence : la transition canonique du pickup devient `confirmed → completed` directement (pas de step intermédiaire `ready`).

---

## Décisions arbitrées par Romain (LOT 0 → 5 questions)

| # | Question | Décision |
|---|---|---|
| Q1 | Workflow réel ? | **3 états** `pending → confirmed → completed`. État `ready` dormant, pas de transition `confirmed → ready` à créer. Gate UI bascule de `'ready'` → `'confirmed'`. |
| Q2 | UX cible cumul ou remplacement ? | **Cumul** : chemin id-based existant (page détail commande, input bas de page) **conservé** + chemin code-based **nouveau** (saisie haut-de-liste `/producer/commandes`) pour mode "caisse rapide marché". |
| Q3 | Preview obligatoire ? | **Asymétrique** — Page détail = 1-clic conservé (la fiche sert de preview, contexte visible). Saisie haut-de-liste = modale preview obligatoire (le producer ne voit rien avant saisie). |
| Q4 | Échéances rappels avis ? | **J+2 / J+7 conservés** (cron existant). Calibration agressive volontaire pour capter la mémoire fraîche du retrait. LOT 6 = NO-OP (vérification + doc). |
| Q5 | Anti-info-leakage ? | **404 unifié** pour `code_unknown` + `wrong_producer` (un producer ne peut pas distinguer "code n'existe pas" vs "code chez autre producer"). Distinction préservée seulement en audit log interne. **409 explicite** pour `order_not_confirmed` (cas pending fréquent) avec `current_status` + `detail_url` pour CTA UI. |

---

## Architecture finale

### Pipeline de validation pickup (deux entrées, single source of truth)

```
                                 ┌──────────────────────────────────────┐
        Producer en marché       │ POST /api/producer/orders/           │
        saisit code haut-de-page │  validate-pickup { code: "TRR-..." } │
                                 │                  GET ?code=...       │
                                 │                  (preview)           │
                                 └─────────────┬────────────────────────┘
                                               │
                                               ▼ Auth + producerId lookup
                                               ▼ Rate-limit 10/min
                                               ▼ helper validatePickup
                                               │
        Producer sur fiche       ┌─────────────┴────────────────────────┐
        commande clique          │ POST /api/orders/[id]/complete       │
        "Valider le retrait"     │  { code_commande: "TRR-..." }        │
                                 └─────────────┬────────────────────────┘
                                               │
                                               ▼
                          Helper lib/orders/pickup-validation.ts
                          (Zod TRR-XXXXX + scope producer + UPDATE atomic
                          WHERE statut='confirmed' + race-safe re-fetch)
                                               │
                                               ▼
                          UPDATE orders SET statut='completed', completed_at=NOW()
                                               │
                                               ▼
                          Helper lib/orders/send-pickup-review-email.tsx
                          → sendTemplate review_request_j0
                                               │
                                               ▼
                          Helper lib/audit-logs/log-pickup-event.ts
                          → audit_logs.insert event_type=pickup_validated
                                  metadata.route='complete_id_based' OU
                                                'validate_pickup_code_based'
                                               │
                                               ▼
                          Cron /api/cron/review-followup (10h UTC daily)
                          J-2 et J-7 batches → relances J+2 et J+7
                          (skip si reviews.order_id existe = anti-spam)
```

### State machine (`lib/orders/stateMachine.ts`)

Transition ajoutée en LOT 1 :

```ts
const TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  pending: ["confirmed", "cancelled", "refunded"],
  confirmed: ["ready", "completed", "cancelled", "refunded"],  // +completed (LOT 1)
  ready: ["completed", "cancelled", "refunded"],               // legacy dormant
  completed: [],
  cancelled: [],
  refunded: [],
};
```

`ready → completed` conservée pour ne pas casser d'éventuels orders historiques en `ready`. `confirmed → completed` est la **transition canonique du modèle 3 états** (commit `4c8e2e1`).

### Helper code-based `lib/orders/pickup-validation.ts` (LOT 2)

Deux fonctions exposées avec DI propre (`SupabaseClient` en param) :

- **`previewPickup(admin, rawCode, producerId)`** — lecture seule. Retourne un `PickupOrderPreview` (consumer_name + items + total_amount + status + created_at).
- **`validatePickup(admin, rawCode, producerId)`** — transition atomique. UPDATE conditionné `WHERE statut='confirmed'` race-safe. Si 0 row affected, re-fetch pour caractériser le nouvel état (probablement `already_completed`).

Discriminated union `PickupValidationError` à 7 variants :
- `code_format_invalid` — Zod stop avant tout I/O
- `code_unknown` / `wrong_producer` — indistincts côté API (anti-info-leakage), distincts en audit interne
- `order_not_confirmed` (avec `current_status` pour message UI explicite)
- `order_already_completed` (avec `completed_at` préservé)
- `order_cancelled` / `order_refunded` (terminaux)

`import "server-only"` en tête (sécurité — pas d'import accidentel client-side).

### Routes

| Route | Méthode | Usage | Préview ? |
|---|---|---|---|
| `POST /api/orders/[id]/complete` | id-based | Page détail commande producer (1-clic, contexte visible) | Non — la fiche sert de preview |
| `GET /api/producer/orders/validate-pickup?code=X` | code-based | Modale preview avant validation (`PickupValidationCard`) | Oui — modale 2 étapes |
| `POST /api/producer/orders/validate-pickup` | code-based | Validation effective post-modale | — |

Les deux routes :
- Auth producer obligatoire via `getOwnedProducerId(admin, session.id)`.
- Rate-limit Upstash 10/min/producer via `getPickupValidationRateLimit()` (key=`producer:<producerId>`).
- Audit log cluster `pickup_*` via `logPickupEvent()`.
- Email J0 via `sendPickupReviewEmail()`.
- Best-effort sur l'envoi email (try/catch + `console.warn` — un échec Resend ne casse pas la transition DB déjà commitée).

### UI `PickupValidationCard` (LOT 4)

Composant client `app/(producer)/commandes/_components/PickupValidationCard.tsx` inséré entre `<header>` et tabs dans `ProducerCommandesClient.tsx`.

3 états visuels (discriminated union `View`) :

1. **Idle** — input mono uppercase auto + bouton "Vérifier" disabled si vide. Erreurs in-place via `<ErrorBanner>` (8 variants typés mappés depuis les réponses API).
2. **Preview** — modale `AdminModal` avec eyebrow "Aperçu commande" + titre "Confirmer la livraison" + nom client + items + total + date. Footer : "Annuler" (ghost) + "Confirmer la livraison" (success CTA terra).
3. **Success** — checkmark vert circulaire + "Commande remise à <Prénom>" + bouton "Valider une autre commande" qui reset.

Callback `onValidated(orderId)` mis à jour le statut local de la commande en `completed` sans recharger la page.

### Cluster audit log `pickup_*` (LOT 3)

Helper `lib/audit-logs/log-pickup-event.ts` avec 5 events :

| Event | Trigger |
|---|---|
| `pickup_preview_ok` | GET `?code=X` succès (route code-based) |
| `pickup_preview_invalid` | GET échec (raison interne en metadata) |
| `pickup_validated` | POST succès, transition effective (les 2 routes) |
| `pickup_attempt_invalid` | POST échec (raison interne en metadata) |
| `pickup_attempt_rate_limited` | 10/min/producer dépassé (les 2 routes) |

`metadata.route` discrimine les events des deux routes :
- `'complete_id_based'` — route `/api/orders/[id]/complete` (page détail)
- *(absent ou explicite côté code-based selon convention LOT 3)* — route `/api/producer/orders/validate-pickup`

`metadata.reason` distingue les sous-cas en interne :
- `wrong_producer` (producer scope strict, NE FUITE PAS côté API)
- `code_unknown`
- `code_mismatch` (route id-based : code saisi ne matche pas l'order_id)
- `order_not_confirmed:<status>` (ex: `order_not_confirmed:pending`)
- `order_already_completed`
- `code_format_invalid`

Le cluster est mappé vers la catégorie `order` côté `categorize-event-type.ts` (sous-flow d'une commande, pas de palette nouvelle nécessaire). Les libellés FR sont dans `lib/audit-logs/labels.ts` (5 entrées).

---

## Garde-fous (defense in depth)

### 1. Producer scope strict
- Lookup `getOwnedProducerId(admin, session.id)` avant tout I/O critique.
- Comparaison `order.producer_id !== producerId` après lookup orders → 403 (id-based) ou 404 générique (code-based, anti-info-leakage).

### 2. Anti-info-leakage 404 unifié
Surface API : `code_unknown` ET `wrong_producer` retournent **la même réponse** `{ error: "pickup_code_unknown" }`. Un producer A ne peut pas déduire qu'un code "exists but isn't mine" vs "doesn't exist at all".
Distinction préservée uniquement dans l'audit log interne (`metadata.reason='code_unknown'` vs `metadata.reason='wrong_producer'`) pour permettre la détection forensique d'un producer qui tenterait des codes d'un autre producer.

### 3. UPDATE atomique race-safe
`validatePickup` fait `UPDATE orders SET statut='completed' WHERE id=X AND statut='confirmed'`. La condition `statut='confirmed'` agit comme verrou optimiste : si un autre tab du même producer a déjà validé, le second UPDATE matche 0 rows. La route re-fetch alors l'état actuel pour caractériser correctement (probablement `already_completed`).

### 4. Rate-limit Upstash 10/min/producer
Key par `producer:<producerId>` (et non IP) car plusieurs producers peuvent partager un NAT en marché. Cap 10/min absorbe la cadence "queue de clients" sans bloquer le flow nominal. Au-delà = soit énumération de codes, soit double-clic réseau flaky. Audit log `pickup_attempt_rate_limited` posé sur le hit. Fail-open si Upstash absent (cohérent pattern lib/rate-limit.ts).

### 5. Email J0 best-effort
Un échec d'envoi Resend ne casse pas la transition pickup déjà commitée en DB. Try/catch + `console.warn` côté route POST validate-pickup. La page détail (route `/complete`) est plus simple : `await sendPickupReviewEmail(...)` sans try/catch (le helper interne swallow déjà via `sendTemplate`).

### 6. Format Zod strict
`pickupCodeSchema = z.string().trim().toUpperCase().regex(/^TRR-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{5}$/)`. Charset sans confusion (0/1/I/O exclus) cohérent avec le trigger Postgres `generate_order_code()`. Stop avant tout I/O Supabase si le format n'est pas respecté.

---

## Échéances rappels avis (J+2 / J+7)

| Étape | Trigger | Source code | Sujet email |
|---|---|---|---|
| **J0** | Post-validation immédiate | Helper `sendPickupReviewEmail` appelé par les 2 routes pickup | "Laissez un avis sur ${exploitation}" |
| **J+2** | Cron `0 10 * * *` UTC daily | `app/api/cron/review-followup/route.tsx`, `sendBatch(2)` | "Votre avis compte — ${exploitation}" |
| **J+7** | Cron même | `sendBatch(7)` | "Dernière invitation : partagez votre avis sur ${exploitation}" |

Au-delà : silence total, pas de spam supplémentaire.

**Anti-spam guard absolu** : pour chaque order candidat, le cron fait `SELECT reviews WHERE order_id = X` JUSTE avant l'envoi. Si une review existe (même posée 1h avant l'envoi), `continue` (skip). Race window minime entre check et send acceptable (au pire 1 email entre check et send).

**Calibration J+2/J+7 (rationale Q4)** : agressivité volontaire pour capter la mémoire fraîche du retrait. La courbe de mémoire d'une expérience consumer décline rapidement après J+5/J+7 ; espacer J+4/J+9 (proposition initiale brief) aurait raté la fenêtre optimale.

---

## Tests

| Fichier | Cas | Couverture |
|---|---|---|
| `tests/lib/orders/stateMachine.test.ts` | matrice 36 + asserts | Ajout transition `confirmed → completed` + tests reflétant LEGAL étendu (LOT 1) |
| `tests/app/(producer)/commandes/[id]/OrderDetailClient.test.tsx` | 5 | Gate UI rendu conditionnel (idle/confirmed/ready/completed/cancelled), pattern SSR `renderToStaticMarkup` (LOT 1) |
| `tests/lib/orders/pickup-validation.test.ts` | 35 | Helper code-based : Zod schema (13 cas), `previewPickup` (12 cas), `validatePickup` (10 cas) — nominal + 7 erreurs typées + race + format invalide (LOT 2) |
| `tests/app/api/producer/orders/validate-pickup/route.test.ts` | 23 | Route code-based : auth (3) + rate-limit (3) + GET preview (9) + POST validate (8). Mock helpers pickup-validation pour découpler des internals (LOT 3) |
| `tests/lib/audit-logs/log-pickup-event.test.ts` | 7 | Helper audit log : insert contract + fail-safe + exhaustivité 5 events (LOT 3) |
| `tests/app/(producer)/commandes/_components/PickupValidationCard.test.tsx` | 10 | UI client jsdom : rendu initial (2) + flow nominal (4) + erreurs (4). Pattern `createRoot+act` aligné `distance-widget.test.tsx` (LOT 4) |
| `tests/app/api/orders/[id]/complete/route.test.ts` | 29 | Route id-based : tests existants + section J nouvelle (audit pickup_validated complet, idempotent audit, transition fail audit, code_mismatch audit, rate-limit hit + Retry-After + audit, keying producer:<id>) (LOT 5) |
| `tests/app/api/producer/orders/validate-pickup/integration.test.ts` | 7 | Intégration e2e : composition route + helper validatePickup + audit log + email helper en réel (uniquement DB + auth + rate-limit + Resend mockés). Flow nominal + 5 edge cases + 1 race condition (LOT 7) |
| `tests/app/api/cron/review-followup/route.test.tsx` | 13 | Cron : auth (3) + fenêtre J-2/J-7 (4) + anti-spam (3) + robustesse missing data (3). Comble la lacune trou 2 LOT 6 (LOT 7) |

**Cumul chantier : 132 nouveaux tests**.

Suite complète au sortir du LOT 7 : **2247/2247 verts** (192 fichiers).

---

## Backlog identifié en cours de chantier

| Item | Source LOT | Priorité | Détails |
|---|---|---|---|
| Nettoyage / réaffectation état `ready` state machine | LOT 1 | Faible | Mort dans modèle 3 états réel. À figer en sens futur (ex. "préparation en cours" si feature future) ou à retirer (avec migration de tout enregistrement historique). |
| Marqueur DB déduplication cron review-followup | LOT 6 | Faible | Si Vercel re-déclenche le cron (timeout retry, exécution manuelle), un consumer peut recevoir le même email J+2 deux fois dans la même journée. Probabilité faible, impact = 1 email doublon. Acceptable pré-Live selon arbitrage Q4. À traiter si des plaintes consumer remontent. |
| Audit log cluster `review_followup_*` | LOT 6 | Moyenne | Pas d'audit log applicatif sur les sends cron — uniquement compteur HTTP. Pour une trace forensique exhaustive ("pourquoi Marie a reçu 2 relances ?"), ajouter un cluster dédié ou étendre `pickup_*` avec un event `pickup_followup_sent`. Substantiel mais pas bloquant — le webhook Resend (`email_*` cluster partiellement instrumenté) fournit déjà une trace partielle. |
| Warning console SSR `styled-jsx` non-boolean attribute | LOT 1 | Cosmétique | `<style jsx>{...}</style>` sur composants client testés via `renderToStaticMarkup` produit un warning React (pas de transformer styled-jsx en pure SSR vitest). Non bloquant mais bruite la sortie test. À mentionner si le pattern devient récurrent. |
| Pattern N+1 cron review-followup (perf) | LOT 6 | Moyenne | Le cron fait `SELECT reviews + SELECT users + SELECT producers` par order, en boucle. À volumes prod actuels (faibles), pas un goulot. Refactor possible vers un SELECT enrichi avec embeds PostgREST (cf. pattern `reminder-consumer` post audit C-3). À refaire si le compte de pickups quotidiens dépasse ~50. |

---

## Récap commits par LOT

| LOT | SHA | Sujet |
|---|---|---|
| LOT 1 | `4c8e2e1` | `fix(orders): gate validation pickup sur confirmed (modèle 3 états réel)` |
| LOT 2 | `203fdb1` | `feat(orders): helper code-based pickup-validation (preview + validate atomique)` |
| LOT 3 | `7e63902` | `feat(orders): route /api/producer/orders/validate-pickup code-based + audit cluster pickup_*` |
| LOT 4 | `75123e4` | `feat(producer): UI section "Valider rapidement" haut de page commandes (PickupValidationCard)` |
| LOT 5 | `8f1755e` | `feat(orders): rétrofit /api/orders/[id]/complete avec audit log pickup_* + rate-limit (LOT 5)` |
| LOT 6 | NO-OP | Audit lecture seule, pas de commit (cron review-followup validé sain) |
| LOT 7 | `96c5ee4` | `test(orders): tests intégration e2e pickup + cron review-followup (LOT 7)` |
| LOT 8 | (ce commit) | `docs(orders): doc finale chantier pickup-validation + vitest mocking patterns + CHANGELOG` |

Aucune migration DB livrée pendant le chantier (le code commande `TRR-XXXXX` existait déjà via trigger Postgres T-* précédent).

---

## Cross-références

- Conventions vitest mocking : [`docs/conventions/vitest-mocking-patterns.md`](../conventions/vitest-mocking-patterns.md) (formalise les 3 leçons LOTs 3/4 + 2 patterns bonus)
- Convention rate-limit : [`docs/conventions/rate-limiting.md`](../conventions/rate-limiting.md) (table mise à jour avec helper `getPickupValidationRateLimit`)
- State machine commandes : `lib/orders/stateMachine.ts` (JSDoc explicite le modèle 3 états réel)
- Workflow audit log : helpers `lib/audit-logs/log-*-event.ts` (cluster pickup ajouté symétriquement aux clusters auth/payment/review/legal/categorisation existants)
