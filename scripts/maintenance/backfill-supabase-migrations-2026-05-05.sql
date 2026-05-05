-- =============================================================================
-- TerrOir — Backfill supabase_migrations.schema_migrations (one-shot)
-- =============================================================================
-- Date          : 2026-05-05
-- Auteur        : finition fix RLS (cf. docs/fixes/fix-rls-2026-05-05.md)
-- Type          : SCRIPT DE MAINTENANCE — PAS UNE MIGRATION.
-- Emplacement   : scripts/maintenance/ (volontairement hors supabase/migrations/
--                 pour ne JAMAIS être re-joué par `supabase migration up`).
-- À exécuter    : UNE FOIS via Supabase Studio SQL Editor (session admin)
--                 par Romain, AVANT d'apply les migrations du fix RLS lots
--                 1+2 / 3+4 / 5 / 7 / 8.
--
-- Objectif :
-- L'audit RLS du 2026-05-05 (finding LOW-5) a constaté que la table
-- supabase_migrations.schema_migrations ne tracke que 15 entrées sur 50
-- fichiers présents dans supabase/migrations/. Les ~35 entrées manquantes
-- correspondent à des migrations apply directement via SQL Editor sans
-- passer par `supabase migration up` — leur effet schéma est en prod, mais
-- la table d'historique est désynchronisée.
--
-- Conséquence runtime : aucune (Supabase n'utilise schema_migrations qu'au
-- moment d'un `supabase migration up --linked` pour décider quelles
-- migrations apply). Conséquence tooling : `supabase migration list --linked`
-- montrerait à tort les 35 entrées comme « to be applied » et tenterait de
-- les rejouer (échec assuré : les CREATE TABLE / ALTER existeraient déjà).
--
-- Cas particuliers — drift de version_id (3 entrées hors-périmètre) :
-- Trois migrations apply via SQL Editor ont été tracées sous un version_id
-- différent du préfixe du fichier local :
--   - File 20260501231300_t102_1_refund_incidents              → tracked 20260501231515
--   - File 20260502064800_t102_2b_record_refund_attempt_rpc    → tracked 20260502065402
--   - File 20260503100000_t200_score_carbone                   → tracked 20260503014338
--                                                                (name suffix _bien_etre en plus)
-- Ces 3 entrées NE SONT PAS BACKFILLÉES ici : leur contenu est déjà tracé
-- (sous un version_id divergent). Pour aligner proprement, il faudrait soit :
--   (a) DELETE le row drift + INSERT avec le version_id du fichier ;
--   (b) renommer le fichier local pour matcher le version_id tracé.
-- Décision laissée à Romain — anomalie cosmétique, pas bloquante. Pas de SQL
-- ici, juste documentation dans docs/fixes/fix-rls-2026-05-05.md.
--
-- T-241 (20260504100000_t241_declaration_veracite_persistance) NE FIGURE PAS
-- dans le backfill : la migration n'a pas encore été appliquée en prod (cf.
-- audit MEDIUM-3). Elle sera tracée naturellement à son 1er apply (via SQL
-- Editor — supabase_migrations sera mise à jour si l'apply utilise
-- `supabase migration up --linked`, sinon Romain insèrera manuellement à
-- ce moment-là).
--
-- Recommandation forward-looking :
-- À partir de cette session, adopter `supabase migration up --linked` pour
-- TOUTE nouvelle migration. Cela synchronisera automatiquement :
--   - schema (DDL apply en prod)
--   - schema_migrations (entrée auto-insérée)
--   - lock file local (.supabase/migrations/...)
-- Le SQL Editor reste possible pour les hotfixes, mais doit être suivi d'un
-- INSERT manuel dans schema_migrations le même jour pour éviter le re-drift.
--
-- Idempotence : ON CONFLICT (version) DO NOTHING — re-run safe (no-op après
-- le 1er passage).
--
-- Rollback : `DELETE FROM supabase_migrations.schema_migrations WHERE version
-- IN ('20260421300000', '20260421400000', ..., '20260430030000');` — n'affecte
-- pas le schéma applicatif, seulement la table de tracking.
-- =============================================================================

-- Sanity check : la table doit exister avec les colonnes attendues. Le SELECT
-- échoue si le schéma a changé, signalant qu'il faut re-vérifier le format.
do $$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'supabase_migrations'
      and table_name = 'schema_migrations'
  ) then
    raise exception 'Table supabase_migrations.schema_migrations introuvable. Vérifier la version Supabase.';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'supabase_migrations'
      and table_name = 'schema_migrations'
      and column_name = 'version'
  ) then
    raise exception 'Colonne version manquante. Schéma supabase_migrations modifié — refaire l''audit avant backfill.';
  end if;
end
$$;

-- Backfill des 35 entrées (préfixes de fichiers présents dans
-- supabase/migrations/ mais absents de schema_migrations au 2026-05-05).
-- created_by : marqueur explicite pour identifier ces rows en cas de
-- diagnostic futur (un future `supabase migration list --linked` les
-- groupera proprement).
insert into supabase_migrations.schema_migrations (version, name, created_by)
values
  ('20260421300000', 'producer_statut_draft_public',                          'manual_backfill_2026-05-05'),
  ('20260421400000', 'producers_forme_juridique_type_production',             'manual_backfill_2026-05-05'),
  ('20260421500000', 'producers_admin_rls_policy',                            'manual_backfill_2026-05-05'),
  ('20260422000000', 'producer_public_filtering',                             'manual_backfill_2026-05-05'),
  ('20260422100000', 'storage_policies_for_producers',                        'manual_backfill_2026-05-05'),
  ('20260422200000', 'rgpd_account_deletion',                                 'manual_backfill_2026-05-05'),
  ('20260422300000', 'slot_rules_and_materialized_slots',                     'manual_backfill_2026-05-05'),
  ('20260422310000', 'add_stripe_customer_id_to_users',                       'manual_backfill_2026-05-05'),
  ('20260422400000', 'slots_adhoc_and_exceptions',                            'manual_backfill_2026-05-05'),
  ('20260422500000', 'slots_capacity_check_in_order_rpc',                     'manual_backfill_2026-05-05'),
  ('20260422600000', 'producer_interests_admin_delete',                       'manual_backfill_2026-05-05'),
  ('20260422700000', 'rename_slots_actif_to_active',                          'manual_backfill_2026-05-05'),
  ('20260423000000', 'rename_products_actif_to_active',                       'manual_backfill_2026-05-05'),
  ('20260423100000', 'add_conseil_and_prenom_affichage_nullable',             'manual_backfill_2026-05-05'),
  ('20260423110000', 'backfill_producers_prenom_affichage',                   'manual_backfill_2026-05-05'),
  ('20260423120000', 'set_producers_prenom_affichage_not_null',               'manual_backfill_2026-05-05'),
  ('20260423130000', 'prevent_self_ordering',                                 'manual_backfill_2026-05-05'),
  ('20260424000000', 'producers_stripe_connect_flags',                        'manual_backfill_2026-05-05'),
  ('20260426000000', 'add_source_to_producer_interests',                      'manual_backfill_2026-05-05'),
  ('20260427000000', 'add_prenom_to_producer_interests',                      'manual_backfill_2026-05-05'),
  ('20260427100000', 'create_audit_logs',                                     'manual_backfill_2026-05-05'),
  ('20260427200000', 'restore_stock_on_order_cancel',                         'manual_backfill_2026-05-05'),
  ('20260427300000', 'revive_order_with_stock_check',                         'manual_backfill_2026-05-05'),
  ('20260428000000', 'gms_prices',                                            'manual_backfill_2026-05-05'),
  ('20260428100000', 'gms_prices_updated_by',                                 'manual_backfill_2026-05-05'),
  ('20260428200000', 'product_stock_alerts',                                  'manual_backfill_2026-05-05'),
  ('20260428300000', 'producer_interests_unique_email',                       'manual_backfill_2026-05-05'),
  ('20260429000000', 'webhook_events_processed',                              'manual_backfill_2026-05-05'),
  ('20260429010000', 'payouts_statut_enum_extend',                            'manual_backfill_2026-05-05'),
  ('20260429020000', 'disputes_table',                                        'manual_backfill_2026-05-05'),
  ('20260429030000', 'payouts_updated_at_error_msg',                          'manual_backfill_2026-05-05'),
  ('20260430000000', 't413_rename_cancellation_reason_to_closure_reason',     'manual_backfill_2026-05-05'),
  ('20260430010000', 't434_create_order_rpc_distinct_errors',                 'manual_backfill_2026-05-05'),
  ('20260430020000', 't438_encoding_utf8_rpc_comments',                       'manual_backfill_2026-05-05'),
  ('20260430030000', 't448_p0001_wording',                                    'manual_backfill_2026-05-05')
on conflict (version) do nothing;

-- Vérification post-backfill : doit retourner 50 rows (15 pré-existants +
-- 35 nouveaux). Les 3 cas drift sont comptés sur leur version_id divergent.
-- Si T-241 a été apply entre-temps, le compte sera 51.
select count(*) as total_tracked
from supabase_migrations.schema_migrations;

-- Listing exhaustif post-backfill (ordre chrono) — utile pour Romain pour
-- visualiser l'état final avant d'apply les nouvelles migrations du fix RLS.
select version, name, created_by
from supabase_migrations.schema_migrations
order by version;
