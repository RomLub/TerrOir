-- =============================================================================
-- TerrOir — prenom_affichage producer
-- Migration C : garde-fou d'intégrité + ALTER SET NOT NULL
-- =============================================================================
-- Lève une exception explicite si des producers non-supprimés n'ont pas de
-- prenom_affichage. Permet à Romain de voir le message dans le SQL Editor,
-- corriger les lignes à la main, puis relancer la migration (idempotente —
-- une fois le NOT NULL posé, l'ALTER est no-op).
--
-- Filtre deleted_at IS NULL : les producers anonymisés RGPD (statut='deleted')
-- ne bloquent pas. La RPC delete_user_account ne touche pas prenom_affichage,
-- donc leur valeur historique est préservée sans risque de fuite publique
-- (filtre RLS statut='public' les isole déjà des consumers).
-- =============================================================================

begin;

do $$
declare
  missing_count int;
begin
  select count(*) into missing_count
    from public.producers
   where deleted_at is null
     and (prenom_affichage is null
          or length(trim(prenom_affichage)) = 0);

  if missing_count > 0 then
    raise exception
      'Impossible de poser NOT NULL : % producer(s) sans prenom_affichage. Corriger en SQL puis relancer cette migration.',
      missing_count;
  end if;
end $$;

alter table public.producers
  alter column prenom_affichage set not null;

commit;
