-- =============================================================================
-- TerrOir — élargissement enum payouts.statut
-- =============================================================================
-- Ajoute 'processing' et 'failed' au CHECK existant pour permettre :
--   - 'processing' : T-414, séquence INSERT-before-transfer (le row est créé
--                    avant l'appel stripe.transfers.create, statut='processing',
--                    puis UPDATE 'paid' après succès / 'failed' après échec).
--   - 'failed'     : T-401, handlers webhook transfer.failed et payout.failed
--                    posent statut='failed' pour signaler l'échec d'un virement
--                    Stripe Connect → banque producteur.
--
-- Modèle final : pending → processing → paid (succès) / failed (échec).
-- 'pending' devient un statut vestige (rows historiques pré-T-414) ; conservé
-- pour rétro-compatibilité.
--
-- Idempotent : drop dynamique de la contrainte quel que soit son nom actuel
-- (Postgres nomme par défaut les CHECK inline `{table}_{column}_check`, mais
-- on ne se fie pas à cette convention — on cible par définition textuelle).
-- Pattern aligné sur 20260421300000_producer_statut_draft_public.sql.
--
-- Cette migration n'impacte AUCUN code applicatif ni policy RLS. Les call
-- sites actuels (lib/stripe/payouts.ts INSERT 'pending', webhook UPDATE
-- 'paid', revenus/page.tsx READ) continuent de fonctionner à l'identique.
-- L'enum élargi sera CONSOMMÉ par T-401 (bundle 3 webhook events) et T-414
-- (PR 2b TC ultérieure).
--
-- Validation rétroactive : ('pending', 'paid') ⊂ ('pending', 'processing',
-- 'paid', 'failed') → aucune ligne existante ne peut violer la nouvelle CHECK.
-- =============================================================================

begin;

-- 1. Drop toute contrainte CHECK sur public.payouts qui référence `statut`
do $$
declare
  c_name text;
begin
  for c_name in
    select conname
    from pg_constraint
    where conrelid = 'public.payouts'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%statut%'
  loop
    execute format('alter table public.payouts drop constraint %I', c_name);
  end loop;
end $$;

-- 2. Ajouter la nouvelle contrainte avec les 4 statuts cibles
alter table public.payouts
  add constraint payouts_statut_check
  check (statut in ('pending', 'processing', 'paid', 'failed'));

-- 3. Documenter l'enum côté SQL pour traçabilité (consigne projet : zéro
--    dette doc inline)
comment on column public.payouts.statut is
  'État du virement vers le producteur : pending (créé, en file d''attente cron) → processing (transfer Stripe en cours, T-414) → paid (transfert réussi, webhook payout.paid) / failed (échec virement, webhook transfer.failed/payout.failed, T-401).';

commit;
