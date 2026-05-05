-- =============================================================================
-- TerrOir — Audit RLS 2026-05-05 / Lot 5 : storage policies SELECT + wrap perf
-- =============================================================================
-- Findings traités : HIGH-3 (storage policies sans SELECT, upsert silent-fail)
--                  + HIGH-1 sur le périmètre storage (wrap owns_producer).
-- Sévérité : HIGH (silent failure — bug fonctionnel sans faille active).
-- Référence : docs/audits/audit-rls-2026-05-05.md section H-3.
--
-- Contexte : la migration 20260422100000_storage_policies_for_producers.sql
-- crée des policies INSERT/UPDATE/DELETE pour les buckets `product-photos` et
-- `producer-photos`, mais pas SELECT. Les buckets sont publics (lecture via
-- getPublicUrl bypasse RLS), donc l'app fonctionne en lecture seule. Mais
-- l'API `storage.from(...).upload(path, file, { upsert: true })` côté
-- authenticated effectue un INSERT-or-UPDATE qui requiert SELECT pour vérifier
-- la collision — sans policy SELECT, le branch UPDATE échoue silencieusement
-- (ancien fichier conservé, pas d'erreur retournée).
--
-- Skill Supabase officiel : "Storage upsert requires INSERT + SELECT + UPDATE.
-- Granting only INSERT allows new uploads but file replacement (upsert)
-- silently fails."
--
-- Cette migration :
--   1. Ajoute SELECT policies sur les 2 buckets (defense-in-depth + couverture
--      upsert authenticated).
--   2. Recrée les policies INSERT/UPDATE/DELETE existantes en wrappant
--      owns_producer() dans (select ...) — alignement HIGH-1 (lot 3/4).
--
-- Idempotence : drop policy if exists + create. Re-runnable.
--
-- Pré-requis : appliquer d'abord le lot 1 (harden_security_definer_acls.sql)
-- pour que owns_producer ait le bon GRANT à `authenticated`.
--
-- Note Dashboard vs SQL : Supabase recommande la gestion via Dashboard pour
-- les storage policies, mais la migration historique (20260422100000) les
-- crée via SQL sans incident — convention projet conservée. Si l'apply via
-- SQL Editor échoue (storage.objects RLS owner restrictions selon version
-- Supabase), bascule sur Dashboard documentée dans
-- docs/fixes/storage-policies-manual-fix.md (étapes UI exactes).
--
-- Rollback : DROP POLICY pour les 2 SELECT ajoutées + recréation des 6
-- INSERT/UPDATE/DELETE sans wrap (état pré-migration).
--
-- Tests : aucun test E2E ne couvre l'upsert storage actuellement. À valider
-- manuellement post-apply : upload d'une nouvelle photo produit + replacement
-- d'une existante via l'UI producteur.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- product-photos
-- -----------------------------------------------------------------------------
drop policy if exists "product-photos owner select" on storage.objects;
create policy "product-photos owner select"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'product-photos'
    and (select public.owns_producer((storage.foldername(name))[1]::uuid))
  );

drop policy if exists "product-photos owner insert" on storage.objects;
create policy "product-photos owner insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'product-photos'
    and (select public.owns_producer((storage.foldername(name))[1]::uuid))
  );

drop policy if exists "product-photos owner update" on storage.objects;
create policy "product-photos owner update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'product-photos'
    and (select public.owns_producer((storage.foldername(name))[1]::uuid))
  )
  with check (
    bucket_id = 'product-photos'
    and (select public.owns_producer((storage.foldername(name))[1]::uuid))
  );

drop policy if exists "product-photos owner delete" on storage.objects;
create policy "product-photos owner delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'product-photos'
    and (select public.owns_producer((storage.foldername(name))[1]::uuid))
  );

-- -----------------------------------------------------------------------------
-- producer-photos
-- -----------------------------------------------------------------------------
drop policy if exists "producer-photos owner select" on storage.objects;
create policy "producer-photos owner select"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'producer-photos'
    and (select public.owns_producer((storage.foldername(name))[1]::uuid))
  );

drop policy if exists "producer-photos owner insert" on storage.objects;
create policy "producer-photos owner insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'producer-photos'
    and (select public.owns_producer((storage.foldername(name))[1]::uuid))
  );

drop policy if exists "producer-photos owner update" on storage.objects;
create policy "producer-photos owner update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'producer-photos'
    and (select public.owns_producer((storage.foldername(name))[1]::uuid))
  )
  with check (
    bucket_id = 'producer-photos'
    and (select public.owns_producer((storage.foldername(name))[1]::uuid))
  );

drop policy if exists "producer-photos owner delete" on storage.objects;
create policy "producer-photos owner delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'producer-photos'
    and (select public.owns_producer((storage.foldername(name))[1]::uuid))
  );

commit;
