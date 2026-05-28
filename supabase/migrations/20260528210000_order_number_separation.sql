-- =============================================================================
-- TerrOir — Séparation `code_commande` (preuve de remise) vs identifiant
-- neutre `numero_commande` (affichage côté producteur). ADR-0015.
-- =============================================================================
-- Contexte : `code_commande` (TRR-XXXXX) a vocation de preuve : le client
-- le présente au producteur au moment du retrait, le producteur vérifie
-- (RPC `complete_pickup_by_producer`). Mais ce code était jusqu'ici affiché
-- côté producteur sur 7 surfaces avant la remise, invalidant la preuve.
--
-- Cette migration introduit un identifiant **producteur-affichable** distinct,
-- au format `PPPP-CCCCC` (4 chiffres producteur + 5 chiffres séquentiel
-- commande par producteur, ex. 0042-00128 = 128ᵉ commande du producteur 0042).
--
-- Décisions clés (ADR-0015) :
--   1. Le segment producteur est un séquentiel d'inscription (int, sequence
--      Postgres dédiée). 4 chiffres aujourd'hui ; format extensible par
--      lettres à terme via colonne supplémentaire si besoin.
--   2. Le segment commande est un séquentiel PAR producteur, stocké en
--      colonne brute `orders.producer_order_seq` (INT). La composition
--      `PPPP-CCCCC` se fait côté code (et côté SQL pour la RPC dashboard).
--   3. Pour garantir l'unicité du séquentiel commande sans race condition :
--      compteur centralisé `producers.next_order_seq`, incrémenté
--      atomiquement via UPDATE...RETURNING dans un trigger BEFORE INSERT
--      sur orders. Le pattern UPDATE...RETURNING acquiert un row lock sur
--      producers, ce qui sérialise les INSERTs concurrents pour le même
--      producteur sans bloquer les autres.
--   4. Contrainte UNIQUE (producer_id, producer_order_seq) = filet de sécu.
--
-- Risque deadlock : nul. Ordre des locks dans le checkout (RPC
-- `create_order_with_items`) : slot → products → producer (via ce trigger).
-- Aucun autre flow connu n'enchaîne lock producer puis lock slot/orders.
--
-- ⚠️ ADDITIVE / FORWARD-ONLY : colonnes nullables au début, triggers en
-- place, backfill dans la même transaction (1 fichier = 1 transaction
-- implicite côté Supabase migration), puis NOT NULL + UNIQUE. Le code
-- déployé continue de lire `code_commande` sans souci pendant la fenêtre
-- entre apply et merge. Applicable AVANT merge via MCP.
--
-- Note : la migration MODIFIANT la RPC `get_producer_dashboard` (qui change
-- la SHAPE du payload — non additif) vit dans un fichier séparé et est
-- appliquée APRÈS le déploiement du code consommateur (cf. ADR-0015 § Deploy).
-- =============================================================================

-- 1. producer_number sur producers ----------------------------------------------

create sequence if not exists public.producer_number_seq;

alter table public.producers
  add column if not exists producer_number int;

create or replace function public.assign_producer_number()
returns trigger
language plpgsql
as $$
begin
  if new.producer_number is null then
    new.producer_number := nextval('public.producer_number_seq');
  end if;
  return new;
end $$;

drop trigger if exists producers_assign_number on public.producers;
create trigger producers_assign_number
  before insert on public.producers
  for each row execute function public.assign_producer_number();

-- Backfill : affecte producer_number aux producteurs existants dans l'ordre
-- created_at ASC (tie-break id pour stabilité). Données pré-launch, factices.
with ranked as (
  select id,
         row_number() over (order by created_at asc, id asc) as rn
  from public.producers
  where producer_number is null
)
update public.producers p
set producer_number = r.rn
from ranked r
where r.id = p.id;

-- Avancer la sequence pour les futurs INSERTs (post-backfill).
select setval(
  'public.producer_number_seq',
  greatest(1, coalesce((select max(producer_number) from public.producers), 0))
);

-- Lock NOT NULL + UNIQUE après backfill.
alter table public.producers
  alter column producer_number set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'producers_producer_number_unique'
      and conrelid = 'public.producers'::regclass
  ) then
    alter table public.producers
      add constraint producers_producer_number_unique unique (producer_number);
  end if;
end $$;

comment on column public.producers.producer_number is
  'Numéro séquentiel d''inscription (4 chiffres affichés, ex. 0042). '
  'Posé automatiquement par trigger BEFORE INSERT via la sequence '
  'public.producer_number_seq. Composant du numero_commande (ADR-0015).';

-- 2. next_order_seq sur producers (compteur pour orders) ------------------------

alter table public.producers
  add column if not exists next_order_seq int not null default 0;

comment on column public.producers.next_order_seq is
  'Compteur centralisé des commandes du producteur. Incrémenté atomiquement '
  'via UPDATE...RETURNING dans le trigger BEFORE INSERT sur orders, pour '
  'générer producer_order_seq sans race condition (ADR-0015).';

-- 3. producer_order_seq sur orders + trigger ------------------------------------

alter table public.orders
  add column if not exists producer_order_seq int;

create or replace function public.assign_producer_order_seq()
returns trigger
language plpgsql
as $$
declare
  v_next int;
begin
  if new.producer_order_seq is null then
    -- UPDATE...RETURNING : row lock sur producers, sérialise les INSERTs
    -- concurrents pour le même producer_id (cf. ADR-0015 § Concurrence).
    update public.producers
       set next_order_seq = next_order_seq + 1
     where id = new.producer_id
     returning next_order_seq into v_next;

    if v_next is null then
      raise exception 'Producer % introuvable lors de l''assignation de producer_order_seq', new.producer_id
        using errcode = '23503';
    end if;

    new.producer_order_seq := v_next;
  end if;
  return new;
end $$;

drop trigger if exists orders_assign_producer_seq on public.orders;
create trigger orders_assign_producer_seq
  before insert on public.orders
  for each row execute function public.assign_producer_order_seq();

-- Backfill orders : séquentiel par producteur dans l'ordre created_at ASC.
-- Données pré-launch, factices.
with ranked as (
  select id,
         row_number() over (
           partition by producer_id
           order by created_at asc, id asc
         ) as rn
  from public.orders
  where producer_order_seq is null
)
update public.orders o
set producer_order_seq = r.rn
from ranked r
where r.id = o.id;

-- Synchroniser next_order_seq sur producers (max des seq déjà posés).
update public.producers p
set next_order_seq = coalesce((
  select max(producer_order_seq)
  from public.orders
  where producer_id = p.id
), 0);

-- Lock NOT NULL + UNIQUE après backfill.
alter table public.orders
  alter column producer_order_seq set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'orders_producer_seq_unique'
      and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders
      add constraint orders_producer_seq_unique unique (producer_id, producer_order_seq);
  end if;
end $$;

comment on column public.orders.producer_order_seq is
  'Séquentiel commande par producteur (repart à 1 par producteur). Posé '
  'automatiquement par trigger BEFORE INSERT via UPDATE producers.next_order_seq '
  'RETURNING. Affichage côté code : PPPP-CCCCC = producer_number-producer_order_seq '
  '(cf. lib/orders/order-number.ts, ADR-0015).';
