import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ReactElement } from "react";

// `lib/env/urls.ts` est importé indirectement (chaîne via getSessionUser /
// supabase server) et lit NEXT_PUBLIC_APP_URL au module load. On le set en
// scope hoisté pour qu'il soit dispo avant l'import dynamique du page module.
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
  process.env.NEXT_PUBLIC_PRODUCER_URL = "http://localhost:3001";
  process.env.NEXT_PUBLIC_ADMIN_URL = "http://localhost:3002";
});

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
// T-303 : capture des UPDATE/INSERT pendant le GET render pour asserter
// l'absence de side-effect (la bascule en server action POST garantit que
// le render ne mute jamais).
let captured: {
  inserts: Array<{ table: string; payload: unknown }>;
  updates: Array<{ table: string; payload: unknown }>;
};

vi.mock("@/lib/auth/session", () => ({
  getSessionUser: async () => sessionUser,
}));

vi.mock("@/lib/producers/pick-initial-infos", () => ({
  pickInitialInfos: () => ({
    prenom: "",
    nom: "",
    telephone: "",
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
      builder.update = (payload: unknown) => {
        captured.updates.push({ table, payload });
        return builder;
      };
      builder.insert = (payload: unknown) => {
        captured.inserts.push({ table, payload });
        return Promise.resolve(resp);
      };
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
  captured = { inserts: [], updates: [] };
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

describe("InvitationPage — T-303 consumer-loggedin no auto-upgrade pendant le GET render", () => {
  it("user loggé comme invitee SANS rôle producer → render InvitationConfirmCard, AUCUN UPDATE/INSERT côté DB", async () => {
    sessionUser = { id: "user-1", email: "consumer@example.com" };
    responses.producer_invitations = [validInvitation("consumer@example.com")];
    responses.admin_users = [{ data: null, error: null }];
    responses.users = [
      {
        data: {
          id: "user-1",
          roles: ["consumer"],
          prenom: "Léa",
          nom: "Martin",
          telephone: "0612345678",
        },
        error: null,
      },
    ];
    // Pas de producer existant côté DB.
    responses.producers = [{ data: null, error: null }];

    const result = await runPage(VALID_TOKEN);

    const card = findByName(result, "InvitationConfirmCard");
    expect(card).not.toBeNull();
    expect(card!.props).toMatchObject({
      token: VALID_TOKEN,
      email: "consumer@example.com",
      prenom: "Léa",
    });

    // Assertion CRITIQUE T-303 : aucun side-effect DB pendant le render.
    // Le bug originel produisait UPDATE users.roles + INSERT producers ici.
    expect(captured.updates).toEqual([]);
    expect(captured.inserts).toEqual([]);

    // Et pas de wizard non plus — la carte de confirmation remplace tout
    // le flow auto-upgrade-puis-StepInfos.
    expect(findByName(result, "OnboardingWizard")).toBeNull();
  });

  it("T-110 : session.email vs invitation.email comparés case-insensitively → InvitationConfirmCard rendue malgré casse différente", async () => {
    // Cas réel : invitation pour 'consumer@example.com', utilisateur loggé
    // côté Supabase Auth en 'Consumer@Example.COM'. Doit être reconnu comme
    // invitee (sinon on retomberait sur le wizard caseKind='consumer-login').
    sessionUser = { id: "user-1", email: "Consumer@Example.COM" };
    responses.producer_invitations = [validInvitation("consumer@example.com")];
    responses.admin_users = [{ data: null, error: null }];
    responses.users = [
      {
        data: {
          id: "user-1",
          roles: ["consumer"],
          prenom: "Léa",
          nom: "Martin",
          telephone: "0612345678",
        },
        error: null,
      },
    ];
    responses.producers = [{ data: null, error: null }];

    const result = await runPage(VALID_TOKEN);

    const card = findByName(result, "InvitationConfirmCard");
    expect(card).not.toBeNull();
    expect(card!.props.email).toBe("consumer@example.com");
  });

  it("user loggé comme invitee + producer.draft existant → redirect /onboarding (early return inchangé Phase 4)", async () => {
    sessionUser = { id: "user-1", email: "consumer@example.com" };
    responses.producer_invitations = [validInvitation("consumer@example.com")];
    responses.admin_users = [{ data: null, error: null }];
    responses.users = [
      {
        data: {
          id: "user-1",
          roles: ["consumer", "producer"],
          prenom: null,
          nom: null,
          telephone: null,
        },
        error: null,
      },
    ];
    responses.producers = [{ data: { id: "p-1", statut: "draft" }, error: null }];

    await expect(runPage(VALID_TOKEN)).rejects.toThrow(
      "__REDIRECT__:/onboarding",
    );

    expect(captured.updates).toEqual([]);
    expect(captured.inserts).toEqual([]);
  });
});
