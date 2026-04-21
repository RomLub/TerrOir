-- =============================================================================
-- TerrOir — modèle de rôles cumulables + table admin_users isolée
-- =============================================================================
-- Ancien modèle : public.users.role text check in ('consumer','producer','admin')
-- → un seul rôle, pas de producteur qui achète, et un admin vit côté users.
--
-- Nouveau modèle :
--   * public.users.roles text[] cumul ('consumer' | 'producer')
--     → tout producteur est aussi consumer par défaut (['consumer','producer'])
--     → un consumer peut rester ['consumer'] uniquement
--   * public.admin_users : table isolée, un admin n'est PAS dans public.users
--     → garde les deux univers étanches (plateforme vs back-office)
--   * Contrainte mutuelle : un même auth.users.id ne peut pas être dans
--     public.users ET public.admin_users en même temps (triggers).
--
-- Wipe complet de public.users + auth.users : pré-prod, pas de données
-- réelles. Les tables dépendantes (producers, products, slots, orders,
-- reviews, payouts, notifications, producer_invitations) sont vidées par
-- TRUNCATE ... CASCADE qui suit la chaîne des FK.
--
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. WIPE
-- -----------------------------------------------------------------------------
-- TRUNCATE CASCADE remonte la chaîne FK :
-- users → producers → products/slots/orders/payouts/reviews/producer_invitations
--                    → order_items (via orders)
--       → notifications (FK directe vers users)
truncate table public.users cascade;
-- producer_interests n'a pas de FK vers users, à nettoyer à part
truncate table public.producer_interests restart identity;
-- Puis les auth.users eux-mêmes
delete from auth.users;

-- -----------------------------------------------------------------------------
-- 2. SCHEMA users.role → users.roles
-- -----------------------------------------------------------------------------
alter table public.users drop column role;
alter table public.users
  add column roles text[] not null default array['consumer']::text[];

alter table public.users
  add constraint users_roles_values check (
    roles <@ array['consumer', 'producer']::text[]
    and cardinality(roles) >= 1
  );

-- -----------------------------------------------------------------------------
-- 3. TABLE public.admin_users
-- -----------------------------------------------------------------------------
create table public.admin_users (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  prenom      text,
  nom         text,
  created_at  timestamptz default now()
);

alter table public.admin_users enable row level security;

-- Un admin peut lire sa propre ligne. service_role contourne la RLS
-- automatiquement (pas de policy nécessaire — comportement natif).
create policy "admin_users self read"
  on public.admin_users for select
  to authenticated
  using (id = auth.uid());

-- -----------------------------------------------------------------------------
-- 4. EXCLUSION MUTUELLE users ↔ admin_users
-- -----------------------------------------------------------------------------
create or replace function public.enforce_user_exclusive()
returns trigger
language plpgsql
as $$
begin
  if tg_table_name = 'users' then
    if exists (select 1 from public.admin_users where id = new.id) then
      raise exception 'User % already exists in admin_users', new.id
        using errcode = '23505';
    end if;
  elsif tg_table_name = 'admin_users' then
    if exists (select 1 from public.users where id = new.id) then
      raise exception 'User % already exists in public.users', new.id
        using errcode = '23505';
    end if;
  end if;
  return new;
end;
$$;

create trigger users_exclusive_with_admin
  before insert or update of id on public.users
  for each row execute function public.enforce_user_exclusive();

create trigger admin_users_exclusive_with_users
  before insert or update of id on public.admin_users
  for each row execute function public.enforce_user_exclusive();

-- -----------------------------------------------------------------------------
-- 5. FK REPOINTÉES VERS auth.users — tables qui peuvent référencer un admin
-- -----------------------------------------------------------------------------
-- notifications.user_id peut être un consumer, un producer OU un admin
-- (ex: notification de modération d'avis). On pointe vers auth.users plutôt
-- que public.users pour couvrir les trois cas sans multiplier les colonnes.
alter table public.notifications
  drop constraint notifications_user_id_fkey;

alter table public.notifications
  add constraint notifications_user_id_fkey
    foreign key (user_id) references auth.users(id) on delete cascade;

-- producer_invitations.created_by = l'admin qui a émis l'invitation.
-- Même logique : pointe vers auth.users. ON DELETE SET NULL pour garder
-- la trace de l'invitation même si l'admin est supprimé plus tard.
alter table public.producer_invitations
  drop constraint producer_invitations_created_by_fkey;

alter table public.producer_invitations
  add constraint producer_invitations_created_by_fkey
    foreign key (created_by) references auth.users(id) on delete set null;

-- -----------------------------------------------------------------------------
-- 6. is_admin() : interroger admin_users au lieu de users.role
-- -----------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.admin_users
    where id = auth.uid()
  );
$$;
