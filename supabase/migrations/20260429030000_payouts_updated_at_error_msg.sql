-- =============================================================================
-- TerrOir — payouts.updated_at + payouts.error_msg (T-426)
-- =============================================================================
-- Ajoute 2 colonnes manquantes flaggées pendant Bundle 2 PR 2b TC :
--   - updated_at timestamptz NOT NULL : standard d'audit. La table initiale
--                                       (20260419000000) ne l'avait pas alors
--                                       que disputes / gms_prices / slot_rules
--                                       l'ont. Trigger auto via fonction
--                                       transverse public.set_updated_at()
--                                       (1ère table à l'utiliser, à réutiliser
--                                       pour les futures tables).
--   - error_msg text NULL             : message d'erreur Stripe lors de
--                                       transitions vers statut='failed'.
--                                       Aujourd'hui stocké uniquement en
--                                       audit_logs.metadata.error_message
--                                       (jsonb), dénormalisation pour query
--                                       rapide. Posé par lib/stripe/payouts.tsx
--                                       (compensation A2 catch synchrone) et
--                                       lib/stripe/handle-payout-failed.tsx
--                                       (webhook payout.failed).
--
-- Pattern updated_at : add nullable -> backfill from created_at -> set NOT NULL
-- -> set default now(). Idempotent : rerun safe (ADD COLUMN IF NOT EXISTS,
-- WHERE updated_at IS NULL matches nothing post-backfill, SET NOT NULL/DEFAULT
-- no-op si déjà appliqué). Préserve le signal "dernière modif effective" pour
-- les rows ante-T-426 plutôt qu'écraser avec now() au déploiement.
--
-- Pas de reset error_msg lors UPDATE -> 'paid' (préserve historique forensique
-- audit, décision Q3 PUSH 1).
-- =============================================================================

begin;

-- 1. Colonne updated_at (nullable initialement pour permettre backfill idempotent).
alter table public.payouts
  add column if not exists updated_at timestamptz;

-- 2. Backfill : rows ante-T-426 ont updated_at IS NULL -> set = created_at.
--    Rerun safe : post-backfill, updated_at IS NULL ne matche plus aucune row.
update public.payouts
  set updated_at = created_at
  where updated_at is null;

-- 3. Lock NOT NULL + default now() (idempotent : no-op si déjà appliqué).
alter table public.payouts
  alter column updated_at set not null;
alter table public.payouts
  alter column updated_at set default now();

-- 4. Colonne error_msg (nullable, set uniquement aux transitions -> failed).
alter table public.payouts
  add column if not exists error_msg text;

-- 5. Fonction transverse set_updated_at() — réutilisable pour futures tables.
--    Avant cette migration, slot_rules avait sa propre fonction locale
--    (slot_rules_set_updated_at) parce qu'aucun helper transverse n'existait.
--    Décision T-426 : créer le helper transverse pour éviter le pattern
--    fonction-par-table. slot_rules n'est pas refacto dans cette migration
--    (chantier futur si pertinent).
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

-- 6. Trigger BEFORE UPDATE pour auto-set updated_at sur public.payouts.
drop trigger if exists payouts_set_updated_at on public.payouts;
create trigger payouts_set_updated_at
  before update on public.payouts
  for each row execute function public.set_updated_at();

-- 7. Comments doc inline.
comment on column public.payouts.updated_at is
  'Timestamp dernière modification (auto-set par trigger payouts_set_updated_at appelant public.set_updated_at). Backfill = created_at pour les rows ante-T-426.';

comment on column public.payouts.error_msg is
  'Message d''erreur Stripe lors d''une transition statut=''failed''. Set par lib/stripe/payouts.tsx (compensation A2 transfer.create catch) ou lib/stripe/handle-payout-failed.tsx (webhook payout.failed). Reste null sur paths success. Pas de reset lors UPDATE -> ''paid'' (préserve historique forensique).';

commit;
