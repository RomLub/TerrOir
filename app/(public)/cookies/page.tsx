import type { Metadata } from "next";
import { cookies } from "next/headers";
import {
  COOKIE_CONSENT_NAME,
  hasMadeChoice,
  parseConsent,
} from "@/lib/rgpd/cookie-consent";
import { CookieSettingsForm } from "./_components/CookieSettingsForm";

// =============================================================================
// Page /cookies — F-012 audit pré-launch 2026-05-10.
// =============================================================================
// Détail granulaire du consentement cookies + possibilité de modifier
// le consent existant. Accessible cross-subdomain.
//
// État actuel du consent lu côté server via le cookie HTTP. La modification
// se fait via un composant client (write-cookie côté browser, pas server
// action — pas besoin d'audit log forensique sur les préférences cookies).
//
// ⚠️ La bannière (composant CookieBanner) n'est PAS encore activée dans le
// layout consumer (préparation pour le chantier T-201 PostHog). Cette page,
// elle, est accessible pour permettre à un user de consulter / modifier
// son consent quand la bannière sera activée plus tard.
// =============================================================================

export const metadata: Metadata = {
  title: "Cookies — TerrOir",
  description:
    "Politique cookies de TerrOir : catégories utilisées, finalités, et gestion du consentement.",
};

const LAST_UPDATED = "10 mai 2026";

export default async function CookiesPage() {
  const cookieStore = await cookies();
  const raw = cookieStore.get(COOKIE_CONSENT_NAME)?.value ?? null;
  const consent = parseConsent(raw);
  const choiceMade = hasMadeChoice(consent);

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold text-terroir-ink">
          Politique cookies
        </h1>
        <p className="text-sm text-terroir-muted">
          Dernière mise à jour : {LAST_UPDATED}
        </p>
      </header>

      <section className="prose prose-terroir mt-8 max-w-none">
        <h2>Pourquoi cette page ?</h2>
        <p>
          TerrOir respecte la directive ePrivacy et le RGPD. Tu choisis quels
          cookies sont posés sur ton navigateur, et tu peux modifier ton
          choix ici à tout moment.
        </p>

        <h2>Catégories de cookies</h2>

        <h3>1. Cookies essentiels (toujours actifs)</h3>
        <p>
          Indispensables au fonctionnement du site&nbsp;: session de
          connexion, panier, jeton anti-CSRF. Sans eux, tu ne peux pas te
          connecter ni passer commande. Ils ne nécessitent pas de
          consentement (article 82 de la loi Informatique et Libertés).
        </p>

        <h3>2. Mesure d&rsquo;audience (opt-in)</h3>
        <p>
          Nous aide à comprendre comment le site est utilisé, ce qui marche
          et ce qui ne marche pas. Pas de revente, pas de partage avec des
          tiers à des fins publicitaires. Aujourd&rsquo;hui, aucun outil de
          mesure d&rsquo;audience n&rsquo;est encore branché côté TerrOir —
          cette catégorie sera utilisée quand nous activerons un outil
          d&rsquo;analytique respectueux de la vie privée.
        </p>

        <h3>3. Marketing (opt-in)</h3>
        <p>
          Personnalisation des contenus / publicités tierces. TerrOir
          n&rsquo;utilise pas de cookies marketing aujourd&rsquo;hui. La
          catégorie est listée par anticipation et reste désactivée par
          défaut.
        </p>

        <h2>Comment refuser ou modifier mon choix ?</h2>
        <p>
          Le formulaire ci-dessous reflète ton consentement actuel et te
          permet de le modifier à tout moment. Tu peux aussi supprimer le
          cookie <code>{COOKIE_CONSENT_NAME}</code> depuis les paramètres
          de ton navigateur — la prochaine visite te re-demandera ton
          consentement.
        </p>

        <h2>Durée de conservation</h2>
        <p>
          Le cookie de consentement est conservé 13 mois (recommandation
          CNIL). Au-delà, ton consentement est re-demandé.
        </p>
      </section>

      <section className="mt-10 rounded-lg border border-terroir-border bg-white p-5">
        <h2 className="text-xl font-semibold text-terroir-ink">
          Mes préférences
        </h2>
        {!choiceMade && (
          <p className="mt-2 text-sm text-amber-700">
            Tu n&rsquo;as pas encore exprimé de choix explicite. Les
            catégories opt-in sont désactivées par défaut.
          </p>
        )}
        <div className="mt-4">
          <CookieSettingsForm initialConsent={consent} />
        </div>
      </section>
    </main>
  );
}
