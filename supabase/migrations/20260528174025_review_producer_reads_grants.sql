-- =============================================================================
-- TerrOir - Correction grants review_producer_reads
-- =============================================================================
-- Supabase peut poser des privileges par defaut sur les nouvelles tables pour
-- authenticated. La table de lecture avis ne doit accepter que SELECT/INSERT/
-- UPDATE cote producteur, le reste etant inutile et risque.
-- =============================================================================

revoke all on public.review_producer_reads from authenticated;
grant select, insert, update on public.review_producer_reads to authenticated;
