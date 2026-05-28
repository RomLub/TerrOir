-- Fixture CLI : reproduit le layout `<cwd>/supabase/migrations/` attendu
-- par `scripts/check-column-grants.ts` quand on tape `npm run check:column-grants`.
-- La migration ajoute une colonne sur `producers` sans GRANT ni whitelist,
-- donc le script doit sortir en exit code 1.
alter table public.producers add column if not exists fixture_violation_col text;
