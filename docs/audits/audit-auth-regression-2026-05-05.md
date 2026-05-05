# Audit Auth — Régression post-fix (2026-05-05)

Audit de régression post-application des fix Auth (commits `dd14254` + `4490c64` + `2d570c5`) sur le projet TerrOir. Lecture stricte du code commité + interrogation MCP Supabase de l'état réel en prod.

**Référence audit initial** : [audit-auth-2026-05-05.md](./audit-auth-2026-05-05.md)
**Référence récap fix** : [../fixes/fix-auth-2026-05-05.md](../fixes/fix-auth-2026-05-05.md)

**Périmètre vérifié** :
- 4 findings HIGH (H-1 à H-4) + 5 findings MEDIUM (M-1, M-2, M-4, M-5, et M-3 deferred) de l'audit initial.
- Détection de nouveaux findings introduits par les fix (régressions ou drifts).
- Vérification spécifique des introductions du chantier (helpers, triggers, layouts, cookies).

> **Posture** : antichronologique côté sévérité. Lecture seule en DB (execute_sql SELECT only). Aucun fichier modifié hors `docs/audits/`. Aucun commit.

---

## Résumé

| Sévérité | Avant fix | Après fix | Nouveaux |
|---|---:|---:|---:|
| **CRITICAL** | 0 | 0 | 0 |
| **HIGH** | 4 | 0 (4/4 FIXED) | 0 |
| **MEDIUM** | 5 | 0 fixés + 1 deferred (M-3) | 1 (N-1 drift repo) |
| **LOW** | 6 (backlog) | inchangé | 2 (N-2, N-3) |
| **INFO** | — | — | 2 (N-4, N-5 sanity) |

**Verdict global : 🟢 GREEN — avec 1 drift MEDIUM à corriger (LOT A migration locale manquante).**

---

## Section 1 — Statut de chaque finding initial

### HIGH

#### H-1. Purge RGPD — `product_stock_alerts.email` survit à `delete_user_account`

> **Citation initiale** : « La RPC `public.delete_user_account` hard-delete reviews écrites, anonymise orders, hard-delete products/slots, anonymise producers. Elle ne touche pas à `public.product_stock_alerts`. »

**Statut** : ✅ **FIXED**

**Preuve DB** (MCP `execute_sql` sur `pg_proc` 2026-05-05) :

```sql
-- Extrait de pg_get_functiondef(public.delete_user_account):
-- 4. Hard-delete product_stock_alerts (finding H-1, RGPD article 17).
--    FK consumer_id ON DELETE SET NULL → sans ce delete explicite,
--    email + confirm_token + unsubscribe_token survivraient au compte.
delete from public.product_stock_alerts where consumer_id = p_user_id;
```

- `proconfig = ['search_path=public, pg_temp']` ✓
- `prosecdef = true` (SECURITY DEFINER) ✓
- `proacl = postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres,supabase_auth_admin=X/postgres` (anon/public exclus) ✓
- L'instruction `delete from public.product_stock_alerts where consumer_id = p_user_id` est posée **avant** le commentaire de fin de fonction (étape 4, après l'anonymisation producers).

**Garantie runtime** : `delete_user_account` est `SECURITY DEFINER`, owner `postgres`. La table `product_stock_alerts` a `relrowsecurity=true`, `relforcerowsecurity=true`, `policy_count=0`. Le DELETE bypasse RLS car `pg_roles.rolbypassrls` est `true` pour `postgres` (vérifié MCP). Aucun risque de silent fail.

**FK** : `product_stock_alerts.consumer_id → auth.users(id) ON DELETE SET NULL` inchangée — l'ordre des opérations dans la RPC garantit la suppression en clair AVANT que la FK n'ait l'occasion de déclencher SET NULL via le `auth.users` deleteUser final.

---

#### H-2. Purge RGPD — `producer_interests` non couvert si l'utilisateur a aussi déposé un intérêt

> **Citation initiale** : « `public.producer_interests` (waitlist "devenir producteur") contient `nom, prenom, email, telephone, nom_exploitation, commune, especes, message`. Aucune FK vers `auth.users`. […] les données du formulaire intérêt restent indéfiniment. »

**Statut** : ✅ **FIXED**

**Preuve code** (`app/(consumer)/compte/profil/delete-account-action.ts:231-252`) :

```ts
// 7bis. Cleanup producer_interests (audit Auth H-2, RGPD article 17).
//       Si l'user avait déposé un intérêt waitlist avec le même email
//       avant de créer son compte, ces données survivraient sinon
//       (pas de FK vers auth.users). Fail-open : un échec ici ne doit
//       pas bloquer la suppression du compte.
try {
  const { count } = await admin
    .from("producer_interests")
    .delete({ count: "exact" })
    .ilike("email", session.email);
  if (count && count > 0) {
    console.warn("[delete-account] producer_interests cleanup", {
      user_id_masked: session.id.slice(0, 8) + "...",
      rows: count,
    });
  }
} catch (err) {
  console.error("[delete-account] producer_interests cleanup failed", { … });
}
```

**Vérifications** :
- L'étape 7bis est posée **AVANT** le `admin.auth.admin.deleteUser(session.id)` de l'étape 8 (ligne 255). ✓
- Utilise le client `admin` (`createSupabaseAdminClient()`, service_role BYPASSRLS=true). ✓
- Match `ilike` case-insensitive sur l'email de session. ✓
- Fail-open via try/catch — un échec ici ne bloque pas la suppression du compte (acceptable RGPD car le compte sera supprimé quand même, le résidu lead serait un effet de bord rare). ✓
- Loggue le count en cas de hit (forensique utile). ✓

---

#### H-3. PII résiduelle — `audit_logs.metadata.email` en clair pour 3 event_types

> **Citation initiale** : « sur les events `account_login_magic_link` (3 lignes), `password_reset_request` (2 lignes), et `login_failed` (instrumenté), `metadata` contient l'email **en clair**. […] L'event `account_deleted` utilise `email_masked: maskEmail(session.email)` — pattern explicite. Asymétrie. »

**Statut** : ✅ **FIXED** (pour les futurs events) — résidu historique noté en N-3 ci-dessous.

**Preuve code** (`app/connexion/actions.ts`) :
- ligne 111 — `login_failed` : `metadata: { email_masked: maskEmail(parsed.data.email), reason_code: classifyLoginError(...) }` ✓
- ligne 278 — `account_login_magic_link` : `metadata: { email_masked: maskEmail(email), isAdmin }` ✓
- ligne 384 — `password_reset_request` : `metadata: { email_masked: maskEmail(email) }` ✓

**Preuve DB** (MCP, agrégat sur `audit_logs.metadata` par event_type 2026-05-05) :

| event_type | rows w/ `email` plaintext | rows w/ `email_masked` | most_recent |
|---|---:|---:|---|
| `account_login_magic_link` | 3 | 0 | **2026-04-30 15:06** |
| `password_reset_request` | 2 | 0 | **2026-04-29 10:12** |
| `login_failed` | 0 | 0 | (jamais déclenché en prod) |
| `account_login_password` | 0 | 0 | 2026-05-05 12:52 |
| `email_change` | 0 | 0 (mais `new_email_masked`=2) | 2026-04-30 |

→ **Aucune nouvelle ligne plaintext post-fix.** Les 3+2 lignes plaintext résiduelles sont toutes datées d'AVANT le commit `dd14254` (2026-05-05). Pattern d'asymétrie corrigé pour les futurs events.

**Reste hors scope (LOT C arbitrage tranché)** :
- `app/api/admin/producers/invite/route.tsx:286` (notifications.metadata.email) — non modifié, convention `lib/rgpd/mask-email.ts:8` (notifications=transport email, plaintext OK).
- `app/(public)/desabonnement/request-new-link-action.tsx:56` — idem.

---

#### H-4. Défense en profondeur — layouts admin/producer/compte ne re-vérifient ni l'auth ni le hostname

> **Citation initiale** : « L'isolation host + auth repose à 100% sur `middleware.ts`. Les layouts de groupe sont vides côté sécurité. »

**Statut** : ✅ **FIXED**

**Preuve code** :

`app/(admin)/layout.tsx:18-24` :
```ts
const session = await getSessionUser();
if (!session?.isAdmin) redirect("/connexion");
const host = headers().get("host") ?? "";
if (!host.startsWith("admin.")) {
  redirect("https://admin.terroir-local.fr/tableau-de-bord");
}
```

`app/(producer)/layout.tsx:15-21` :
```ts
const session = await getSessionUser();
if (!session) redirect("/connexion");
const host = headers().get("host") ?? "";
if (!host.startsWith("pro.")) {
  redirect("https://pro.terroir-local.fr/dashboard");
}
```

`app/(consumer)/compte/layout.tsx:20-21` :
```ts
const session = await getSessionUser();
if (!session) redirect("/connexion");
// pas de check host (compte accessible www ET pro, cookies partagés)
```

**Vérifications** :
- Pas de boucle redirect en PROD : sur `admin.terroir-local.fr`, `host.startsWith("admin.")` → true → no redirect. ✓
- Tous les checks sont async + dédupliqués via `getSessionUser()` (React cache). ✓
- Pas de check role producer dans `(producer)/layout` — délégué au middleware §3b (cohérent avec récap fix). ✓
- Limitation de DX local dev (host=localhost:3000 sans subdomain) → flagué N-2 ci-dessous (pas une régression sécurité, dégradation DX).

---

### MEDIUM

#### M-1. Audit logging — events déclarés mais jamais émis en prod

> **Citation initiale** : « 7 event_types déclarés dans `AUTH_EVENT_TYPES` mais non observés en prod. »

**Statut** : ✅ **INVESTIGATION FERMÉE** (aucun fix nécessaire)

**Preuve** (récap fix LOT E, vérifié par grep des call sites) :
- `account_signup` instrumenté (`app/auth/callback/route.ts:149-160`)
- `account_deleted` instrumenté (`app/(consumer)/compte/profil/delete-account-action.ts:124-128`)
- `invitation_created`, `admin_invite_sent` instrumentés (`app/api/admin/producers/invite/route.tsx:233-241,307-314`)
- `invitation_consumed_success` instrumenté (`app/(producer)/invitation/_actions/complete-onboarding.ts:213-220`)
- `login_failed` instrumenté (`app/connexion/actions.ts:107-114`)
- `rate_limit_exceeded` instrumenté sur 5 sites

Verdict : 0 gap réel, l'absence en prod = code récent + flows inexpérimentés. Recommandation forward-looking inchangée (test invitation manuelle pour valider visuellement).

---

#### M-2. Cookies HMAC sans préfixe `__Secure-` / `__Host-`

> **Citation initiale** : « `redirect_after_auth`, `__terroir_role_snapshot`, `sb-admin-role-snapshot` sans préfixe. […] Defense-in-depth marginale. »

**Statut** : ✅ **FIXED** avec stratégie de transition double-lecture

**Preuve code** :

`lib/auth/redirect-cookie.ts:27-28` :
```ts
const COOKIE_NAME_LEGACY = "redirect_after_auth";
const COOKIE_NAME_NEW = "__Secure-redirect_after_auth";
```

`lib/auth/role-snapshot-cookie.ts:33-36` :
```ts
const COOKIE_NAME_DEFAULT_LEGACY = "__terroir_role_snapshot";
const COOKIE_NAME_ADMIN_LEGACY = "sb-admin-role-snapshot";
const COOKIE_NAME_DEFAULT_NEW = "__Secure-terroir_role_snapshot";
const COOKIE_NAME_ADMIN_NEW = "__Host-sb-admin-role-snapshot";
```

**Stratégie de transition vérifiée par lecture stricte** :

| Action | Comportement | Référence |
|---|---|---|
| Read | Tente le nouveau nom, fallback legacy | `readRedirectAfterAuth` (lib/auth/redirect-cookie.ts:86-94), `readRoleSnapshotFromRequest` (lib/auth/role-snapshot-cookie.ts:248-261) |
| Write | Nouveau nom uniquement | `setRedirectAfterAuth` (l.74-78), `setRoleSnapshotOnStore` (l.331-342) |
| Clear (logout) | Double-clear (nouveau ET legacy) | `clearRedirectAfterAuth` (l.102-113), `clearRoleSnapshotOnStore` (l.344-358) |
| Dev fallback | `cookieNameForHost` retourne le nom legacy si `!isProdHost` (HTTP localhost rejette `__Secure-`/`__Host-`) | `lib/auth/role-snapshot-cookie.ts:80-88` |

**Vérification des contraintes `__Host-`** (admin) :
- `path = "/"` ✓ (l.104)
- `secure = true` en prod ✓ (l.108)
- `domain` non posé en prod admin ✓ (`isProd && !isAdmin` ternaire l.103)

**Vérification des contraintes `__Secure-`** (default www/pro) :
- `secure = true` en prod ✓
- `domain = ".terroir-local.fr"` posé pour partage cross-subdomain www↔pro ✓

Aucun risque de session cassée pendant la fenêtre de transition (TTL max 1h redirect, 15min role snapshot).

---

#### M-3. Cache role snapshot — TTL 15min invalide tardivement les démotions admin

> **Citation initiale** : « Un admin que l'on retire de `admin_users` à T0 garde `isAdmin=true` côté middleware jusqu'à T0+15min. »

**Statut** : 📌 **DEFERRED** — décision documentée et acceptée

**Justification** (récap fix § Arbitrages tranchés) : « Pas de mécanisme cross-session permettant d'invalider le cookie HMAC d'un user **autre** que celui qui déclenche le changement (le cookie est isolé au browser cible). Réduire le TTL en dessous de 15 min serait du masquage d'un problème architectural sans gain réel. Démotion admin reste rare en pratique. »

Aucune action de fix attendue. À documenter formellement comme staleness max acceptée dans un futur runbook admin (hors scope).

---

#### M-4. `loadRoleSnapshot` fail-silent côté `connexion/layout.tsx`

> **Citation initiale** : « Si la lecture `users.roles` ou `admin_users` plante (RLS régression, DB down), l'utilisateur déjà connecté reverra le formulaire `/connexion` au lieu d'être redirigé. Aucun log. »

**Statut** : ✅ **FIXED**

**Preuve code** (`app/connexion/layout.tsx:42-60`) :
```ts
let user: User | null = null;
try {
  const supabase = createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  user = data.user;
  if (user) {
    const role = await loadRoleSnapshot(supabase, user.id);
    alreadyLoggedInPath = localPostLoginPath(role, host);
  }
} catch (err) {
  // Audit Auth 2026-05-05 M-4 : silent fail-open remplacé par log explicite
  console.error("[connexion/layout] role snapshot lookup failed", {
    user_id_masked: user?.id?.slice(0, 8) + "...",
    err: err instanceof Error ? err.message : String(err),
  });
}
```

- `user` hoisté hors du try (typed `User | null`) → accessible dans le catch pour le log masqué. ✓
- `console.error` au lieu de `/* fail-open */` silencieux. ✓
- user_id masqué (slice 8 chars) — pas de leak forensique. ✓
- Comportement runtime préservé (fail-open : l'user verra le form en cas d'erreur, mais l'incident est désormais loggé). ✓

---

#### M-5. Magic link rate-limit mutualisé avec login (cap 5/60s par IP)

> **Citation initiale** : « `app/connexion/actions.ts:201-204` réutilise `getLoginRateLimit()` pour `requestMagicLinkAction`. Un attaquant qui flood magic link sur une IP NAT consomme le quota login pour tous les users derrière cette IP. »

**Statut** : ✅ **FIXED**

**Preuve code** :

`lib/rate-limit.ts:119-131` (helpers separés) :
```ts
export function getLoginRateLimit(): Ratelimit | null {
  if (_loginLimiter === undefined) {
    _loginLimiter = createRateLimiter(5, "60 s", "login");
  }
  return _loginLimiter;
}

export function getMagicLinkRateLimit(): Ratelimit | null {
  if (_magicLinkLimiter === undefined) {
    _magicLinkLimiter = createRateLimiter(3, "120 s", "magic_link");
  }
  return _magicLinkLimiter;
}
```

`app/connexion/actions.ts` :
- ligne 80 — `loginAction` utilise `getLoginRateLimit()` ✓
- ligne 203 — `requestMagicLinkAction` utilise `getMagicLinkRateLimit()` ✓
- ligne 337 — `requestPasswordResetAction` utilise `getRecoveryRateLimit()` (déjà séparé pré-fix)

**Isolation Redis vérifiée** :
- `prefix: "ratelimit:login"` vs `prefix: "ratelimit:magic_link"` — clés séparées dans Redis (`createRateLimiter` lib/rate-limit.ts:67).
- Variables singleton séparées (`_loginLimiter` vs `_magicLinkLimiter`) — pas de re-création accidentelle.

Verdict : un attaquant qui flood magic link consomme désormais uniquement le quota magic_link (3/120s), n'impacte plus le quota login (5/60s) pour les users légitimes mdp derrière une IP NAT.

---

## Section 2 — Nouveaux findings (introduits par les fix ou découverts par l'audit régression)

### CRITICAL

_Aucun._

### HIGH

_Aucun._

### MEDIUM

#### N-1. Drift repo↔prod — LOT A non reconstitué dans `supabase/migrations/`

**Constat.** La migration `extend_delete_user_account_rgpd_product_stock_alerts` est appliquée en prod (version `20260505115937` dans `supabase_migrations.schema_migrations`, `created_by='lubin.rom@gmail.com'`) mais **aucun fichier local correspondant** n'existe dans `supabase/migrations/`.

Les 2 autres migrations apply via MCP ont été reconstituées (commit `2d570c5`) :
- ✅ `20260505200000_audit_rls_regression_new1_search_path_t241.sql` (LOT 0)
- ✅ `20260505200100_producer_interests_rate_limit_email.sql` (LOT B)
- ❌ **manquant** : `20260505200xxx_extend_delete_user_account_rgpd_product_stock_alerts.sql` (LOT A)

**Vérifié** : `git show --stat 2d570c5` → seulement 2 fichiers ajoutés.

**Impact.** Risque sur dev clean-state : `supabase db reset --linked` depuis le local rejouerait l'ancienne version de la RPC (sans `delete from public.product_stock_alerts where consumer_id = p_user_id`) — le fix H-1 serait perdu sur les environnements dev fraîchement reset. Aucun impact sur prod (déjà appliqué).

**Sévérité MEDIUM** : drift sur une migration security-relevant (RGPD article 17). Pas un bug runtime mais cohérence repo critique pour les futures setups dev / staging.

**Pistes.** Créer le fichier local `supabase/migrations/20260505200050_extend_delete_user_account_rgpd_product_stock_alerts.sql` (préfixe `200050` pour s'intercaler dans l'ordre temporel d'apply MCP : 115433 → 115937 → 120505) reproduisant exactement le `CREATE OR REPLACE FUNCTION` actuel (récupérable via `pg_get_functiondef` MCP). Ne pas re-apply (déjà en prod), ajouter un commentaire `-- NE PAS apply : déjà en prod sous version 20260505115937` aligné sur les 2 autres reconstitutions du commit `2d570c5`.

---

### LOW

#### N-2. Layouts (admin) et (producer) hard-redirectent vers la prod depuis localhost dev

**Constat** (`app/(admin)/layout.tsx:21-24`, `app/(producer)/layout.tsx:18-21`) :
```ts
const host = headers().get("host") ?? "";
if (!host.startsWith("admin.")) {
  redirect("https://admin.terroir-local.fr/tableau-de-bord");
}
```

Sur localhost:3000 (host littéral, sans préfixe `admin.`/`pro.`), un admin loggé qui visite une route `(admin)/*` est hard-redirigé vers `https://admin.terroir-local.fr/tableau-de-bord` (PROD). Idem pour `(producer)/*` → `https://pro.terroir-local.fr/dashboard`.

Le middleware ne déclenche pas car en local `hostname === "admin.terroir-local.fr"` est faux et `needsAuth` est faux pour les chemins (admin) hors `/compte`. Donc le layout est la première barrière — et il redirige hors-localhost.

**Pas de boucle** : le redirect est one-shot vers PROD, qui matche `startsWith("admin.")` et reste stable. Mais le dev local ne peut plus accéder aux routes admin sans setup `admin.localhost:3000` via `/etc/hosts` (ou `hosts` Windows).

**Impact.** Dégradation DX local + vercel preview deploys (host `*.vercel.app` ne matche pas). Aucun impact sécurité (en prod, le check protège exactement comme attendu).

**Sévérité LOW** : workaround possible (subdomain dev), pas une régression de sécurité.

**Pistes** :
- Documenter le workaround dans le README (ajouter `127.0.0.1 admin.localhost pro.localhost` au hosts file).
- OU env-aware : `if (process.env.VERCEL_ENV === "production" && !host.startsWith("admin."))` — mais perd la défense-in-depth en preview/staging.
- OU laisser tel quel (security-first, dev contraint).

---

#### N-3. Résidu PII pré-fix — 5 lignes `audit_logs` historiques avec `metadata.email` plaintext

**Constat** (MCP execute_sql 2026-05-05) :

| event_type | rows | most_recent | user_id |
|---|---:|---|---|
| `account_login_magic_link` | 3 | 2026-04-30 15:06 | NULL |
| `password_reset_request` | 2 | 2026-04-29 10:12 | NULL |

Toutes datées AVANT le commit `dd14254` (2026-05-05). Le fix LOT C protège les futurs events mais ne backfille pas l'existant. Les 5 lignes ont `user_id IS NULL` (les events magic_link/recovery sont émis avant verifyOtp donc sans user authentifié) — la FK `audit_logs.user_id ON DELETE SET NULL` ne s'applique pas, ces lignes survivent indéfiniment indépendamment du `delete_user_account` sur les comptes correspondants.

**Impact.** RGPD article 17 strict : un user dont l'email apparaît dans ces 5 lignes a perdu l'effet effaceur (compte supprimé n'efface pas ces logs). Volume très faible (5 lignes), datant de < 7 jours.

**Sévérité LOW** : pré-existant, hors scope du fix initial (LOT C scope = futurs events). À arbitrer côté Romain.

**Pistes** (READ-ONLY, à ne pas appliquer sans validation) :
```sql
-- Backfill : remplace metadata.email par metadata.email_masked
UPDATE public.audit_logs
SET metadata = (metadata - 'email')
             || jsonb_build_object('email_masked',
                  -- maskEmail JS port simplifié : us***@domain.tld
                  regexp_replace(metadata->>'email', '^(.{2}).*(@.*)$', '\1***\2')
                )
WHERE event_type IN ('account_login_magic_link', 'password_reset_request', 'login_failed')
  AND metadata ? 'email';
```
Effacerait le détail forensique (IP+timestamp suffisent pour brute-force detection sans email). Arbitrage Romain : conformité RGPD vs forensique anti-énumération.

---

### INFORMATIONAL / SANITY

#### N-4. ACL `delete_user_account` — `authenticated` granted (intentionnel)

**Constat MCP** : `proacl = postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres,supabase_auth_admin=X/postgres`.

**Vérification** :
- `anon` et `public` exclus (pas dans la liste). ✓
- Le guard interne `if auth.uid() is null or auth.uid() is distinct from p_user_id then raise…` empêche tout user authentifié de supprimer un autre user. ✓
- Cohérent avec le brief LOT A § Note arbitrage : « ACL `authenticated` préservée pour ne pas casser le runtime (le server action n'utilise pas le client admin pour cette RPC). »

Pas un finding — sanity check confirmant que l'ACL n'a pas dérivé.

---

#### N-5. Trigger `producer_interests` rate-limit — surface d'attaque réelle limitée mais non-zéro

**Constat.** Le trigger `trg_producer_interests_rate_limit` rejette tout 4e INSERT case-insensitive sur 24h. Vérifié actif (`pg_trigger.tgenabled='O'`, `tgtype=7` = BEFORE INSERT FOR EACH ROW).

**Effet pratique** :
- Helper `lib/producer-interests/upsert-interest.ts:51-53` normalise l'email à `lower(trim(email))` avant INSERT → le user passant par `POST /api/producer-interests` ne peut pas exploiter la variation de casse (toujours envoyé en lowercase).
- Donc le trigger protège uniquement contre les call sites qui INSERT sans passer par le helper normalisé. Audit grep : 1 site direct (`app/api/admin/producers/invite/route.tsx:367-378` insert `invitation_directe`) — admin-only, pas exploitable par un attaquant externe.

**Sanity** : la `UNIQUE(email)` (case-sensitive) bloque déjà le doublon exact-case. Le helper UPSERT bascule sur UPDATE en cas de 23505. Donc en pratique 1 seul row par email lowercase, le trigger est defense-in-depth contre :
1. Future relaxation de la contrainte UNIQUE (multi-leads par email).
2. Attaquant qui contournerait le helper et INSERT directement via service_role (n'existe pas dans le code applicatif actuel).

**Pas un finding** — le trigger fait son job, juste à noter que la protection effective dépend de la discipline de normalisation côté TS.

**Side-effect bénin** : si le trigger raise `23P01`, le helper `upsertProducerInterest` retombe sur la branche générique (ligne 92-98) qui retourne `{ok: false, error: ...}` puis l'API renvoie 500. Suboptimal UX (utilisateur voit "Erreur serveur" au lieu de "Trop de tentatives, réessayez plus tard") mais ne bloque rien d'autre. Hors scope régression.

---

## Section 3 — Vérification spécifique des introductions du fix

### LOT A SQL — `delete_user_account` étendu pour `product_stock_alerts`

✅ **Confirmé en prod.** `pg_get_functiondef` montre la ligne `delete from public.product_stock_alerts where consumer_id = p_user_id;` posée en étape 4 (après l'anonymisation producers, avant le commentaire de fin). Owner postgres avec BYPASSRLS=true → bypass `relforcerowsecurity=true` sur `product_stock_alerts`. Pas de silent fail.

### LOT A TS — `deleteAccountAction` purge `producer_interests` par email

✅ **Confirmé** (`delete-account-action.ts:231-252`). L'étape 7bis est positionnée correctement entre `signOut` (l.229) et `admin.auth.admin.deleteUser` (l.255). Service_role BYPASSRLS=true → DELETE fonctionne. Fail-open + log warn/error.

### LOT B — Trigger `trg_producer_interests_rate_limit`

✅ **Confirmé en prod.**
- Trigger `tgname='trg_producer_interests_rate_limit'`, `tgenabled='O'` (active), `tgtype=7` (BEFORE INSERT FOR EACH ROW).
- Function `check_producer_interests_rate_limit` SECURITY DEFINER, search_path verrouillé `'public', 'pg_temp'`, `proacl = postgres=X/postgres,service_role=X/postgres,supabase_auth_admin=X/postgres` (REVOKE EXECUTE FROM public/anon/authenticated — pattern projet conforme aux 7 autres trigger functions).
- Logique : `select count(*) … where lower(email) = lower(new.email) and created_at > now() - interval '24 hours'; if v_count >= 3 then raise … using errcode = '23P01'`.
- 4e INSERT case-insensitive sur 24h glissantes rejeté avec hint `producer_interests_rate_limit`. ✓
- Aucune ligne en prod actuellement en violation : `WHERE created_at > now()-interval '24h' GROUP BY lower(email) HAVING count(*) >= 3` retourne 0 rows. ✓

### LOT C — `email_masked` aux 3 sites `audit_logs`

✅ **Confirmé code** (3 sites `app/connexion/actions.ts:111,278,384`) + **confirmé DB** (0 nouvelle ligne plaintext post-fix). Pas de nouveau site plaintext introduit ailleurs (`grep "metadata:.*email[^_]" app/**/*.ts` → seulement les 2 sites notifications hors scope, intentionnels).

### LOT D — 3 layouts defense-in-depth

✅ **Confirmé** : `app/(admin)/layout.tsx`, `app/(producer)/layout.tsx`, `app/(consumer)/compte/layout.tsx` ont tous `getSessionUser()` + redirect approprié. Pas de redirect loop en PROD (host correspond), DX local dégradée flagué N-2.

### LOT F — Stratégie cookies `__Secure-` / `__Host-`

✅ **Confirmé code complet** :
- Read : nouveau nom puis fallback legacy (`readRoleSnapshotFromRequest:254-260`, `readRedirectAfterAuth:88-93`).
- Write : nouveau nom uniquement (`setRoleSnapshotOnStore:341`, `setRedirectAfterAuth:77`).
- Clear : double-clear nouveau + legacy (`clearRoleSnapshotOnStore:354-357`, `clearRedirectAfterAuth:109-112`).
- Dev fallback : `cookieNameForHost` retourne legacy si non-prod (HTTP rejette `__Secure-`/`__Host-`).
- `__Host-` requirements admin OK : `path=/`, `secure=true` en prod, `domain` non posé (`isProd && !isAdmin ? {domain} : {}` ternaire).

### LOT G — `connexion/layout.tsx` ne fail-silent plus

✅ **Confirmé** (`app/connexion/layout.tsx:52-60`). `console.error` avec user_id masqué (slice 8 chars) remplace le `/* fail-open */` silencieux. Variable `user` hoistée hors du try pour être accessible dans le catch.

### LOT H — `getMagicLinkRateLimit` isolé de `getLoginRateLimit`

✅ **Confirmé** (`lib/rate-limit.ts:119-131`). 2 helpers séparés avec memoization indépendante (`_loginLimiter` vs `_magicLinkLimiter`), prefixes Redis distincts (`ratelimit:login` vs `ratelimit:magic_link`), caps distincts (5/60s vs 3/120s). Aucune cross-utilisation possible. Recovery (`getRecoveryRateLimit`) déjà séparé pré-fix.

---

## Section 4 — Verdict global

### 🟢 GREEN

| Finding initial | Statut | Commit/preuve |
|---|---|---|
| H-1 product_stock_alerts purge | ✅ FIXED | RPC DB: `delete from public.product_stock_alerts...` + postgres BYPASSRLS |
| H-2 producer_interests purge | ✅ FIXED | `delete-account-action.ts:236-252` + service_role BYPASSRLS |
| H-3 email_masked audit_logs | ✅ FIXED | `actions.ts:111,278,384` + 0 nouvelle ligne plaintext |
| H-4 layouts defense-in-depth | ✅ FIXED | 3 layouts avec getSessionUser+host check |
| M-1 audit logging instrumentation | ✅ INVESTIGATION FERMÉE | 7/7 events instrumentés |
| M-2 cookies prefixes | ✅ FIXED transition | `__Secure-`/`__Host-` + double-lecture |
| M-3 TTL role snapshot | 📌 DEFERRED | Cross-session impossible (documenté) |
| M-4 fail-silent connexion/layout | ✅ FIXED | `console.error` masqué remplace silent catch |
| M-5 magic_link rate-limit isolation | ✅ FIXED | `getMagicLinkRateLimit` séparé |

### Action recommandée — N-1 (drift LOT A repo↔prod)

**MEDIUM, non bloquant pour la prod actuelle** mais à corriger pour préserver la cohérence repo. Procédure proposée (à valider Romain) :

1. Récupérer le SQL exact de la RPC actuelle :
   ```sql
   SELECT pg_get_functiondef('public.delete_user_account(uuid)'::regprocedure);
   ```
2. Créer `supabase/migrations/20260505200050_extend_delete_user_account_rgpd_product_stock_alerts.sql` avec en-tête identique aux 2 autres reconstitutions (cf. `20260505200100_producer_interests_rate_limit_email.sql`).
3. Commit dans la même esthétique que `2d570c5` :
   > `audit: reconstitute LOT A migration (extend_delete_user_account product_stock_alerts)`
4. Ne pas apply — déjà en prod sous version `20260505115937`.

Aucune autre action correctrice attendue. Les 2 LOW (N-2, N-3) sont à arbitrer Romain selon priorités DX et conformité RGPD historique.

### Prochaine étape suggérée

Continuer le backlog LOW (L-1 à L-6 audit-auth-2026-05-05.md), ou enchaîner sur un autre périmètre audit (RPC, migrations, perf, edge functions). Aucune ouverture nouvelle ne ressort comme bloquante après ce passage régression.

---

_Audit régression effectué le 2026-05-05 — base de code post-commits `dd14254` + `4490c64` + `2d570c5`. État prod via MCP Supabase (read-only). Aucun fichier modifié hors `docs/audits/`. Aucun commit._
