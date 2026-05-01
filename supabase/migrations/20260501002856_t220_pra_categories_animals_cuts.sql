-- T-220 PR-A — Schéma catégorisation viande
--
-- Référentiels minimaux pour catégorisation produit 3 niveaux :
--   product_categories : catégorie globale (viande, légumes, fromages...)
--   animals            : espèce animale (boeuf, porc, volaille...)
--   cuts               : morceau, scoped par animal_id (entrecote, joue...)
--
-- + ajout colonnes nullable category_id / animal_id / cut_id sur products,
-- toutes en ON DELETE SET NULL (un référentiel supprimé n'écrase pas le
-- produit, le tag est juste reset à NULL).
--
-- Backfill : les 16 produits prod existants restent NULL après cette
-- migration. Re-tagging via UI PR-B + email aux 6 producteurs concernés.
-- Migration follow-up plus tard pour passer les colonnes NOT NULL une
-- fois le backfill terminé.
--
-- Idempotent : `create table if not exists`, `add column if not exists`,
-- `on conflict do nothing`, `drop policy if exists`. Re-runnable sans erreur.

-- 1. product_categories ---------------------------------------------------------
create table if not exists public.product_categories (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  name        text not null,
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now()
);

alter table public.product_categories enable row level security;

drop policy if exists product_categories_read_public on public.product_categories;
create policy product_categories_read_public
  on public.product_categories
  for select
  using (true);

-- 2. animals --------------------------------------------------------------------
create table if not exists public.animals (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  name        text not null,
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now()
);

alter table public.animals enable row level security;

drop policy if exists animals_read_public on public.animals;
create policy animals_read_public
  on public.animals
  for select
  using (true);

-- 3. cuts -----------------------------------------------------------------------
-- ON DELETE RESTRICT sur animal_id : on refuse de supprimer une espèce
-- tant qu'il existe des morceaux qui la référencent (intégrité forte
-- côté référentiel — la suppression d'un animal est un événement rare
-- qui mérite une étape manuelle de cleanup des cuts).
create table if not exists public.cuts (
  id          uuid primary key default gen_random_uuid(),
  animal_id   uuid not null references public.animals(id) on delete restrict,
  slug        text not null,
  name        text not null,
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now(),
  unique (animal_id, slug)
);

alter table public.cuts enable row level security;

drop policy if exists cuts_read_public on public.cuts;
create policy cuts_read_public
  on public.cuts
  for select
  using (true);

-- 4. Seeds product_categories (7) ----------------------------------------------
-- Ordre priorité métier : viande en 1er.
insert into public.product_categories (slug, name, sort_order) values
  ('viande',      'Viande',      10),
  ('charcuterie', 'Charcuterie', 20),
  ('legumes',     'Légumes',     30),
  ('fromages',    'Fromages',    40),
  ('miel',        'Miel',        50),
  ('oeufs',       'Œufs',        60),
  ('autres',      'Autres',      70)
on conflict (slug) do nothing;

-- 5. Seeds animals (6) ----------------------------------------------------------
-- Ordre priorité métier : boeuf en 1er.
insert into public.animals (slug, name, sort_order) values
  ('boeuf',    'Bœuf',     10),
  ('veau',     'Veau',     20),
  ('porc',     'Porc',     30),
  ('agneau',   'Agneau',   40),
  ('volaille', 'Volaille', 50),
  ('lapin',    'Lapin',    60)
on conflict (slug) do nothing;

-- 6. Seeds cuts boeuf (30) ------------------------------------------------------
-- 30 morceaux dont :
--   - 'colis-mixte'  : panier multi-morceaux assemblé par le producteur
--   - 'abats-mixtes' : générique foie/rognon/langue/coeur (simplification MVP)
-- Fusions vs liste anatomique stricte :
--   - macreuse        ← macreuse-a-pot-au-feu + macreuse-a-bifteck
--   - jumeau          ← jumeau-a-pot-au-feu + jumeau-a-bifteck
--   - bavette-aloyau  ← bavette-d-aloyau (slug raccourci)
--   - bavette-flanchet← bavette-de-flanchet (slug raccourci)
insert into public.cuts (animal_id, slug, name, sort_order)
select a.id, c.slug, c.name, c.sort_order
from public.animals a,
  (values
    ('joue',                  'Joue',                   10),
    ('macreuse',              'Macreuse',               20),
    ('paleron',               'Paleron',                30),
    ('jumeau',                'Jumeau',                 40),
    ('collier',               'Collier',                50),
    ('basses-cotes',          'Basses côtes',           60),
    ('cote',                  'Côte',                   70),
    ('entrecote',             'Entrecôte',              80),
    ('faux-filet',            'Faux-filet',             90),
    ('filet',                 'Filet',                 100),
    ('rumsteck',              'Rumsteck',              110),
    ('tende-de-tranche',      'Tende de tranche',      120),
    ('gite-a-la-noix',        'Gîte à la noix',        130),
    ('aiguillette-baronne',   'Aiguillette baronne',   140),
    ('bavette-aloyau',        'Bavette d''aloyau',     150),
    ('bavette-flanchet',      'Bavette de flanchet',   160),
    ('onglet',                'Onglet',                170),
    ('hampe',                 'Hampe',                 180),
    ('plat-de-cotes',         'Plat de côtes',         190),
    ('tendron',               'Tendron',               200),
    ('flanchet',              'Flanchet',              210),
    ('gite',                  'Gîte',                  220),
    ('queue',                 'Queue',                 230),
    ('rond-de-gite',          'Rond de gîte',          240),
    ('araignee',              'Araignée',              250),
    ('poire-merlan',          'Poire / Merlan',        260),
    ('gros-bout-de-poitrine', 'Gros bout de poitrine', 270),
    ('milieu-de-poitrine',    'Milieu de poitrine',    280),
    ('abats-mixtes',          'Abats mixtes',          290),
    ('colis-mixte',           'Colis mixte',           300)
  ) as c(slug, name, sort_order)
where a.slug = 'boeuf'
on conflict (animal_id, slug) do nothing;

-- 7. ALTER products — colonnes FK nullable -------------------------------------
-- ON DELETE SET NULL : si un référentiel disparaît, le produit n'est pas
-- supprimé, son tag est simplement réinitialisé. Cohérent avec le caractère
-- nullable transitoire de ces colonnes pendant le backfill.
--
-- Pas de check contrainte cross-FK animal_id ↔ cut_id en DB : la cohérence
-- (cut.animal_id == products.animal_id) est validée côté UI/API en MVP.
-- À durcir en migration ultérieure si nécessaire (ex: trigger ou contrainte
-- composite via colonne dénormalisée).
alter table public.products
  add column if not exists category_id uuid references public.product_categories(id) on delete set null;

alter table public.products
  add column if not exists animal_id uuid references public.animals(id) on delete set null;

alter table public.products
  add column if not exists cut_id uuid references public.cuts(id) on delete set null;

-- 8. Indexes pour filtrage catalogue (PR-B / PR-C) ------------------------------
create index if not exists products_category_id_idx on public.products(category_id);
create index if not exists products_animal_id_idx   on public.products(animal_id);
create index if not exists products_cut_id_idx      on public.products(cut_id);

-- 9. Comments -------------------------------------------------------------------
comment on table public.product_categories is
  'T-220 PR-A — référentiel catégories produit (viande, charcuterie, légumes...). RLS read public.';

comment on table public.animals is
  'T-220 PR-A — référentiel espèces animales (boeuf, porc, volaille...). RLS read public.';

comment on table public.cuts is
  'T-220 PR-A — référentiel morceaux animaux (scoped par animal_id). Inclut colis-mixte et abats-mixtes pour le boeuf en MVP. RLS read public.';

comment on column public.products.category_id is
  'T-220 — catégorie globale du produit. Nullable transitoire le temps du backfill manuel par les producteurs via UI (PR-B).';

comment on column public.products.animal_id is
  'T-220 — espèce animale (uniquement pour catégorie viande/charcuterie). Nullable transitoire.';

comment on column public.products.cut_id is
  'T-220 — morceau précis. Cohérence cut.animal_id == products.animal_id validée client-side (pas de check contrainte cross-FK en DB pour MVP). Nullable transitoire.';
