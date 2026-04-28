-- =============================================================================
-- TerrOir — producer_interests : contrainte UNIQUE (email) pour déduplication
-- =============================================================================
-- Contexte (mini-chantier "Déduplication leads producteurs", 2026-04-28) :
-- Bug détecté en prod : 2 emails dupliqués dans producer_interests
-- (lubin.rom@gmail.com x2, test-phase3-newuser@mailinator.com x2). Écart
-- temporel plusieurs minutes entre les submits → vraies re-soumissions
-- volontaires (pas double-clic accidentel). Le formulaire public
-- /devenir-producteur permet aujourd'hui à un même email de soumettre
-- plusieurs fois sans blocage ni déduplication.
--
-- Sémantique sur conflit (gérée applicativement dans la nouvelle route
-- POST /api/producer-interests, pas en DB) : UPSERT — INSERT puis catch
-- SQLSTATE 23505 puis UPDATE des champs business {prenom, nom, telephone,
-- nom_exploitation, commune, message}. Champs PRÉSERVÉS sur conflit :
--   - statut : workflow CRM admin (new → contacted → onboarded), un
--     re-submit user ne doit pas reset à 'new'
--   - source : canal d'origine (formulaire_public vs invitation_directe),
--     traçabilité funnel
--   - created_at : date d'origine, analytics funnel
--
-- ⚠️ PRÉ-REQUIS APPLICATION PROD :
-- Cette migration plantera tant que les 2 doublons existants restent en
-- base (la contrainte UNIQUE rétroactive échouerait sur les rows dupliquées).
-- Avant d'apply cette migration, run en SQL Editor :
--
--   DELETE FROM producer_interests
--   WHERE id IN (
--     '289423fb-2485-44df-9b41-e6663ffb8ea7',  -- lubin doublon ancien
--     'b821b36b-6d54-4f76-b2f9-47cc12f68637'   -- test-phase3 doublon ancien
--   );
--
-- Puis vérifier `SELECT email, COUNT(*) FROM producer_interests GROUP BY
-- email HAVING COUNT(*) > 1;` retourne 0 rows avant d'apply la migration.
--
-- Idempotence : `drop constraint if exists` avant `add constraint` permet
-- de relancer la migration sans erreur si elle a déjà été appliquée
-- (CREATE CONSTRAINT IF NOT EXISTS n'existe pas en Postgres avant 15+,
-- on évite la dépendance à une version min).
-- =============================================================================

begin;

alter table public.producer_interests
  drop constraint if exists producer_interests_email_key;

alter table public.producer_interests
  add constraint producer_interests_email_key unique (email);

commit;
