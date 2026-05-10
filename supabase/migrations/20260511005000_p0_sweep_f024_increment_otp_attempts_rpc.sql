-- =============================================================================
-- TerrOir — F-024 : RPC atomique increment_otp_attempts_if_below_cap
-- =============================================================================
-- Audit pré-launch 2026-05 (docs/AUDIT_PRELAUNCH_2026.md F-024). Le flow
-- verifyOtpAction (app/(consumer)/compte/profil/_actions/verify-otp.tsx)
-- exécute pour un code invalide :
--   1. SELECT row.attempts
--   2. UPDATE attempts = newAttempts (= row.attempts + 1)
--
-- Entre les deux, deux tentatives concurrentes lisent attempts=3, calculent
-- newAttempts=4 chacune, et incrémentent à 4 au lieu de 5. Lost update :
-- une attaque parallèle peut consommer plus de tentatives que le cap visible.
--
-- Cette migration pose une RPC SECDEF qui exécute l'increment+guard EN UN
-- SEUL STATEMENT SQL atomique :
--   UPDATE ... SET attempts = attempts + 1 WHERE id = X AND attempts < cap
--   RETURNING attempts;
--
-- Sémantique de retour :
--   • new_attempts non null → increment effectué, valeur post-increment.
--   • new_attempts null     → guard miss (attempts déjà >= cap au moment du
--                              UPDATE). Le caller doit traiter comme
--                              "max_attempts_reached" et invalider la row.
--
-- Doctrine T-295-bis : SECDEF + REVOKE EXECUTE PUBLIC/anon/authenticated +
-- GRANT EXECUTE service_role exclusivement. Le caller server action utilise
-- déjà admin client (service_role) — alignment naturel.
--
-- Idempotence (doctrine T-297) : CREATE OR REPLACE FUNCTION.
-- =============================================================================

create or replace function public.increment_otp_attempts_if_below_cap(
  p_row_id uuid,
  p_cap integer
)
returns table (new_attempts integer, consumed boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_new_attempts integer;
begin
  -- Increment atomique avec guard : UPDATE retourne 0 rows si attempts >= cap.
  update public.email_change_otp_codes
    set attempts = attempts + 1
    where id = p_row_id
      and attempts < p_cap
      and consumed_at is null
    returning attempts into v_new_attempts;

  -- Cas guard miss : la row existe peut-être encore mais attempts a été capé
  -- entre temps (ou la row a été consumed). On force l'invalidation defensive
  -- (consumed_at = now) si pas déjà consumed pour aligner avec le pre-check
  -- défensif du caller TS.
  if v_new_attempts is null then
    update public.email_change_otp_codes
      set consumed_at = now()
      where id = p_row_id
        and consumed_at is null;
    return query select null::integer, true;
    return;
  end if;

  -- Si l'increment a atteint le cap pile : consume la row en même temps pour
  -- garantir qu'une retentative suivante tombe dans le branch "no_active".
  if v_new_attempts >= p_cap then
    update public.email_change_otp_codes
      set consumed_at = now()
      where id = p_row_id;
    return query select v_new_attempts, true;
    return;
  end if;

  -- Increment normal, row pas consumed.
  return query select v_new_attempts, false;
end;
$$;

revoke execute on function public.increment_otp_attempts_if_below_cap(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.increment_otp_attempts_if_below_cap(uuid, integer)
  to service_role;

comment on function public.increment_otp_attempts_if_below_cap(uuid, integer) is
  'F-024 P0 sweep — Increment atomique attempts avec guard cap en un seul UPDATE. Élimine la race read-then-write du flow verifyOtpAction. SECDEF service_role only.';
