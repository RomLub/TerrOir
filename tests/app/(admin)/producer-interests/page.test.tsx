import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ReactElement } from "react";

// Test de la page Server Component /producer-interests (refactor PR1).
//
// On vérifie que :
//   1. La page appelle bien fetchProducerInterestsList(admin) côté serveur.
//   2. Le JSX retourné transmet `initialLeads` au Client Component.
//   3. En cas d'erreur fetch, `initialError` est transmis (non null).
//
// On mocke :
//   - createSupabaseAdminClient → objet vide (jamais appelé directement).
//   - fetchProducerInterestsList → contrôle des données injectées.
//
// On inspecte le React Element retourné (.type, .props) plutôt que de le
// rendre — le Client Component est "use client" et ferait planter
// renderToStaticMarkup à cause des hooks (useState, useRouter).

const { mockFetch } = vi.hoisted(() => ({ mockFetch: vi.fn() }));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({}),
}));

vi.mock("@/lib/admin/producer-interests/fetch", () => ({
  fetchProducerInterestsList: mockFetch,
}));

// Mock le Client Component pour court-circuiter sa chaîne d'imports
// (@/components/ui → lib/env/urls.ts qui exige NEXT_PUBLIC_APP_URL en prod).
// On garde une stub function-component sentinel pour que la page le
// référence et qu'on puisse inspecter ses props via React.cloneElement.
vi.mock(
  "@/app/(admin)/producer-interests/_components/ProducerInterestsClient",
  () => ({
    ProducerInterestsClient: (props: {
      initialLeads: unknown;
      initialError: unknown;
    }) => props,
  }),
);

import AdminProducerInterestsPage, {
  ProducerInterestsContent,
} from "@/app/(admin)/producer-interests/page";

// Lot B perf : la page retourne <Suspense><ProducerInterestsContent/></Suspense>.
// La logique data (fetch + props client) vit dans ProducerInterestsContent
// (async). resolveContent extrait l'enfant du <Suspense> rendu par la page puis
// l'exécute pour obtenir le <ProducerInterestsClient /> final.
async function resolveContent(): Promise<
  ReactElement<{ initialLeads: unknown; initialError: unknown }>
> {
  // Le contenu ne prend aucun argument : on l'exécute directement.
  return (await ProducerInterestsContent()) as ReactElement<{
    initialLeads: unknown;
    initialError: unknown;
  }>;
}

beforeEach(() => {
  mockFetch.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AdminProducerInterestsPage (Server Component)", () => {
  it("la page enveloppe le contenu dans un <Suspense>", async () => {
    mockFetch.mockResolvedValue([]);
    const page = (await AdminProducerInterestsPage()) as ReactElement<{
      children?: ReactElement;
    }>;
    // Coquille de streaming : enfant = <ProducerInterestsContent/>. Le fetch
    // ne part pas tant que le contenu n'est pas rendu (Suspense).
    expect(page.props.children).toBeDefined();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("transmet la liste fetchée au Client Component", async () => {
    const leads = [
      {
        id: "1",
        created_at: "2026-05-10T00:00:00Z",
        prenom: "Jean",
        nom: "Dupont",
        email: "j@example.com",
        telephone: null,
        nom_exploitation: null,
        commune: null,
        especes: null,
        message: null,
        statut: "new",
        source: "formulaire_public",
      },
    ];
    mockFetch.mockResolvedValue(leads);

    const element = await resolveContent();

    expect(mockFetch).toHaveBeenCalledOnce();
    expect(element.props.initialLeads).toEqual(leads);
    expect(element.props.initialError).toBeNull();
  });

  it("liste vide → initialLeads=[] + initialError=null", async () => {
    mockFetch.mockResolvedValue([]);

    const element = await resolveContent();

    expect(element.props.initialLeads).toEqual([]);
    expect(element.props.initialError).toBeNull();
  });

  it("erreur fetch → initialError non null + initialLeads=[]", async () => {
    mockFetch.mockRejectedValue(new Error("db down"));

    const element = await resolveContent();

    expect(element.props.initialLeads).toEqual([]);
    expect(element.props.initialError).toBe("db down");
  });
});
