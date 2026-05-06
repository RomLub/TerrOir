import Link from "next/link";

// Page d'atterrissage post-clic du lien unsubscribe email. Mise à jour
// unsubscribed_at faite en amont par /api/stock-alerts/unsubscribe.

const MESSAGES: Record<
  string,
  { title: string; body: string; cta: string }
> = {
  success: {
    title: "Tu es désabonné(e)",
    body:
      "Tu ne recevras plus aucun email pour cette alerte stock. Si tu changes d'avis, tu peux créer une nouvelle alerte depuis la fiche produit.",
    cta: "Voir les producteurs",
  },
  already_unsubscribed: {
    title: "Désabonnement déjà effectué",
    body:
      "Tu étais déjà désinscrit(e) de cette alerte — aucun email ne te sera envoyé.",
    cta: "Voir les producteurs",
  },
  invalid: {
    title: "Lien de désabonnement invalide",
    body:
      "Ce lien n'est pas reconnu. Si tu reçois encore des emails non souhaités, contacte-nous via le formulaire de support.",
    cta: "Voir les producteurs",
  },
};

const FALLBACK = MESSAGES.invalid;

export default function StockAlertUnsubscribePage({
  searchParams,
}: {
  searchParams: { status?: string };
}) {
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
