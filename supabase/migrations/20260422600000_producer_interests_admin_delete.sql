-- =============================================================================
-- TerrOir — producer_interests : policy DELETE admin
-- =============================================================================
-- La page admin /producer-interests (Phase leads producteurs) permet à l'admin
-- de nettoyer les leads obsolètes ou erronés (doublons, spam, prospects
-- définitivement perdus). Les policies initiales (migration 20260419000000)
-- couvraient INSERT (public), SELECT (admin), UPDATE (admin) mais pas DELETE.
--
-- Idempotent : drop + create. CREATE POLICY IF NOT EXISTS n'est supporté
-- qu'à partir de Postgres 15, et on ne veut pas coupler la migration à une
-- version minimale.
-- =============================================================================

begin;

drop policy if exists "producer_interests admin delete" on public.producer_interests;

create policy "producer_interests admin delete"
  on public.producer_interests for delete
  to authenticated
  using (public.is_admin());

commit;
