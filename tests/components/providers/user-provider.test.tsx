// @vitest-environment jsdom
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type {
  AuthChangeEvent,
  Session,
  User,
} from "@supabase/supabase-js";
import {
  UserProvider,
  useUserContext,
} from "@/components/providers/user-provider";
import type { InitialUserPayload } from "@/lib/auth/types";

// =============================================================================
// T-011 — UserProvider INITIAL_SESSION protect + sync useEffect (PR #14)
// =============================================================================
// Le bug T-011 : navbar « Connexion » affichée alors que l'utilisateur est
// authentifié, intermittent en prod. Deux mitigations en place dans
// `components/providers/user-provider.tsx` :
//
//   1. PR #14 — useEffect ligne 101 : sync state quand un nouveau initial.user
//      arrive via SSR re-render (login server action → revalidatePath →
//      RSC re-renders RootLayout → initial.user passe de null à une valeur,
//      mais useState capture seulement la valeur du premier mount sur la
//      page précédente).
//   2. INITIAL_SESSION protect — onAuthStateChange ligne 207 : à la réception
//      d'INITIAL_SESSION (émis par Supabase au mount du subscribe), on SKIP
//      `applySession()` car le payload SSR a déjà fourni l'état complet.
//      Évite que la session côté browser (potentiellement absente au mount
//      à cause d'une race cookies/getSession) écrase l'état SSR fourni.
//
// Cette suite vérifie ces deux protections et les comportements de transition
// SIGNED_IN / SIGNED_OUT (qui doivent, eux, traverser applySession). Couvre
// aussi le cas anonyme (initial vide → loading=false rapidement, pas de query
// inutile). Audit Vercel H-4 (2026-05-05) a câblé l'INITIAL_SESSION protect.
// =============================================================================

type AuthCallback = (event: AuthChangeEvent, session: Session | null) => void;

// Holder pour capturer le callback onAuthStateChange entre les renders.
const captured: { current: AuthCallback | null } = { current: null };

// Mock Supabase browser client. La chaîne `.from(...).select(...).eq(...).maybeSingle()`
// renvoie systématiquement data=null par défaut — les tests écrivent
// loadProfileResult pour piloter ce que renvoient les 3 queries (users,
// admin_users, producers).
const loadProfileResult = {
  users: { data: null as { roles: string[] } | null },
  admin_users: { data: null as { id: string } | null },
  producers: {
    data: null as
      | { id: string; slug: string; nom_exploitation: string; statut: string }
      | null,
  },
};

vi.mock("@/lib/supabase/client", () => {
  return {
    createSupabaseBrowserClient: () => {
      const fromHandler = (table: keyof typeof loadProfileResult) => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: loadProfileResult[table].data }),
          }),
        }),
      });
      return {
        from: (table: string) =>
          fromHandler(table as keyof typeof loadProfileResult),
        auth: {
          onAuthStateChange: (cb: AuthCallback) => {
            captured.current = cb;
            return {
              data: {
                subscription: {
                  unsubscribe: vi.fn(),
                },
              },
            };
          },
          getSession: async () => ({
            data: { session: null },
            error: null,
          }),
        },
      };
    },
  };
});

// Mock broadcaster — neutre (pas de cross-tab dans les tests).
vi.mock("@/lib/auth/cross-tab-auth-sync", () => ({
  createAuthBroadcaster: () => ({
    subscribe: () => () => {},
    broadcast: vi.fn(),
    close: vi.fn(),
  }),
}));

// Petit consommateur du context — affiche le state pour les assertions.
function Probe() {
  const ctx = useUserContext();
  return (
    <div>
      <div data-testid="user-id">{ctx.user?.id ?? "(none)"}</div>
      <div data-testid="loading">{ctx.loading ? "loading" : "ready"}</div>
      <div data-testid="is-admin">{ctx.isAdmin ? "admin" : "not-admin"}</div>
      <div data-testid="is-producer">
        {ctx.isProducer ? "producer" : "not-producer"}
      </div>
      <div data-testid="roles">{ctx.roles.join(",")}</div>
    </div>
  );
}

const FAKE_USER: User = {
  id: "user-romain",
  app_metadata: {},
  user_metadata: {},
  aud: "authenticated",
  created_at: "2026-01-01T00:00:00.000Z",
} as User;

function buildInitial(over: Partial<InitialUserPayload> = {}): InitialUserPayload {
  return {
    user: null,
    isAdmin: false,
    isProducer: false,
    producerLite: null,
    roles: [],
    ...over,
  };
}

beforeEach(() => {
  captured.current = null;
  loadProfileResult.users.data = null;
  loadProfileResult.admin_users.data = null;
  loadProfileResult.producers.data = null;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("UserProvider — INITIAL_SESSION protect (T-011)", () => {
  it("mount avec initial.user fourni : state utilise l'initial sans re-fetch", async () => {
    render(
      <UserProvider
        initial={buildInitial({
          user: FAKE_USER,
          isAdmin: true,
          isProducer: false,
          producerLite: null,
          // Note : `admin` n'est PAS un UserRole (cf. lib/auth/roles.ts =
          // "consumer" | "producer"). Le statut admin est porté par le flag
          // `isAdmin` séparé. On utilise `consumer` ici comme rôle producteur
          // de fond et on assert isAdmin via le flag dédié.
          roles: ["consumer"],
        })}
      >
        <Probe />
      </UserProvider>,
    );
    // Avant que INITIAL_SESSION soit déclenché, loading reste à true (car
    // initial.user !== null → loading initialisé à true en attente du
    // INITIAL_SESSION qui flagge ready).
    expect(screen.getByTestId("user-id").textContent).toBe("user-romain");
    expect(screen.getByTestId("is-admin").textContent).toBe("admin");
    expect(screen.getByTestId("roles").textContent).toBe("consumer");
    expect(screen.getByTestId("loading").textContent).toBe("loading");

    // Le subscribe a capturé un callback : on fire INITIAL_SESSION avec une
    // session null (cas dégradé : cookies pas encore lus côté browser).
    expect(captured.current).not.toBeNull();
    captured.current!("INITIAL_SESSION", null);

    // Verrou T-011 (INITIAL_SESSION protect) : malgré session=null, le state
    // user reste celui de initial (pas écrasé). Seul loading bascule.
    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("ready");
    });
    expect(screen.getByTestId("user-id").textContent).toBe("user-romain");
    expect(screen.getByTestId("is-admin").textContent).toBe("admin");
    expect(screen.getByTestId("roles").textContent).toBe("consumer");
  });

  it("mount anonyme : initial vide → loading=false immédiat", () => {
    render(
      <UserProvider initial={buildInitial()}>
        <Probe />
      </UserProvider>,
    );
    // initial.user === null → loading initialisé à false (pas d'attente
    // d'INITIAL_SESSION pour relâcher l'UI). State reste vide.
    expect(screen.getByTestId("user-id").textContent).toBe("(none)");
    expect(screen.getByTestId("loading").textContent).toBe("ready");
    expect(screen.getByTestId("is-admin").textContent).toBe("not-admin");
  });
});

describe("UserProvider — transitions SIGNED_IN / SIGNED_OUT (T-011)", () => {
  it("SIGNED_IN après mount anonyme : user mis à jour + loadProfile (roles, admin, producer)", async () => {
    loadProfileResult.users.data = { roles: ["consumer", "producer"] };
    loadProfileResult.admin_users.data = null;
    loadProfileResult.producers.data = {
      id: "p-1",
      slug: "ferme-test",
      nom_exploitation: "Ferme Test",
      statut: "public",
    };
    render(
      <UserProvider initial={buildInitial()}>
        <Probe />
      </UserProvider>,
    );
    // SSR anonyme : pas d'INITIAL_SESSION protect ici, on simule directement
    // un SIGNED_IN après login (cas typique : user vient de cliquer "se
    // connecter" et la session est désormais dispo côté cookies).
    expect(captured.current).not.toBeNull();
    captured.current!("SIGNED_IN", {
      user: FAKE_USER,
      access_token: "tok",
      token_type: "bearer",
      expires_in: 3600,
      expires_at: Date.now() / 1000 + 3600,
      refresh_token: "rt",
    } as unknown as Session);

    // Le state se met à jour : user, roles via loadProfile, producer.
    await waitFor(() => {
      expect(screen.getByTestId("user-id").textContent).toBe("user-romain");
    });
    expect(screen.getByTestId("roles").textContent).toBe("consumer,producer");
    expect(screen.getByTestId("is-producer").textContent).toBe("producer");
    expect(screen.getByTestId("is-admin").textContent).toBe("not-admin");
    expect(screen.getByTestId("loading").textContent).toBe("ready");
  });

  it("SIGNED_OUT après mount loggé : reset complet (user null, roles vides, etc.)", async () => {
    loadProfileResult.users.data = { roles: ["consumer"] };
    loadProfileResult.producers.data = null;
    render(
      <UserProvider
        initial={buildInitial({
          user: FAKE_USER,
          isAdmin: false,
          isProducer: false,
          roles: ["consumer"],
        })}
      >
        <Probe />
      </UserProvider>,
    );
    // INITIAL_SESSION pour relâcher loading.
    captured.current!("INITIAL_SESSION", null);
    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("ready");
    });
    // Logout : SIGNED_OUT avec session=null. Doit traverser applySession et
    // tout reset — y compris écraser user à null (contrairement à
    // INITIAL_SESSION qui ne touche pas).
    captured.current!("SIGNED_OUT", null);
    await waitFor(() => {
      expect(screen.getByTestId("user-id").textContent).toBe("(none)");
    });
    expect(screen.getByTestId("roles").textContent).toBe("");
    expect(screen.getByTestId("is-admin").textContent).toBe("not-admin");
    expect(screen.getByTestId("is-producer").textContent).toBe("not-producer");
  });
});

describe("UserProvider — sync useEffect PR #14 (T-011)", () => {
  it("changement de initial.user via re-render parent : state suit", async () => {
    // Simule le cas login server action → revalidatePath → RSC re-render
    // RootLayout avec un nouveau initial.user (alors que useState a capturé
    // null sur le premier mount sur la page /connexion).
    const { rerender } = render(
      <UserProvider initial={buildInitial()}>
        <Probe />
      </UserProvider>,
    );
    expect(screen.getByTestId("user-id").textContent).toBe("(none)");

    // Le parent re-render avec un initial.user désormais défini.
    rerender(
      <UserProvider
        initial={buildInitial({
          user: FAKE_USER,
          isAdmin: true,
          roles: ["producer"],
        })}
      >
        <Probe />
      </UserProvider>,
    );
    // Verrou PR #14 : useEffect ligne 101 sync l'initial → state, sans
    // attendre un event Supabase. La navbar peut afficher le bon état dès
    // que SSR a re-rendu RootLayout.
    await waitFor(() => {
      expect(screen.getByTestId("user-id").textContent).toBe("user-romain");
    });
    expect(screen.getByTestId("is-admin").textContent).toBe("admin");
    expect(screen.getByTestId("roles").textContent).toBe("producer");
  });

  it("logout via initial : initial.user repasse à null → state suit", async () => {
    const { rerender } = render(
      <UserProvider
        initial={buildInitial({
          user: FAKE_USER,
          isAdmin: false,
          roles: ["consumer"],
        })}
      >
        <Probe />
      </UserProvider>,
    );
    expect(screen.getByTestId("user-id").textContent).toBe("user-romain");
    rerender(
      <UserProvider initial={buildInitial()}>
        <Probe />
      </UserProvider>,
    );
    await waitFor(() => {
      expect(screen.getByTestId("user-id").textContent).toBe("(none)");
    });
    expect(screen.getByTestId("roles").textContent).toBe("");
  });
});
