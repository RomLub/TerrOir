-- =============================================================================
-- TerrOir — Cluster review_followup : marqueur DB déduplication cron J+2/J+7
-- =============================================================================
-- Contexte : le cron `app/api/cron/review-followup/route.tsx` envoie 2 emails
-- de relance (J+2 et J+7 post-completed) aux consumers n'ayant pas encore
-- posté de review. Aujourd'hui aucun marqueur DB ne garantit l'idempotence —
-- un re-run du cron (manuel via curl ou retry Vercel après échec) renvoie
-- les mêmes emails à un consumer qui n'a juste pas encore rédigé son avis.
-- L'absence de review n'est PAS un signal de dédup fiable (la fenêtre review
-- reste ouverte indéfiniment côté UX).
--
-- # Solution
--
-- Approche choisie : 2 colonnes nullable sur public.orders :
--   - review_followup_d2_sent_at TIMESTAMPTZ NULL
--   - review_followup_d7_sent_at TIMESTAMPTZ NULL
--
-- Le cron coche la colonne AVANT le sendTemplate (pattern check-then-update
-- via UPDATE ... WHERE col IS NULL ... RETURNING — race-safe, aligné T-100
-- pickup transition atomique). Si le cron crash entre coche et send, la
-- relance suivante skip — trade-off accepté : mieux 1 mail manqué qu'un
-- double-envoi (qui dégrade trust consumer plus que silence).
--
-- # Pourquoi pas table dédiée `review_followup_runs(order_id, kind, sent_at)`
--
-- 1. Volume négligeable : 1 row consumer × 2 events = 2 entrées max par
--    order. Pas de duplication multi-runs (l'idempotence est portée par
--    l'UPDATE conditionnel).
-- 2. Pas de jointure complexe nécessaire : le cron lit déjà orders + reviews,
--    1 ALTER TABLE ADD COLUMN évite de créer une nouvelle table + ses RLS
--    + ses index + son cleanup à 24 mois (cohérent doctrine
--    `audit-logs-retention.md`, sauf qu'orders elle-même n'est jamais purgée).
-- 3. Lecture admin /audit-logs intacte : le détail forensique reste dans
--    le cluster audit_logs `review_followup_*` (4 events), les colonnes ici
--    ne servent qu'à la dédup transactionnelle.
--
-- # Smoke tests post-apply (à exécuter via SQL Studio service_role)
--
-- (a) ALTER OK : SELECT column_name FROM information_schema.columns
--     WHERE table_schema='public' AND table_name='orders' AND
--     column_name LIKE 'review_followup_d%_sent_at' → 2 rows.
-- (b) Pose nominale : UPDATE orders SET review_followup_d2_sent_at=now()
--     WHERE id=$test_id AND review_followup_d2_sent_at IS NULL → 1 row affected.
-- (c) Idempotence : ré-exécuter (b) → 0 rows affected (skip path correct).
-- (d) Reset (cleanup test) : UPDATE orders
--     SET review_followup_d2_sent_at=NULL, review_followup_d7_sent_at=NULL
--     WHERE id=$test_id (service_role bypass RLS).
--
-- Convention idempotence T-297 : ALTER TABLE ADD COLUMN IF NOT EXISTS.
-- =============================================================================

alter table public.orders
  add column if not exists review_followup_d2_sent_at timestamptz;

alter table public.orders
  add column if not exists review_followup_d7_sent_at timestamptz;

comment on column public.orders.review_followup_d2_sent_at is
  'Marqueur dédup cron review-followup J+2 (cf. app/api/cron/review-followup). '
  'Posé AVANT sendTemplate via UPDATE ... WHERE col IS NULL — un re-run cron '
  'skip si la colonne est déjà set. NULL = pas encore envoyé. Cluster audit '
  'review_followup_* trace forensiquement les sent / skipped / dedup_blocked.';

comment on column public.orders.review_followup_d7_sent_at is
  'Marqueur dédup cron review-followup J+7 (idem D+2). NULL = pas encore '
  'envoyé. Pose conditionnelle race-safe.';
