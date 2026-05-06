-- =============================================================================
-- TerrOir — Droit de réponse Producer aux avis (CGU 6.4) + prefs notifs consumer
-- =============================================================================
-- Engagement contractuel CGU 6.4 (publié) : « Le Producer concerné dispose
-- d'un droit de réponse public à chaque avis ». Cette migration matérialise
-- l'implémentation manquante côté DB.
--
-- Décisions business validées (Romain, 2026-05-06) :
--   - Réponse Producer publique à un avis (1 réponse par avis, jamais plus).
--   - Longueur max 500 caractères.
--   - Producer peut éditer ET supprimer sa réponse pendant 24h après
--     publication, puis la réponse est figée (lock applicatif via
--     producer_response_locked_at consulté côté API ; la RLS UPDATE producer
--     reste ouverte mais la route /api/producer/reviews/[id]/respond
--     vérifie le lock — défense applicative + audit log).
--   - Modération admin a posteriori : publication immédiate, admin peut
--     supprimer/masquer si abusif via /api/admin/reviews/[id]/response
--     (override de la lock 24h).
--   - Email notification au consumer désactivable via prefs (table
--     user_notification_preferences, default = activé).
--
-- Cohabitation avec modération avis consumer (a priori, statut='pending'
-- avant publication) : la réponse Producer ne peut viser qu'une review
-- déjà publiée. Pas de pré-modération dédiée à la réponse — publication
-- immédiate, admin override en post.
--
-- Idempotence : ALTER TABLE ... ADD COLUMN IF NOT EXISTS et CREATE TABLE
-- IF NOT EXISTS, drop policy if exists avant create policy. Apply ré-exécutable
-- sans effet de bord.
--
-- Rollback : ALTER TABLE public.reviews DROP COLUMN producer_response,
-- DROP COLUMN producer_response_at, DROP COLUMN producer_response_updated_at,
-- DROP COLUMN producer_response_locked_at, DROP COLUMN producer_response_status;
-- DROP TABLE public.user_notification_preferences CASCADE;
--
-- Risque : faible. Aucun row existant n'a de réponse (colonnes nouvelles
-- nullables). Nouvelle table user_notification_preferences vide à
-- l'apply, alimentée à la demande (premier toggle UI ou premier fetch
-- via getUserNotificationPreferences avec defaults virtuels).
-- =============================================================================

-- 1. Colonnes producer_response sur public.reviews ----------------------------

alter table public.reviews
  add column if not exists producer_response text,
  add column if not exists producer_response_at timestamptz,
  add column if not exists producer_response_updated_at timestamptz,
  add column if not exists producer_response_locked_at timestamptz,
  add column if not exists producer_response_status varchar(20);

-- Contrainte CHECK statut. Ajoutée séparément (idempotence) : DROP avant ADD
-- pour garantir un re-apply propre.
alter table public.reviews
  drop constraint if exists reviews_producer_response_status_check;

alter table public.reviews
  add constraint reviews_producer_response_status_check
  check (producer_response_status is null
         or producer_response_status in ('published', 'removed_admin', 'removed_producer'));

-- Contrainte CHECK longueur (cohérent avec validation Zod côté API : max 500).
alter table public.reviews
  drop constraint if exists reviews_producer_response_length_check;

alter table public.reviews
  add constraint reviews_producer_response_length_check
  check (producer_response is null or char_length(producer_response) <= 500);

comment on column public.reviews.producer_response is
  'Texte de la réponse publique du producer à l''avis (CGU 6.4). NULL si pas de réponse ou si supprimée. Max 500 chars (CHECK reviews_producer_response_length_check). Producer peut éditer/supprimer pendant 24h post-publication (lock via producer_response_locked_at, vérifié côté API).';

comment on column public.reviews.producer_response_at is
  'Timestamp publication initiale de la réponse. NEVER updated lors d''une édition (cf. producer_response_updated_at pour la dernière édition). NULL = pas encore publié ou supprimé sans avoir été publié.';

comment on column public.reviews.producer_response_updated_at is
  'Timestamp dernière édition de la réponse (pendant la fenêtre 24h). NULL = jamais édité depuis la publication initiale.';

comment on column public.reviews.producer_response_locked_at is
  'Timestamp à partir duquel la réponse devient figée (= producer_response_at + 24h). Vérifié côté API /api/producer/reviews/[id]/respond pour bloquer édition/suppression. Admin override : /api/admin/reviews/[id]/response peut supprimer après lock.';

comment on column public.reviews.producer_response_status is
  'Statut de la réponse : published (visible), removed_admin (supprimée par admin pour modération abusive), removed_producer (supprimée par producer dans les 24h). NULL = pas de réponse. Distinction du producer_response (NULL en cas de removed_*) permet de garder l''historique métadonnées même après suppression.';

-- Index pour query "réponses récemment éditables (< 24h)" — utile pour
-- futur dashboard producer et pour cron éventuel d'audit. Partial index
-- pour rester léger (la majorité des reviews n'auront pas de réponse).
create index if not exists idx_reviews_producer_response_lock
  on public.reviews (producer_response_locked_at)
  where producer_response is not null;

-- RLS additionnelle : producer (owns_producer) peut UPDATE sa réponse sur
-- ses reviews. RLS de base "reviews public read when published" couvre
-- déjà la lecture côté public (une review published expose ses colonnes,
-- y compris producer_response). On ajoute donc juste l'UPDATE producer.
--
-- Pattern (select auth.uid()) optimisé (cf. audit RLS lot 3-4) — owns_producer
-- est SECURITY DEFINER stable, pas besoin de wrap select.
--
-- Les checks applicatifs (lock 24h, ownership review.producer_id =
-- producer du caller, validation Zod) restent côté route API. La RLS
-- est defense-in-depth : empêche le bypass direct via supabase-js client
-- d'un user authentifié non-producer ou un producer essayant d'updater
-- la review d'un autre.

drop policy if exists "reviews producer response update" on public.reviews;

create policy "reviews producer response update"
  on public.reviews
  for update
  to authenticated
  using (public.owns_producer(producer_id))
  with check (public.owns_producer(producer_id));

-- 2. Table user_notification_preferences --------------------------------------

create table if not exists public.user_notification_preferences (
  user_id uuid primary key references public.users(id) on delete cascade,
  email_review_response boolean not null default true,
  -- Extensible : email_order_status, email_promotional, email_new_producer,
  -- etc. — chaque nouvelle pref = nouvelle colonne boolean not null default
  -- (true|false). Pas de stockage générique JSON pour rester typé.
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.user_notification_preferences is
  'Préférences notifications email par utilisateur (consumer ou producer). Row créée à la demande lors du premier toggle UI ou implicite via les defaults virtuels de getUserNotificationPreferences (lib/notifications/preferences.ts). Default toutes prefs = activées (opt-out, cohérent avec sms_optin existant et doctrine produit "communication active sauf opposition").';

comment on column public.user_notification_preferences.email_review_response is
  'Pref P0 (chantier 2026-05-06 droit de réponse) : recevoir un email quand le producer répond à un avis du consumer. Default = true. Si false, l''envoi via lib/notifications/send-review-response-email.ts est skip silencieusement (log info, pas d''erreur).';

-- Trigger updated_at (réutilise public.set_updated_at déjà en place pour
-- d'autres tables — payouts, slot_rules, etc.).
drop trigger if exists user_notification_preferences_set_updated_at
  on public.user_notification_preferences;

create trigger user_notification_preferences_set_updated_at
  before update on public.user_notification_preferences
  for each row
  execute function public.set_updated_at();

-- RLS : self-only. Pas d'accès admin (les prefs sont privées au user, l'admin
-- ne doit pas les lire ni modifier — pas d'usage produit ni légal pour un
-- override admin à ce stade).

alter table public.user_notification_preferences enable row level security;

drop policy if exists "user_notification_preferences self read"
  on public.user_notification_preferences;

create policy "user_notification_preferences self read"
  on public.user_notification_preferences
  for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "user_notification_preferences self insert"
  on public.user_notification_preferences;

create policy "user_notification_preferences self insert"
  on public.user_notification_preferences
  for insert
  to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "user_notification_preferences self update"
  on public.user_notification_preferences;

create policy "user_notification_preferences self update"
  on public.user_notification_preferences
  for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
