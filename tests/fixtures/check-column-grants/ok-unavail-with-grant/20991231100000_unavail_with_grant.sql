-- Fixture test : colonne ajoutée à `unavailabilities` AVEC GRANT SELECT explicite.
-- check-column-grants doit retourner zéro drift sur cette migration.
alter table public.unavailabilities add column if not exists fixture_public_col text;
grant select (fixture_public_col) on public.unavailabilities to anon, authenticated;
