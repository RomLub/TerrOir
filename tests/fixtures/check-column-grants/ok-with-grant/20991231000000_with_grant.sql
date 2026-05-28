-- Fixture test : colonne ajoutée à `producers` AVEC GRANT SELECT explicite.
-- check-column-grants doit retourner zéro drift sur cette migration.
alter table public.producers add column if not exists fixture_public_col text;
grant select (fixture_public_col) on public.producers to anon, authenticated;
