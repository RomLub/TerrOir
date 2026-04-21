-- =============================================================================
-- TerrOir — RLS policy admin sur public.producers
-- =============================================================================
-- Au moment de la création de la table (migration 20260419000000), aucune
-- policy admin n'avait été posée sur public.producers : les admin ne voyaient
-- que les producers avec statut='active' via la policy "producers public read
-- when active". Les producers 'pending' / 'suspended' (et 'draft' / 'public'
-- post-Phase 1 du Chantier 2) étaient invisibles depuis
-- /admin/gestion-producteurs.
--
-- Ce trou a été mis en évidence par la Phase 3 (premier producer créé en
-- statut='pending' par le flow d'onboarding — invisible côté admin).
--
-- On aligne sur le pattern de public.producer_interests et
-- public.producer_invitations, qui utilisent déjà public.is_admin() pour leur
-- accès admin.
--
-- Idempotent : drop-then-create pour tolérer un re-run.
-- =============================================================================

begin;

drop policy if exists "producers admin all" on public.producers;

create policy "producers admin all"
  on public.producers for all
  using (public.is_admin())
  with check (public.is_admin());

commit;
