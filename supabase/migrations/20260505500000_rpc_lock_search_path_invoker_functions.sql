-- =============================================================================
-- TerrOir — Audit RPC & Edge LOT 4 (M-3) — defense-in-depth search_path
-- =============================================================================
-- Date apply : 2026-05-05
-- Tracker version_id : 20260505154054 (apply via MCP apply_migration —
--                       le filename utilise le préfixe sémantique 500000 pour
--                       s'intercaler après le chantier Migrations 400xxx,
--                       convention projet déjà adoptée — cf. 100xxx RLS,
--                       200xxx Auth, 300xxx Perf, 400xxx Migrations).
-- Référence : docs/audits/audit-rpc-edge-2026-05-05.md (M-3)
-- Récap     : docs/fixes/fix-rpc-edge-2026-05-05.md
--
-- Verrouille `search_path = public, pg_temp` sur les 6 fonctions custom du
-- schéma public actuellement déclarées sans config search_path. Toutes sont
-- SECURITY INVOKER (vérifié 2026-05-05 : prosecdef=false), donc le risque
-- d'élévation de privilèges via injection de schéma est aujourd'hui nul. Le
-- but est purement défense-en-profondeur : si un futur ALTER passe l'une
-- d'elles en SECURITY DEFINER (par ex. pour bypass RLS sur un trigger),
-- l'absence de search_path créerait alors une faille immédiate.
--
-- ALTER FUNCTION SET search_path est non destructif : ne touche pas l'ACL,
-- ne reset pas les triggers attachés, ne casse pas les references.
--
-- Apply via MCP apply_migration. Reconstitué pour cohérence repo↔prod
-- (pattern documenté chantiers RLS+Auth+Perf+Migrations).
-- =============================================================================

ALTER FUNCTION public.compute_order_commission()      SET search_path = public, pg_temp;
ALTER FUNCTION public.enforce_user_exclusive()        SET search_path = public, pg_temp;
ALTER FUNCTION public.set_order_code()                SET search_path = public, pg_temp;
ALTER FUNCTION public.set_updated_at()                SET search_path = public, pg_temp;
ALTER FUNCTION public.slot_rules_set_updated_at()     SET search_path = public, pg_temp;
ALTER FUNCTION public.generate_order_code()           SET search_path = public, pg_temp;
