-- =============================================================================
-- TerrOir — F-046 (audit pré-launch 2026-05) — index composite idempotence orders
-- =============================================================================
-- Date : 2026-05-11
-- Référence : docs/AUDIT_PRELAUNCH_2026.md (F-046)
--
-- Contexte : la création d'une order via la RPC create_order_with_items
-- inclut un check anti-doublon (même consumer + même slot + même date sur
-- les orders en pending). Le check est aujourd'hui un SELECT plein scan
-- partiel filtré sur statut='pending'. À mesure que la table orders grossit
-- (et que les pending résiduels traînent), ce SELECT scanne plus de rows
-- que nécessaire.
--
-- Index composite partiel : (consumer_id, slot_id, date_retrait, created_at DESC)
-- WHERE statut='pending'. Ciblé sur le sous-ensemble actif pour le check
-- idempotence. La colonne `created_at DESC` permet aussi d'optimiser un
-- éventuel SELECT du plus récent pending pour ce trio (utile si on évolue
-- vers une stratégie "renvoyer le pending existant" plutôt qu'erreur).
--
-- Idempotent : IF NOT EXISTS.
-- =============================================================================

create index if not exists orders_dedup_idx
  on public.orders (consumer_id, slot_id, date_retrait, created_at desc)
  where statut = 'pending';
