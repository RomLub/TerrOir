-- =============================================================================
-- TerrOir — Phase 6 (Chantier 2) : filtrage public sur statut='public'
-- =============================================================================
-- Objectif : les producteurs n'apparaissent côté public que lorsqu'ils ont
-- publié au moins un produit actif. 'active' = validé admin mais pas encore
-- vitrine ; 'public' = vitrine visible sur le site.
--
-- Transaction unique :
--   1. Promotion des producers 'active' avec >=1 produit actif → 'public'
--      (inclut les 5 seeds de démo introduits après Phase 3).
--   2. RLS policies (producers, products, slots) : bascule sur 'public'.
--   3. RPC create_order_with_items() : verrou vente sur 'public'.
--   4. RPC search_producers() : filtre recherche sur 'public'.
--
-- Les `create or replace function` conservent les GRANTs existants — la
-- signature des fonctions n'est pas modifiée par cette migration. Les
-- policies RLS sont drop+create car Postgres n'a pas de
-- `create or replace policy`.
--
-- Pré-requis côté code applicatif : le helper
-- lib/producers/promote-to-public.ts doit être déployé pour que la
-- transition 'active' → 'public' se fasse automatiquement au 1er produit
-- publié APRÈS cette migration (les producers antérieurs sont traités par
-- le bloc 1 ci-dessous).
-- =============================================================================

begin;

-- 1. Promotion rétroactive : tout producer 'active' avec au moins un
--    produit actif en base est déjà vitrine de fait → on aligne le statut.
--    Les producers 'active' sans produit actif restent 'active' et seront
--    promus automatiquement à leur 1er produit publié (cf helper applicatif).
update public.producers
set statut = 'public'
where statut = 'active'
  and id in (
    select distinct producer_id
    from public.products
    where actif = true
  );

-- 2. RLS public.producers : lecture publique uniquement pour les vitrines.
drop policy if exists "producers public read when active" on public.producers;

create policy "producers public read when public"
  on public.producers for select
  using (statut = 'public');

-- 3. RLS public.products : lecture publique gatée par producer.statut='public'.
drop policy if exists "products public read when active" on public.products;

create policy "products public read when producer public"
  on public.products for select
  using (
    actif = true
    and exists (
      select 1 from public.producers p
      where p.id = products.producer_id and p.statut = 'public'
    )
  );

-- 4. RLS public.slots : lecture publique gatée par producer.statut='public'.
drop policy if exists "slots public read when producer active" on public.slots;

create policy "slots public read when producer public"
  on public.slots for select
  using (
    exists (
      select 1 from public.producers p
      where p.id = slots.producer_id and p.statut = 'public'
    )
  );

-- 5. RPC create_order_with_items() : défense en profondeur sur 'public'.
--    En pratique un producer 'active' (non-public) est inatteignable
--    depuis les pages publiques, mais on rend l'invariant explicite.
create or replace function public.create_order_with_items(
  p_consumer_id    uuid,
  p_producer_id    uuid,
  p_slot_id        uuid,
  p_date_retrait   date,
  p_heure_retrait  time,
  p_notes_client   text,
  p_items          jsonb
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order_id    uuid;
  v_total       numeric(10, 2) := 0;
  v_item        jsonb;
  v_product_id  uuid;
  v_quantite    numeric(10, 3);
  v_product     record;
  v_sous_total  numeric(10, 2);
  v_ids         uuid[];
begin
  -- 0. Auth: le consumer doit être l'utilisateur courant.
  if auth.uid() is null or p_consumer_id is distinct from auth.uid() then
    raise exception 'Consumer mismatch with auth.uid()'
      using errcode = '42501';
  end if;

  -- 1. Validation input
  if p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 then
    raise exception 'items must be a non-empty array'
      using errcode = '22023';
  end if;

  -- 2. Producteur vitrine ('public') ?
  if not exists (
    select 1 from public.producers
    where id = p_producer_id and statut = 'public'
  ) then
    raise exception 'Producer % is not public', p_producer_id
      using errcode = '42501';
  end if;

  -- 3. Slot valide et rattaché au producteur ?
  if not exists (
    select 1 from public.slots
    where id = p_slot_id
      and producer_id = p_producer_id
      and actif = true
  ) then
    raise exception 'Slot % invalide pour ce producteur', p_slot_id
      using errcode = '23514';
  end if;

  -- 4. Collecte des IDs produits (dédupliqués) puis verrou FOR UPDATE
  --    dans un ordre stable (par id) pour éviter les deadlocks.
  select array_agg(distinct (item->>'product_id')::uuid order by (item->>'product_id')::uuid)
    into v_ids
  from jsonb_array_elements(p_items) as item;

  perform 1
  from public.products
  where id = any(v_ids)
  order by id
  for update;

  -- 5. Validation ligne par ligne + calcul du total (prix DB autoritatif)
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_product_id := (v_item->>'product_id')::uuid;
    v_quantite   := (v_item->>'quantite')::numeric(10, 3);

    if v_quantite is null or v_quantite <= 0 then
      raise exception 'Quantité invalide pour le produit %', v_product_id
        using errcode = '22023';
    end if;

    select id, producer_id, prix, stock_disponible, stock_illimite, actif
      into v_product
    from public.products
    where id = v_product_id;

    if not found then
      raise exception 'Produit % introuvable', v_product_id
        using errcode = 'P0002';
    end if;
    if not v_product.actif then
      raise exception 'Produit % inactif', v_product_id
        using errcode = '42501';
    end if;
    if v_product.producer_id <> p_producer_id then
      raise exception 'Produit % appartient à un autre producteur', v_product_id
        using errcode = '23514';
    end if;
    if not v_product.stock_illimite
       and v_product.stock_disponible < v_quantite then
      raise exception 'Stock insuffisant pour %', v_product_id
        using errcode = '23514';
    end if;

    v_sous_total := round(v_product.prix * v_quantite, 2);
    v_total := v_total + v_sous_total;
  end loop;

  -- 6. Insert order (triggers DB calculent code_commande / commission / net)
  insert into public.orders (
    consumer_id, producer_id, slot_id,
    date_retrait, heure_retrait, notes_client,
    montant_total, statut
  )
  values (
    p_consumer_id, p_producer_id, p_slot_id,
    p_date_retrait, p_heure_retrait, p_notes_client,
    v_total, 'pending'
  )
  returning id into v_order_id;

  -- 7. Insert order_items + décrément stock
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_product_id := (v_item->>'product_id')::uuid;
    v_quantite   := (v_item->>'quantite')::numeric(10, 3);

    select prix, stock_illimite
      into v_product
    from public.products
    where id = v_product_id;

    v_sous_total := round(v_product.prix * v_quantite, 2);

    insert into public.order_items (
      order_id, product_id, quantite, prix_unitaire, sous_total
    )
    values (
      v_order_id, v_product_id, v_quantite, v_product.prix, v_sous_total
    );

    if not v_product.stock_illimite then
      update public.products
      set stock_disponible = stock_disponible - v_quantite
      where id = v_product_id;
    end if;
  end loop;

  return v_order_id;
end;
$$;

-- 6. RPC search_producers() : filtre sur statut='public' (annuaire + carte).
create or replace function public.search_producers(
  p_lat        double precision,
  p_lng        double precision,
  p_radius_km  double precision,
  p_especes    text[] default null,
  p_labels     text[] default null
)
returns table (
  id                         uuid,
  slug                       text,
  nom_exploitation           text,
  commune                    text,
  code_postal                text,
  latitude                   double precision,
  longitude                  double precision,
  photo_principale           text,
  especes                    text[],
  labels                     text[],
  badge_stock_score          double precision,
  badge_confirmation_score   double precision,
  badge_annulation_score     double precision,
  distance_km                double precision,
  note_moyenne               numeric,
  nb_avis                    int,
  product_count              int
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    p.id, p.slug, p.nom_exploitation, p.commune, p.code_postal,
    p.latitude, p.longitude, p.photo_principale, p.especes, p.labels,
    p.badge_stock_score, p.badge_confirmation_score, p.badge_annulation_score,
    (6371 * acos(
      greatest(-1, least(1,
        cos(radians(p_lat)) * cos(radians(p.latitude))
        * cos(radians(p.longitude) - radians(p_lng))
        + sin(radians(p_lat)) * sin(radians(p.latitude))
      ))
    )) as distance_km,
    p.note_moyenne::numeric as note_moyenne,
    p.nb_avis               as nb_avis,
    (
      select count(*)::int
      from public.products pr
      where pr.producer_id = p.id
        and pr.actif = true
    ) as product_count
  from public.producers p
  where p.statut = 'public'
    and p.latitude  is not null
    and p.longitude is not null
    and (
      p_especes is null
      or array_length(p_especes, 1) is null
      or p.especes && p_especes
    )
    and (
      p_labels is null
      or array_length(p_labels, 1) is null
      or p.labels && p_labels
    )
    and (6371 * acos(
      greatest(-1, least(1,
        cos(radians(p_lat)) * cos(radians(p.latitude))
        * cos(radians(p.longitude) - radians(p_lng))
        + sin(radians(p_lat)) * sin(radians(p.latitude))
      ))
    )) <= p_radius_km
  order by distance_km;
$$;

commit;
