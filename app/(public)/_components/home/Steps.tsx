// Section "Du pré à ta table, en trois étapes" (homepage.html .steps).
//
// 3 étapes horizontales desktop / stack mobile, sur fond blanc. Icônes
// SVG inline stroke green-700 (pattern repo : pas de bibliothèque
// externe). Numérotation 01/02/03 dans une pastille terra-100.
//
// CRITIQUE copy : étape 02 = « Payer en ligne · Réglez en sécurité »,
// JAMAIS « Payer sur place » (modèle Stripe Connect, cf. règles
// copywriting 00_DESIGN_SYSTEM.md).

type Step = {
  num: string;
  numLabel: string;
  icon: React.ReactNode;
  title: string;
  body: string;
};

function BasketIcon() {
  return (
    <svg viewBox="0 0 56 56" aria-hidden="true">
      <path d="M14 18 L42 18 L40 46 L16 46 Z" />
      <path d="M22 18 V14 a6 6 0 0 1 12 0 V18" />
      <circle cx="22" cy="28" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="34" cy="28" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

function CardIcon() {
  return (
    <svg viewBox="0 0 56 56" aria-hidden="true">
      <rect x="8" y="14" width="40" height="28" rx="3" />
      <line x1="8" y1="22" x2="48" y2="22" />
      <circle cx="16" cy="32" r="2" />
      <line x1="22" y1="32" x2="32" y2="32" />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg viewBox="0 0 56 56" aria-hidden="true">
      <path d="M28 50 C18 36 14 28 14 22 a14 14 0 0 1 28 0 C42 28 38 36 28 50 Z" />
      <circle cx="28" cy="22" r="5" />
    </svg>
  );
}

const STEPS: Step[] = [
  {
    num: "1",
    numLabel: "Choisir",
    icon: <BasketIcon />,
    title: "Compose ton panier",
    body: "Parcours les fermes près de chez toi, ajoute les produits du moment. Chaque fiche indique le producteur, sa commune et son mode d'élevage.",
  },
  {
    num: "2",
    numLabel: "Payer en ligne",
    icon: <CardIcon />,
    title: "Réglez en sécurité",
    body: "Paiement en ligne sécurisé par Stripe. Le producteur reçoit directement le fruit de son travail, TerrOir prélève une petite commission pour faire vivre la marketplace.",
  },
  {
    num: "3",
    numLabel: "Récupérer",
    icon: <PinIcon />,
    title: "Récupère chez le producteur",
    body: "Choisis ton créneau de retrait à la ferme ou en point relais sarthois. On te guide jusqu'à l'éleveur, tu repars avec ta commande.",
  },
];

export type StepsProps = { className?: string };

export function Steps({ className = "" }: StepsProps) {
  return (
    <section
      className={`border-y border-terroir-border bg-white ${className}`}
    >
      <div className="mx-auto max-w-6xl px-4 py-16 md:py-20">
        <div className="mx-auto mb-12 max-w-[720px] text-center md:mb-14">
          <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-terra-700">
            Comment ça marche
          </span>
          <h2 className="mt-4 font-serif text-[32px] font-medium leading-[1.1] tracking-[-0.005em] text-green-900 md:text-[44px]">
            Du pré à ta table,
            <br />
            en{" "}
            <em className="not-italic">
              <span className="italic text-terra-700">trois étapes.</span>
            </em>
          </h2>
        </div>
        <div className="grid gap-8 md:grid-cols-3 md:gap-7">
          {STEPS.map((step) => (
            <div key={step.num}>
              <div className="mb-4 inline-flex items-center gap-2.5">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-terra-100 text-sm font-semibold text-terra-700">
                  {step.num}
                </span>
                <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-terroir-muted">
                  {step.numLabel}
                </span>
              </div>
              <div className="mb-4 h-14 w-14 text-green-700 [&_svg]:h-full [&_svg]:w-full [&_svg]:fill-none [&_svg]:stroke-current [&_svg]:[stroke-linecap:round] [&_svg]:[stroke-linejoin:round] [&_svg]:stroke-[1.5]">
                {step.icon}
              </div>
              <h3 className="font-serif text-[26px] font-medium leading-[1.2] text-green-900">
                {step.title}
              </h3>
              <p className="mt-2.5 max-w-[320px] text-[15px] leading-[1.65] text-terroir-ink/[0.72]">
                {step.body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
