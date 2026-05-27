import { describe, it, expect, vi } from "vitest";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Tests des cartes « mise en ligne » du dashboard producteur. On teste les
// sous-composants isolément (PublicationTodoCard / PublicationWaitCard)
// plutôt que le DashboardClient complet — pas de useEffect Supabase realtime
// à mocker, et la logique métier vit toute dans ces sous-composants.

// `next/link` mock minimal : renderToStaticMarkup gère <a> natif.
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

// `@/lib/supabase/client` est importé top-level par DashboardClient mais
// non-exécuté lors d'un simple import ; stub minimal pour éviter toute
// initialisation côté browser-client.
vi.mock("@/lib/supabase/client", () => ({
  createSupabaseBrowserClient: () => ({}),
}));

// `@/components/ui` et `WeekNavigator` sont importés top-level par
// DashboardClient — stubs minimaux pour ne pas faire crasher l'import.
vi.mock("@/components/ui", () => ({
  Button: () => null,
  ProducerBadge: () => null,
}));

// WeekNavigator est importé transitivement par DashboardClient mais n'est
// jamais instancié dans ces tests — pas besoin de mock, ses imports
// (next/navigation) sont safe au load.

import {
  PublicationTodoCard,
  PublicationWaitCard,
} from "@/app/(producer)/dashboard/DashboardClient";
import type { CriterionKey } from "@/lib/producers/publication-criteria";

function render(el: ReactElement): string {
  return renderToStaticMarkup(el);
}

describe("PublicationTodoCard — états progression", () => {
  it("0/6 : liste les 4 premières étapes restantes et signale qu'il en reste 2 autres", () => {
    const missing: CriterionKey[] = [
      "description",
      "photo_principale",
      "localisation",
      "product_with_photo",
      "open_slot",
      "stripe",
    ];
    const html = render(
      <PublicationTodoCard doneCount={0} missingKeys={missing} />,
    );
    expect(html).toContain("Finalisez votre mise en ligne (0/6 étapes)");
    expect(html).toContain("Description");
    expect(html).toContain("Photo de couverture");
    expect(html).toContain("Localisation");
    expect(html).toContain("1 produit avec photo");
    // Au-delà de PUBLICATION_INLINE_MAX (4) : les 2 dernières en overflow.
    expect(html).toContain("et 2 autres…");
    expect(html).not.toContain("1 créneau ouvert");
    expect(html).not.toContain("Paiements activés");
    expect(html).toContain("Voir →");
    expect(html).toContain('href="/ma-page"');
  });

  it("3/6 : liste les 3 étapes restantes sans overflow", () => {
    const missing: CriterionKey[] = [
      "product_with_photo",
      "open_slot",
      "stripe",
    ];
    const html = render(
      <PublicationTodoCard doneCount={3} missingKeys={missing} />,
    );
    expect(html).toContain("Finalisez votre mise en ligne (3/6 étapes)");
    expect(html).toContain("Il reste : 1 produit avec photo · 1 créneau ouvert · Paiements activés");
    expect(html).not.toContain("autre");
    expect(html).toContain("Voir →");
  });

  it("6/6 non encore demandée : libellé Tout est prêt, pas de liste d'étapes", () => {
    const html = render(
      <PublicationTodoCard doneCount={6} missingKeys={[]} />,
    );
    expect(html).toContain("Tout est prêt — demandez la publication");
    expect(html).not.toContain("Finalisez votre mise en ligne");
    expect(html).not.toContain("Il reste");
    expect(html).toContain("Voir →");
    expect(html).toContain('href="/ma-page"');
  });
});

describe("PublicationWaitCard — demande envoyée en attente", () => {
  it("affiche le message d'attente sans CTA, non-cliquable", () => {
    const html = render(<PublicationWaitCard />);
    expect(html).toContain("Demande de publication envoyée");
    expect(html).toContain(
      "L&#x27;équipe TerrOir valide votre fiche, vous serez prévenu par email.",
    );
    expect(html).not.toContain("Voir →");
    // Pas de <a> ni href : carte non-cliquable.
    expect(html).not.toMatch(/<a\b/);
    expect(html).not.toMatch(/href=/);
  });

  it("utilise une pastille terra (état passif), pas la pastille verte d'action", () => {
    const html = render(<PublicationWaitCard />);
    expect(html).toContain("bg-terra-700");
    expect(html).not.toContain("bg-green-700");
  });
});
