import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fetchPublicProducerBySlug,
  type ProducerPublic,
} from "@/lib/producers/fetch-public";

// Mock Supabase client minimal : supporte la chaîne
//   from('producers').select(cols).eq('slug', v).eq('statut', v)
//     .is('deleted_at', null).maybeSingle()
// Chaque méthode est capturée pour permettre aux tests d'asserter les filtres
// de défense en profondeur (statut='public', deleted_at IS NULL) et la
// whitelist de colonnes exposées côté consumer.
type Captured = {
  from: string[];
  select: string[];
  eq: Array<[string, unknown]>;
  is: Array<[string, unknown]>;
  maybeSingleCalls: number;
};

function makeSupabase(response: { data: unknown; error: unknown }): {
  client: SupabaseClient;
  captured: Captured;
} {
  const captured: Captured = {
    from: [],
    select: [],
    eq: [],
    is: [],
    maybeSingleCalls: 0,
  };

  const builder: any = {};
  builder.select = (cols: string) => {
    captured.select.push(cols);
    return builder;
  };
  builder.eq = (col: string, val: unknown) => {
    captured.eq.push([col, val]);
    return builder;
  };
  builder.is = (col: string, val: unknown) => {
    captured.is.push([col, val]);
    return builder;
  };
  builder.maybeSingle = async () => {
    captured.maybeSingleCalls++;
    return response;
  };

  const client = {
    from: (table: string) => {
      captured.from.push(table);
      return builder;
    },
  } as unknown as SupabaseClient;

  return { client, captured };
}

function makeProducer(overrides: Partial<ProducerPublic> = {}): ProducerPublic {
  return {
    id: "producer-1",
    slug: "ferme-test",
    nom_exploitation: "Ferme Test",
    users: { prenom: "Alice" },
    commune: "Lyon",
    code_postal: "69001",
    adresse: "1 rue Test",
    latitude: 45.75,
    longitude: 4.85,
    photo_principale: null,
    photos: null,
    description: null,
    histoire: null,
    annee_creation: null,
    generations: null,
    especes: null,
    labels: null,
    badge_stock_score: null,
    badge_confirmation_score: null,
    badge_annulation_score: null,
    note_moyenne: null,
    nb_avis: null,
    ...overrides,
  };
}

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
});

describe("fetchPublicProducerBySlug — cas nominal", () => {
  it("retourne le ProducerPublic quand data est présent", async () => {
    // makeProducer() utilise des coords déjà arrondies (45.75 / 4.85) pour
    // que le test d'égalité directe passe sans appliquer roundCoord.
    const producer = makeProducer({ slug: "ferme-bio" });
    const { client } = makeSupabase({ data: producer, error: null });

    const res = await fetchPublicProducerBySlug(client, "ferme-bio");

    expect(res).toEqual(producer);
  });

  it("requête la table 'producers'", async () => {
    const { client, captured } = makeSupabase({
      data: makeProducer(),
      error: null,
    });

    await fetchPublicProducerBySlug(client, "ferme-bio");

    expect(captured.from).toEqual(["producers"]);
  });

  it("appelle maybeSingle() (et non single()) pour tolérer l'absence de ligne", async () => {
    const { client, captured } = makeSupabase({
      data: makeProducer(),
      error: null,
    });

    await fetchPublicProducerBySlug(client, "ferme-bio");

    expect(captured.maybeSingleCalls).toBe(1);
  });
});

describe("fetchPublicProducerBySlug — défense en profondeur (sécurité)", () => {
  it("applique .eq('slug', <slug>)", async () => {
    const { client, captured } = makeSupabase({
      data: makeProducer(),
      error: null,
    });

    await fetchPublicProducerBySlug(client, "ferme-bio");

    expect(captured.eq).toContainEqual(["slug", "ferme-bio"]);
  });

  it("applique .eq('statut', 'public') — bypass RLS service_role", async () => {
    // Règle critique de l'audit 22/04 : côté service_role, RLS est contourné,
    // donc le filtre applicatif sur statut='public' est la seule barrière
    // contre l'exposition de producers draft/pending/active/suspended.
    const { client, captured } = makeSupabase({
      data: makeProducer(),
      error: null,
    });

    await fetchPublicProducerBySlug(client, "ferme-bio");

    expect(captured.eq).toContainEqual(["statut", "public"]);
  });

  it("applique .is('deleted_at', null) — exclusion RGPD anonymisés", async () => {
    const { client, captured } = makeSupabase({
      data: makeProducer(),
      error: null,
    });

    await fetchPublicProducerBySlug(client, "ferme-bio");

    expect(captured.is).toContainEqual(["deleted_at", null]);
  });

  it("n'expose PAS les colonnes internes sensibles dans le SELECT", async () => {
    const { client, captured } = makeSupabase({
      data: makeProducer(),
      error: null,
    });

    await fetchPublicProducerBySlug(client, "ferme-bio");

    const cols = captured.select[0] ?? "";
    // Colonnes internes qui ne doivent jamais fuiter côté consumer.
    // user_id apparaît uniquement dans la jointure FK `users:user_id(prenom)` :
    // on vérifie qu'il n'est PAS exposé comme colonne scalaire propre, en
    // retirant la sous-string de la jointure avant l'assertion.
    const colsWithoutJoin = cols.replace(/users:user_id\([^)]*\)/g, "");
    expect(colsWithoutJoin).not.toContain("user_id");
    expect(cols).not.toContain("stripe_account_id");
    expect(cols).not.toContain("stripe_cleanup_pending");
    expect(cols).not.toContain("abonnement_");
    expect(cols).not.toContain("siret");
    expect(cols).not.toContain("forme_juridique");
    expect(cols).not.toContain("type_production");
    expect(cols).not.toContain("deleted_at");
  });

  it("inclut les colonnes publiques essentielles dans le SELECT", async () => {
    const { client, captured } = makeSupabase({
      data: makeProducer(),
      error: null,
    });

    await fetchPublicProducerBySlug(client, "ferme-bio");

    const cols = captured.select[0] ?? "";
    expect(cols).toContain("id");
    expect(cols).toContain("slug");
    expect(cols).toContain("nom_exploitation");
  });

  it("inclut les colonnes coords (floutées) dans le SELECT", async () => {
    // Smoke test : latitude/longitude doivent figurer dans le SELECT public
    // (consommées par le widget distance, floutées avant retour).
    const { client, captured } = makeSupabase({
      data: makeProducer(),
      error: null,
    });

    await fetchPublicProducerBySlug(client, "ferme-bio");

    const cols = captured.select[0] ?? "";
    expect(cols).toContain("latitude");
    expect(cols).toContain("longitude");
  });

  it("joint users.prenom via la FK user_id pour l'affichage public", async () => {
    // Source unique du prénom d'affichage côté lecture publique depuis le
    // chantier de centralisation sur users.prenom (cf. getProducerDisplayName).
    const { client, captured } = makeSupabase({
      data: makeProducer(),
      error: null,
    });

    await fetchPublicProducerBySlug(client, "ferme-bio");

    const cols = captured.select[0] ?? "";
    expect(cols).toContain("users:user_id(prenom)");
  });

  it("normalise users array (Supabase peut typer la jointure FK comme array) en objet", async () => {
    // Selon la version du client supabase-js, une jointure FK 1:1 peut être
    // typée objet OU array. Le helper normalise systématiquement en objet
    // pour que les consumers manipulent une forme stable.
    const rawWithArray = {
      ...makeProducer(),
      users: [{ prenom: "Bob" }],
    };
    const { client } = makeSupabase({
      data: rawWithArray as unknown,
      error: null,
    });

    const res = await fetchPublicProducerBySlug(client, "ferme-bio");

    expect(res?.users).toEqual({ prenom: "Bob" });
  });
});

describe("fetchPublicProducerBySlug — cas null (slug introuvable ou non-public)", () => {
  it("retourne null quand maybeSingle renvoie data=null", async () => {
    // maybeSingle() renvoie data=null soit parce que le slug n'existe pas,
    // soit parce qu'il existe mais ne matche pas statut='public' / deleted_at=null.
    // Dans tous les cas, du point de vue du consumer : null → notFound.
    const { client } = makeSupabase({ data: null, error: null });

    const res = await fetchPublicProducerBySlug(client, "slug-inexistant");

    expect(res).toBeNull();
  });
});

describe("fetchPublicProducerBySlug — cas erreur DB", () => {
  it("log l'erreur et retourne null quand Supabase remonte une erreur", async () => {
    const { client } = makeSupabase({
      data: null,
      error: { message: "network unreachable" },
    });

    const res = await fetchPublicProducerBySlug(client, "ferme-bio");

    expect(res).toBeNull();
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    const logged = String(consoleErrorSpy.mock.calls[0]?.[0] ?? "");
    expect(logged).toContain("FETCH_PUBLIC_PRODUCER_ERROR");
    expect(logged).toContain("slug=ferme-bio");
    expect(logged).toContain("network unreachable");
  });
});

describe("fetchPublicProducerBySlug — T-200 sécurité : floutage coords producteur", () => {
  // Le widget distance côté consumer doit pouvoir calculer un Haversine,
  // mais l'adresse personnelle du producteur (= souvent son domicile) ne
  // doit JAMAIS quitter le serveur en clair. roundCoord arrondit à
  // 2 décimales (~1 km de précision en Sarthe), suffisant pour
  // l'affichage "à vol d'oiseau" et masque l'adresse précise.
  // Décision comité review T-200 round 1 (sécurité).

  it("arrondit la latitude à 2 décimales", async () => {
    const producer = makeProducer({
      latitude: 47.123456789,
      longitude: 0.5,
    });
    const { client } = makeSupabase({ data: producer, error: null });

    const res = await fetchPublicProducerBySlug(client, "ferme-bio");

    expect(res?.latitude).toBe(47.12);
  });

  it("arrondit la longitude à 2 décimales", async () => {
    const producer = makeProducer({
      latitude: 47.0,
      longitude: 0.987654321,
    });
    const { client } = makeSupabase({ data: producer, error: null });

    const res = await fetchPublicProducerBySlug(client, "ferme-bio");

    expect(res?.longitude).toBe(0.99);
  });

  it("préserve null pour les producteurs sans coordonnées (5/10 prod aujourd'hui)", async () => {
    // Cas réel : la moitié des producteurs en prod n'ont pas encore de
    // lat/lng saisie. Le widget distance ne doit pas s'afficher dans ce
    // cas (cf. ScoreCarbonBlock + DistanceWidget early-return), pas un
    // crash silencieux ni un NaN km.
    const producer = makeProducer({ latitude: null, longitude: null });
    const { client } = makeSupabase({ data: producer, error: null });

    const res = await fetchPublicProducerBySlug(client, "ferme-bio");

    expect(res?.latitude).toBeNull();
    expect(res?.longitude).toBeNull();
  });

  it("normalise les coordonnées non finies (NaN, Infinity) en null", async () => {
    // Defense-in-depth : si une donnée DB corrompue arrive avec NaN, on
    // ne propage pas un NaN km côté UI — on préfère masquer le widget.
    const producer = makeProducer({
      latitude: NaN,
      longitude: Number.POSITIVE_INFINITY,
    });
    const { client } = makeSupabase({ data: producer, error: null });

    const res = await fetchPublicProducerBySlug(client, "ferme-bio");

    expect(res?.latitude).toBeNull();
    expect(res?.longitude).toBeNull();
  });
});
