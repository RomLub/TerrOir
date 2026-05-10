-- =============================================================================
-- TerrOir — F-033 (audit pré-launch 2026-05) — code_commande 5 → 7 chars
-- =============================================================================
-- Date : 2026-05-11
-- Référence : docs/AUDIT_PRELAUNCH_2026.md (F-033)
--
-- Contexte : `generate_order_code` produit aujourd'hui `TRR-XXXXX` (5 chars
-- sur l'alphabet 32-chars `23456789ABCDEFGHJKLMNPQRSTUVWXYZ`) → espace
-- 32^5 = 33.5M codes. Suffisant pour 17 orders en prod, MAIS pré-launch on
-- veut anticiper :
--   - 100K orders → ~0.3% collision/INSERT (boucle retry souvent),
--   - 1M orders   → ~3% collision/INSERT,
--   - 10M orders  → ~30% (cap retry M-4 saute en P0002).
-- Passer à 7 chars = 32^7 = 34.4 milliards de codes. Probabilité collision
-- pour 1M orders ≈ 0.003%, marge ~1000× confortable jusqu'à 100M+ orders.
--
-- Décisions :
--   - CREATE OR REPLACE (pas DROP+CREATE) → préserve ACL exacte de la
--     fonction (cf. doctrine cycle 06/05/2026 + piège Lot 8 chantier Perf).
--   - Garde le retry cap M-4 (10 attempts → P0002).
--   - Pas de migration des codes 5-chars existants (les orders prod
--     gardent leur code historique, c'est ok — unique sur la table).
--   - Préfixe `TRR-` inchangé.
--
-- CHECK constraint format : on ajoute un CHECK regex sur orders.code_commande
-- pour locker le format `TRR-[CHARSET]{5,7}` (5 = orders existants, 7 = nouveaux).
-- Idempotent : DROP CONSTRAINT IF EXISTS + ADD.
-- =============================================================================

create or replace function public.generate_order_code()
 returns text
 language plpgsql
 set search_path to 'public', 'pg_temp'
as $function$
declare
  alphabet       constant text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  code_len       constant int  := 7;
  max_attempts   constant int  := 10;
  candidate      text;
  i              int;
  attempt        int;
  exists_already boolean;
begin
  for attempt in 1..max_attempts loop
    candidate := 'TRR-';
    for i in 1..code_len loop
      candidate := candidate
        || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;

    select exists (select 1 from public.orders where code_commande = candidate)
      into exists_already;

    if not exists_already then
      return candidate;
    end if;
  end loop;

  raise exception 'Cannot generate unique order code after % attempts (table saturated?)', max_attempts
    using errcode = 'P0002';
end;
$function$;

-- CHECK format : whitelist alphabet + longueur 5 OU 7 (5 pour les codes
-- historiques, 7 pour les nouveaux). Idempotent.
alter table public.orders
  drop constraint if exists orders_code_commande_format_check;

alter table public.orders
  add constraint orders_code_commande_format_check
  check (code_commande ~ '^TRR-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{5,7}$');
