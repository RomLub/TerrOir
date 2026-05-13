-- =============================================================================
-- TerrOir — Bulk publish des producteurs validés + cleanup comptes test
-- =============================================================================
-- Date : 2026-05-13 — Demande Romain en vue de la démo Julien du 2026-05-14.
--
-- 1. Publie en mode `public` (visible sur /carte) les 3 producteurs réalistes
--    en statut `active` qui étaient prêts à être publiés de toute façon :
--      - perche-sarthois  (Ferme du Perche Sarthois)
--      - clos-cenomane    (GAEC du Clos Cenomane)
--      - vergers-huisne   (Les Vergers de l'Huisne)
--
-- 2. Nettoie en `deleted` 2 comptes de test résiduels qui sortaient en
--    `active` sans contenu réel :
--      - test-phase3-newuser-ucqr0z (« Exploitation Test »)
--      - hemery-chlo-sy7j9f         (« TEST »)
--
-- Contexte assumé (pushback documenté) : aucun des 3 producteurs publiés n'a
-- `stripe_charges_enabled = true` à ce stade — la fiche publique est OK pour
-- la démo (visualisation), mais le bouton « Commander » est cassé jusqu'à
-- finalisation Stripe Connect. Le garde-fou normal
-- `promoteProducerToPublicIfActive` (lib/producers/promote-to-public.ts)
-- aurait refusé cette promotion ; ici on l'applique en bulk admin assumé.
--
-- Idempotence :
--   - Les deux UPDATE filtrent sur `statut = 'active'`. Réexécution → 0 row
--     affected (les producteurs ciblés sont déjà 'public' ou 'deleted').
--   - Les deux INSERT audit_logs lisent depuis les CTE de UPDATE via
--     RETURNING → 0 ligne UPDATE = 0 ligne INSERT. L'INSERT de résumé
--     `bulk_summary` est gardé par `where n_published > 0 or n_cleaned > 0`.
--     Donc no-op intégral en réexécution.
--
-- Trigger BEFORE UPDATE `producers_block_owner_admin_columns_trigger` (T-218) :
--   - Bloque les modifications de `statut` pour authenticated non-admin.
--   - Bypass explicite pour `auth.role() = 'service_role'` et `is_admin()`.
--   - Détail Piège connu CLAUDE.md « UPDATE admin manuel via SQL Studio » :
--     `SET ROLE service_role` ne suffit PAS depuis le contexte MCP — la
--     fonction `auth.role()` lit `current_setting('request.jwt.claim.role')`
--     et le JWT claim, pas le rôle Postgres de la session. On force donc
--     directement le claim via `set local request.jwt.claim.role`. Cohérent
--     avec ce qu'envoie PostgREST pour les appels service_role en runtime.
--
-- Cache Next :
--   - `revalidatePublicStats` et `revalidateProducersSearch` ne sont pas
--     déclenchés depuis une migration SQL pure. TTL 60 s sur
--     `producers-search` → la carte publique re-fetch automatiquement en
--     ≤ 60 s après application. Acceptable pour le délai démo de demain.
-- =============================================================================

set local request.jwt.claim.role = 'service_role';

with publish_updates as (
  update public.producers
     set statut = 'public'
   where statut = 'active'
     and slug = any (array[
       'perche-sarthois',
       'clos-cenomane',
       'vergers-huisne'
     ])
  returning id, slug, nom_exploitation
),
cleanup_updates as (
  update public.producers
     set statut = 'deleted'
   where statut = 'active'
     and slug = any (array[
       'test-phase3-newuser-ucqr0z',
       'hemery-chlo-sy7j9f'
     ])
  returning id, slug, nom_exploitation
),
audit_publish as (
  insert into public.audit_logs (user_id, event_type, metadata)
  select
    null,
    'admin_producer_statut_changed',
    jsonb_build_object(
      'producer_id',     id,
      'previous_statut', 'active',
      'new_statut',      'public',
      'producer_slug',   slug,
      'producer_name',   nom_exploitation,
      'reason',          'bulk publish for Julien demo + validated producers ready',
      'migration',       '20260513220000_publish_validated_producers'
    )
  from publish_updates
  returning 1
),
audit_cleanup as (
  insert into public.audit_logs (user_id, event_type, metadata)
  select
    null,
    'admin_producer_statut_changed',
    jsonb_build_object(
      'producer_id',     id,
      'previous_statut', 'active',
      'new_statut',      'deleted',
      'producer_slug',   slug,
      'producer_name',   nom_exploitation,
      'reason',          'cleanup test accounts during bulk publish 2026-05-13',
      'migration',       '20260513220000_publish_validated_producers'
    )
  from cleanup_updates
  returning 1
),
result as (
  select
    (select count(*) from publish_updates) as n_published,
    (select count(*) from cleanup_updates) as n_cleaned,
    (select count(*) from audit_publish)   as n_audit_publish,
    (select count(*) from audit_cleanup)   as n_audit_cleanup
)
insert into public.audit_logs (user_id, event_type, metadata)
select
  null,
  'admin_producer_statut_changed',
  jsonb_build_object(
    'kind',            'bulk_summary',
    'n_published',     n_published,
    'n_cleaned',       n_cleaned,
    'n_audit_publish', n_audit_publish,
    'n_audit_cleanup', n_audit_cleanup,
    'migration',       '20260513220000_publish_validated_producers'
  )
from result
where n_published > 0 or n_cleaned > 0;
