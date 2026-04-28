import {
  type GmsPrice,
  type GmsPriceFiliere,
} from "@/lib/gms-prices/fetch-active";
import { formatEuro } from "@/lib/format/currency";

// Section "Pièce par pièce" — 10 références gms_prices issues DB,
// groupées par filière (bovin / porcin / ovin) en 3 sous-sections cards.
//
// Côté lib Phase A on dispose de fetchActiveGmsPrices() qui retourne
// l'ensemble trié par ordre_affichage. On regroupe applicativement ici
// (1 roundtrip DB) plutôt que d'appeler 3 × fetchActiveGmsPricesByFiliere.

const FILIERE_LABELS: Record<GmsPriceFiliere, string> = {
  bovin: "Bœuf",
  porcin: "Porc",
  ovin: "Agneau",
};

const FILIERE_ORDER: GmsPriceFiliere[] = ["bovin", "porcin", "ovin"];

function groupByFiliere(refs: GmsPrice[]): Record<GmsPriceFiliere, GmsPrice[]> {
  const out: Record<GmsPriceFiliere, GmsPrice[]> = {
    bovin: [],
    porcin: [],
    ovin: [],
  };
  for (const r of refs) {
    out[r.filiere].push(r);
  }
  return out;
}

// Affiche une fourchette min–max si les deux sont présents, sinon le moyen,
// sinon "—". Le "/ kg" est rajouté en suffixe constant côté UI.
function formatPrixTerroirKg(p: GmsPrice): string {
  if (p.prix_terroir_kg_min !== null && p.prix_terroir_kg_max !== null) {
    return `${formatEuro(p.prix_terroir_kg_min)} – ${formatEuro(p.prix_terroir_kg_max)}`;
  }
  if (p.prix_terroir_kg_moyen !== null) {
    return formatEuro(p.prix_terroir_kg_moyen);
  }
  return "—";
}

export type ComparisonSectionProps = {
  refs: GmsPrice[];
  className?: string;
};

export function ComparisonSection({
  refs,
  className = "",
}: ComparisonSectionProps) {
  const grouped = groupByFiliere(refs);
  const hasAny = refs.length > 0;

  return (
    <section className={`bg-terroir-bg ${className}`}>
      <div className="mx-auto max-w-6xl px-4 py-16 md:py-20">
        <div className="mx-auto mb-12 max-w-[720px] text-center md:mb-14">
          <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-terra-700">
            Pièce par pièce
          </span>
          <h2 className="mt-4 font-serif text-[32px] font-medium leading-[1.1] tracking-[-0.005em] text-green-900 md:text-[44px]">
            Comparez les prix,
            <br />
            <em className="not-italic">
              <span className="italic text-terra-700">filière par filière.</span>
            </em>
          </h2>
          <p className="mx-auto mt-5 max-w-[560px] text-[15px] leading-[1.55] text-terroir-ink/[0.72]">
            Quelques pièces emblématiques en grande distribution face à leur
            équivalent chez nos producteurs sarthois.
          </p>
        </div>

        {!hasAny ? (
          <div className="mx-auto max-w-[480px] rounded-2xl border border-terroir-border bg-white p-8 text-center text-sm text-terroir-muted">
            Le tableau de comparaison est en cours de mise à jour. Repassez
            dans quelques jours.
          </div>
        ) : (
          <div className="space-y-12 md:space-y-14">
            {FILIERE_ORDER.map((filiere) => {
              const items = grouped[filiere];
              if (items.length === 0) return null;
              return (
                <FiliereGroup
                  key={filiere}
                  label={FILIERE_LABELS[filiere]}
                  items={items}
                />
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

type FiliereGroupProps = {
  label: string;
  items: GmsPrice[];
};

function FiliereGroup({ label, items }: FiliereGroupProps) {
  return (
    <div>
      <h3 className="mb-5 font-serif text-2xl font-medium leading-tight text-green-900 md:text-3xl">
        {label}
      </h3>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <PriceCard key={item.id} item={item} />
        ))}
      </div>
    </div>
  );
}

function PriceCard({ item }: { item: GmsPrice }) {
  const prixTerroir = formatPrixTerroirKg(item);
  return (
    <article className="flex h-full flex-col rounded-2xl border border-terroir-border bg-white p-5 shadow-soft">
      <h4 className="font-serif text-lg font-medium leading-snug text-green-900">
        {item.libelle}
      </h4>
      {item.description_courte ? (
        <p className="mt-1 text-xs text-terroir-muted leading-[1.5]">
          {item.description_courte}
        </p>
      ) : null}

      <dl className="mt-5 grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-terra-200 bg-terra-50 px-3 py-2.5">
          <dt className="text-[10px] font-semibold uppercase tracking-wide text-terra-700">
            Grande surface
          </dt>
          <dd className="mt-1 text-base font-semibold tabular-nums text-terra-900">
            {formatEuro(item.prix_gms_kg)}
            <span className="text-xs font-normal text-terra-700">&nbsp;/ kg</span>
          </dd>
        </div>
        <div className="rounded-xl border border-green-200 bg-green-50 px-3 py-2.5">
          <dt className="text-[10px] font-semibold uppercase tracking-wide text-green-700">
            Chez le producteur
          </dt>
          <dd className="mt-1 text-base font-semibold tabular-nums text-green-900">
            {prixTerroir}
            {prixTerroir !== "—" ? (
              <span className="text-xs font-normal text-green-700">&nbsp;/ kg</span>
            ) : null}
          </dd>
        </div>
      </dl>

      <p className="mt-4 text-[11px] text-terroir-muted leading-relaxed">
        Source : {item.source} · {item.mois_reference}
      </p>
    </article>
  );
}
