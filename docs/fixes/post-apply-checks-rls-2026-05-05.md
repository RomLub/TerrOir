# Post-apply checks — Fix RLS 2026-05-05

Checklist manuelle à dérouler **en environnement dev / preview** après chaque lot du fix RLS, avant promotion en production. Vitest et Playwright n'attaquent pas la couche RLS de manière exhaustive — ces parcours sont la garantie de non-régression fonctionnelle.

**Convention** : cocher au fil de l'eau. Si un check échoue, **stopper l'apply** et ouvrir une investigation avant de poursuivre les lots suivants.

**Référence** : [fix-rls-2026-05-05.md](./fix-rls-2026-05-05.md) pour le détail des migrations.

---

## Étape 0 — Backfill `supabase_migrations`

À dérouler **avant** tout apply de migration du fix RLS.

- [ ] Exécuter `scripts/maintenance/backfill-supabase-migrations-2026-05-05.sql` via Supabase Studio SQL Editor.
- [ ] La sortie `total_tracked` retourne **50** rows (15 pré-existants + 35 backfillés).
- [ ] Le listing chronologique montre `created_by = 'manual_backfill_2026-05-05'` sur les 35 nouvelles entrées (la colonne reste NULL pour les 15 pré-existantes).
- [ ] Re-jouer le script une 2e fois : aucune erreur (idempotence ON CONFLICT).

---

## Étape 1 — Apply lot 6 (T-241 patché)

**Fichier** : `supabase/migrations/20260504100000_t241_declaration_veracite_persistance.sql`

### Sanity SQL

- [ ] La fonction `update_producer_onboarding` existe : `SELECT pg_get_functiondef('public.update_producer_onboarding(uuid, text, text, text, text, text, text, text, text, text, text, text, text, boolean, text)'::regprocedure);`
- [ ] L'ACL est verrouillée — la requête suivante doit retourner `false`, `false`, `true` :
  ```sql
  select
    has_function_privilege('anon',          'public.update_producer_onboarding(uuid, text, text, text, text, text, text, text, text, text, text, text, text, boolean, text)', 'EXECUTE') as anon_can,
    has_function_privilege('authenticated', 'public.update_producer_onboarding(uuid, text, text, text, text, text, text, text, text, text, text, text, text, boolean, text)', 'EXECUTE') as auth_can,
    has_function_privilege('service_role',  'public.update_producer_onboarding(uuid, text, text, text, text, text, text, text, text, text, text, text, text, boolean, text)', 'EXECUTE') as sr_can;
  ```
- [ ] Les 3 colonnes `declaration_indicateurs_*` existent sur `public.producers` : `\d public.producers` (bloc fin de table).

### Parcours producer onboarding

- [ ] Login pro avec un compte invitation valide (Phase 4 reprise OU Phase 1 nouveau).
- [ ] Compléter le wizard `/invitation` jusqu'à l'étape « infos producteur ».
- [ ] Cocher la case « Je certifie sur l'honneur… » (déclaration véracité).
- [ ] Soumettre → redirige vers `/ma-page?onboarded=1`.
- [ ] Vérifier en SQL que `public.producers` pour ce user a :
  - [ ] `declaration_indicateurs_veracite_at` non NULL et récent (now() ± qq sec)
  - [ ] `declaration_indicateurs_snapshot` JSON contenant les 3 enums saisis
  - [ ] `declaration_indicateurs_wording_version` = `'v1.0'`
  - [ ] `statut = 'pending'`

---

## Étape 2 — Apply lot 1+2 (harden ACLs)

**Fichier** : `supabase/migrations/20260505100000_audit_rls_lot_1_2_harden_security_definer_acls.sql`

### Sanity SQL

- [ ] Vérifier qu'`anon` ne peut plus EXECUTE `revive_order_with_stock_check` :
  ```sql
  select has_function_privilege('anon', 'public.revive_order_with_stock_check(uuid)', 'EXECUTE');
  -- doit retourner false
  ```
- [ ] Idem pour `record_refund_attempt` (anon + authenticated) :
  ```sql
  select
    has_function_privilege('anon',          'public.record_refund_attempt(uuid, text, text, uuid, text, text, text, text, text, text, text, text, timestamptz)', 'EXECUTE'),
    has_function_privilege('authenticated', 'public.record_refund_attempt(uuid, text, text, uuid, text, text, text, text, text, text, text, text, timestamptz)', 'EXECUTE');
  -- doit retourner false, false
  ```
- [ ] `is_admin` / `owns_producer` / `search_producers` restent callables anon + authenticated :
  ```sql
  select
    has_function_privilege('anon',          'public.is_admin()', 'EXECUTE'),
    has_function_privilege('authenticated', 'public.owns_producer(uuid)', 'EXECUTE'),
    has_function_privilege('anon',          'public.search_producers(double precision, double precision, double precision, text[], text[])', 'EXECUTE');
  -- doit retourner true, true, true
  ```

### Parcours anonyme (consumer non logged-in)

- [ ] GET `/` → page d'accueil charge sans erreur.
- [ ] GET `/carte` → carte interactive, marqueurs producteurs visibles (filiale RPC `search_producers`).
- [ ] GET `/producteurs` → liste paginée des producteurs publics, count > 0.
- [ ] GET `/producteurs/[slug]` (un slug actif) → fiche complète, produits visibles, créneaux affichés.
- [ ] GET `/notre-demarche` → comparaison prix GMS chargée (`gms_prices public read`).

### Parcours consumer authentifié

- [ ] Login avec un test consumer (`/connexion`).
- [ ] GET `/compte` → infos personnelles + historique commandes.
- [ ] Ajouter un produit au panier sur une fiche producteur.
- [ ] Aller à `/compte/checkout` → renseigner CB test Stripe (`4242 4242 4242 4242` exp `12/30` cvc `123`).
- [ ] Confirmer paiement → redirection vers `/compte/confirmation/[id]`.
- [ ] GET `/compte/commandes/[id]` → détails commande, items visibles (parties read + order_items via order).
- [ ] Vérifier que la commande apparaît bien côté producteur (`/commandes` après login pro).

### Parcours admin

- [ ] Login admin (sous-domaine admin) → `/admin` charge.
- [ ] GET `/admin/producteurs` → tous producteurs y compris non-`public`.
- [ ] GET `/admin/producteurs/[id]` → détail producteur.

### Webhook Stripe (smoke test)

- [ ] Vérifier dans les logs Vercel (ou équivalent) que les webhooks `payment_intent.succeeded` / `account.updated` traités par le code applicatif côté service_role n'erreent pas avec `permission denied for function`.

---

## Étape 3 — Apply lot 3+4 (perf RLS + EXISTS replace)

**Fichier** : `supabase/migrations/20260505100100_audit_rls_lot_3_4_optimize_rls_perf.sql`

### Sanity SQL

- [ ] Les 3 helpers existent :
  ```sql
  select proname from pg_proc
  where pronamespace = 'public'::regnamespace
    and proname in ('is_producer_public', 'can_access_order', 'is_completed_order_of_caller');
  -- doit retourner 3 rows
  ```
- [ ] Aucun `EXISTS` inline résiduel dans les policies products / slots / slot_rules / order_items / reviews-insert :
  ```sql
  select tablename, policyname, qual, with_check
  from pg_policies
  where schemaname = 'public'
    and (qual ilike '%exists ( select 1%from public.producers%' or
         with_check ilike '%exists ( select 1%from public.producers%');
  -- doit retourner 0 rows
  ```
- [ ] Les `auth.uid()` sont wrappés dans (select ...) :
  ```sql
  select tablename, policyname
  from pg_policies
  where schemaname = 'public'
    and (qual ~* 'auth\.uid\(\)' and qual !~* '\(\s*select\s+auth\.uid\(\)')
    and (qual is not null);
  -- doit retourner 0 rows (toutes les policies utilisent (select auth.uid()))
  ```

### Parcours consumer (non-régression)

- [ ] Re-dérouler le parcours consumer authentifié (étape 2 ci-dessus) — aucune différence comportementale attendue.
- [ ] Spécifiquement vérifier que `/produits/[id]` charge les créneaux disponibles (slots public read via `is_producer_public`).
- [ ] Spécifiquement vérifier que `/compte/commandes/[id]` affiche bien tous les `order_items` (via `can_access_order`).

### Parcours producer (non-régression)

- [ ] Login pro, GET `/dashboard` → liste commandes (parties read via `owns_producer`).
- [ ] GET `/commandes/[id]` → détails commande + items (idem).
- [ ] GET `/produits` → catalogue producteur (products owner all).
- [ ] GET `/creneaux` → slot rules + slots matérialisés (slot_rules owner + slots owner).

### Parcours admin (non-régression)

- [ ] Login admin → GET `/admin/avis` → reviews à modérer (admin all chemin différent).
- [ ] GET `/admin/audit-logs` → events forensique (audit_logs admin read refacto via is_admin).
- [ ] GET `/admin/refund-incidents` (si page existe) → incidents (refund_incidents admin read).
- [ ] GET `/admin/disputes` (si page existe) → disputes (disputes admin read).

### Review post-completed-order

- [ ] Sur une commande consumer test au statut `completed`, soumettre un avis.
- [ ] La policy `reviews consumer insert after completed order` doit accepter (via `is_completed_order_of_caller`).
- [ ] L'avis apparaît dans `/admin/avis` en `pending`.

### Perf check (informatif)

- [ ] Sur prod-like dataset, comparer EXPLAIN (ANALYZE, BUFFERS) sur :
  ```sql
  -- session authenticated avec SET request.jwt.claims = ...
  set local role authenticated;
  set local "request.jwt.claims" = '{"sub": "<un-uuid-consumer>"}';
  explain (analyze, buffers) select * from public.orders where consumer_id = '<uuid>'::uuid limit 100;
  ```
- [ ] L'output ne doit plus mentionner `auth.uid()` dans une `Function Scan` répétée par row — devrait apparaître en InitPlan unique.

---

## Étape 4 — Apply lot 5 (storage SELECT)

**Fichier** : `supabase/migrations/20260505100200_audit_rls_lot_5_fix_storage_policies_select.sql`

### Sanity SQL

- [ ] Les 8 policies storage sont en place :
  ```sql
  select policyname, cmd, roles
  from pg_policies
  where schemaname = 'storage' and tablename = 'objects'
  order by policyname;
  -- doit retourner 8 rows : 2 buckets × 4 commands (SELECT, INSERT, UPDATE, DELETE)
  ```

### Parcours producer — upload + replacement

Le fix critique : avant ce lot, le replacement (upsert) échouait silencieusement. Test obligatoire.

- [ ] Login pro avec un test producer.
- [ ] GET `/ma-page` → édition profil.
- [ ] **Upload neuf** : remplacer la photo principale (hero) par une nouvelle image. La nouvelle image doit s'afficher après save.
- [ ] **Replacement (upsert)** : sur le même producer, ré-uploader une autre image dans le slot hero. La nouvelle (3e) image doit remplacer la 2e — vérifier visuellement après refresh ET via SQL :
  ```sql
  select photo_principale, updated_at from public.producers where id = '<producer_id>';
  -- photo_principale doit pointer vers la 3e image, pas la 2e
  ```
- [ ] Idem sur un produit : `/produits/[id]/edit` → uploader puis remplacer la photo. Vérifier que l'ancienne disparaît.

### Cross-producer denial

- [ ] Avec le compte producteur A, ouvrir DevTools console → tenter manuellement un upload vers `<producerB-id>/test.jpg` :
  ```js
  await window.supabase.storage.from('product-photos').upload('<producerB-id>/test.jpg', new Blob(['x']));
  // doit retourner une erreur 403 / "row-level security policy"
  ```

### Si l'apply SQL échoue

- [ ] Suivre le fallback Dashboard documenté dans [storage-policies-manual-fix.md](./storage-policies-manual-fix.md).

---

## Étape 5 — Apply lot 7 (FORCE RLS + drop redondance)

**Fichier** : `supabase/migrations/20260505100300_audit_rls_lot_7_harden_rls_medium.sql`

### Sanity SQL

- [ ] Les 9 tables ont `relforcerowsecurity = true` :
  ```sql
  select c.relname, c.relforcerowsecurity
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in (
      'audit_logs', 'disputes', 'refund_incidents', 'refund_incident_attempts',
      'payouts', 'email_change_otp_codes', 'email_change_undo_tokens',
      'webhook_events_processed', 'product_stock_alerts'
    )
  order by c.relname;
  -- les 9 rows doivent avoir relforcerowsecurity = true
  ```
- [ ] La policy `disputes_service_role_all` n'existe plus :
  ```sql
  select count(*) from pg_policies
  where schemaname = 'public' and tablename = 'disputes' and policyname = 'disputes_service_role_all';
  -- doit retourner 0
  ```

### Smoke test runtime

- [ ] Webhook Stripe `payment_intent.succeeded` continue de marquer les orders + écrire dans `audit_logs` (vérifier dans les logs Vercel).
- [ ] Le cron retry-failed-refunds (si exécutable manuellement) lit `refund_incidents` sans erreur (service_role bypass natif).
- [ ] L'admin `/admin/audit-logs` continue d'afficher les events (admin via service_role helper).

### Debug interactif (mémo)

- [ ] Note pour Romain : pour debug en SQL Editor sur ces 9 tables, désormais `SET LOCAL ROLE service_role;` avant chaque query d'inspection (sinon RLS s'applique même au superuser postgres).

---

## Étape 6 — Apply lot 8 (cleanup cosmétique)

**Fichier** : `supabase/migrations/20260505100400_audit_rls_lot_8_cleanup_rls_low.sql`

### Sanity SQL

- [ ] Les ~22 policies identity-check sont scope `to authenticated` :
  ```sql
  select tablename, policyname, roles
  from pg_policies
  where schemaname = 'public'
    and policyname in (
      'users self read', 'users self insert', 'users self update',
      'producers owner read', 'producers owner insert', 'producers owner update', 'producers admin all',
      'products owner all',
      'slots owner all',
      'slot_rules owner all', 'slot_rules admin all',
      'orders parties read', 'orders consumer insert', 'orders parties update',
      'order_items via order',
      'reviews author read', 'reviews consumer insert after completed order', 'reviews author update',
      'payouts producer read',
      'notifications owner read',
      'producer_interests admin read', 'producer_interests admin update',
      'invitations admin all'
    )
  order by tablename, policyname;
  -- toutes les rows doivent montrer roles = {authenticated}
  ```
- [ ] L'index composite existe :
  ```sql
  select indexname, indexdef from pg_indexes
  where schemaname = 'public' and tablename = 'producer_interests'
    and indexname = 'producer_interests_statut_source_idx';
  -- 1 row attendue
  ```

### Smoke test runtime

- [ ] Les parcours consumer / producer / admin (étapes précédentes) restent fonctionnels — aucun changement comportemental attendu (just metadata).

---

## Validation finale

Une fois TOUTES les étapes ci-dessus cochées en dev :

- [ ] Re-vérifier en SQL : aucune policy ne mentionne `auth.uid()` ou `is_admin()` ou `owns_producer()` non-wrappé :
  ```sql
  select tablename, policyname
  from pg_policies
  where schemaname in ('public', 'storage')
    and (
      (qual ~* '(?<!\(\s*select\s)auth\.uid\(\)'
       and qual !~* 'auth\.users') -- exclure les FK FROM auth.users
      or (qual ~* '(?<!\(\s*select\s)is_admin\(\)')
      or (qual ~* '(?<!\(\s*select\s)owns_producer\(')
    );
  -- doit retourner 0 rows
  ```
- [ ] Re-vérifier les fonctions sensibles : ACL bouclée
  ```sql
  select pg_proc.proname, pg_proc.proacl
  from pg_proc
  where pronamespace = 'public'::regnamespace
    and proname in ('revive_order_with_stock_check', 'record_refund_attempt', 'update_producer_onboarding');
  -- aucune ACL ne doit contenir =X/postgres en première position (ce serait PUBLIC)
  ```
- [ ] Promotion staging → prod uniquement après tous les checks ci-dessus verts.

## En cas de régression

1. Identifier le lot qui a introduit la régression (le dernier apply).
2. Suivre la procédure de rollback documentée dans [fix-rls-2026-05-05.md](./fix-rls-2026-05-05.md) section « Rollback global ».
3. Capturer le contexte (query qui échoue, message d'erreur, role auth) avant rollback pour analyse post-mortem.
