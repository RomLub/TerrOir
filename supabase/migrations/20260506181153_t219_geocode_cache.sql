-- =============================================================================
-- T-219 : cache serveur géocodage CP→lat/lng
-- =============================================================================
-- Contexte : le DistanceWidget appelle aujourd'hui api-adresse.data.gouv.fr
-- directement depuis le navigateur, à chaque saisie de CP. Service public sans
-- SLA contractuel, pas de garantie de disponibilité ni rate-limit transparent.
-- Si le widget devient un point chaud trafic (post-launch, scaling Pays de la
-- Loire), on risque le goulot. Cf. T-204 (anticiper scaling) et T-226 (plan B
-- fournisseur géocodeur).
--
-- Décision Option α : table Supabase persistante. Rationale (vs Upstash KV ou
-- unstable_cache Next.js) : les CP français ne bougent jamais, donc TTL
-- inutile. La persistance permanente cross-deploy est le bon modèle, et
-- hit_count/last_hit_at donnent une observabilité SQL pour le scaling (top CP,
-- analytics). Cf. docs/fixes/geocode-cache-2026-05-06.md.
--
-- Continuité avec T-200 r1 ("zéro serveur géocodage, pas de PII traversant,
-- pas de log par-IP, pas de profilage user") : le cache geocode_cache stocke
-- uniquement (cp, lat, lng, source, resolved_at, hit_count, last_hit_at).
-- Aucune colonne IP, aucune jointure user→cp, hit_count est un compteur
-- agrégé anonyme. Le CP français est une donnée publique INSEE, pas une PII
-- personnelle. Le cache raffine T-200 r1 sans le contredire.
--
-- RLS : public read (lat/lng commune = donnée publique), service-role pour
-- les writes. Le helper applicatif (lib/geo/geocode-cache.ts) utilisera le
-- client admin (service_role) pour l'UPSERT après cache miss.
--
-- Pas de TTL : un CP français pointe toujours sur le même centroïde commune.
-- Si jamais l'API gouv.fr change ses coords (très rare, cas de fusion de
-- communes), un purge ciblé manuel par CP est suffisant.

CREATE TABLE IF NOT EXISTS public.geocode_cache (
  cp           VARCHAR(5)   PRIMARY KEY,
  lat          NUMERIC(10,7) NOT NULL,
  lng          NUMERIC(10,7) NOT NULL,
  source       VARCHAR(50)  NOT NULL DEFAULT 'api-adresse.data.gouv.fr',
  resolved_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  hit_count    INTEGER      NOT NULL DEFAULT 1,
  last_hit_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT geocode_cache_cp_format CHECK (cp ~ '^[0-9]{5}$'),
  CONSTRAINT geocode_cache_lat_range CHECK (lat BETWEEN -90 AND 90),
  CONSTRAINT geocode_cache_lng_range CHECK (lng BETWEEN -180 AND 180),
  CONSTRAINT geocode_cache_hit_count_positive CHECK (hit_count > 0)
);

COMMENT ON TABLE public.geocode_cache IS
  'T-219 — Cache persistant des résolutions CP français → coordonnées centroïde commune (api-adresse.data.gouv.fr). Pas de TTL (CP stable). Pas de PII (cf. continuité T-200 r1). hit_count = compteur agrégé anonyme pour analytics scaling (T-204).';

COMMENT ON COLUMN public.geocode_cache.cp IS
  'Code postal français à 5 chiffres (clé primaire). DOM-TOM inclus (97xxx/98xxx) bien que le DistanceWidget bascule message dédié au-delà de 500 km — cf. T-230.';
COMMENT ON COLUMN public.geocode_cache.lat IS
  'Latitude WGS84 du centroïde commune (api-adresse type=municipality). NUMERIC(10,7) ≈ précision 1 cm — la précision réelle dépend de l''API source.';
COMMENT ON COLUMN public.geocode_cache.lng IS
  'Longitude WGS84 du centroïde commune. Mêmes garanties que lat.';
COMMENT ON COLUMN public.geocode_cache.source IS
  'Service externe ayant fourni la résolution. Permet d''isoler les entries si bascule fournisseur (T-226 plan B).';
COMMENT ON COLUMN public.geocode_cache.resolved_at IS
  'Timestamp de la résolution initiale. Préservé sur UPSERT (ne pas écraser au INSERT ... ON CONFLICT).';
COMMENT ON COLUMN public.geocode_cache.hit_count IS
  'Compteur agrégé anonyme du nombre de hits cache. Incrémenté sur chaque GET cache hit. Ne contient AUCUNE info user/IP — utilisable pour identifier les CP les plus actifs sans risque RGPD.';
COMMENT ON COLUMN public.geocode_cache.last_hit_at IS
  'Timestamp du dernier hit. Permet de purger les entries dormantes si la table croît (non implémenté ici, à voir selon volumétrie).';

-- Index pour les analytics (top CP par activité récente / fréquence).
CREATE INDEX IF NOT EXISTS idx_geocode_cache_last_hit_at
  ON public.geocode_cache (last_hit_at DESC);

CREATE INDEX IF NOT EXISTS idx_geocode_cache_hit_count
  ON public.geocode_cache (hit_count DESC);

-- RLS : public read autorisé (donnée publique INSEE), writes réservés au
-- service_role (le helper backend utilise le client admin pour UPSERT).
ALTER TABLE public.geocode_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "geocode_cache_public_read" ON public.geocode_cache;
CREATE POLICY "geocode_cache_public_read"
  ON public.geocode_cache
  FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "geocode_cache_service_role_write" ON public.geocode_cache;
CREATE POLICY "geocode_cache_service_role_write"
  ON public.geocode_cache
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON POLICY "geocode_cache_public_read" ON public.geocode_cache IS
  'T-219 — Lecture publique autorisée : les coordonnées centroïde commune sont des données publiques INSEE, sans risque PII. Pas de jointure user→cp possible.';
COMMENT ON POLICY "geocode_cache_service_role_write" ON public.geocode_cache IS
  'T-219 — Writes réservés service_role. Le helper lib/geo/geocode-cache.ts utilise createSupabaseAdminClient() pour l''UPSERT après cache miss.';

-- =============================================================================
-- RPC bump_geocode_cache(cp) : cache hit path (atomique)
-- =============================================================================
-- Une seule requête : UPDATE ... RETURNING. Si la row existe, on incrémente
-- hit_count + last_hit_at et retourne lat/lng. Si elle n'existe pas, RETURNING
-- est vide → le helper interprète comme cache miss.
--
-- L'atomicité est garantie par Postgres au niveau row (pas de read-then-update
-- côté applicatif). Pas de race possible sur le compteur.

CREATE OR REPLACE FUNCTION public.bump_geocode_cache(
  p_cp VARCHAR(5)
) RETURNS TABLE(lat NUMERIC, lng NUMERIC)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE public.geocode_cache
     SET hit_count   = hit_count + 1,
         last_hit_at = NOW()
   WHERE cp = p_cp
  RETURNING lat, lng;
$$;

COMMENT ON FUNCTION public.bump_geocode_cache(VARCHAR) IS
  'T-219 — Cache hit path. UPDATE atomique hit_count + last_hit_at + RETURNING lat/lng. Vide si cache miss (le helper bascule alors sur upsert_geocode_cache).';

-- =============================================================================
-- RPC upsert_geocode_cache(cp, lat, lng, source) : cache write path (atomique)
-- =============================================================================
-- INSERT ... ON CONFLICT DO UPDATE qui PRÉSERVE resolved_at (timestamp de la
-- première résolution INSEE, utile en analytics pour repérer les CP cachés
-- depuis longtemps). Sur conflit, on incrémente hit_count comme un hit normal
-- (sémantiquement : la 2e requête concurrente cache-miss aurait dû être un
-- hit si la 1re avait fini avant).

CREATE OR REPLACE FUNCTION public.upsert_geocode_cache(
  p_cp     VARCHAR(5),
  p_lat    NUMERIC,
  p_lng    NUMERIC,
  p_source VARCHAR DEFAULT 'api-adresse.data.gouv.fr'
) RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  INSERT INTO public.geocode_cache (cp, lat, lng, source)
  VALUES (p_cp, p_lat, p_lng, p_source)
  ON CONFLICT (cp) DO UPDATE
     SET hit_count   = public.geocode_cache.hit_count + 1,
         last_hit_at = NOW();
$$;

COMMENT ON FUNCTION public.upsert_geocode_cache(VARCHAR, NUMERIC, NUMERIC, VARCHAR) IS
  'T-219 — Cache write path. INSERT ... ON CONFLICT DO UPDATE qui préserve resolved_at (premier passage INSEE). Sur race-condition cache miss, incrément hit_count cohérent avec bump_geocode_cache.';

-- Restreindre l'usage : seul le service_role peut bumper/upserter le cache.
-- Le client anon/authenticated peut SEULEMENT lire la table via la policy RLS
-- ci-dessus (lecture publique), pas appeler les fonctions de write.
REVOKE ALL ON FUNCTION public.bump_geocode_cache(VARCHAR)              FROM PUBLIC;
REVOKE ALL ON FUNCTION public.upsert_geocode_cache(VARCHAR, NUMERIC, NUMERIC, VARCHAR) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.bump_geocode_cache(VARCHAR)             TO service_role;
GRANT  EXECUTE ON FUNCTION public.upsert_geocode_cache(VARCHAR, NUMERIC, NUMERIC, VARCHAR) TO service_role;
