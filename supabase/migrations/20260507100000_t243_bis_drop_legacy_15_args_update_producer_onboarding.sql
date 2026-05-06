-- =============================================================================
-- TerrOir — T-243-bis : DROP signature legacy 15 args update_producer_onboarding
-- =============================================================================
-- Contexte : la migration T-243 (20260506202622) a posé la signature 16-args
-- (avec p_enums_version) sans dropper la 15-args (T-241) pour eviter une
-- fenetre incompatibilite migration apply <-> deploiement code.
--
-- A 2026-05-07, le caller unique (app/(producer)/invitation/_actions/
-- complete-onboarding.ts ligne 147) appelle la 16-args en passant
-- SCORE_CARBONE_ENUMS_VERSION. Aucun autre call site ne reference la 15-args.
-- La signature legacy peut etre droppee.
--
-- Note timestamp : applique 2026-05-06 22:28:45 via mcp__supabase__apply_migration
-- (timestamp serveur). Trace locale postee dans le slot Teammate A
-- 20260507100000 pour conserver l'ordre logique du chantier 2026-05-07
-- post-Agent Teams. Aucun impact technique (la migration est deja enregistree
-- en prod sous timestamp 20260506222845, ce fichier est purement
-- documentaire forward-only et sera ignore par tout `supabase db push`
-- ulterieur car la version distante est deja > a celle d'ici).
--
-- Convention idempotence T-297 : DROP FUNCTION IF EXISTS avec signature
-- precise (postgres ne dispatch pas par nom seul quand 2 signatures coexistent).
--
-- Smoke test post-apply (2026-05-07 db-state) :
--   SELECT proname, pg_get_function_identity_arguments(oid), pronargs
--   FROM pg_proc WHERE proname = 'update_producer_onboarding';
--   -> 1 row, pronargs = 16, p_enums_version present. OK.
-- =============================================================================

drop function if exists public.update_producer_onboarding(
  uuid, text, text, text, text, text, text, text, text, text, text, text, text, boolean, text
);
