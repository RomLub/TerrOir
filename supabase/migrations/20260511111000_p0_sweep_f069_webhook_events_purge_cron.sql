-- =============================================================================
-- TerrOir — F-069 (audit P0 sweep low-info 2026-05-11) : purge pg_cron
--           mensuelle de webhook_events_processed (rows > 60 jours)
-- =============================================================================
-- Contexte : table webhook_events_processed (migration 20260429000000_*)
-- accumule un row par event Stripe traité (dédup applicative anti-rejouage).
-- Commentaire originel : "Pas de purge automatique dans ce chantier. À traiter
-- en chantier dédié futur si volume devient significatif." On lève la dette
-- avant ouverture Live : pose d'un cron mensuel idempotent.
--
-- Rétention 60 jours :
--   - Stripe retry automatique : ~3 jours max (exponential backoff).
--   - Stripe Dashboard "Resend event" : possible jusqu'à 30 jours.
--   - Marge x2 → 60 jours = safe contre tout rejouage légitime.
--   - Au-delà, un rejouage manuel par admin Stripe sera traité comme
--     un nouvel event (effet de bord rejoué). Acceptable car cas hors
--     workflow normal.
--
-- Colonne `created_at` : la migration originelle nomme la colonne
-- `processed_at` (timestamptz not null default now()). On filtre dessus
-- (correction par rapport au stub du brief qui mentionnait created_at).
--
-- pg_cron : extension dispo Supabase mais NON installée par défaut sur
-- ce projet (cf. list_extensions 2026-05-11). On la crée si absente.
-- IMPORTANT : sur Supabase managé, pg_cron doit aussi être activé via
-- le Dashboard (Database → Extensions → pg_cron → Enable) côté UI pour
-- bénéficier du worker. Si le CREATE EXTENSION ci-dessous échoue avec
-- "permission denied" ou "extension not allowed", activer manuellement
-- via le Dashboard puis re-apply cette migration.
--
-- Idempotence :
--   - CREATE EXTENSION IF NOT EXISTS
--   - cron.schedule() insère dans cron.job ; pour rendre l'opération
--     idempotente on unschedule d'abord le job homonyme (no-op s'il
--     n'existe pas, géré par le bloc DO).
-- =============================================================================

begin;

-- Activation idempotente de l'extension (no-op si déjà installée).
-- Schema 'extensions' par convention Supabase (mais pg_cron s'auto-installe
-- généralement dans le schema 'cron'). On laisse Postgres choisir.
create extension if not exists pg_cron;

-- Unschedule défensif (idempotence). Le DO block évite l'erreur si le job
-- n'existe pas encore lors du premier apply.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'purge-webhook-events-processed') then
    perform cron.unschedule('purge-webhook-events-processed');
  end if;
end
$$;

-- Schedule : 1er du mois à 03:00 UTC (off-peak).
select cron.schedule(
  'purge-webhook-events-processed',
  '0 3 1 * *',
  $$ delete from public.webhook_events_processed where processed_at < now() - interval '60 days' $$
);

commit;
