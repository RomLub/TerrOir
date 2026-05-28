-- Fixture test : colonne ajoutée à `producers` sans GRANT ni whitelist.
-- check-column-grants doit détecter un drift (exit 1) sur cette migration.
alter table public.producers add column if not exists fixture_violation_col text;
