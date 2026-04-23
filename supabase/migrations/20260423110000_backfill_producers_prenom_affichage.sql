-- =============================================================================
-- TerrOir — prenom_affichage producer
-- Migration B : backfill automatique depuis users.prenom du owner
-- =============================================================================
-- Idempotent : l'UPDATE filtre sur prenom_affichage IS NULL, donc une
-- relance après corrections manuelles n'écrase pas les valeurs posées
-- entre-temps. Les producers sans owner (user_id NULL après RGPD) ou dont
-- le owner a un prenom vide ne sont pas touchés ici : ils doivent être
-- corrigés manuellement avant la migration C (qui vérifie l'absence de
-- trous avant de poser le NOT NULL).
-- =============================================================================

begin;

update public.producers p
   set prenom_affichage = u.prenom
  from public.users u
 where p.user_id = u.id
   and p.prenom_affichage is null
   and u.prenom is not null
   and length(trim(u.prenom)) > 0;

commit;
