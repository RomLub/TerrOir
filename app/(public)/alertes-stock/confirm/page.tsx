import Link from "next/link";

// Page d'atterrissage post-clic du lien email confirm. Pure UX : la mise à
// jour confirmed_at a été faite en amont par /api/stock-alerts/confirm
// avant le redirect 303. Ici on lit le query param `status` (renvoyé par
// la route API) et on rend un message ciblé.
//
// Server Component : pas d'interaction (juste un lien retour), tout est
// rendu côté serveur depuis searchParams.

const MESSAGES: Record<
  string,
  { title: string; body: string; cta: string }
> = {
  success: {
    title: "Ton alerte est confirmée",
    body:
      "Tu recevras un email dès que ce produit sera à nouveau disponible. Tu peux te désabonner à tout moment depuis le lien en pied d'email.",
    cta: "Continuer mes achats",
  },
  already_confirmed: {
    title: "Alerte déjà active",
    body:
      "Cette alerte avait déjà été confirmée. Tu seras bien prévenu(e) au retour en stock.",
    cta: "Retour aux producteurs",
  },
  expired: {
    title: "Lien de confirmation expiré",
    body:
      "Ce lien de confirmation est expiré (validité 7 jours). Pour réactiver l'alerte, retourne sur la fiche du produit et crées-en une nouvelle.",
    cta: "Voir les producteurs",
  },
  unsubscribed: {
    title: "Désabonnement déjà effectué",
    body:
      "Tu t'étais désabonné(e) de cette alerte. Pour la réactiver, retourne sur la fiche produit et crée une nouvelle alerte.",
    cta: "Voir les producteurs",
  },
  invalid: {
    title: "Lien de confirmation invalide",
    body:
      "Ce lien n'est pas reconnu. Vérifie que tu as cliqué le lien le plus récent reçu par email, ou crée une nouvelle alerte depuis la fiche produit.",
    cta: "Voir les producteurs",
  },
};

const FALLBACK = MESSAGES.invalid;

export default async function StockAlertConfirmPage(
  props: {
    searchParams: Promise<{ status?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const status = searchParams.status ?? "";
  const message = MESSAGES[status] ?? FALLBACK;

  return (
    <section className="bg-bg">
      <div className="max-w-lg mx-auto px-6 py-20 md:py-28">
        <h1 className="font-serif text-[36px] md:text-[44px] text-green-900 leading-tight">
          {message.title}
        </h1>
        <p className="mt-4 text-[15px] text-dark/70 leading-relaxed">
          {message.body}
        </p>
        <div className="mt-8">
          <Link
            href="/producteurs"
            className="inline-block px-5 py-3 bg-green-900 text-white rounded-md font-medium hover:bg-green-800 transition"
          >
            {message.cta}
          </Link>
        </div>
      </div>
    </section>
  );
}
