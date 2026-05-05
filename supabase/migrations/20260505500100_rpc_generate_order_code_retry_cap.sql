-- =============================================================================
-- TerrOir — Audit RPC & Edge LOT 5 (M-4) — cap retry generate_order_code
-- =============================================================================
-- Date apply : 2026-05-05
-- Tracker version_id : 20260505154131 (apply via MCP apply_migration —
--                       préfixe 500100 pour s'intercaler après 500000).
-- Référence : docs/audits/audit-rpc-edge-2026-05-05.md (M-4)
-- Récap     : docs/fixes/fix-rpc-edge-2026-05-05.md
--
-- Avant : `loop ... exit when not exists_already; end loop` — boucle pure
-- infinie. Pas une vulnérabilité (espace = 32^5 = 33.5M codes), mais piège
-- de scalabilité : à 100K orders ~0.3% collision/INSERT, à 1M ~3%, à 10M
-- ~30% (boucles longues + contention). Aujourd'hui 17 orders : ROI faible
-- mais coût ~3 lignes SQL.
--
-- Après : FOR attempt IN 1..10 + RAISE EXCEPTION P0002 si saturation. Cap
-- arbitraire mais conservateur — 10 attempts à 33.5M codes = pratiquement
-- impossible à hit avant des dizaines de millions d'orders.
--
-- CREATE OR REPLACE (pas DROP+CREATE) pour préserver l'ACL exact actuelle
-- (`{postgres=X/postgres,service_role=X/postgres,supabase_auth_admin=X/postgres}`)
-- et éviter le piège du Lot 8 chantier Perf (DROP+CREATE qui a regrant
-- PUBLIC EXECUTE par défaut).
--
-- Apply via MCP apply_migration. Reconstitué pour cohérence repo↔prod.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.generate_order_code()
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  alphabet       constant text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  code_len       constant int  := 5;
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
$function$
