-- Migration : opposabilité juridique CGU/CGV via colonnes timestamp + version
-- sur public.users et public.orders. Persistance de l'acceptation explicite
-- au moment de l'inscription (CGU) et du checkout (CGV).
--
-- Champs nullables : les users (11 rows) et orders (19 rows) existants en prod
-- au moment de l'apply n'ont pas formellement accepté ces versions. Acceptation
-- rétroactive automatique = fields restent NULL, pas de blocage UI ni de
-- migration de données. Toute future modification substantielle des CGU/CGV
-- doit prévoir un flow "popup réacceptation" pour repasser les rows à la
-- nouvelle version (chantier dédié quand pertinent).

begin;

ALTER TABLE public.users
  ADD COLUMN cgu_accepted_at TIMESTAMPTZ NULL,
  ADD COLUMN cgu_version VARCHAR(10) NULL;

COMMENT ON COLUMN public.users.cgu_accepted_at IS
  'Timestamp acceptation CGU lors de l''inscription. NULL pour les comptes pré-2026-05-06 (acceptation rétroactive auto). Set par actions.ts:signupAction post-INSERT users.';

COMMENT ON COLUMN public.users.cgu_version IS
  'Version CGU acceptée (ex: "1.0"). Centralisée via lib/legal/versions.ts LEGAL_VERSIONS.CGU. Comparer à la version courante pour détecter les comptes nécessitant une réacceptation après modif substantielle.';

ALTER TABLE public.orders
  ADD COLUMN cgv_accepted_at TIMESTAMPTZ NULL,
  ADD COLUMN cgv_version VARCHAR(10) NULL;

COMMENT ON COLUMN public.orders.cgv_accepted_at IS
  'Timestamp acceptation CGV lors du checkout. NULL pour les commandes pré-2026-05-06. Set par /api/orders/create POST post-RPC create_order_with_items.';

COMMENT ON COLUMN public.orders.cgv_version IS
  'Version CGV acceptée (ex: "1.0"). Centralisée via lib/legal/versions.ts LEGAL_VERSIONS.CGV. Snapshot juridique au moment de la commande, n''évolue pas si CGV mises à jour ultérieurement.';

commit;
