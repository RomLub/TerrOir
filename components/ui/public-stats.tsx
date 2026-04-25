import { getPublicStats } from "@/lib/stats/public-stats";

// Bandeau "TerrOir en chiffres" affiché sur la home consumer.
// Server Component : les counts sont fetchés au render (cachés 5 min via
// unstable_cache dans getPublicStats).
//
// Affichage piloté par la crédibilité (credibility-driven display) :
//  1. On filtre les stats à 0 — afficher "0 Commandes" sur la home tue le
//     signal "marketplace active" qu'on cherche à donner.
//  2. Si toutes les stats sont à 0 (cas pré-lancement), on skip la section
//     entièrement plutôt que d'afficher un message "vide".
//  3. Le layout s'adapte au nombre de stats restantes (1, 2 ou 3 colonnes
//     desktop ; toujours stack vertical mobile).

const NUMBER_FORMATTER = new Intl.NumberFormat("fr-FR");

function pluralize(count: number, singular: string, plural: string): string {
  // Français : 0 et 1 → singulier, sinon pluriel.
  return count >= 2 ? plural : singular;
}

type StatItem = {
  value: number;
  singular: string;
  plural: string;
};

// Tailwind ne peut pas interpoler les classes dynamiquement (tree-shaking),
// donc on mappe explicitement le nombre de colonnes à la classe complète.
const GRID_COLS_CLASS: Record<1 | 2 | 3, string> = {
  1: "md:grid-cols-1",
  2: "md:grid-cols-2",
  3: "md:grid-cols-3",
};

export async function PublicStats() {
  const { producersCount, ordersCount, productsCount } = await getPublicStats();

  const allItems: StatItem[] = [
    {
      value: producersCount,
      singular: "Producteur actif",
      plural: "Producteurs actifs",
    },
    {
      value: ordersCount,
      singular: "Commande passée",
      plural: "Commandes passées",
    },
    {
      value: productsCount,
      singular: "Produit disponible",
      plural: "Produits disponibles",
    },
  ];

  const items = allItems.filter((item) => item.value > 0);
  if (items.length === 0) {
    return null;
  }

  const gridColsClass = GRID_COLS_CLASS[items.length as 1 | 2 | 3];

  return (
    <section className="bg-white">
      <div className="mx-auto max-w-6xl px-4 py-12 md:py-16">
        <div className="mb-8 flex flex-col gap-1 text-center md:mb-10">
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-terroir-green-700">
            TerrOir en chiffres
          </span>
          <h2 className="font-serif text-3xl text-terroir-ink md:text-4xl">
            Une marketplace déjà active
          </h2>
        </div>
        <dl
          className={`grid grid-cols-1 divide-y divide-terroir-border ${gridColsClass} md:divide-x md:divide-y-0`}
        >
          {items.map((item) => (
            <div
              key={item.singular}
              className="flex flex-col items-center gap-1 px-4 py-6 text-center md:py-4"
            >
              <dt className="order-2 text-sm text-terroir-muted">
                {pluralize(item.value, item.singular, item.plural)}
              </dt>
              <dd className="order-1 font-serif text-5xl tabular-nums text-terroir-green-700 md:text-6xl">
                {NUMBER_FORMATTER.format(item.value)}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
