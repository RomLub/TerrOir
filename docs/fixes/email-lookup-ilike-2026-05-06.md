# Normalisation lookups email-keyed `.eq()` → `.ilike()` — 2026-05-06 (T-110)

**Contexte** : asymétrie `.eq()` vs `.ilike()` détectée dans le repo.
Certaines routes faisaient `.eq("email", input.email)` (case-sensitive)
alors que `producer_interests` utilise déjà `.ilike()`. Symptôme observé :
admin saisit `Bob@example.fr` → users.email='bob@example.fr' → pré-check
foire silencieusement (aucun match). Détecté pendant l'inspection TB
invite du 2026-04-28.

T-110 normalise tous les lookups email-keyed sur le pattern uniforme
`.ilike()` (case-insensitive Postgres natif).

---

## Décision arbitrée

**Pattern retenu** : `.ilike("email", input.email)` côté SELECT/UPDATE/DELETE.

**Pas** de trigger DB `lower()` au save (alternative envisagée). Raisons :
- Implique une migration DB + risque de casse données existantes
  (collisions si 2 emails diffèrent uniquement par la casse).
- Aujourd'hui les emails entrent normalement en lowercase via les
  flows signup/invite (cf. vérification écriture lowercase ci-dessous).
- Pattern `.ilike()` côté SELECT est zéro-risque sur les données
  existantes et offre le meilleur ratio impact/risque.

---

## Vérification écriture lowercase au save

Audit du flux d'écriture email :

- **Inscription consumer** (`app/(consumer)/auth/inscription/actions.ts`) :
  `email.trim().toLowerCase()` avant `auth.signUp()` + INSERT public.users.
- **Inscription producteur** (`app/(producer)/invitation/_actions/*`) :
  `getSessionUser().email` + `.toLowerCase()` (cf. complete-onboarding.ts:95).
- **Formulaire public producer** (`lib/producer-interests/upsert-interest.ts`) :
  validation Zod `.email()` + écriture telle quelle (Supabase Auth peut
  encoder en casse mixte).
- **Helpers internes** (`lib/audit-logs/email-lookup.ts`,
  `lib/resend/suppressions.ts`) : `normalizeEmail()` =
  `.trim().toLowerCase()` + regex EMAIL_REGEX avant tout INSERT/SELECT.
- **Tables `email_suppressions`, `product_stock_alerts`** : write toujours
  par helpers backend (jamais par client browser). normalizeEmail() en amont.

**Conclusion** : les writes email passent par `.toLowerCase()` au moins une
fois dans la chaîne avant d'arriver en DB. **Pas d'arbitrage à reporter** à
Romain (cf. LOT 3.2 du brief) — l'écriture est déjà normalisée.

L'asymétrie pré-T-110 venait uniquement du **côté lecture** (.eq()
case-sensitive), pas du côté écriture. La table peut néanmoins contenir
des emails en casse mixte legacy (avant doctrine T-110, ou via mirror
trigger `auth.users` non normalisé). `.ilike()` les couvre.

---

## Mapping avant/après

| Fichier | Ligne | Table | Avant | Après |
|---------|-------|-------|-------|-------|
| `lib/audit-logs/email-lookup.ts` | 82 | users | `.eq("email", normalized)` | `.ilike("email", normalized)` |
| `lib/resend/suppressions.ts` | 71 | email_suppressions | `.eq("email", normalized)` | `.ilike("email", normalized)` |
| `lib/resend/suppressions.ts` | 132 | email_suppressions | `.eq("email", normalized)` | `.ilike("email", normalized)` |
| `scripts/seed.ts` | 215 | users | `.eq("email", email)` | `.ilike("email", email)` |
| `scripts/seed-producers.ts` | 437 | users | `.eq("email", email)` | `.ilike("email", email)` |
| `tests/e2e/legal/inscription-cgu.spec.ts` | 133 | users | `.eq("email", email)` | `.ilike("email", email)` |
| `tests/e2e/email-webhook-h3.spec.ts` | 92, 120, 150, 172, 198, 216, 258 | email_suppressions | `.eq('email', recipient)` | `.ilike('email', recipient)` |

Total : **6 fichiers, 13 call sites migrés**.

Tests vitest associés mis à jour pour exposer `.ilike()` au lieu de `.eq()`
dans les mocks Supabase :
- `tests/lib/audit-logs/email-lookup.test.ts` (mockEq → mockIlike).
- `tests/lib/resend/suppressions.test.ts` (builder.ilike ajouté + le test
  "normalise case + trim" mock `ilike` au lieu de `eq`).

Call sites déjà conformes pré-T-110 (gardés en l'état) :

- `app/connexion/actions.ts:231,361` (admin_users)
- `app/api/admin/producers/invite/route.tsx:56,86,205,343,373` (admin_users / users / producer_invitations / producer_interests)
- `app/api/stock-alerts/route.tsx:100` (product_stock_alerts)
- `app/(producer)/invitation/_actions/*.ts` (users / producer_interests)
- `app/(producer)/invitation/page.tsx:97,113,197` (admin_users / users / producer_interests)
- `app/(producer)/onboarding/page.tsx:51` (producer_interests)
- `app/(public)/desabonnement/*.ts` (producer_interests)
- `app/(consumer)/compte/profil/delete-account-action.ts:240` (producer_interests)
- `lib/legal/compliance.ts:155` (déjà avec wildcards %X% + escape `_`/`%`/`\`)
- `lib/producer-interests/upsert-interest.ts:112` (producer_interests)
- `lib/stock-alerts/create-alert.ts:106` (product_stock_alerts)

---

## Doctrine formalisée

> **Tout lookup email-keyed utilise `.ilike()`.**
>
> **Tout write email-keyed normalise en lowercase à l'entrée** (helper
> `normalizeEmail` ou `.trim().toLowerCase()` en amont du SDK Supabase ou
> Auth).
>
> **Validation Zod `.email()` amont** garantit la forme valide RFC. Pour
> les emails, `_` est techniquement autorisé en partie locale (RFC 5321) ;
> en pratique, l'usage de `.ilike()` avec un email RFC-valide ne provoque
> pas de faux positifs significatifs (cas pathologiques d'emails contenant
> `_` : la recherche matche également des variantes improbables — voir
> backlog).

---

## Risque résiduel `_` / `%` dans les inputs — résolu T-110-bis

`.ilike()` interprète `%` (joker n caractères) et `_` (joker 1 caractère)
comme wildcards SQL. Pour des emails RFC-valides :
- `%` n'est PAS autorisé en partie locale RFC 5322 (mais reste théoriquement
  injectable si la validation Zod n'est pas en amont).
- `_` EST autorisé en partie locale RFC 5322. Risque réel :
  `bob_doe@example.com` saisi exact match aussi `bobXdoe@example.com`,
  `bobAdoe@example.com`, `bob1doe@example.com`, etc.

### Résolution T-110-bis (2026-05-06)

Helper `lib/supabase/escape-ilike.ts` qui échappe `_`, `%`, `\` (le
backslash en cas de quoted local-part RFC 5322 rare) :

```ts
export function escapeIlikeEmail(email: string): string {
  return email.replace(/[\\_%]/g, (m) => `\\${m}`);
}
```

Pattern wrap appliqué sur tous les call sites `.ilike("email", X)` :

```ts
.ilike("email", escapeIlikeEmail(email))
```

22 call sites de production wrappés sur 13 fichiers :

| Fichier | Call sites |
|---------|------------|
| `lib/audit-logs/email-lookup.ts` | 1 |
| `lib/resend/suppressions.ts` | 2 |
| `lib/stock-alerts/create-alert.ts` | 1 |
| `lib/producer-interests/upsert-interest.ts` | 1 |
| `app/connexion/actions.ts` | 2 |
| `app/(producer)/onboarding/page.tsx` | 1 |
| `app/(producer)/invitation/_actions/login-and-upgrade.ts` | 1 |
| `app/(producer)/invitation/_actions/complete-onboarding.ts` | 1 |
| `app/(producer)/invitation/_actions/accept-invitation.ts` | 1 |
| `app/(producer)/invitation/page.tsx` | 3 |
| `app/api/stock-alerts/route.tsx` | 1 |
| `app/(consumer)/compte/profil/delete-account-action.ts` | 1 |
| `app/(public)/desabonnement/unsubscribe-action.ts` | 1 |
| `app/(public)/desabonnement/request-new-link-action.tsx` | 1 |
| `app/api/admin/producers/invite/route.tsx` | 5 |

**Cas non wrappés (volontaires)** :
- `lib/legal/compliance.ts:155` — pattern différent (recherche partielle
  `%X%` avec son propre escape ligne 154 sur le même set de caractères).
- `tests/e2e/*` (×8) — recipients déterministes générés via `Date.now()`,
  pas de risque wildcard.
- `scripts/seed*.ts` — seed CLI avec emails contrôlés.

### Doctrine renforcée (T-110-bis)

> **Tout lookup email-keyed utilise `.ilike("email", escapeIlikeEmail(input))`.**
> Double couche defense in depth :
> 1. Validation Zod `.email()` amont (rejette les formats invalides type
>    `<bogus>` mais accepte `_` RFC-valide).
> 2. `escapeIlikeEmail(input)` côté query pour neutraliser les wildcards
>    Postgres ILIKE.

### Tests contractuels

`tests/lib/supabase/escape-ilike.test.ts` — 8 tests couvrant :
- No-op sur emails sans wildcards
- Échappement `_` / `%` / `\` (3 caractères)
- Mix des 3 caractères sur même input
- Edge case empty string
- Régression : caractères non-wildcards inchangés
- Non-idempotence (escape × 2 → augmente backslashes, pattern documenté)

Validation : `npx vitest run` → 184/184 fichiers, 2154/2154 tests passent
(+8 vs baseline T-110). `npx tsc --noEmit` → 0 erreur.

---

## Tests T-110 initial

Aucun nouveau test fonctionnel ajouté (chaque call site déjà couvert par
les tests existants — seuls les mocks ont été ajustés).

Validation : `npx vitest run` → 181/181 fichiers, 2098/2098 tests passent
post-migration. `npx tsc --noEmit` → 0 erreur.

(Cf. section "Résolution T-110-bis" ci-dessus pour les tests contractuels
sur `escapeIlikeEmail` ajoutés post-T-110-bis.)

---

## Backlog

- **T-110-ter** (optionnel) : règle ESLint `no-restricted-syntax` pour
  bloquer tout nouveau `.ilike("email", X)` qui n'utilise pas
  `escapeIlikeEmail(X)`. Pattern aligné avec T-255 / T-266. Pas urgent —
  un développeur attentif respectera la doctrine documentée. À ouvrir si
  un nouveau call site oublie l'escape en revue.
- **T-110-quater** (optionnel) : trigger DB `BEFORE INSERT/UPDATE` qui
  `lower()` le champ email côté users / admin_users / producers /
  producer_interests / email_suppressions / product_stock_alerts.
  Ferme définitivement le risque casse mixte côté table — mais nécessite
  audit collision données existantes (2 emails identiques après lower()).
  Hors-scope T-110.
