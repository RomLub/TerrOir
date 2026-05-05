-- =============================================================================
-- Reconstitution de migration apply via MCP — 2026-05-05
-- =============================================================================
-- Apply effectué via MCP apply_migration avant création de ce fichier —
-- version_id auto-généré 20260505115433. Ce fichier reconstitue le SQL
-- pour cohérence repo ↔ prod (finding NEW-1 audit RLS de régression).
--
-- Référence audit : docs/audits/audit-rls-regression-2026-05-05.md NEW-1
-- Préfixe local 20260505200000 choisi pour conserver l'ordre chronologique
-- des LOTS audit du jour (20260505100000-100400) tout en signalant via
-- l'écart de saut (200000) le caractère reconstitué post-apply.
-- =============================================================================

-- Audit RLS de régression 2026-05-05 — finding NEW-1
-- Référence : docs/audits/audit-rls-regression-2026-05-05.md NEW-1
--
-- Harmonise le search_path de update_producer_onboarding sur le pattern
-- 'public, pg_temp' utilisé par les 11 autres SECURITY DEFINER du projet.
-- Defense-in-depth : empêche le shadowing via pg_temp même si la fonction
-- est aujourd'hui service_role only (donc non exploitable en pratique).

ALTER FUNCTION public.update_producer_onboarding(
  uuid, text, text, text, text, text, text, text, text, text, text,
  text, text, boolean, text
) SET search_path = public, pg_temp;
