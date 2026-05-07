-- =============================================================================
-- E2E test infra : test_emails_captured
-- =============================================================================
-- Contexte : la suite Playwright e2e exhaustive (~164 tests) doit pouvoir
-- assert sur les emails envoyés sans consommer le quota Resend (3000/mois).
-- Solution : flag RESEND_TEST_MODE dans lib/resend/send.ts qui, quand actif,
-- écrit les emails dans cette table au lieu d'appeler resend.emails.send().
--
-- Le flag est strictement gated NODE_ENV !== 'production' côté code applicatif
-- pour empêcher toute activation accidentelle en prod (cf. send.ts).
--
-- Sécurité : RLS deny-all + GRANT service_role only. Aucun client anon ou
-- authenticated ne peut lire ni écrire la table. Seul le serveur applicatif
-- (createSupabaseAdminClient = service_role) peut INSERT depuis send.ts, et
-- les helpers e2e (mailbox.ts) lisent via le même client admin.
--
-- Données : pas de PII applicatives au sens strict (les emails capturés sont
-- toujours des emails de test playwright-test-{ts}@mailinator.com — cf. guard
-- assertSafeEmail dans tests/e2e/helpers/guards.ts), mais on conserve le
-- contenu HTML complet pour les assertions de tests (présence d'un lien OTP,
-- d'un nom producteur, etc.).
--
-- Cleanup : la table est purgée par le global-teardown Playwright en fin de
-- suite. Pas de TTL DB côté Postgres (la table est destinée à rester quasi-
-- vide en dehors des runs e2e).

CREATE TABLE IF NOT EXISTS public.test_emails_captured (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  to_email      TEXT         NOT NULL,
  from_email    TEXT         NOT NULL,
  subject       TEXT         NOT NULL,
  template      TEXT         NOT NULL,
  html          TEXT,
  metadata      JSONB        NOT NULL DEFAULT '{}'::jsonb,
  user_id       UUID,
  captured_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.test_emails_captured IS
  'E2E capture: emails écrits ici quand RESEND_TEST_MODE=true (gated NODE_ENV != production). Lu par mailbox.ts pour assertions tests. Purgé par global-teardown Playwright. RLS deny-all + service_role only.';

COMMENT ON COLUMN public.test_emails_captured.to_email IS
  'Email destinataire. Toujours un email playwright-test-{ts}@mailinator.com en pratique (allow-list assertSafeEmail côté helpers e2e).';
COMMENT ON COLUMN public.test_emails_captured.template IS
  'Identifiant du template (ex: order-confirmed-consumer, email-change-otp-current). Permet le filtrage par mailbox.waitForCapturedEmail.';
COMMENT ON COLUMN public.test_emails_captured.html IS
  'Contenu HTML rendu par @react-email/render. Stocké pour assertions de tests (lien OTP, nom producteur, montant, etc.). Peut être NULL si capture pre-render fail.';
COMMENT ON COLUMN public.test_emails_captured.metadata IS
  'Mêmes champs que metadata des notifications (resend_id, error, skip_reason, etc.) + champs spécifiques capture si pertinent.';
COMMENT ON COLUMN public.test_emails_captured.user_id IS
  'user_id du destinataire si applicable (mêmes sémantiques que notifications.user_id). NULL pour emails system (welcome anon, etc.).';

-- Index pour les lookups les plus fréquents côté mailbox helper :
--   waitForCapturedEmail(to, subject) → idx_to_subject
--   listCapturedEmailsByTemplate(template) → idx_template
CREATE INDEX IF NOT EXISTS idx_test_emails_captured_to_subject
  ON public.test_emails_captured (to_email, subject, captured_at DESC);

CREATE INDEX IF NOT EXISTS idx_test_emails_captured_template
  ON public.test_emails_captured (template, captured_at DESC);

-- Sécurité ACL : RLS deny-all, REVOKE explicite sur PUBLIC/anon/authenticated,
-- GRANT explicite sur service_role uniquement.
ALTER TABLE public.test_emails_captured ENABLE ROW LEVEL SECURITY;

-- Pas de policy = deny-all par défaut sous RLS pour anon/authenticated.
-- service_role bypass RLS de Postgres → écrit/lit librement.
-- On ajoute néanmoins une policy explicite "deny-all" documentaire pour que
-- l'intent soit visible à la lecture du schema (pas que silence par défaut).
DROP POLICY IF EXISTS "test_emails_captured_deny_all" ON public.test_emails_captured;
CREATE POLICY "test_emails_captured_deny_all"
  ON public.test_emails_captured
  FOR ALL
  TO public
  USING (false)
  WITH CHECK (false);

COMMENT ON POLICY "test_emails_captured_deny_all" ON public.test_emails_captured IS
  'Deny-all explicite pour anon/authenticated. service_role bypass RLS Postgres → seul access légitime. Doctrine FORCE RLS TerrOir (CLAUDE.md).';

-- Defense in depth : REVOKE ALL avant GRANT service_role pour annuler les
-- GRANTs default Postgres (notamment grant USAGE PUBLIC sur le schema public
-- qui ne suffit pas pour table mais reste une convention claire).
REVOKE ALL ON public.test_emails_captured FROM PUBLIC;
REVOKE ALL ON public.test_emails_captured FROM anon;
REVOKE ALL ON public.test_emails_captured FROM authenticated;

GRANT ALL ON public.test_emails_captured TO service_role;
