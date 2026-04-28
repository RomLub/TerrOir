-- =============================================================================
-- TerrOir — tables gms_prices + gms_prices_history (page pédagogique /notre-demarche)
-- =============================================================================
-- Page pédagogique consumer comparant les prix GMS (grandes et moyennes
-- surfaces, panel Kantar Worldpanel / FranceAgriMer) aux prix TerrOir vente
-- directe ferme, pour les 3 filières viandes prioritaires (bovin, porcin,
-- ovin).
--
-- Phase A (cette migration) : schéma + RLS + seed initial 10 références
--   (le seed est exécuté via scripts/seed-gms-prices.ts, pas dans la migration).
-- Phase B (à venir) : interface admin de gestion mensuelle (mise à jour prix
--   + insertion ligne history pour traçabilité historique).
-- Phase C (à venir) : page publique /notre-demarche consommant ces données.
--
-- Périmètre tables :
--   - gms_prices         : référence active courante, une ligne par produit
--                          (slug unique, prix_gms_kg + fourchette TerrOir).
--   - gms_prices_history : trace mensuelle, une ligne par (référence, mois)
--                          pour permettre suivi évolution / graphiques.
--
-- RLS lecture publique (active=true) : la page /notre-demarche est non-
-- authentifiée, donc lecture anon. Defense-in-depth applicative : les helpers
-- lib/gms-prices/fetch-active.ts refiltrent active=true + filiere=X côté
-- applicatif en plus du filtre RLS, aligné convention fetch-public.ts (cf.
-- audit 22/04 pour les règles d'isolation des données publiques côté
-- service_role).
--
-- Pas de policy INSERT/UPDATE/DELETE : écritures gérées exclusivement via
-- service_role depuis l'admin Phase B (pattern aligné audit_logs et
-- producers — bypass service_role + convention applicative stricte).
-- =============================================================================

begin;

create table if not exists public.gms_prices (
  id                       uuid primary key default gen_random_uuid(),
  slug                     text unique not null,
  filiere                  text not null check (filiere in ('bovin', 'porcin', 'ovin')),
  libelle                  text not null,
  description_courte       text,
  prix_gms_kg              numeric(10,2) not null,
  prix_terroir_kg_min      numeric(10,2),
  prix_terroir_kg_max      numeric(10,2),
  prix_terroir_kg_moyen    numeric(10,2),
  mois_reference           text not null,
  source                   text not null,
  source_url               text,
  ordre_affichage          int not null default 0,
  active                   boolean not null default true,
  notes_admin              text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create table if not exists public.gms_prices_history (
  id                       uuid primary key default gen_random_uuid(),
  reference_id             uuid not null references public.gms_prices(id) on delete cascade,
  prix_gms_kg              numeric(10,2) not null,
  prix_terroir_kg_moyen    numeric(10,2),
  mois_reference           text not null,
  source                   text not null,
  source_url               text,
  created_at               timestamptz not null default now(),
  unique (reference_id, mois_reference)
);

create index if not exists idx_gms_prices_filiere
  on public.gms_prices (filiere) where active;

create index if not exists idx_gms_prices_history_reference
  on public.gms_prices_history (reference_id, mois_reference desc);

alter table public.gms_prices enable row level security;

drop policy if exists "gms_prices public read" on public.gms_prices;
create policy "gms_prices public read"
  on public.gms_prices
  for select
  using (active = true);

alter table public.gms_prices_history enable row level security;

drop policy if exists "gms_prices_history public read" on public.gms_prices_history;
create policy "gms_prices_history public read"
  on public.gms_prices_history
  for select
  using (true);

commit;
