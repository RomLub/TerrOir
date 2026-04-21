-- =============================================================================
-- TerrOir — élargissement des statuts producteur
-- =============================================================================
-- Ajoute 'draft' (formulaire en cours) et 'public' (visible sur le site) au
-- CHECK existant. Modèle final :
--   draft → pending → active → public → (suspended)
--
-- Idempotent : drop dynamique de la contrainte quel que soit son nom actuel
-- (Postgres nomme par défaut les CHECK inline `{table}_{column}_check`, mais
-- on ne se fie pas à cette convention — on cible par définition textuelle).
--
-- Cette migration n'impacte AUCUN code applicatif ni policy RLS. Les pages
-- publiques continuent de filtrer sur statut = 'active' (Phase 6 fera la
-- bascule vers 'public').
-- =============================================================================

begin;

-- 1. Drop toute contrainte CHECK sur public.producers qui référence `statut`
do $$
declare
  c_name text;
begin
  for c_name in
    select conname
    from pg_constraint
    where conrelid = 'public.producers'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%statut%'
  loop
    execute format('alter table public.producers drop constraint %I', c_name);
  end loop;
end $$;

-- 2. Ajouter la nouvelle contrainte avec les 5 statuts cibles
alter table public.producers
  add constraint producers_statut_check
  check (statut in ('draft', 'pending', 'active', 'public', 'suspended'));

commit;
