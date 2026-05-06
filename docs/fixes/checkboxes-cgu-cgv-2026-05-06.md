# Checkboxes CGU (inscription) + CGV (checkout) — opposabilité juridique

**Date** : 2026-05-06
**Scope** : P0 légal (suite directe du chantier pages CGU/CGV/mentions légales).

## Résumé

Acceptation explicite des CGU à l'inscription et des CGV au checkout, avec persistance DB (timestamp + version). Permet de prouver juridiquement qu'un user/commande a bien validé une version donnée du contrat.

## Migration SQL (à appliquer manuellement)

Fichier : `supabase/migrations/20260506131551_add_legal_acceptance_columns.sql`

✅ **Appliquée le 2026-05-06 via MCP `apply_migration`** (pattern dual-GO METHODOLOGY respecté). Timestamp DB tracking `20260506131551`, fichier disque renommé pour matcher (gotcha METHODOLOGY § "Apply via CC + MCP Supabase").

```sql
ALTER TABLE public.users
  ADD COLUMN cgu_accepted_at TIMESTAMPTZ NULL,
  ADD COLUMN cgu_version VARCHAR(10) NULL;

ALTER TABLE public.orders
  ADD COLUMN cgv_accepted_at TIMESTAMPTZ NULL,
  ADD COLUMN cgv_version VARCHAR(10) NULL;
```

(plus 4 `COMMENT ON COLUMN` cf fichier complet)

**Fields nullables** : les 11 users + 19 orders existants en prod restent NULL (acceptation rétroactive automatique). Aucune migration de données nécessaire, aucun blocage UI.

Apply via MCP a généré le timestamp `20260506131551` côté tracking DB. Le fichier disque a été renommé de `20260506000000` → `20260506131551` pour matcher (cf METHODOLOGY § "Apply via CC + MCP Supabase"), évite qu'un futur `supabase db push` local tente de réappliquer une migration déjà trackée.

## Versions actuelles

`lib/legal/versions.ts` :

```ts
export const LEGAL_VERSIONS = {
  CGU: "1.0",
  CGV: "1.0",
} as const;
```

Toute modification substantielle des pages `/cgu` ou `/cgv` doit incrémenter ces versions :
- `1.x` : modifs mineures (typo, reformulation sans impact droits/obligations) → pas de réacceptation forcée.
- `2.x` : modifs majeures (changement de droits/obligations, nouveau traitement de données, modif conditions remboursement) → **prévoir un flow popup réacceptation** au prochain login pour les users dont `users.cgu_version < version courante`. Idem CGV au prochain checkout. Ce flow n'est pas implémenté en V1 (chantier dédié quand le besoin se présente).

## Fichiers créés / modifiés

### Créés

- `supabase/migrations/20260506131551_add_legal_acceptance_columns.sql`
- `lib/legal/versions.ts`
- `docs/fixes/checkboxes-cgu-cgv-2026-05-06.md` (ce fichier)

### Modifiés

| Fichier | Changement |
|---|---|
| `lib/auth/validators.ts` | `signupSchema` : champ `cgu_accepted` obligatoire (refine truthy) |
| `app/(consumer)/auth/inscription/actions.ts` | INSERT users : `cgu_accepted_at = NOW()`, `cgu_version = LEGAL_VERSIONS.CGU` |
| `app/(consumer)/auth/inscription/page.tsx` | Checkbox CGU + politique confidentialité (liens new tab), useState, submit désactivé tant que non cochée |
| `app/api/orders/create/route.ts` | Validation Zod `cgv_accepted: z.literal(true)` + UPDATE post-RPC pour `cgv_accepted_at` + `cgv_version` |
| `app/(consumer)/compte/checkout/page.tsx` | Checkbox CGV en haut section paiement, gate l'auto-init order/PI tant que non cochée, désactivée une fois cochée |
| `tests/app/(consumer)/auth/inscription/actions.test.ts` | +2 tests CGU (manquant, false), assertion CGU INSERT |
| `tests/app/api/orders/create/route.test.ts` | +2 tests B (cgv_accepted manquant/false), +4 tests H (UPDATE CGV), builder mock étendu .update()/.then() |

## Flow Stripe — vérification LOT 7

Le flow checkout TerrOir utilise **Payment Intent direct** (pas Stripe Checkout Session redirect) :
- `automatic_payment_methods.enabled: true` + `allow_redirects: 'never'`
- PaymentElement inline + `confirmPayment` côté client
- Pas de redirection Stripe hostée

Conséquence pour la CGV : la checkbox bloque l'init order/PI côté client AVANT la création de l'order DB. L'invariant "order créée avec `cgv_accepted_at` peuplé" est garanti par construction (le checkbox gate le useEffect qui appelle `/api/orders/create`).

Les paths "redirect-based" (SEPA, Bancontact, iDEAL, etc.) sont explicitement désactivés. Si un futur chantier active SEPA Direct Debit ou un autre PaymentMethod redirect, vérifier que la checkbox CGV reste positionnée AVANT la sortie de page TerrOir.

## Tests

`pnpm vitest run` → **1787 / 1787** passent (152 fichiers de tests).

Couverture nouvelle :

**Inscription CGU** (`tests/app/(consumer)/auth/inscription/actions.test.ts`) :
- Happy path : INSERT users a bien `cgu_accepted_at` (ISO string) + `cgu_version = "1.0"`.
- Négatif : `cgu_accepted` manquant → error Zod, aucun appel Supabase.
- Négatif : `cgu_accepted = "false"` → error Zod, aucun appel Supabase.

**Checkout CGV** (`tests/app/api/orders/create/route.test.ts`) :
- B3/B4 : `cgv_accepted` manquant ou false → 400, aucun I/O.
- H1 : UPDATE CGV échoue (RLS / lock) → 200, log `[ORDER_CGV_PERSIST_FAIL]`, flow non cassé.
- H2 : UPDATE CGV pose les bonnes valeurs (eq order_id + payload version + timestamp).
- H3 : RPC échoue → pas d'UPDATE CGV (early return).
- H4 : dedup hit → pas d'UPDATE CGV (court-circuit, la 1ère création a déjà persisté).

## Trade-offs et décisions autonomes

1. **Pas de Server Action dédié pour persister CGV — UPDATE post-RPC inline dans `/api/orders/create`**. Plus simple, le UPDATE est best-effort (warn log si fail mais ne casse pas le paiement). Trade-off accepté : si l'UPDATE échoue silencieusement, l'order existe sans trace de consentement → mitigé par log greppable + le check Zod `cgv_accepted: z.literal(true)` qui matérialise déjà le consentement côté request.

2. **Dedup hit (T-428 idempotence) ne re-persiste pas la CGV**. Décision YAGNI : edge case double-clic 5 min sur même slot/date, la 1ère création a déjà persisté. Si jamais l'utilisateur a un panier ouvert pendant le déploiement et que l'order pré-existante n'a pas la CGV, elle restera NULL — acceptable (acceptation rétroactive auto).

3. **Validator `z.union([z.boolean(), z.string()])` pour `cgu_accepted`** au lieu d'un union strict `z.literal("on") | z.literal("true") | z.boolean()`. Raison : permettre au `refine` custom de remonter le message d'erreur métier ("Vous devez accepter…") au lieu du générique "Invalid input" du union strict.

4. **Checkbox CGV gate l'auto-init au mount du checkout**, plutôt que de la placer juste avant le bouton "Payer". Conséquence UX : l'user voit la checkbox + un message "Pour finaliser votre commande, acceptez…" avant que l'order soit créée. Cocher déclenche l'init order/PI/PaymentElement. Cohérent avec l'invariant juridique "consentement avant création de l'engagement".

5. **Pas de tests E2E Playwright** ajoutés. Volumétrie quota Resend (~10-20 specs max). Tests vitest backend + assertions DB couvrent les paths critiques. Si Romain veut un E2E à terme, pattern à reproduire à partir de `tests/e2e/change-email.spec.ts`.

## Suites possibles (out of scope V1)

- Flow popup réacceptation au prochain login pour les users dont `cgu_version < version courante` (déclenché lors d'un bump 2.x).
- Vue admin "Liste des users sans CGU acceptée" pour migration progressive (cas où on voudrait forcer la mise à jour rétroactive).
- Stockage historique des acceptations (table `legal_acceptances` append-only) si besoin de tracer plusieurs versions par user. V1 garde le snapshot courant uniquement (1 timestamp + 1 version par user/order, écrasable lors d'une réacceptation).
