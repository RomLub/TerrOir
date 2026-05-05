-- =============================================================================
-- Reconstitution de migration apply via MCP — 2026-05-05
-- =============================================================================
-- Apply effectué via MCP apply_migration avant création de ce fichier —
-- version_id auto-généré 20260505120505. Ce fichier reconstitue le SQL
-- pour cohérence repo ↔ prod (finding MEDIUM-4 audit RLS).
--
-- Référence audit : docs/audits/audit-rls-2026-05-05.md MEDIUM-4
-- Préfixe local 20260505200100 choisi pour conserver l'ordre chronologique
-- des LOTS audit du jour (20260505100000-100400) tout en signalant via
-- l'écart de saut (200xxx) le caractère reconstitué post-apply. Posé après
-- 20260505200000 pour respecter l'ordre temporel d'apply MCP (115433 puis
-- 120505).
-- =============================================================================

-- =============================================================================
-- Audit RLS 2026-05-05 — finding MEDIUM-4 (rate-limit DB producer_interests)
-- Référence : docs/audits/audit-rls-2026-05-05.md MEDIUM-4
--
-- Trigger BEFORE INSERT qui rejette toute insertion >= 3e tentative pour
-- le même email sur 24h glissantes. Pas de tracking IP (évite ajout de
-- colonne RGPD-sensible). errcode = 23P01 (check_violation) — distinct
-- du 23505 (unique_violation) déjà levé par la contrainte UNIQUE(email),
-- permet au handler Next.js de distinguer les deux cas via err.code.
--
-- Nota : avec UNIQUE(email) déjà en place (cf. 20260428300000), seul
-- 1 INSERT par email réussit en pratique. Le seuil 3 est defense-in-
-- depth si la contrainte UNIQUE est un jour relâchée (multi-leads par
-- email) ou si un attaquant fait varier la casse pour spammer (le
-- trigger applique lower() — la casse ne contourne pas).
--
-- SECURITY DEFINER + search_path verrouillé : pattern projet (cf. les 12
-- autres SD du schéma public). Non appelable directement (REVOKE
-- EXECUTE FROM public) — le déclenchement se fait uniquement via le
-- trigger BEFORE INSERT.
-- =============================================================================

create or replace function public.check_producer_interests_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count int;
begin
  select count(*) into v_count
  from public.producer_interests
  where lower(email) = lower(new.email)
    and created_at > now() - interval '24 hours';

  if v_count >= 3 then
    raise exception 'Rate limit exceeded: too many inserts for this email in the last 24 hours'
      using errcode = '23P01',
            hint = 'producer_interests_rate_limit';
  end if;

  return new;
end;
$$;

revoke execute on function public.check_producer_interests_rate_limit() from public;

create trigger trg_producer_interests_rate_limit
  before insert on public.producer_interests
  for each row execute function public.check_producer_interests_rate_limit();
