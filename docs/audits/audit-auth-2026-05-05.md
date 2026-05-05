# Audit Auth — TerrOir (2026-05-05)

Audit du flux d'authentification sur les 3 sous-domaines (www / pro / admin) après la bascule magic link / reset password vers le flow OTP `token_hash` + `verifyOtp` (sortie du PKCE cassé). Observation prod via MCP Supabase + lecture du code.

Périmètre couvert : magic link, password reset, signup confirm, change email, change password, account deletion, logout, isolation cookies cross-subdomain, audit logging, RGPD purge.

> **Rappel posture** : ce document est antichronologique côté sévérité (CRITICAL en haut → LOW en bas). Aucune correction proposée ici n'a été appliquée.

---

## Résumé

| Sévérité | Findings |
|---|---:|
| **CRITICAL** | 0 |
| **HIGH** | 4 |
| **MEDIUM** | 5 |
| **LOW** | 6 |

État global : flux auth **sain** côté primitives Supabase (token_hash + verifyOtp partout, getUser exclusif côté serveur, cookies isolés admin / partagés www-pro, rate-limit applicatif, enumeration-resistance). Les findings restants concernent surtout :
1. la **purge RGPD incomplète** (résidus PII dans des tables non couvertes par la RPC `delete_user_account`),
2. une **défense en profondeur manquante** sur les layouts admin/producer (tout repose sur le middleware),
3. de l'**asymétrie d'audit logging** (email plaintext vs masqué selon les events).

---

## CRITICAL

_Aucun._

Le flow OTP token_hash + verifyOtp est en place sur toutes les routes auth (`/auth/callback`, `/reinitialiser-mot-de-passe`). Aucune occurrence de `exchangeCodeForSession` (PKCE) dans `app/**` ou `lib/**`. `getSession()` côté serveur n'apparaît que dans le client browser (`components/providers/user-provider.tsx`) — tous les points d'entrée serveur (middleware, server actions, route handlers, layouts) passent par `getUser()` directement ou via le helper `getSessionUser()` (`lib/auth/session.ts:16`).

---

## HIGH

### H-1. Purge RGPD incomplète — `product_stock_alerts.email` survit à `delete_user_account`

**Constat.** La RPC `public.delete_user_account` (`supabase/migrations/20260422200000_rgpd_account_deletion.sql:69-152`) hard-delete reviews écrites, anonymise orders, hard-delete products/slots, anonymise producers. Elle ne touche pas à `public.product_stock_alerts`.

La FK `product_stock_alerts.consumer_id → auth.users(id)` est `ON DELETE SET NULL` — donc lors du `admin.auth.admin.deleteUser(session.id)` final, `consumer_id` est nullifié mais **les colonnes `email`, `confirm_token`, `unsubscribe_token` restent en clair**. L'utilisateur a juridiquement supprimé son compte, son adresse email reste exploitable côté DB (et côté CRON de notification stock).

**Schema confirmé en prod (MCP) :**
```
product_stock_alerts(id, product_id, email, consumer_id, ..., confirm_token, unsubscribe_token)
FK consumer_id → auth.users(id) ON DELETE SET NULL
```

**Impact.** Non-conformité RGPD article 17 (droit à l'effacement). Surface : faible si peu d'alertes par compte, mais mécaniquement présente.

**Pistes.** Étendre `delete_user_account` pour `delete from public.product_stock_alerts where consumer_id = p_user_id` AVANT que la FK ne soit nullifiée par CASCADE. Ou changer la FK en `ON DELETE CASCADE` (mais alors les alertes anonymes par email sans compte sont préservées via `consumer_id = null` au signup — vérifier avant).

---

### H-2. Purge RGPD — `producer_interests` non couvert si l'utilisateur a aussi déposé un intérêt

**Constat.** `public.producer_interests` (waitlist "devenir producteur") contient `nom, prenom, email, telephone, nom_exploitation, commune, especes, message`. Aucune FK vers `auth.users` (la table est conçue pour des leads anonymes pré-compte). Si un visiteur dépose un intérêt puis crée un compte avec le même email, puis supprime ce compte, **les données du formulaire intérêt restent indéfiniment**.

Le flow `desabonnement` (`app/(public)/desabonnement/unsubscribe-action.ts`) traite ce cas via `verifyOptOutToken` mais nécessite que l'utilisateur clique le lien dédié — ce n'est pas appelé depuis `delete_user_account`.

**Impact.** Même classe que H-1, RGPD article 17. Probabilité plus faible en pratique (un user qui s'inscrit n'a pas forcément déposé l'intérêt avant), mais le cas existe.

**Pistes.** Dans `deleteAccountAction` (post-RPC), faire un `admin.from('producer_interests').delete().ilike('email', session.email)` à la 4bis. Logger en console si rows > 0 (utile forensique).

---

### H-3. PII résiduelle — `audit_logs.metadata.email` en clair pour 3 event_types

**Constat (vérifié en prod, MCP)** : sur les events `account_login_magic_link` (3 lignes), `password_reset_request` (2 lignes), et `login_failed` (instrumenté), `metadata` contient l'email **en clair** :
- `app/connexion/actions.ts:278` (`metadata: { email, isAdmin }`)
- `app/connexion/actions.ts:384` (`metadata: { email }`)
- `app/connexion/actions.ts:109-113` (`metadata: { email: parsed.data.email, ... }` pour login_failed)

Or l'event `account_deleted` (`app/(consumer)/compte/profil/delete-account-action.ts:127`) utilise `email_masked: maskEmail(session.email)` — pattern explicite. L'event `email_change` (`app/auth/callback/route.ts:222`) utilise aussi `new_email_masked`. Asymétrie.

La FK `audit_logs.user_id → auth.users(id) ON DELETE SET NULL` préserve la ligne après suppression du compte. Les emails en clair survivent au compte. Justifié par le commentaire de migration ("conservation logs sécurité ≥1 an CNIL"), mais les *autres* event_types ont déjà fait le choix de masquer.

**Impact.** Conformité RGPD sur logs forensiques : un audit CNIL pourrait challenger la conservation d'emails en clair sur des comptes supprimés alors que le pattern masqué existe ailleurs dans la même table.

**Pistes.** Aligner les 3 events sur le pattern `*_masked` (et conserver `email` clair uniquement pour les events où le user n'existe pas encore — magic link / reset / login_failed sont précisément ces cas, à arbitrer).

---

### H-4. Défense en profondeur — layouts `(admin)`, `(producer)`, `(consumer)/compte` ne re-vérifient ni l'auth ni le hostname

**Constat.** L'isolation host + auth repose à 100% sur `middleware.ts`. Les layouts de groupe sont vides côté sécurité :

- `app/(admin)/layout.tsx` : aucun check ni `headers().get('host')`, ni `getUser()`. Juste un AdminHeader/Sidebar.
- `app/(producer)/layout.tsx` : retourne directement `<div>{children}</div>`.
- `app/(consumer)/compte/layout.tsx:8-9` : commentaire explicite « L'auth est garantie par le middleware (`/compte` est dans `CONSUMER_PROTECTED_PREFIX`), donc pas de redirect ici. »

Conséquences si le middleware est désactivé / contourné (ex : un nouveau matcher `config.matcher` exclut une page admin par mégarde, un bypass via header injection, une régression de l'isolation cookies) :
- une page `(admin)/*` rendue depuis `www.terroir-local.fr` afficherait son contenu sans contrôle ;
- un consumer connecté pourrait potentiellement atterrir sur `(producer)/*` ou `(admin)/*` si la matrice de canonicalisation a un trou.

Le seul filet est le check par-page (`getSessionUser()` + isAdmin) **dans certaines** routes — cf. `app/api/admin/audit-logs/export/route.ts:32`, `app/(producer)/dashboard/page.tsx:49-54`. Mais c'est non systématique : `app/(admin)/audit-logs/page.tsx`, `app/(admin)/avis/...`, `app/(admin)/gestion-producteurs/...` doivent être audités page-par-page (non fait dans cet audit, hors scope).

**Impact.** Risque hypothétique aujourd'hui (matcher robuste, isolation cookies en place). Risque réel à la prochaine modification du middleware ou ajout de subdomain.

**Pistes.** Ajouter dans `app/(admin)/layout.tsx` un check serveur :
```ts
const session = await getSessionUser();
if (!session?.isAdmin) redirect('/connexion');
const host = headers().get('host') ?? '';
if (!host.startsWith('admin.')) redirect('https://admin.terroir-local.fr/tableau-de-bord');
```
Idem pour `(producer)/layout.tsx`. Coût : un getUser() supplémentaire par route protégée — déjà dédupliqué par React cache si `getSessionUser()` est utilisé.

---

## MEDIUM

### M-1. Audit logging — events déclarés mais jamais émis en prod

**Constat (MCP).** Sur 96 lignes `audit_logs`, les event_types observés sont : `account_login_password` (49), `account_logout` (31), `account_login_magic_link` (3), `password_changed` (3), `email_change` (2), `password_reset_request` (2), `admin_login` (2), + events `order_*` payment.

Manquants à l'observation, alors qu'ils sont déclarés dans `AUTH_EVENT_TYPES` (`lib/audit-logs/log-auth-event.ts:28-113`) :
- `account_signup` — normal si pas de signups réels en prod (12 auth.users mais seeds + tests),
- `account_deleted` — aucun delete account testé en prod,
- `invitation_created`, `invitation_consumed_success`, `admin_invite_sent` — alors que **3 invitations consommées** + **11 créées** existent en prod (`producer_invitations`). Soit l'instrumentation T-310 / T-081 est arrivée après ces événements (probable vu les commits récents), soit elle échoue silencieusement (`logAuthEvent` swallow + `console.warn`).
- `login_failed`, `rate_limit_exceeded` — devraient apparaître si tentatives échouées / stress test ; absent peut signaler que c'est juste sous-utilisé en prod, ou que l'instrumentation ne se déclenche pas.

**Impact.** Trous forensiques observables si aujourd'hui un attaquant déclenchait une de ces voies — pas de preuve historique. À distinguer : "instrumentation absente" (gap réel) vs "voie jamais empruntée" (pas un gap).

**Pistes.** Émettre une invitation test en prod (admin) et vérifier que `invitation_created` + `admin_invite_sent` apparaissent dans la même seconde. Si non → bug d'instrumentation. Si oui → backlog antérieur, l'audit du présent OK.

---

### M-2. Cookie `redirect_after_auth` cross-domain non `__Host-` / `__Secure-`

**Constat.** Le cookie est posé avec `domain=.terroir-local.fr` (cross-subdomain volontaire), HttpOnly, Secure (en prod), SameSite=Lax (`lib/auth/redirect-cookie.ts:38-49`). Le nom est `redirect_after_auth`, sans préfixe `__Secure-`.

Limite admise : `__Host-` exige `domain` non posé (incompatible avec le cross-subdomain ciblé). `__Secure-` est compatible et apporte la garantie navigateur que le cookie ne peut être posé que via HTTPS — plus protecteur qu'un simple flag `Secure`.

Idem pour `__terroir_role_snapshot` (`lib/auth/role-snapshot-cookie.ts:23`) — même contrainte cross-domain, même opportunité `__Secure-`.

**Impact.** Très faible. Defense-in-depth marginale.

**Pistes.** Renommer en `__Secure-redirect_after_auth` et `__Secure-terroir_role_snapshot`. Migration cookie : laisser l'ancien nom expirer (TTL 1h pour redirect, 15min pour role snapshot) et basculer côté code. Sur admin, `sb-admin-role-snapshot` peut devenir `__Host-sb-admin-role-snapshot` (admin n'a pas de cross-subdomain → `domain` non posé déjà).

---

### M-3. Cache role snapshot — TTL 15min invalide tardivement les démotions admin

**Constat.** `ROLE_SNAPSHOT_TTL_SECONDS = 15 * 60` (`lib/auth/role-snapshot-cookie.ts:27`). Le cookie HMAC est cross-bind sur `user_id` (invalide quand un *autre* user se connecte) mais pas invalide sur changement de rôle du *même* user. Donc :

- Un admin que l'on retire de `admin_users` à T0 garde `isAdmin=true` côté middleware jusqu'à T0+15min (au pire) ou T0+1 hit après expiration cookie.
- Un producer qu'on rétrograde (drop du role 'producer' dans `users.roles`) idem.

L'event `role_changed` est déclaré dans `AUTH_EVENT_TYPES` mais aucun call site dans `app/**` (`Grep "role_changed"` n'a rien trouvé hors déclaration). Aucun mécanisme d'invalidation cookie côté serveur lorsqu'un rôle change.

**Impact.** Faible en pratique (les démotions sont rares et la fenêtre de 15min reste petite), mais documenté nulle part comme un trade-off explicite.

**Pistes.** (1) Documenter `ROLE_SNAPSHOT_TTL_SECONDS` comme staleness max acceptée. (2) Quand un admin change `users.roles` ou `admin_users`, propager via `clearRoleSnapshotOnStore()` avec le `user_id` cible — nécessite un endpoint admin qui ait accès au cookie de la cible (impossible cross-session) → en pratique se contenter de réduire TTL, ou loguer `role_changed` pour audit + accepter la fenêtre.

---

### M-4. `loadRoleSnapshot` fail-silent côté `connexion/layout.tsx`

**Constat.** `app/connexion/layout.tsx:42-53` :
```ts
try {
  const supabase = createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    const role = await loadRoleSnapshot(supabase, user.id);
    alreadyLoggedInPath = localPostLoginPath(role, host);
  }
} catch { /* fail-open */ }
```

Si la lecture `users.roles` ou `admin_users` plante (RLS régression, DB down), l'utilisateur déjà connecté reverra le formulaire `/connexion` au lieu d'être redirigé. Aucun log. Symptôme silencieux : "pourquoi je suis renvoyé vers /connexion alors que je suis connecté ?".

**Impact.** UX confuse + perte de signal alerting (un incident DB sur la lecture rôles ne fait pas de bruit).

**Pistes.** Ajouter `console.error` dans le catch avec `user.id` masqué. Ou logguer un `audit_logs` event `role_lookup_warn` (à ajouter) pour bénéficier du dashboard admin /audit-logs.

---

### M-5. Magic link rate-limit mutualisé avec login (cap 5/60s par IP)

**Constat.** `app/connexion/actions.ts:201-204` réutilise `getLoginRateLimit()` pour `requestMagicLinkAction`. Commentaire explicite (T-305 PR-B) : "un attaquant qui alterne login mdp + magic link sur la même IP rencontre le compteur partagé". Trade-off conscient.

Effet de bord : un attaquant qui flood `/api/.../magic-link` sur une IP NAT (entreprise, université) consomme le quota login pour tous les users derrière cette IP — déni de service collatéral pour les comptes légitimes mdp.

**Impact.** Faible (5/60s permet 300 tentatives/heure, suffisant pour usage légitime). Documenté.

**Pistes.** Si plaintes utilisateurs surfacent, séparer les caps (login = 5/60s, magic = 3/120s) et accepter qu'un attaquant cumule.

---

## LOW

### L-1. `canonicalPostLoginUrlWithRedirect` — pas de check rôle / path compatibility

`lib/auth/post-login-redirect.ts:152-154` (commentaire) accepte qu'un consumer demande `/tableau-de-bord` (admin only). Le middleware rejettera après auth → potentielle boucle `/connexion` ↔ `/tableau-de-bord` si un bug dans la matrice. Acceptable, déjà tracé.

### L-2. `sanitizeNext` log dans Vercel uniquement, pas dans `audit_logs`

`lib/auth/sanitize-next.ts:30-31` utilise `console.warn` uniquement. Un attaquant qui sonde `/auth/callback?next=javascript:...` n'apparaît pas dans le dashboard `/audit-logs` admin. Volontaire (le commentaire mentionne "anti log forging") mais pas de trace forensique persistante. Évolution : event `auth_callback_param_rejected` dans `audit_logs`.

### L-3. `clearRoleSnapshotOnStore` non type-guard sur `cookieStore` au logout

`lib/auth/role-snapshot-cookie.ts:309-316` : OK techniquement, le `isClearableStore` filet est défensif. RAS, juste à noter que ce code est sensible en cas de migration Next.

### L-4. Asymétrie `admin_login` source (magic_link vs password)

`app/auth/callback/route.ts:226-232` émet `admin_login` source=magic_link uniquement si `type === 'magiclink' && role.isAdmin`. `app/connexion/actions.ts:128-134` émet `admin_login` source=password si `role.isAdmin`. Cohérent. Pas un finding, juste à valider que le futur SSO/OIDC saura ajouter `source=oidc`.

### L-5. `cookieConfigForHost` retourne `{}` pour les hosts non-terroir

`lib/supabase/cookie-domain.ts:36-37` : sur un host inattendu en prod (vercel preview, subdomain non listé), retourne defaults. Le risque est qu'une preview deploy sur `*.vercel.app` partage les cookies avec rien et ne casse pas le test, mais pourrait poser un cookie sans `secure` si le browser ne le force pas. Acceptable, environnement dev / preview attendu.

### L-6. Désynchro `auth.users` (12) vs `public.users` (11) — explicable

L'admin (`admin@terroir-local.fr`, id `478d643a...`) est dans `auth.users` + `public.admin_users` mais pas dans `public.users` (trigger d'exclusion mutuelle, cf. migration `20260421100000`). Pas un finding — comportement attendu et confirmé. Documenté ici pour ne pas le re-investiguer.

---

## Vérifications complémentaires effectuées (sans finding)

- **Flux OTP `token_hash`** : `Grep verifyOtp` confirme usage exclusif sur `/auth/callback` et `/reinitialiser-mot-de-passe`. Aucun `exchangeCodeForSession` (PKCE) restant.
- **`getUser()` vs `getSession()` côté serveur** : `Grep` confirme 0 occurrence de `getSession()` dans les server actions / route handlers / middleware / layouts. Le seul usage browser est `components/providers/user-provider.tsx:178` (légitime, post-broadcast cross-tab pour récupérer la session côté client).
- **Cookies `@supabase/ssr`** : pattern `getAll`/`setAll` correct dans `middleware.ts:88-107`, `lib/supabase/server.ts:14-34`, `app/auth/callback/route.ts:104-117`. `setAll` du Server Client est try/catch pour le cas Server Component (correct).
- **Service_role exposure** : `lib/supabase/admin.ts` est `import "server-only"`, jamais importé par un fichier `"use client"`.
- **Enumeration-resistance** : magic link, signup, reset password — tous renvoient le même message succès quel que soit l'email connu/inconnu (cf. `signupAction` T-313 commentaire, `requestMagicLinkAction` shouldCreateUser=false swallow, `requestPasswordResetAction` swallow).
- **Hardening redirect** : `sanitizeNext` (callback ?next=) couvre control chars, dangerous schemes, protocol-relative — bien plus strict que `isValidRedirectPath` (qui couvre seulement `//` et `/\\`). Asymétrie historique tracée par le commentaire (T-314 finding antérieur).
- **Re-auth pre-deletion / pre-password-change** : pattern `tempClient` (`createClient` anon + `persistSession=false`) bien utilisé dans `delete-account-action.ts:104-117` et `change-password.ts:80-93` — re-auth sans pollution cookies session courante.
- **CASCADE FK auth.users (MCP)** : `auth.identities`, `auth.sessions`, `auth.mfa_factors`, `auth.one_time_tokens` etc. en CASCADE. Côté public : `users`, `notifications`, `admin_users`, `email_change_otp_codes`, `email_change_undo_tokens` en CASCADE. `audit_logs`, `producer_invitations.created_by`, `gms_prices.updated_by`, `product_stock_alerts.consumer_id` en SET NULL. Cohérent avec la politique RGPD (sauf cas H-1 ci-dessus).
- **Trigger d'exclusion mutuelle `users` ↔ `admin_users`** : confirmé en prod (admin n'a pas de ligne `public.users`), match avec le commentaire `lib/auth/session.ts:25-26`.
- **`secure password change` Supabase** : contournement documenté (`change-password.ts:96-104`) via `admin.auth.admin.updateUserById` après re-auth tempClient. Légitime, alternative sinon nonce reauthenticate côté browser.
- **Cookies admin isolés** : `sb-admin-auth-token` distinct de `sb-<projectref>-auth-token` (cookie-domain.ts:31), `sb-admin-role-snapshot` distinct de `__terroir_role_snapshot`. Une session admin ne fuite pas vers `pro.*` / `www.*` (et inversement).

---

## Annexes

### A. Inventaire routes auth scannées

| Subdomain | Route | Type | File |
|---|---|---|---|
| www | `/connexion` | Page + Action | `app/connexion/page.tsx` + `app/connexion/actions.ts` (loginAction, requestMagicLinkAction, requestPasswordResetAction) |
| www | `/auth/inscription` | Page + Action | `app/(consumer)/auth/inscription/page.tsx` + `actions.ts` (signupAction) |
| www | `/auth/callback` | Route Handler | `app/auth/callback/route.ts` (GET, verifyOtp token_hash) |
| www | `/mot-de-passe-oublie` | Page (form) | `app/(public)/mot-de-passe-oublie/page.tsx` |
| www | `/reinitialiser-mot-de-passe` | Page + Action | `app/(public)/reinitialiser-mot-de-passe/page.tsx` + `_actions/update-password.ts` (updatePasswordAction, verifyOtp + updateUser) |
| www | `/desabonnement` | Action | `app/(public)/desabonnement/unsubscribe-action.ts` |
| www | `/compte/profil` (delete) | Action | `app/(consumer)/compte/profil/delete-account-action.ts` |
| www | `/compte/profil` (change email) | Actions | `app/(consumer)/compte/profil/_actions/{request-otp,verify-otp,complete-email-change}.tsx` |
| www | `/compte/password` | Action | `app/(consumer)/compte/password/_actions/change-password.ts` |
| pro | `/connexion` | Layout adaptatif (`app/connexion/layout.tsx`) — même action loginAction, branche pro chrome |
| pro | `/auth/callback` | Routé via `getAuthCallbackUrl(isAdmin=false)` → `https://www...` (et non pro) — magic link consumer/producer atterrit sur www, cookies `.terroir-local.fr` partagés couvrent pro |
| pro | `/invitation` | Page + Actions | `app/(producer)/invitation/_actions/{create-account,accept-invitation,login-and-upgrade,complete-onboarding}.ts` |
| admin | `/connexion` | Layout adaptatif chrome admin |
| admin | `/auth/callback` | `getAuthCallbackUrl(isAdmin=true)` → `https://admin...` |
| admin | `/reinitialiser-mot-de-passe` | `getPasswordResetUrl(isAdmin=true)` → `https://admin...` |
| Tous | `logout` | Action | `app/connexion/logout-action.ts` (clear cookies sb-* + role snapshot scopés au host) |

### B. Tables auth observées (MCP, 2026-05-05)

```
auth.users           : 12
public.users         : 11  (1 admin sans profil = OK)
public.admin_users   : 1
public.audit_logs    : 96
public.producer_invitations : 11 (3 used, 8 pending)
producers (statut='deleted') : 1
```

### C. Events `audit_logs` observés vs déclarés

Déclarés dans `AUTH_EVENT_TYPES` (28 entrées) — observés 8/28. Le delta est documenté en M-1.

---

_Audit effectué le 2026-05-05 — base de code commit `3f7932b` + état prod via MCP Supabase. Aucun fichier modifié hors `docs/audits/`._
