-- =============================================================================
-- TerrOir — F-031 : doctrine d'accès producers (COMMENT)
-- =============================================================================
-- Audit pré-launch 2026-05 (docs/AUDIT_PRELAUNCH_2026.md F-031) :
-- recommandation initiale = DROP des 2 policies SELECT supposées "mortes"
-- (producers public read when public + producers owner read).
--
-- Vérification empirique sweep P0 (2026-05-11) :
--   • Bien que table-level GRANT SELECT soit REVOKED pour anon/authenticated,
--     les COLUMN-level GRANT SELECT existent sur la majorité des colonnes
--     (sauf latitude/longitude + colonnes admin-only ciblées par
--     cluster_a_privacy_lat_lng + T-218).
--   • SET LOCAL ROLE authenticated; SELECT FROM producers LIMIT 1 retourne
--     bien des rows → les policies SELECT fire (statut='public' filter +
--     auth.uid()=user_id filter).
--   • middleware.ts (cookie SSR) lit producers.statut pour le producer
--     courant via "producers owner read".
--   • components/providers/user-provider.tsx (browser client) lit
--     id/slug/nom_exploitation/statut via "producers owner read".
--   • Plusieurs pages /producteur/* (parametres, catalogue, ma-page)
--     lisent leur propre row via cookie/browser client → policy "owner read".
--
-- DROP des 2 policies = casse middleware + user-provider + ~5+ pages
-- producer (refactor 10+ fichiers vers admin client ou nouvelle RPC).
-- Coût > bénéfice : la sécurité réelle est portée par les COLUMN-level
-- REVOKE sur (latitude, longitude) + les colonnes admin-only.
--
-- Décision sweep P0 :
--   • PAS de DROP — policies conservées (defense-in-depth row-level)
--   • COMMENT ON TABLE pour documenter le contrat canonique
--   • Le vrai garde-fou est column-level — tout futur dev qui rétablirait
--     GRANT SELECT (latitude, longitude) à anon/authenticated doit être
--     bloqué par code review + ce comment.
-- =============================================================================

comment on table public.producers is
$$F-031 (audit P0 sweep 2026-05-11) — Doctrine d'accès :

ACCÈS CANONIQUE (à privilégier toujours) :
  • Listing public + recherche → RPC public.search_producers (SECDEF, applique
    filtres statut='public' + floutage roundCoord 2 décimales).
  • Fiche publique par slug → lib/producers/fetch-public.ts (admin client +
    roundCoord côté serveur, T-217 Option A).
  • Mutations producer (onboarding, updates) → RPC update_producer_onboarding
    (SECDEF, service_role exclusivement).

POLICIES SELECT EN PLACE (conservées en defense-in-depth row-level) :
  • "producers owner read"            → auth.uid() = user_id  (own row)
  • "producers public read when public" → statut = 'public'   (public listing)
  • "producers admin all"             → is_admin()             (admin tools)

SÉCURITÉ EFFECTIVE (column-level REVOKE) :
  • latitude / longitude REVOKE anon+authenticated (cluster_a_privacy_lat_lng
    2026-05-07) — defense critique contre re-identification adresse.
  • Colonnes admin-only (statut, abonnement_*, stripe_*, badge_*,
    declaration_indicateurs_*, deleted_at, etc.) protégées par trigger
    T-218 producers_block_owner_admin_columns_trigger (BEFORE UPDATE bloque
    self-update non-admin).

INTERDICTIONS :
  • NE JAMAIS GRANT SELECT (latitude, longitude) à anon ou authenticated.
    Si jamais besoin futur, OBLIGATOIRE via RPC SECDEF qui applique roundCoord.
  • NE JAMAIS exposer raw lat/lng via PostgREST direct depuis client cookie
    ou browser. Cf. tests/meta/no-raw-coords-leak.test.ts.
  • NE PAS ajouter de nouvelle policy SELECT directe sans audit RLS préalable
    (privilégier RPC SECDEF + service_role).
$$;
