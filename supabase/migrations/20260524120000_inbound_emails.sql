-- Chantier 9 — Boîte mails admin : réception des emails entrants (IMAP poll
-- OVH, cf. ADR-0010). Deux tables :
--   - inbound_email_accounts : config + checkpoint PAR adresse surveillée
--     (conçu multi-adresses : ajouter contact@/support@/… = INSERT, pas de
--     hardcode). Les identifiants IMAP restent en env (secrets), la table ne
--     stocke que l'adresse + l'état de polling (UID checkpoint + UIDVALIDITY).
--   - inbound_emails : un email reçu, dédupliqué par Message-ID.
--
-- Forward-only, idempotent. Lecture admin (RLS), écriture service_role.

-- 1. Comptes surveillés.
create table if not exists public.inbound_email_accounts (
  id uuid primary key default gen_random_uuid(),
  address text not null unique,
  -- Checkpoint IMAP : dernier UID traité (reprise — on ne re-scanne pas tout
  -- l'historique à chaque run). uid_validity : si le serveur change cette
  -- valeur, les UID sont invalidés → on reset last_seen_uid.
  last_seen_uid bigint not null default 0,
  uid_validity bigint,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Seed du compte MVP contact@ (idempotent).
insert into public.inbound_email_accounts (address)
values ('contact@terroir-local.fr')
on conflict (address) do nothing;

-- 2. Emails reçus.
create table if not exists public.inbound_emails (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references public.inbound_email_accounts(id) on delete set null,
  -- Message-ID header : clé de déduplication (IMAP peut renvoyer le même mail).
  message_id text not null unique,
  in_reply_to text,
  from_email text not null,
  from_name text,
  to_email text,
  subject text,
  body_text text,
  body_html text,
  received_at timestamptz,
  -- Tag automatique calculé à l'ingestion (lookup expéditeur).
  tag text not null default 'public'
    check (tag in ('producteur', 'consommateur', 'public')),
  lookup_user_id uuid,
  lookup_lead_id uuid,
  read_at timestamptz,
  replied_at timestamptz,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists inbound_emails_tag_received_idx
  on public.inbound_emails (tag, received_at desc);
create index if not exists inbound_emails_received_idx
  on public.inbound_emails (received_at desc);
create index if not exists inbound_emails_lookup_user_idx
  on public.inbound_emails (lookup_user_id) where lookup_user_id is not null;

-- 3. RLS : lecture admin, écriture service_role uniquement.
alter table public.inbound_email_accounts enable row level security;
alter table public.inbound_emails enable row level security;

drop policy if exists "inbound_email_accounts admin read" on public.inbound_email_accounts;
create policy "inbound_email_accounts admin read"
  on public.inbound_email_accounts for select to authenticated
  using (exists (select 1 from public.admin_users where id = auth.uid()));

drop policy if exists "inbound_emails admin read" on public.inbound_emails;
create policy "inbound_emails admin read"
  on public.inbound_emails for select to authenticated
  using (exists (select 1 from public.admin_users where id = auth.uid()));
