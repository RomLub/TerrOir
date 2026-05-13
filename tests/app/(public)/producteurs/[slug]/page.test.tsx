// Tests vitest pour le Server Component /producteurs/[slug].
//
// Test contractuel sécurité (T-217) : la page ne doit JAMAIS sérialiser de
// coordonnées brutes (6+ décimales) vers le ProducerPageClient. La garantie
// est centralisée dans `fetchPublicProducerBySlug` (lib/producers/fetch-public.ts)
// qui applique `roundCoord` à la frontière fetch DB → propagation app. Ce test
// vérifie le contrat à la frontière Server → Client Component (props passées
// à <ProducerPageClient>) — si quelqu'un casse `roundCoord` côté fetcher, ou
// court-circuite le fetcher avec une lecture directe de `producers.latitude`,
// ce test pète bruyamment.
//
// Pourquoi pas de roundCoord défensif au niveau page (T-217 décision Romain) :
// duppliquer roundCoord en surface (à 1 ligne du fetcher canonique) dilue le
// source of truth ; un futur lecteur se demanderait si le fetcher est fiable
// (cargo cult). Le bon signal anti-régression est CE test, pas un no-op
// silencieux. Cf. doc docs/features/coords-privacy-policy-2026-05-06.md.
//
// Pattern : on test au niveau ReactElement (env=node, pas jsdom) en inspectant
// .type / .props sans rendu DOM. Cf. tests/app/(producer)/invitation/page.test.tsx.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ReactElement } from "react";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_APP_URL =
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  process.env.NEXT_PUBLIC_PRODUCER_URL =
    process.env.NEXT_PUBLIC_PRODUCER_URL ?? "http://localhost:3001";
  process.env.NEXT_PUBLIC_ADMIN_URL =
    process.env.NEXT_PUBLIC_ADMIN_URL ?? "http://localhost:3002";
});

// --- Mocks ---------------------------------------------------------------

// unstable_cache : on retourne une fonction identité (pas de cache, exécution
// directe) — sinon vitest n'a pas accès à la registry interne de Next.js.
vi.mock("next/cache", () => ({
  unstable_cache: <T extends (...a: unknown[]) => unknown>(fn: T) => fn,
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("__NOT_FOUND__");
  },
}));

type Resp = { data?: unknown; error?: unknown };

// Réponses successives indexées par table (FIFO). On consomme un .shift() à
// chaque .from(table) pour pouvoir injecter des résultats différents quand la
// page fait plusieurs lectures sur la même table.
let responses: Record<string, Resp[]>;

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from: (table: string) => {
      const resp = responses[table]?.shift() ?? { data: null, error: null };
      const builder: Record<string, unknown> = {};
      builder.select = () => builder;
      builder.eq = () => builder;
      builder.is = () => builder;
      builder.order = () => builder;
      builder.limit = () => builder;
      builder.maybeSingle = () => Promise.resolve(resp);
      // Quand le code fait `await admin.from(...).select(...).eq(...)` sans
      // `.maybeSingle()` ni `.single()`, le builder est awaité directement —
      // on doit donc être thenable.
      builder.then = (onFulfilled: (r: Resp) => unknown) => onFulfilled(resp);
      return builder;
    },
  }),
}));

import ProducteurPage from "@/app/(public)/producteurs/[slug]/page";

// --- Helpers --------------------------------------------------------------

// DFS sur l'arbre ReactElement pour trouver un composant nommé.
function findByName(
  el: ReactElement | null | undefined,
  name: string,
): ReactElement | null {
  if (!el || typeof el !== "object") return null;
  const elType = el.type as { name?: string; displayName?: string } | string;
  if (
    typeof elType === "function" &&
    ((elType as { name?: string }).name === name ||
      (elType as { displayName?: string }).displayName === name)
  ) {
    return el;
  }
  const children = (el.props as { children?: unknown })?.children;
  const arr = Array.isArray(children)
    ? children
    : children !== undefined
      ? [children]
      : [];
  for (const c of arr) {
    const found = findByName(c as ReactElement, name);
    if (found) return found;
  }
  return null;
}

function buildRawProducerRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "p-1",
    slug: "ferme-alpha",
    nom_exploitation: "Ferme Alpha",
    commune: "Saint-Mars-d'Outillé",
    code_postal: "72220",
    adresse: "1 chemin du Bourg",
    // Coordonnées brutes 6+ décimales — ce que retourne réellement Postgres.
    // Le contrat T-217 dit qu'elles ne doivent JAMAIS arriver en l'état
    // jusqu'à ProducerPageClient.
    latitude: 47.987654,
    longitude: -0.123456,
    photo_principale: null,
    photos: [],
    description: null,
    histoire: null,
    annee_creation: null,
    generations: null,
    especes: [],
    labels: [],
    badge_stock_score: null,
    badge_confirmation_score: null,
    badge_annulation_score: null,
    note_moyenne: null,
    nb_avis: null,
    mode_elevage: null,
    alimentation: null,
    densite_animale: null,
    users: { prenom: "Lou" },
    ...overrides,
  };
}

beforeEach(() => {
  responses = {};
});

afterEach(() => {
  vi.restoreAllMocks();
});

// --- Tests ----------------------------------------------------------------

describe("/producteurs/[slug] — contrat sécurité coords (T-217)", () => {
  it("floute lat/lng à 2 décimales avant de passer au ProducerPageClient", async () => {
    responses = {
      producers: [{ data: buildRawProducerRow(), error: null }],
      products: [{ data: [], error: null }],
      reviews: [{ data: [], error: null }],
    };

    const result = (await ProducteurPage({
      params: Promise.resolve({ slug: "ferme-alpha" }),
    })) as ReactElement;

    const client = findByName(result, "ProducerPageClient");
    expect(client).not.toBeNull();

    const producer = (client!.props as { producer: { latitude: number; longitude: number } })
      .producer;

    // Verrou explicite : valeurs floutées attendues (47.987654 → 47.99,
    // -0.123456 → -0.12).
    expect(producer.latitude).toBe(47.99);
    expect(producer.longitude).toBe(-0.12);
  });

  it("ne propage aucune coordonnée à plus de 2 décimales (scan exhaustif)", async () => {
    // Échantillon varié pour stresser le contrat sur des cas négatifs / bornes.
    const samples = [
      { latitude: 48.123456789, longitude: 0.987654321 },
      { latitude: -12.345678, longitude: -3.6789 },
      { latitude: 0.0001, longitude: -0.0001 },
    ];

    for (const sample of samples) {
      responses = {
        producers: [{ data: buildRawProducerRow(sample), error: null }],
        products: [{ data: [], error: null }],
        reviews: [{ data: [], error: null }],
      };

      const result = (await ProducteurPage({
        params: Promise.resolve({ slug: "ferme-alpha" }),
      })) as ReactElement;
      const client = findByName(result, "ProducerPageClient");
      const producer = (client!.props as {
        producer: { latitude: number | null; longitude: number | null };
      }).producer;

      // Contrat : valeur arrondie à 2 décimales → val * 100 est entier.
      expect(producer.latitude).not.toBeNull();
      expect(producer.longitude).not.toBeNull();
      expect(Math.round(producer.latitude! * 100)).toBe(
        producer.latitude! * 100,
      );
      expect(Math.round(producer.longitude! * 100)).toBe(
        producer.longitude! * 100,
      );
    }
  });

  it("propage null pour un producer sans coords (pas de NaN injecté)", async () => {
    responses = {
      producers: [
        {
          data: buildRawProducerRow({ latitude: null, longitude: null }),
          error: null,
        },
      ],
      products: [{ data: [], error: null }],
      reviews: [{ data: [], error: null }],
    };

    const result = (await ProducteurPage({
      params: Promise.resolve({ slug: "ferme-alpha" }),
    })) as ReactElement;
    const client = findByName(result, "ProducerPageClient");
    const producer = (client!.props as {
      producer: { latitude: number | null; longitude: number | null };
    }).producer;

    expect(producer.latitude).toBeNull();
    expect(producer.longitude).toBeNull();
  });
});
