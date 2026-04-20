-- =============================================================================
-- TerrOir — schema initial
-- =============================================================================
-- Hypothèse: les lignes dans public.users sont créées par l'application
-- au moment de l'inscription (copie du id + email depuis auth.users, puis
-- UPDATE des champs profil). Pas de trigger on_auth_user_created ici.
-- =============================================================================

create extension if not exists "pgcrypto";

-- =============================================================================
-- 1. TABLES
-- =============================================================================

-- users ------------------------------------------------------------------------
create table public.users (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  role        text check (role in ('consumer', 'producer', 'admin')),
  prenom      text,
  nom         text,
  telephone   text,
  sms_optin   boolean default false,
  created_at  timestamptz default now()
);

-- producers --------------------------------------------------------------------
create table public.producers (
  id                         uuid primary key default gen_random_uuid(),
  user_id                    uuid unique references public.users(id),
  slug                       text unique not null,
  nom_exploitation           text not null,
  siret                      text,
  adresse                    text,
  commune                    text,
  code_postal                text,
  latitude                   double precision,
  longitude                  double precision,
  description                text,
  histoire                   text,
  photo_principale           text,
  photos                     text[],
  annee_creation             int,
  generations                int,
  especes                    text[] check (
    especes <@ array['bovin', 'porcin', 'ovin']::text[]
  ),
  labels                     text[] check (
    labels <@ array['label_rouge', 'bio', 'aop', 'boeuf_fermier_maine']::text[]
  ),
  statut                     text default 'pending'
                             check (statut in ('pending', 'active', 'suspended')),
  abonnement_niveau          text check (
    abonnement_niveau in ('starter', 'pro', 'premium')
  ),
  abonnement_expire_at       timestamptz,
  stripe_account_id          text,
  badge_stock_score          double precision default 100,
  badge_confirmation_score   double precision default 100,
  badge_annulation_score     double precision default 100,
  created_at                 timestamptz default now()
);

-- products ---------------------------------------------------------------------
create table public.products (
  id                        uuid primary key default gen_random_uuid(),
  producer_id               uuid references public.producers(id) on delete cascade,
  nom                       text not null,
  description               text,
  photos                    text[],
  prix                      numeric(10, 2) not null,
  unite                     text check (unite in ('kg', 'piece', 'colis')),
  poids_estime_kg           double precision,
  stock_disponible          int default 0,
  stock_illimite            boolean default false,
  delai_preparation_jours   int default 0,
  actif                     boolean default true,
  created_at                timestamptz default now()
);

-- slots ------------------------------------------------------------------------
create table public.slots (
  id             uuid primary key default gen_random_uuid(),
  producer_id    uuid references public.producers(id) on delete cascade,
  jour_semaine   int check (jour_semaine between 0 and 6),
  heure_debut    time not null,
  heure_fin      time not null,
  actif          boolean default true
);

-- orders -----------------------------------------------------------------------
create table public.orders (
  id                           uuid primary key default gen_random_uuid(),
  consumer_id                  uuid references public.users(id),
  producer_id                  uuid references public.producers(id),
  statut                       text default 'pending' check (
    statut in ('pending', 'confirmed', 'ready', 'completed', 'cancelled', 'refunded')
  ),
  code_commande                text unique
                               check (code_commande is not null and code_commande <> ''),
  slot_id                      uuid references public.slots(id),
  date_retrait                 date,
  heure_retrait                time,
  montant_total                numeric(10, 2),
  commission_terroir           numeric(10, 2),
  montant_net_producteur       numeric(10, 2),
  stripe_payment_intent_id     text,
  notes_client                 text,
  created_at                   timestamptz default now(),
  confirmed_at                 timestamptz,
  completed_at                 timestamptz,
  cancelled_at                 timestamptz
);

-- order_items ------------------------------------------------------------------
create table public.order_items (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid references public.orders(id) on delete cascade,
  product_id      uuid references public.products(id),
  quantite        numeric(10, 3) not null,
  prix_unitaire   numeric(10, 2) not null,
  sous_total      numeric(10, 2) not null
);

-- reviews ----------------------------------------------------------------------
create table public.reviews (
  id             uuid primary key default gen_random_uuid(),
  order_id       uuid unique references public.orders(id),
  consumer_id    uuid references public.users(id),
  producer_id    uuid references public.producers(id),
  note           int check (note between 1 and 5),
  commentaire    text,
  statut         text default 'pending'
                 check (statut in ('pending', 'published', 'rejected')),
  created_at     timestamptz default now(),
  published_at   timestamptz
);

-- payouts ----------------------------------------------------------------------
create table public.payouts (
  id                uuid primary key default gen_random_uuid(),
  producer_id       uuid references public.producers(id),
  periode_debut     date,
  periode_fin       date,
  montant_brut      numeric(10, 2),
  commission        numeric(10, 2),
  montant_net       numeric(10, 2),
  stripe_payout_id  text,
  statut            text default 'pending' check (statut in ('pending', 'paid')),
  created_at        timestamptz default now()
);

-- notifications ----------------------------------------------------------------
create table public.notifications (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references public.users(id),
  type         text check (type in ('email', 'sms')),
  template     text not null,
  statut       text default 'sent' check (statut in ('sent', 'failed')),
  metadata     jsonb,
  created_at   timestamptz default now()
);

-- producer_interests -----------------------------------------------------------
create table public.producer_interests (
  id                  uuid primary key default gen_random_uuid(),
  nom                 text not null,
  email               text not null,
  telephone           text,
  nom_exploitation    text,
  commune             text,
  especes             text[],
  message             text,
  statut              text default 'new'
                      check (statut in ('new', 'contacted', 'onboarded')),
  created_at          timestamptz default now()
);

-- =============================================================================
-- 2. INDEXES
-- =============================================================================

create index producers_statut_idx         on public.producers (statut);
create index producers_created_at_idx     on public.producers (created_at);

create index products_producer_id_idx     on public.products (producer_id);
create index products_actif_idx           on public.products (actif);
create index products_created_at_idx      on public.products (created_at);

create index slots_producer_id_idx        on public.slots (producer_id);

create index orders_consumer_id_idx       on public.orders (consumer_id);
create index orders_producer_id_idx       on public.orders (producer_id);
create index orders_statut_idx            on public.orders (statut);
create index orders_slot_id_idx           on public.orders (slot_id);
create index orders_created_at_idx        on public.orders (created_at);

create index order_items_order_id_idx     on public.order_items (order_id);
create index order_items_product_id_idx   on public.order_items (product_id);

create index reviews_consumer_id_idx      on public.reviews (consumer_id);
create index reviews_producer_id_idx      on public.reviews (producer_id);
create index reviews_statut_idx           on public.reviews (statut);
create index reviews_created_at_idx       on public.reviews (created_at);

create index payouts_producer_id_idx      on public.payouts (producer_id);
create index payouts_statut_idx           on public.payouts (statut);
create index payouts_created_at_idx       on public.payouts (created_at);

create index notifications_user_id_idx    on public.notifications (user_id);
create index notifications_created_at_idx on public.notifications (created_at);

create index producer_interests_statut_idx     on public.producer_interests (statut);
create index producer_interests_created_at_idx on public.producer_interests (created_at);

-- =============================================================================
-- 3. HELPERS (SECURITY DEFINER — contournent RLS proprement pour éviter les
--    récursions de politiques)
-- =============================================================================

-- is_admin() -------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.users
    where id = auth.uid() and role = 'admin'
  );
$$;

-- owns_producer(producer_id) ---------------------------------------------------
create or replace function public.owns_producer(p_producer_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.producers
    where id = p_producer_id and user_id = auth.uid()
  );
$$;

-- =============================================================================
-- 4. FONCTIONS & TRIGGERS
-- =============================================================================

-- 4.1 generate_order_code() ----------------------------------------------------
-- Génère un code unique "TRR-XXXXX" (5 caractères sur un alphabet sans
-- confusion visuelle: pas de 0/O, pas de 1/I/L).
create or replace function public.generate_order_code()
returns text
language plpgsql
as $$
declare
  alphabet  constant text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  code_len  constant int  := 5;
  candidate text;
  i         int;
  exists_already boolean;
begin
  loop
    candidate := 'TRR-';
    for i in 1..code_len loop
      candidate := candidate
        || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;

    select exists (select 1 from public.orders where code_commande = candidate)
      into exists_already;

    exit when not exists_already;
  end loop;

  return candidate;
end;
$$;

-- Trigger: assigne automatiquement code_commande à l'INSERT
create or replace function public.set_order_code()
returns trigger
language plpgsql
as $$
begin
  if new.code_commande is null or new.code_commande = '' then
    new.code_commande := public.generate_order_code();
  end if;
  return new;
end;
$$;

create trigger orders_set_code_before_insert
  before insert on public.orders
  for each row
  execute function public.set_order_code();

-- 4.2 Calcul automatique de la commission (6%) ---------------------------------
create or replace function public.compute_order_commission()
returns trigger
language plpgsql
as $$
begin
  if new.montant_total is not null then
    new.commission_terroir     := round(new.montant_total * 0.06, 2);
    new.montant_net_producteur := new.montant_total - new.commission_terroir;
  end if;
  return new;
end;
$$;

create trigger orders_commission_before_insert
  before insert on public.orders
  for each row
  execute function public.compute_order_commission();

create trigger orders_commission_before_update
  before update of montant_total on public.orders
  for each row
  when (new.montant_total is distinct from old.montant_total)
  execute function public.compute_order_commission();

-- =============================================================================
-- 5. ROW LEVEL SECURITY
-- =============================================================================

alter table public.users               enable row level security;
alter table public.producers           enable row level security;
alter table public.products            enable row level security;
alter table public.slots               enable row level security;
alter table public.orders              enable row level security;
alter table public.order_items         enable row level security;
alter table public.reviews             enable row level security;
alter table public.payouts             enable row level security;
alter table public.notifications       enable row level security;
alter table public.producer_interests  enable row level security;

-- 5.1 users --------------------------------------------------------------------
create policy "users self read"
  on public.users for select
  using (auth.uid() = id);

create policy "users self insert"
  on public.users for insert
  with check (auth.uid() = id);

create policy "users self update"
  on public.users for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- 5.2 producers ----------------------------------------------------------------
create policy "producers public read when active"
  on public.producers for select
  using (statut = 'active');

create policy "producers owner read"
  on public.producers for select
  using (auth.uid() = user_id);

create policy "producers owner insert"
  on public.producers for insert
  with check (auth.uid() = user_id);

create policy "producers owner update"
  on public.producers for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 5.3 products -----------------------------------------------------------------
create policy "products public read when active"
  on public.products for select
  using (
    actif = true
    and exists (
      select 1 from public.producers p
      where p.id = products.producer_id and p.statut = 'active'
    )
  );

create policy "products owner all"
  on public.products for all
  using (public.owns_producer(producer_id))
  with check (public.owns_producer(producer_id));

-- 5.4 slots --------------------------------------------------------------------
-- Slots visibles dès que le producteur est actif (utile pour le checkout).
create policy "slots public read when producer active"
  on public.slots for select
  using (
    exists (
      select 1 from public.producers p
      where p.id = slots.producer_id and p.statut = 'active'
    )
  );

create policy "slots owner all"
  on public.slots for all
  using (public.owns_producer(producer_id))
  with check (public.owns_producer(producer_id));

-- 5.5 orders -------------------------------------------------------------------
create policy "orders parties read"
  on public.orders for select
  using (
    auth.uid() = consumer_id
    or public.owns_producer(producer_id)
  );

create policy "orders consumer insert"
  on public.orders for insert
  with check (auth.uid() = consumer_id);

create policy "orders parties update"
  on public.orders for update
  using (
    auth.uid() = consumer_id
    or public.owns_producer(producer_id)
  )
  with check (
    auth.uid() = consumer_id
    or public.owns_producer(producer_id)
  );

-- 5.6 order_items --------------------------------------------------------------
-- Accès délégué via la commande parente.
create policy "order_items via order"
  on public.order_items for all
  using (
    exists (
      select 1 from public.orders o
      where o.id = order_items.order_id
        and (auth.uid() = o.consumer_id or public.owns_producer(o.producer_id))
    )
  )
  with check (
    exists (
      select 1 from public.orders o
      where o.id = order_items.order_id
        and (auth.uid() = o.consumer_id or public.owns_producer(o.producer_id))
    )
  );

-- 5.7 reviews ------------------------------------------------------------------
create policy "reviews public read when published"
  on public.reviews for select
  using (statut = 'published');

create policy "reviews author read"
  on public.reviews for select
  using (auth.uid() = consumer_id);

-- Le consumer peut créer une review uniquement pour une commande completed
-- qui lui appartient.
create policy "reviews consumer insert after completed order"
  on public.reviews for insert
  with check (
    auth.uid() = consumer_id
    and exists (
      select 1 from public.orders o
      where o.id = reviews.order_id
        and o.consumer_id = auth.uid()
        and o.statut = 'completed'
    )
  );

create policy "reviews author update"
  on public.reviews for update
  using (auth.uid() = consumer_id)
  with check (auth.uid() = consumer_id);

-- 5.8 payouts ------------------------------------------------------------------
create policy "payouts producer read"
  on public.payouts for select
  using (public.owns_producer(producer_id));

-- 5.9 notifications ------------------------------------------------------------
create policy "notifications owner read"
  on public.notifications for select
  using (auth.uid() = user_id);

-- 5.10 producer_interests ------------------------------------------------------
-- Formulaire public (candidatures producteurs) : anon peut INSERT.
create policy "producer_interests public insert"
  on public.producer_interests for insert
  to anon, authenticated
  with check (true);

create policy "producer_interests admin read"
  on public.producer_interests for select
  using (public.is_admin());

create policy "producer_interests admin update"
  on public.producer_interests for update
  using (public.is_admin())
  with check (public.is_admin());
