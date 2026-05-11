-- =============================================================================
-- TerrOir — F-066 (audit P0 sweep low-info 2026-05-11) : indexes FK manquants
-- =============================================================================
-- Contexte : audit pré-launch identifie 2 foreign keys non indexées.
-- Sans index sur la colonne FK :
--   - Les jointures reverse (ex: "lister les invitations créées par cet admin")
--     forcent un seq scan sur producer_invitations.
--   - Le check de validité de la FK lors d'un DELETE sur la table parente
--     (auth.users / public.users) doit scanner toute la table fille.
-- Volume actuel faible (pré-launch), mais coût d'apply ~0 et bénéfice
-- monotonique → on pose les indexes idempotents avant ouverture publique.
--
-- Colonnes vérifiées présentes :
--   - producer_invitations.created_by : migration 20260419010000_producer_invitations.sql
--     (uuid references public.users(id), nullable)
--   - gms_prices.updated_by         : migration 20260428100000_gms_prices_updated_by.sql
--     (uuid references auth.users(id) on delete set null, nullable)
--
-- Idempotence : CREATE INDEX IF NOT EXISTS (forward-only, doctrine T-297).
-- =============================================================================

begin;

create index if not exists producer_invitations_created_by_idx
  on public.producer_invitations(created_by);

create index if not exists gms_prices_updated_by_idx
  on public.gms_prices(updated_by);

commit;
