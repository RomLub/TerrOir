import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ReactElement } from "react";

// `lib/env/urls.ts` est importé indirectement (chaîne via getSessionUser /
// supabase server) et lit NEXT_PUBLIC_APP_URL au module load. On le set en
// scope hoisté pour qu'il soit dispo avant l'import dynamique du page module.
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
  process.env.NEXT_PUBLIC_PRODUCER_URL = "http://localhost:3001";
});

// `server-only` est un module virtuel Next.js qui throw côté client. Importé
// indirectement via la chaîne app/connexion/logout-action → lib/audit-logs.
// Pattern aligné sur les autres tests du repo (cf. log-auth-event.test.ts).
vi.mock("server-only", () => ({}));

// --- Mocks ---------------------------------------------------------------
// On test au niveau ReactElement : le Server Component retourne du JSX qu'on
// inspecte via .type / .props sans passer par un rendu DOM (env=node, pas
// jsdom). Les CTA sont passés en props à `ErrorCard` → assertion directe sur
// `props.ctaHref` / `props.ctaLabel`.

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`__REDIRECT__:${url}`);
  },
}));

type Resp = { data?: unknown; error?: unknown };

let responses: Record<string, Resp[]>;
let sessionUser: { id: string; email: string | null } | null;

vi.mock("@/lib/auth/session", () => ({
  getSessionUser: async () => sessionUser,
}));

vi.mock("@/lib/producers/pick-initial-infos", () => ({
  pickInitialInfos: () => ({
    prenom: "",
    nom: "",
    telephone: "",
    prenom_affichage: "",
    nom_exploitation: "",
    forme_juridique: "",
    siret: "",
    adresse: "",
    code_postal: "",
    commune: "",
    type_production: "",
    type_production_precision: "",
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from: (table: string) => {
      const resp = responses[table]?.shift() ?? { data: null, error: null };
      const builder: Record<string, unknown> = {};
      builder.select = () => builder;
      builder.eq = () => builder;
      builder.ilike = () => builder;
      builder.in = () => builder;
      builder.order = () => builder;
      builder.limit = () => builder;
      builder.update = () => builder;
      builder.insert = () => Promise.resolve(resp);
      builder.maybeSingle = () => Promise.resolve(resp);
      builder.then = (onFulfilled: (r: Resp) => unknown) => onFulfilled(resp);
      return builder;
    },
  }),
}));

import InvitationPage from "@/app/(producer)/invitation/page";

// --- Helpers --------------------------------------------------------------

const VALID_TOKEN = "a".repeat(32);

function validInvitation(email = "user@example.com"): Resp {
  return {
    data: {
      email,
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      used_at: null,
    },
    error: null,
  };
}

// Récupère le composant nommé `name` dans l'arbre `el` (DFS sur props.children).
function findByName(el: ReactElement | null | undefined, name: string): ReactElement | null {
  if (!el || typeof el !== "object") return null;
  if (typeof el.type === "function" && (el.type as { name?: string }).name === name) {
    return el;
  }
  const children = (el.props as { children?: unknown })?.children;
  const arr = Array.isArray(children) ? children : children !== undefined ? [children] : [];
  for (const c of arr) {
    const found = findByName(c as ReactElement, name);
    if (found) return found;
  }
  return null;
}

async function runPage(token?: string): Promise<ReactElement> {
  const result = await InvitationPage({ searchParams: token ? { token } : {} });
  return result as ReactElement;
}

// --- Setup / teardown -----------------------------------------------------

beforeEach(() => {
  responses = {};
  sessionUser = null;
});

afterEach(() => {
  vi.restoreAllMocks();
});

// --- Tests ----------------------------------------------------------------

describe("InvitationPage — ErrorCard CTAs", () => {
  it("token manquant → ErrorCard avec CTA /devenir-producteur", async () => {
    const result = await runPage();
    const card = findByName(result, "ErrorCard");
    expect(card).not.toBeNull();
    expect(card!.props).toMatchObject({
      ctaLabel: "Demander une nouvelle invitation",
      ctaHref: "/devenir-producteur",
    });
  });

  it("invitation introuvable → ErrorCard avec CTA /devenir-producteur", async () => {
    responses.producer_invitations = [{ data: null, error: null }];
    const result = await runPage(VALID_TOKEN);
    const card = findByName(result, "ErrorCard");
    expect(card!.props.ctaHref).toBe("/devenir-producteur");
    expect(card!.props.message).toMatch(/introuvable/i);
  });

  it("invitation déjà utilisée → ErrorCard avec CTA /devenir-producteur", async () => {
    responses.producer_invitations = [
      {
        data: {
          email: "user@example.com",
          expires_at: new Date(Date.now() + 86_400_000).toISOString(),
          used_at: new Date().toISOString(),
        },
        error: null,
      },
    ];
    const result = await runPage(VALID_TOKEN);
    const card = findByName(result, "ErrorCard");
    expect(card!.props.ctaHref).toBe("/devenir-producteur");
    expect(card!.props.message).toMatch(/utilisée/i);
  });

  it("invitation expirée → ErrorCard avec CTA /devenir-producteur", async () => {
    responses.producer_invitations = [
      {
        data: {
          email: "user@example.com",
          expires_at: new Date(Date.now() - 1000).toISOString(),
          used_at: null,
        },
        error: null,
      },
    ];
    const result = await runPage(VALID_TOKEN);
    const card = findByName(result, "ErrorCard");
    expect(card!.props.ctaHref).toBe("/devenir-producteur");
    expect(card!.props.message).toMatch(/expirée/i);
  });

  it("email = admin existant → ErrorCard avec CTA /connexion", async () => {
    responses.producer_invitations = [validInvitation("admin@example.com")];
    responses.admin_users = [{ data: { id: "admin-1" }, error: null }];

    const result = await runPage(VALID_TOKEN);
    const card = findByName(result, "ErrorCard");
    expect(card!.props).toMatchObject({
      ctaLabel: "Se connecter",
      ctaHref: "/connexion",
    });
    expect(card!.props.message).toMatch(/administrateur/i);
  });

  it("producer déjà inscrit (statut != draft) → ErrorCard avec CTA /connexion", async () => {
    responses.producer_invitations = [validInvitation("prod@example.com")];
    responses.admin_users = [{ data: null, error: null }];
    responses.users = [
      { data: { id: "user-1", roles: ["consumer", "producer"] }, error: null },
    ];
    responses.producers = [
      { data: { id: "p-1", statut: "active" }, error: null },
    ];

    const result = await runPage(VALID_TOKEN);
    const card = findByName(result, "ErrorCard");
    expect(card!.props).toMatchObject({
      ctaLabel: "Se connecter à mon espace",
      ctaHref: "/connexion",
    });
    expect(card!.props.message).toMatch(/déjà inscrit/i);
  });
});

describe("InvitationPage — wizard caseKind passé à OnboardingWizard", () => {
  it("invitation valide + aucun user en DB → caseKind='new'", async () => {
    responses.producer_invitations = [validInvitation()];
    responses.admin_users = [{ data: null, error: null }];
    responses.users = [{ data: null, error: null }];
    responses.producer_interests = [{ data: null, error: null }];

    const result = await runPage(VALID_TOKEN);
    const wizard = findByName(result, "OnboardingWizard");
    expect(wizard).not.toBeNull();
    expect(wizard!.props).toMatchObject({
      caseKind: "new",
      email: "user@example.com",
      startStep: 1,
    });
  });

  it("invitation valide + user consumer non loggé → caseKind='consumer-login'", async () => {
    sessionUser = null;
    responses.producer_invitations = [validInvitation("consumer@example.com")];
    responses.admin_users = [{ data: null, error: null }];
    responses.users = [
      { data: { id: "user-1", roles: ["consumer"] }, error: null },
    ];
    // Pas de producer existant.
    responses.producers = [{ data: null, error: null }];
    responses.producer_interests = [{ data: null, error: null }];

    const result = await runPage(VALID_TOKEN);
    const wizard = findByName(result, "OnboardingWizard");
    expect(wizard!.props).toMatchObject({
      caseKind: "consumer-login",
      email: "consumer@example.com",
      startStep: 1,
    });
  });
});
