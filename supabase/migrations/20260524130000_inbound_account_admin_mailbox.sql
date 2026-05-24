-- Chantier 9 (suite) — la boîte réellement pollée en IMAP est admin@ (Zimbra
-- OVH, boîte principale) ; contact@ n'est qu'une redirection MX → admin@.
-- On corrige le compte surveillé seedé initialement sur contact@.
--
-- Note : la RÉPONSE part toujours de contact@ (interlocuteur unique, géré côté
-- code), seule la boîte d'ingestion change.
--
-- Forward-only, idempotent.

update public.inbound_email_accounts
set address = 'admin@terroir-local.fr', updated_at = now()
where address = 'contact@terroir-local.fr';

insert into public.inbound_email_accounts (address)
values ('admin@terroir-local.fr')
on conflict (address) do nothing;
