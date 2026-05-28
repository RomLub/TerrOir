-- Fixture test : colonne ajoutée sur une table HORS liste blanche (orders).
-- check-column-grants doit ignorer cette migration (zéro drift).
alter table public.orders add column if not exists fixture_unrelated_col text;
