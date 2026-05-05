-- =============================================================================
-- Audit perf-postgres-2026-05-05 — finding M-3
-- =============================================================================
-- Apply effectué le 2026-05-05 via MCP apply_migration, version_id 20260505133654.
-- Reconstitué pour cohérence repo↔prod.
--
-- NB : l'ANALYZE manuel des 6 tables (procédé via execute_sql en parallèle de
-- cette migration) n'est pas reconstitué — un db reset local part d'une DB
-- vide donc le statisticien tourne déjà à neuf. Pour reproduire la séquence
-- exacte d'une DB live, lancer :
--   ANALYZE public.producers, public.users, public.orders,
--           public.producer_interests, public.slot_rules, public.email_change_otp_codes;
--
-- Resserre le seuil autovacuum/analyze sur les 6 tables OLTP à petite volumétrie.
-- Avec scale_factor=0.10 par défaut, une table de 10 rows requiert ~51 mods avant ANALYZE.
-- À 0.05, le seuil tombe à ~50 + 0.05*10 = ~50.5 (toujours dominé par le threshold fixe à 50).
-- L'effet réel devient mesurable quand la table grandit (à 1000 rows : 50 vs 100 mods).
-- Bénéfice immédiat : trace l'intention "table OLTP fortement updatée, planner doit suivre".
-- =============================================================================

ALTER TABLE public.email_change_otp_codes SET (autovacuum_analyze_scale_factor = 0.05);
ALTER TABLE public.producers              SET (autovacuum_analyze_scale_factor = 0.05);
ALTER TABLE public.users                  SET (autovacuum_analyze_scale_factor = 0.05);
ALTER TABLE public.orders                 SET (autovacuum_analyze_scale_factor = 0.05);
ALTER TABLE public.producer_interests     SET (autovacuum_analyze_scale_factor = 0.05);
ALTER TABLE public.slot_rules             SET (autovacuum_analyze_scale_factor = 0.05);
