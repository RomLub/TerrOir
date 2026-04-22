-- =============================================================================
-- TerrOir — RLS policies sur storage.objects pour les buckets producteur
-- =============================================================================
-- Les buckets `product-photos` et `producer-photos` sont configurés en mode
-- public (lecture via getPublicUrl → endpoint unauthenticated, pas de RLS
-- nécessaire pour le SELECT). En revanche INSERT/UPDATE/DELETE passent par
-- PostgREST et DOIVENT satisfaire une policy RLS sur storage.objects.
--
-- Sans ces policies, tout upload côté authenticated échoue en 400 — c'était
-- le cas avant cette migration.
--
-- Invariant de path : le 1er segment est toujours le producer_id (UUID).
--   product-photos  : {producer_id}/{ts}-{rand}.{ext}
--   producer-photos : {producer_id}/hero/{ts}-{rand}.{ext}   (ma-page hero)
--                     {producer_id}/gallery/{ts}-{rand}.{ext} (ma-page gallery)
--
-- Vérification de propriété via public.owns_producer() (security definer,
-- bypasse la RLS sur public.producers). Un path malformé (sans slash) →
-- storage.foldername(name) = {} → [1] = null → cast uuid null → owns_producer
-- renvoie false → WITH CHECK échoue. Comportement safe voulu.
--
-- Idempotent : drop policy if exists avant chaque create → re-run safe.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- product-photos
-- -----------------------------------------------------------------------------
drop policy if exists "product-photos owner insert" on storage.objects;
create policy "product-photos owner insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'product-photos'
    and public.owns_producer((storage.foldername(name))[1]::uuid)
  );

drop policy if exists "product-photos owner update" on storage.objects;
create policy "product-photos owner update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'product-photos'
    and public.owns_producer((storage.foldername(name))[1]::uuid)
  )
  with check (
    bucket_id = 'product-photos'
    and public.owns_producer((storage.foldername(name))[1]::uuid)
  );

drop policy if exists "product-photos owner delete" on storage.objects;
create policy "product-photos owner delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'product-photos'
    and public.owns_producer((storage.foldername(name))[1]::uuid)
  );

-- -----------------------------------------------------------------------------
-- producer-photos
-- -----------------------------------------------------------------------------
drop policy if exists "producer-photos owner insert" on storage.objects;
create policy "producer-photos owner insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'producer-photos'
    and public.owns_producer((storage.foldername(name))[1]::uuid)
  );

drop policy if exists "producer-photos owner update" on storage.objects;
create policy "producer-photos owner update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'producer-photos'
    and public.owns_producer((storage.foldername(name))[1]::uuid)
  )
  with check (
    bucket_id = 'producer-photos'
    and public.owns_producer((storage.foldername(name))[1]::uuid)
  );

drop policy if exists "producer-photos owner delete" on storage.objects;
create policy "producer-photos owner delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'producer-photos'
    and public.owns_producer((storage.foldername(name))[1]::uuid)
  );

commit;
