-- Cluster C 2026-05-07 — retrait état 'ready' mort
-- ----------------------------------------------------------------------------
-- Contexte : doctrine "ready mort" CLAUDE.md. État jamais set par aucune route
-- en pratique (modèle 3 états réel : pending → confirmed → completed).
-- Cleanup pré-launch : zéro row 'ready' en prod (vérifié 2026-05-07 via
-- count(*) FROM orders WHERE statut='ready' = 0).
--
-- Forward-only idempotent : DROP IF EXISTS + ADD nouvelle constraint sans
-- 'ready' dans la whitelist. La colonne reste un text simple (pas un enum
-- Postgres), donc pas besoin de manipulation enum complexe.
--
-- Migration appliquée à la prod via MCP `apply_migration` 2026-05-07
-- (T6 cluster C). Smoke tests post-apply validés :
--   1. SELECT contraint définition : whitelist sans 'ready' OK
--   2. UPDATE statut='ready' sur row existante → CHECK violation OK (rejet)
--
-- IMPORTANT : ce fichier doit être committé pour rester forward-only en
-- sync avec le state DB. Le commit côté code (cleanup TS/TSX call sites
-- ready) a été interrompu par race git multi-terminaux 2026-05-07 — Romain
-- doit décider du chemin de remédiation (rollback DB OU reprise cluster C).

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_statut_check;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_statut_check
  CHECK (statut IN ('pending', 'confirmed', 'completed', 'cancelled', 'refunded'));
