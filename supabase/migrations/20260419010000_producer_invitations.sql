-- =============================================================================
-- TerrOir — table des invitations producteurs
-- =============================================================================
-- L'admin génère une invitation (token unique, 7 jours de validité).
-- Le producteur s'inscrit en activant le lien et en définissant son mot de passe.
-- =============================================================================

create table public.producer_invitations (
  id            uuid primary key default gen_random_uuid(),
  email         text not null,
  token         text unique not null,
  expires_at    timestamptz not null default (now() + interval '7 days'),
  used_at       timestamptz,
  created_by    uuid references public.users(id),
  created_at    timestamptz default now()
);

create index producer_invitations_token_idx       on public.producer_invitations (token);
create index producer_invitations_email_idx       on public.producer_invitations (email);
create index producer_invitations_expires_at_idx  on public.producer_invitations (expires_at);

alter table public.producer_invitations enable row level security;

-- Seul un admin peut lire / créer / mettre à jour les invitations.
-- La validation du token à l'inscription passe par un endpoint API qui
-- utilise la service_role (contourne RLS), donc pas de policy public read.
create policy "invitations admin all"
  on public.producer_invitations for all
  using (public.is_admin())
  with check (public.is_admin());
