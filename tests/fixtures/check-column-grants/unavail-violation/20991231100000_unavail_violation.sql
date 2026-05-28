-- Fixture test : colonne ajoutée à `unavailabilities` sans GRANT ni whitelist.
-- check-column-grants doit détecter un drift (exit 1) sur cette migration.
alter table public.unavailabilities add column if not exists fixture_unavail_violation_col text;
