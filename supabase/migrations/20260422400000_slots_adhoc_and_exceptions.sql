-- =============================================================================
-- TerrOir — Créneaux ponctuels + exceptions manuelles
-- =============================================================================
-- Chantier "Créneaux ponctuels + exceptions" (Option B design pro) :
--   * Slots ponctuels one-shot : rule_id = NULL autorisé (créneaux ad hoc
--     sans rule parent, ex. "ouverture exceptionnelle samedi 3 mai").
--   * Exceptions manuelles orthogonales : colonne slots.excluded_at nullable.
--     NULL = slot actif, timestamp = exclu manuellement par le producer
--     (vacances, maladie, annulation ponctuelle). Orthogonal à slots.actif
--     qui reste contrôlé par le toggle on/off des slot_rules (Phase 4).
--
-- Filter consumer : slots affichés et réservables ssi actif=true AND
-- excluded_at IS NULL (cf update RPC create_order_with_items plus bas +
-- update du filter côté page produit).
--
-- Idempotent : rerunnable sans effet de bord. Drop constraint NOT NULL
-- ignoré si déjà droppée, add column if not exists, index if not exists.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. slots.rule_id : nullable pour permettre les slots ponctuels (rule_id NULL)
-- -----------------------------------------------------------------------------
alter table public.slots alter column rule_id drop not null;

-- -----------------------------------------------------------------------------
-- 2. slots.excluded_at : marque d'exclusion manuelle
-- -----------------------------------------------------------------------------
alter table public.slots
  add column if not exists excluded_at timestamptz;

-- Index partiel : lookup rapide des slots exclus d'un producer (dashboard
-- exceptions). Ne stocke que les lignes où excluded_at IS NOT NULL (petit).
create index if not exists slots_excluded_at_idx
  on public.slots (producer_id, excluded_at)
  where excluded_at is not null;

-- -----------------------------------------------------------------------------
-- 3. RPC create_order_with_items : +check excluded_at IS NULL au lookup slot
-- -----------------------------------------------------------------------------
-- Miroir exact de la version migration 20260422000000, avec une seule
-- modification : bloc 3 (validation slot) ajoute `and excluded_at is null`.
-- Le reste (auth, items validation, producer public, stock, commission) est
-- identique.
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
  -- 0. Auth
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

  -- 3. Slot valide, rattaché au producteur, actif ET non exclu ?
  if not exists (
    select 1 from public.slots
    where id = p_slot_id
      and producer_id = p_producer_id
      and actif = true
      and excluded_at is null
  ) then
    raise exception 'Slot % invalide pour ce producteur', p_slot_id
      using errcode = '23514';
  end if;

  -- 4. Collecte des IDs produits (dédupliqués) + verrou FOR UPDATE stable
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

commit;
