-- ============================================================================
-- F-006 (audit P0-TC 2026-05-10) — Validation côté Storage Supabase
-- ============================================================================
-- Avant : buckets `producer-photos` + `product-photos` sans cap taille ni
-- whitelist MIME → producer authentifié pouvait uploader du HTML servi
-- `text/html`, du JS `text/javascript`, des PDF phishing ou un fichier
-- multi-GB sur la CDN Supabase TerrOir. CSP empêchait l'embed depuis
-- l'app mais le fichier restait publiquement servable depuis
-- `<project>.supabase.co/...` — vecteur d'abus stockage et phishing
-- avalisé par sous-domaine de service connu.
--
-- Après : 5 MB max + image/jpeg|png|webp uniquement. Defense-in-depth
-- côté Storage, complémentaire à la validation côté
-- `lib/producers/upload.ts` (helper applicatif = whitelist extensions
-- + cap taille + contentType dérivé serveur ; Storage = dernière
-- barrière si quelqu'un bypass le helper côté admin/service-role).
--
-- Pas de DDL CREATE/ALTER : `storage.buckets` est une table managée
-- Supabase, on UPDATE les colonnes de configuration uniquement.
--
-- Idempotence : UPDATE conditionnel sur `id IN (...)` — réexécution
-- safe (pose les mêmes valeurs). Pas de WHERE supplémentaire pour
-- préserver la simplicité.
-- ============================================================================

UPDATE storage.buckets
SET
  file_size_limit = 5242880, -- 5 MB
  allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp']
WHERE id IN ('producer-photos', 'product-photos');
