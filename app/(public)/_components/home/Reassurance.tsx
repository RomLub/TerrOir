// Section Réassurance (homepage.html .reassure) — 4 arguments en grid.
//
// Pas d'eyebrow ni de H2 (cf. screen DS), juste 4 cards icon + titre +
// body. Layout : 4 cols desktop (lg+), 2 cols tablet, stack mobile.
// Icônes SVG inline stroke terra-700 (cohérent règle DS : icônes en
// terra dans cette section, vs green dans Steps).
//
// Important copy : éviter "sans intermédiaire" pour parler du flux
// d'argent (TerrOir prélève une commission). Ici "Pas de centrale
// d'achat, pas de plateforme intermédiaire" est OK car parle de
// distribution physique humaine, pas de paiement.

type Item = {
  icon: React.ReactNode;
  title: string;
  body: string;
};

function PinIcon() {
  return (
    <svg viewBox="0 0 40 40" aria-hidden="true">
      <path d="M20 36 C12 28 8 22 8 17 a12 12 0 0 1 24 0 C32 22 28 28 20 36 Z" />
      <circle cx="20" cy="17" r="4" />
    </svg>
  );
}

function ShieldCheckIcon() {
  return (
    <svg viewBox="0 0 40 40" aria-hidden="true">
      <path d="M20 5 L33 10 V20 c0 8 -6 14 -13 16 c-7 -2 -13 -8 -13 -16 V10 Z" />
      <path d="M14 20 L18 24 L26 16" />
    </svg>
  );
}

function PeopleIcon() {
  return (
    <svg viewBox="0 0 40 40" aria-hidden="true">
      <circle cx="20" cy="14" r="6" />
      <path d="M8 34 a12 12 0 0 1 24 0" />
      <path d="M14 30 c2 -1 4 -1 6 -1 c2 0 4 0 6 1" />
    </svg>
  );
}

function BasketLockIcon() {
  return (
    <svg viewBox="0 0 40 40" aria-hidden="true">
      <rect x="6" y="14" width="28" height="20" rx="2" />
      <path d="M12 14 V10 a8 8 0 0 1 16 0 V14" />
      <circle cx="20" cy="24" r="2.5" />
    </svg>
  );
}

const ITEMS: Item[] = [
  {
    icon: <PinIcon />,
    title: "Producteurs sarthois exclusivement",
    body: "Tous nos partenaires sont installés en Sarthe, à moins de 60 km du Mans. Nous les visitons avant de les référencer.",
  },
  {
    icon: <ShieldCheckIcon />,
    title: "Paiement en ligne sécurisé",
    body: "Carte bancaire ou Apple Pay via Stripe. Aucune donnée stockée chez nous, le producteur reçoit son virement directement.",
  },
  {
    icon: <PeopleIcon />,
    title: "Circuit court, humain",
    body: "Pas de centrale d’achat, pas de plateforme intermédiaire. Vous achetez à un éleveur, il vous remet votre commande lui-même.",
  },
  {
    icon: <BasketLockIcon />,
    title: "Retrait à la ferme ou en point relais",
    body: "Choisissez le créneau qui vous arrange parmi ceux que le producteur propose. Pas de livraison aléatoire, pas de frais cachés.",
  },
];

export type ReassuranceProps = { className?: string };

export function Reassurance({ className = "" }: ReassuranceProps) {
  return (
    <section className={`bg-terroir-bg ${className}`}>
      <div className="mx-auto max-w-6xl px-4 py-16 md:py-20">
        <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {ITEMS.map((item) => (
            <div key={item.title}>
              <div className="mb-4 h-10 w-10 text-terra-700 [&_svg]:h-full [&_svg]:w-full [&_svg]:fill-none [&_svg]:stroke-current [&_svg]:[stroke-linecap:round] [&_svg]:[stroke-linejoin:round] [&_svg]:[stroke-width:1.5]">
                {item.icon}
              </div>
              <h3 className="text-base font-semibold leading-[1.3] text-terroir-ink">
                {item.title}
              </h3>
              <p className="mt-1.5 text-sm leading-[1.55] text-terroir-ink/[0.65]">
                {item.body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
