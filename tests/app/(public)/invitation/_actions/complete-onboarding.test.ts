import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// --- Mocks ---------------------------------------------------------------
// Le redirect Next.js réel throw NEXT_REDIRECT en succès. On stubbe avec un
// throw maison qu'on attrape dans le helper runAction() pour laisser les
// assertions s'exécuter.
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`__REDIRECT__:${url}`);
  },
}));

// revalidatePath() requiert un static generation store en runtime — absent en
// test (env=node). Mock en no-op : la sémantique cache-bust n'a pas d'incidence
// sur les assertions métier de ce fichier (DB writes, redirect path, lead bump).
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

type SessionUser = {
  id: string;
  email: string | null;
  roles: string[];
  isAdmin: boolean;
};
let sessionUser: SessionUser | null;
vi.mock("@/lib/auth/session", () => ({
  getSessionUser: async () => sessionUser,
}));

// Mock Supabase admin : un builder chaînable par appel `from(table)`. Chaque
// méthode (.update/.eq/.ilike/.select) capture ses args et retourne le builder.
// `.maybeSingle()` résout en Promise ; le builder est aussi thenable pour les
// chaînes awaited directement (sans .maybeSingle) — pattern aligné sur
// tests/lib/stripe/sync-account-flags.test.ts.
type Resp = { data?: unknown; error?: unknown };

type Captured = {
  fromCalls: string[];
  updates: Array<{ table: string; payload: unknown }>;
  selects: Array<{ table: string; cols: string }>;
  eqCalls: Array<{ table: string; col: string; val: unknown }>;
  ilikeCalls: Array<{ table: string; col: string; val: unknown }>;
  isCalls: Array<{ table: string; col: string; val: unknown }>;
  rpcCalls: Array<{ name: string; params: Record<string, unknown> }>;
};

let captured: Captured;
let responses: Record<string, Resp[]>;
let rpcResponses: Record<string, Resp[]>;

function defaultResp(table: string): Resp {
  // Defaults qui font passer le flow métier sans intervention. Les tests
  // surchargent uniquement `producer_interests` (la table sous test).
  // Pour `producers` : couvre le SELECT statut (branche reprise). Depuis
  // T-241 round 2, plus de SELECT JS des 3 enums : la RPC
  // update_producer_onboarding lit + décide + UPDATE en une seule
  // transaction atomique côté SQL.
  if (table === "producers")
    return { data: { statut: "draft" }, error: null };
  return { data: null, error: null };
}

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from: (table: string) => {
      captured.fromCalls.push(table);
      const resp = responses[table]?.shift() ?? defaultResp(table);

      const builder: Record<string, unknown> = {};
      builder.update = (payload: unknown) => {
        captured.updates.push({ table, payload });
        return builder;
      };
      builder.select = (cols: string) => {
        captured.selects.push({ table, cols });
        return builder;
      };
      builder.eq = (col: string, val: unknown) => {
        captured.eqCalls.push({ table, col, val });
        return builder;
      };
      builder.ilike = (col: string, val: unknown) => {
        captured.ilikeCalls.push({ table, col, val });
        return builder;
      };
      builder.is = (col: string, val: unknown) => {
        captured.isCalls.push({ table, col, val });
        return builder;
      };
      builder.maybeSingle = () => Promise.resolve(resp);
      builder.then = (onFulfilled: (r: Resp) => unknown) => onFulfilled(resp);
      return builder;
    },
    // T-241 round 2 — la server action passe l'UPDATE producers via RPC
    // atomique. Le mock capture nom + params pour assertions, et renvoie
    // par défaut { data: null, error: null } (succès silencieux). Les tests
    // qui simulent une erreur RPC surchargent rpcResponses[name].
    rpc: (name: string, params: Record<string, unknown>) => {
      captured.rpcCalls.push({ name, params });
      const resp = rpcResponses[name]?.shift() ?? { data: null, error: null };
      return Promise.resolve(resp);
    },
  }),
}));

// T-307 — mock logAuthEvent : la SUT l'appelle sur race lost. On veut
// vérifier eventType + payload metadata sans déclencher l'INSERT réel
// dans audit_logs (qui a son propre suite de tests dédiée).
vi.mock("@/lib/audit-logs/log-auth-event", () => ({
  logAuthEvent: vi.fn(),
}));

// Import APRÈS les mocks (vi.mock est hoisté par vitest, mais on garde
// l'ordre lisible). Le path alias `@` → repo root est défini dans
// vitest.config.ts.
import {
  completeOnboardingAction,
  type State,
} from "@/app/(public)/invitation/_actions/complete-onboarding";
import { logAuthEvent } from "@/lib/audit-logs/log-auth-event";

// --- Helpers --------------------------------------------------------------

function makeFormData(overrides: Record<string, string> = {}): FormData {
  // Token vide → branche "reprise d'onboarding" (Phase 4) : pas d'invitation
  // à valider, légitimité via session + producer draft existant. On évite
  // ainsi de mocker la chaîne producer_invitations + check email invitation.
  const fd = new FormData();
  fd.set("token", "");
  fd.set("prenom", "Jean");
  fd.set("nom", "Dupont");
  fd.set("telephone", "0612345678");
  fd.set("nom_exploitation", "Ferme du Test");
  fd.set("forme_juridique", "ei");
  fd.set("siret", "12345678901234");
  fd.set("adresse", "1 rue Test");
  fd.set("code_postal", "75001");
  fd.set("commune", "Paris");
  fd.set("type_production", "maraichage");
  for (const [k, v] of Object.entries(overrides)) fd.set(k, v);
  return fd;
}

async function runAction(formData: FormData): Promise<State | undefined> {
  // Le redirect mocké throw __REDIRECT__ en chemin succès. On l'attrape
  // pour laisser les assertions s'exécuter ; toute autre erreur remonte.
  try {
    return await completeOnboardingAction({}, formData);
  } catch (e) {
    if (!String(e).includes("__REDIRECT__")) throw e;
    return undefined;
  }
}

// --- Setup / teardown -----------------------------------------------------

let consoleInfoSpy: ReturnType<typeof vi.spyOn>;
let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  captured = {
    fromCalls: [],
    updates: [],
    selects: [],
    eqCalls: [],
    ilikeCalls: [],
    isCalls: [],
    rpcCalls: [],
  };
  responses = {};
  rpcResponses = {};
  sessionUser = {
    id: "user-42",
    email: "user@example.com",
    roles: ["consumer"],
    isAdmin: false,
  };
  consoleInfoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
  consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.mocked(logAuthEvent).mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// --- Tests ----------------------------------------------------------------

describe("completeOnboardingAction — T-110 comparaison session.email vs invitation.email", () => {
  it("session.email vs invitation.email comparés case-insensitively (Bob@... matche bob@...)", async () => {
    // Cas réel : invitation créée pour 'user@example.com', utilisateur loggé
    // côté Supabase Auth en 'User@Example.COM'. Le check ne doit PAS bloquer.
    sessionUser = {
      id: "user-42",
      email: "User@Example.COM",
      roles: ["consumer"],
      isAdmin: false,
    };
    responses.producer_invitations = [
      {
        data: {
          id: "inv-1",
          email: "user@example.com",
          expires_at: new Date(Date.now() + 86_400_000).toISOString(),
          used_at: null,
        },
        error: null,
      },
    ];
    responses.producer_interests = [{ data: [{ id: "lead-1" }], error: null }];

    const fd = makeFormData();
    fd.set("token", "a".repeat(32));
    const res = await runAction(fd);

    // Le check ne renvoie pas d'erreur "correspond pas" → on passe au flow.
    expect(res?.error).toBeUndefined();
  });

  it("session.email réellement différent de invitation.email → toujours bloqué (sécurité préservée)", async () => {
    sessionUser = {
      id: "user-x",
      email: "attacker@example.com",
      roles: ["consumer"],
      isAdmin: false,
    };
    responses.producer_invitations = [
      {
        data: {
          id: "inv-1",
          email: "victim@example.com",
          expires_at: new Date(Date.now() + 86_400_000).toISOString(),
          used_at: null,
        },
        error: null,
      },
    ];

    const fd = makeFormData();
    fd.set("token", "a".repeat(32));
    const res = await runAction(fd);

    expect(res?.error).toMatch(/correspond pas/i);
  });

  it("invitation expirée → error + audit log admin_invite_expired (userId=session.id, surface=complete_onboarding)", async () => {
    const token = "b".repeat(32);
    responses.producer_invitations = [
      {
        data: {
          id: "inv-1",
          email: "user@example.com",
          expires_at: new Date(Date.now() - 1000).toISOString(),
          used_at: null,
        },
        error: null,
      },
    ];

    const fd = makeFormData();
    fd.set("token", token);
    const res = await runAction(fd);

    expect(res?.error).toBe("Invitation expirée");
    // Pas d'UPDATE users / RPC producers / UPDATE producer_invitations
    // (sortie avant toute mutation).
    expect(captured.updates).toEqual([]);
    expect(captured.rpcCalls).toEqual([]);
    // T-081 — audit log admin_invite_expired. userId = session.id (le user
    // est loggé sur le wizard, c'est le token qui a expiré entre l'arrivée
    // sur la page et la soumission du formulaire).
    expect(logAuthEvent).toHaveBeenCalledWith({
      eventType: "admin_invite_expired",
      userId: "user-42",
      metadata: {
        invitation_id: "inv-1",
        token_prefix: token.substring(0, 8),
        surface: "complete_onboarding",
      },
    });
  });
});

describe("completeOnboardingAction — auto-bump lead 'contacted' → 'onboarded'", () => {
  it("UPDATE producer_interests + log [LEAD_ONBOARDED] quand un lead 'contacted' match l'email session", async () => {
    responses.producer_interests = [{ data: [{ id: "lead-1" }], error: null }];

    await runAction(makeFormData());

    expect(captured.fromCalls).toContain("producer_interests");
    const piUpdates = captured.updates.filter((u) => u.table === "producer_interests");
    expect(piUpdates).toEqual([
      { table: "producer_interests", payload: { statut: "onboarded" } },
    ]);
    expect(captured.ilikeCalls).toContainEqual({
      table: "producer_interests",
      col: "email",
      val: "user@example.com",
    });
    expect(captured.eqCalls).toContainEqual({
      table: "producer_interests",
      col: "statut",
      val: "contacted",
    });
    expect(captured.selects).toContainEqual({
      table: "producer_interests",
      cols: "id",
    });

    expect(consoleInfoSpy).toHaveBeenCalledTimes(1);
    const logged = String(consoleInfoSpy.mock.calls[0]?.[0] ?? "");
    expect(logged).toContain("[LEAD_ONBOARDED]");
    expect(logged).toContain("Bumped 1 lead");
    // Email masqué via maskEmail() — RGPD : "user@..." → "us***@..."
    expect(logged).toContain("us***@example.com");
    expect(consoleWarnSpy).not.toHaveBeenCalled();
  });

  it("passe session.email verbatim à .ilike (case-insensitivity côté Supabase, pas de transformation client)", async () => {
    sessionUser = { ...sessionUser!, email: "User@Example.COM" };
    responses.producer_interests = [{ data: [{ id: "lead-2" }], error: null }];

    await runAction(makeFormData());

    expect(captured.ilikeCalls).toContainEqual({
      table: "producer_interests",
      col: "email",
      val: "User@Example.COM",
    });
    // Garde-fou : on n'utilise pas .eq("email", ...) (sensible à la casse).
    const eqEmail = captured.eqCalls.find(
      (e) => e.table === "producer_interests" && e.col === "email",
    );
    expect(eqEmail).toBeUndefined();
  });

  it("no-op silencieux si aucun lead ne match (data: []) — producer s'inscrit sans avoir été invité", async () => {
    responses.producer_interests = [{ data: [], error: null }];

    await runAction(makeFormData());

    // L'UPDATE est tenté (Supabase ne sait pas a priori si la WHERE matchera)
    expect(
      captured.updates.filter((u) => u.table === "producer_interests"),
    ).toHaveLength(1);
    // Mais ni info ni warn : c'est un cas légitime, pas un échec.
    expect(consoleInfoSpy).not.toHaveBeenCalled();
    expect(consoleWarnSpy).not.toHaveBeenCalled();
  });

  it("filtre .eq('statut', 'contacted') exclut les leads en 'new' (formulaire public, jamais invités)", async () => {
    // Côté SQL un lead 'new' renvoie data:[] car la WHERE l'exclut. On
    // simule ce comportement et on vérifie surtout que le filtre est bien
    // posé dans la chaîne — c'est le seul garde-fou contre le bump 'new' →
    // 'onboarded' qui sauterait le statut 'contacted'.
    responses.producer_interests = [{ data: [], error: null }];

    await runAction(makeFormData());

    expect(captured.eqCalls).toContainEqual({
      table: "producer_interests",
      col: "statut",
      val: "contacted",
    });
    expect(consoleInfoSpy).not.toHaveBeenCalled();
  });

  it("filtre .eq('statut', 'contacted') exclut aussi les leads en 'opted_out' (lead RGPD-désinscrit)", async () => {
    responses.producer_interests = [{ data: [], error: null }];

    await runAction(makeFormData());

    expect(captured.eqCalls).toContainEqual({
      table: "producer_interests",
      col: "statut",
      val: "contacted",
    });
    expect(consoleInfoSpy).not.toHaveBeenCalled();
  });

  it("log [LEAD_ONBOARDED_WARN] sur erreur Supabase, le flow métier ne re-throw pas", async () => {
    responses.producer_interests = [
      { data: null, error: { message: "RLS policy violation" } },
    ];

    // L'action doit toujours atteindre le redirect (qui throw __REDIRECT__).
    // runAction l'attrape → resolves(undefined). Si l'action avait re-throw
    // l'erreur DB, runAction la propagerait et le test échouerait.
    await expect(runAction(makeFormData())).resolves.toBeUndefined();

    expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
    const warned = String(consoleWarnSpy.mock.calls[0]?.[0] ?? "");
    expect(warned).toContain("[LEAD_ONBOARDED_WARN]");
    expect(warned).toContain("RLS policy violation");
    expect(warned).toContain("us***@example.com");
    expect(consoleInfoSpy).not.toHaveBeenCalled();
  });

  it("session.email null → ne tente jamais l'UPDATE producer_interests, aucun log", async () => {
    sessionUser = { ...sessionUser!, email: null };

    await runAction(makeFormData());

    expect(captured.fromCalls).not.toContain("producer_interests");
    expect(
      captured.updates.find((u) => u.table === "producer_interests"),
    ).toBeUndefined();
    expect(consoleInfoSpy).not.toHaveBeenCalled();
    expect(consoleWarnSpy).not.toHaveBeenCalled();
  });
});

// --- T-307 : guard race condition consommation token --------------------
// Le UPDATE producer_invitations final porte un guard SQL .is('used_at',
// null) + .select('id') pour détecter le cas où une transaction concurrente
// a déjà claim le token entre le check ligne 54 et le UPDATE. Sémantique :
// data path users + producers étant idempotent, on log + audit + continue
// le redirect happy plutôt que rejeter — UX cohérente avec un onboarding
// en réalité réussi côté data.

function makeValidInvitationRead(): Resp {
  // SELECT initial sur producer_invitations dans la branche `if (token)` :
  // invitation valide non consommée, email matchant la session, expiration
  // largement future. Permet d'arriver au UPDATE final qui porte le guard.
  return {
    data: {
      id: "inv-99",
      email: "user@example.com",
      expires_at: "2030-12-31T00:00:00Z",
      used_at: null,
    },
    error: null,
  };
}

describe("completeOnboardingAction — race condition consommation token (T-307)", () => {
  it("happy path : claim succeeds → UPDATE invitation chaîne .is('used_at', null) + .select('id'), aucun log race + audit log invitation_consumed_success", async () => {
    responses.producer_invitations = [
      makeValidInvitationRead(),
      // 2e from() pour producer_invitations = UPDATE final → claim OK,
      // 1 row affected.
      { data: [{ id: "inv-99" }], error: null },
    ];

    await runAction(makeFormData({ token: "abcdef0123456789-token" }));

    // Le guard SQL est posé sur l'UPDATE.
    expect(captured.isCalls).toContainEqual({
      table: "producer_invitations",
      col: "used_at",
      val: null,
    });
    // Le rowcount est récupéré pour détecter la race.
    expect(captured.selects).toContainEqual({
      table: "producer_invitations",
      cols: "id",
    });

    // Aucun signal de race.
    const raceWarn = consoleWarnSpy.mock.calls.find((c: unknown[]) =>
      String(c[0] ?? "").includes("[INVITATION_RACE_LOST]"),
    );
    expect(raceWarn).toBeUndefined();
    expect(logAuthEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "invitation_consumed_race_lost" }),
    );

    // T-310 : audit log success path symétrique race_lost. Émis avec
    // préfixe token (8 chars), jamais le token complet.
    expect(logAuthEvent).toHaveBeenCalledWith({
      eventType: "invitation_consumed_success",
      userId: "user-42",
      metadata: {
        invitation_id: "inv-99",
        token_prefix: "abcdef01",
      },
    });
  });

  it("race lost : claim renvoie rowcount=0 → console.warn [INVITATION_RACE_LOST] + audit log invitation_consumed_race_lost, redirect happy quand même", async () => {
    responses.producer_invitations = [
      makeValidInvitationRead(),
      // Race : autre transaction a claim avant nous → 0 rows updated.
      { data: [], error: null },
    ];

    // runAction resolve undefined si le redirect happy a été déclenché
    // (le throw __REDIRECT__ est attrapé par runAction). Si la SUT avait
    // return error, runAction renverrait { error: ... } à la place.
    await expect(
      runAction(makeFormData({ token: "abcdef0123456789-token" })),
    ).resolves.toBeUndefined();

    const raceWarn = consoleWarnSpy.mock.calls.find((c: unknown[]) =>
      String(c[0] ?? "").includes("[INVITATION_RACE_LOST]"),
    );
    expect(raceWarn).toBeDefined();
    const warned = String(raceWarn?.[0] ?? "");
    expect(warned).toContain("invitationId=inv-99");
    expect(warned).toContain("userId=user-42");

    // Audit log race lost émis avec préfixe token (8 chars), jamais le
    // token complet (cohérent T-081 PR-A : token Resend metadata = prefix
    // only).
    expect(logAuthEvent).toHaveBeenCalledWith({
      eventType: "invitation_consumed_race_lost",
      userId: "user-42",
      metadata: {
        invitation_id: "inv-99",
        token_prefix: "abcdef01",
      },
    });
    // T-310 : exclusion mutuelle race_lost / consumed_success.
    expect(logAuthEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "invitation_consumed_success" }),
    );
  });

  it("claimError DB authentique → console.error [INVITATION_CLAIM_ERROR] + pas d'audit log race + redirect happy", async () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    responses.producer_invitations = [
      makeValidInvitationRead(),
      // Erreur DB pendant le UPDATE invitation : on log error mais on
      // continue (data path users + producers idempotent → pas un échec
      // critique du POV utilisateur). Distinct de la race (rowcount=0).
      { data: null, error: { message: "connection reset" } },
    ];

    await expect(
      runAction(makeFormData({ token: "abcdef0123456789-token" })),
    ).resolves.toBeUndefined();

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("[INVITATION_CLAIM_ERROR]"),
    );
    expect(logAuthEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "invitation_consumed_race_lost" }),
    );
    // T-310 : claimError n'est NI race lost NI success → aucun event T-310
    // émis (seul le console.error forensique trace l'incident DB).
    expect(logAuthEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "invitation_consumed_success" }),
    );
  });
});

// --- T-200 : champs catégoriels score carbone & bien-être animal ----------

describe("completeOnboardingAction — T-200 score carbone & bien-être animal", () => {
  it("happy path avec les 3 champs renseignés + déclaration cochée → params RPC update_producer_onboarding contiennent les 3 enums + p_declaration_cochee=true", async () => {
    const fd = makeFormData({
      mode_elevage: "plein_air",
      alimentation: "pature_dominante",
      densite_animale: "extensive",
      declaration_indicateurs_veracite: "on",
    });

    await runAction(fd);

    // T-241 round 2 — l'UPDATE producers est désormais encapsulé dans la RPC
    // atomique update_producer_onboarding (lecture + décision + UPDATE en
    // une seule transaction PostgreSQL avec SELECT FOR UPDATE).
    const rpc = captured.rpcCalls.find(
      (c) => c.name === "update_producer_onboarding",
    );
    expect(rpc).toBeDefined();
    expect(rpc?.params).toMatchObject({
      p_user_id: "user-42",
      p_mode_elevage: "plein_air",
      p_alimentation: "pature_dominante",
      p_densite_animale: "extensive",
      p_declaration_cochee: true,
      p_wording_version: "v1.0",
    });
  });

  it("T-200 r5 — au moins un enum saisi sans déclaration cochée → erreur Zod, aucune mutation DB ni RPC", async () => {
    // Cas typique : producteur coche « Plein air » mais oublie/refuse la
    // déclaration sur l'honneur. On bloque côté serveur (la garde client
    // n'est pas suffisante — un POST direct contournerait).
    const fd = makeFormData({ mode_elevage: "plein_air" });

    const res = await runAction(fd);

    expect(res?.error).toBeDefined();
    expect(res?.error).toMatch(/certifie/i);
    // T-200 r6 — errorField pose le path Zod du premier issue pour permettre
    // à l'UI d'ancrer la bordure rouge + le message à côté de la case
    // (au lieu d'une erreur orpheline en bas du formulaire).
    expect(res?.errorField).toBe("declaration_indicateurs_veracite");
    expect(captured.updates).toEqual([]);
    expect(captured.rpcCalls).toEqual([]);
  });

  it("T-200 r5 — déclaration cochée mais aucun enum saisi → OK, params RPC ont p_X=null pour les 3 enums (la RPC SQL ne re-persistera pas via le check any_set)", async () => {
    // Cas symétrique : producteur a coché la case par curiosité mais n'a
    // rempli aucun indicateur. Côté JS on transmet null aux 3 paramètres ;
    // la décision finale (ne pas re-persister) est prise atomiquement
    // côté SQL via le check any_set dans la RPC update_producer_onboarding
    // (cf. tests/lib/producers/declaration-veracite.test.ts pour la spec).
    const fd = makeFormData({ declaration_indicateurs_veracite: "on" });

    await runAction(fd);

    const rpc = captured.rpcCalls.find(
      (c) => c.name === "update_producer_onboarding",
    );
    expect(rpc).toBeDefined();
    expect(rpc?.params).toMatchObject({
      p_mode_elevage: null,
      p_alimentation: null,
      p_densite_animale: null,
      p_declaration_cochee: true,
    });
  });

  it("happy path sans les 3 champs → params RPC ont p_X=null pour les 3 enums + p_declaration_cochee=false", async () => {
    await runAction(makeFormData());

    const rpc = captured.rpcCalls.find(
      (c) => c.name === "update_producer_onboarding",
    );
    expect(rpc).toBeDefined();
    expect(rpc?.params).toMatchObject({
      p_mode_elevage: null,
      p_alimentation: null,
      p_densite_animale: null,
      p_declaration_cochee: false,
    });
  });

  it("valeur invalide pour mode_elevage → Zod rejette, error 'Saisie invalide', aucune mutation DB ni RPC", async () => {
    const fd = makeFormData({ mode_elevage: "valeur_qui_nexiste_pas" });

    const res = await runAction(fd);

    expect(res?.error).toBeDefined();
    expect(captured.updates).toEqual([]);
    expect(captured.rpcCalls).toEqual([]);
  });
});

// --- T-241 : persistance déclaration sur l'honneur (DGCCRF) ---------------
// Avant T-241, la case « Je certifie… » était validée Zod mais non archivée.
// Round 1 : ajout de 3 colonnes (veracite_at, snapshot, wording_version) +
// helper JS de décision + double-call SELECT/UPDATE Supabase.
// Round 2 (suite revue conformité+technique) : la décision est désormais
// faite ATOMIQUEMENT côté SQL par la RPC update_producer_onboarding, qui
// encapsule lecture (SELECT FOR UPDATE), décision (CASE WHEN) et écriture
// dans une seule transaction PostgreSQL — élimine la fenêtre lecture-
// modification non atomique sur double-clic / retry concurrent.
//
// Les 3 tests ci-dessous documentent le CONTRAT côté server action :
// quels paramètres doivent être transmis à la RPC dans chacun des 3
// scénarios métier (création, édition changeante, édition inerte). La
// SÉMANTIQUE de la décision elle-même (re-persister ou pas) est testée
// unitairement dans tests/lib/producers/declaration-veracite.test.ts via
// shouldPersistDeclarationVeracite, miroir lisible du CASE WHEN SQL.

describe("completeOnboardingAction — T-241 persistance déclaration sur l'honneur (RPC atomique)", () => {
  it("création producteur (enums vierges) + 3 enums + case cochée → RPC update_producer_onboarding appelée avec p_user_id + 3 enums + p_declaration_cochee=true + p_wording_version=v1.0", async () => {
    const fd = makeFormData({
      mode_elevage: "plein_air",
      alimentation: "pature_dominante",
      densite_animale: "extensive",
      declaration_indicateurs_veracite: "on",
    });

    await runAction(fd);

    // Une seule RPC update_producer_onboarding doit être appelée — c'est
    // le seul write path autorisé sur les colonnes declaration_indicateurs_*.
    const rpcs = captured.rpcCalls.filter(
      (c) => c.name === "update_producer_onboarding",
    );
    expect(rpcs).toHaveLength(1);
    expect(rpcs[0]?.params).toMatchObject({
      p_user_id: "user-42",
      p_mode_elevage: "plein_air",
      p_alimentation: "pature_dominante",
      p_densite_animale: "extensive",
      p_declaration_cochee: true,
      p_wording_version: "v1.0",
    });
    // Aucun UPDATE direct sur la table producers — toute la sémantique
    // declaration_indicateurs_* doit obligatoirement passer par la RPC pour
    // garantir l'atomicité et la traçabilité (single write path).
    expect(captured.updates.find((u) => u.table === "producers")).toBeUndefined();
  });

  it("édition producteur qui CHANGE un enum + case cochée → RPC appelée avec les nouveaux enums, c'est la RPC SQL qui datera la re-coche atomiquement", async () => {
    // Cas business : producteur draft avec déjà 3 enums déclarés revient et
    // change `alimentation` (pature_dominante → mixte). Côté JS on transmet
    // les valeurs soumises par le user ; la RPC SQL fait son SELECT FOR
    // UPDATE des valeurs en base, compare au snapshot précédent et décide
    // de re-persister declaration_indicateurs_* avec NOW(). La décision
    // SQL est testée via le helper shouldPersistDeclarationVeracite.
    const fd = makeFormData({
      mode_elevage: "plein_air",
      alimentation: "mixte", // changé
      densite_animale: "extensive",
      declaration_indicateurs_veracite: "on",
    });

    await runAction(fd);

    const rpc = captured.rpcCalls.find(
      (c) => c.name === "update_producer_onboarding",
    );
    expect(rpc).toBeDefined();
    expect(rpc?.params).toMatchObject({
      p_user_id: "user-42",
      p_mode_elevage: "plein_air",
      p_alimentation: "mixte",
      p_densite_animale: "extensive",
      p_declaration_cochee: true,
      p_wording_version: "v1.0",
    });
  });

  it("édition INERTE — user soumet les MÊMES enums que ceux en base + change juste le nom de la ferme + case cochée → RPC appelée avec les enums identiques, c'est la RPC SQL qui PRÉSERVE les colonnes declaration_* atomiquement", async () => {
    // Cas garde-fou comité T-241 round 2 : on doit s'assurer que le path
    // de la RPC est BIEN traversé même quand les enums sont identiques —
    // sinon le test passerait pour de mauvaises raisons (assertion
    // triviale sur un chemin où la logique n'est jamais traversée).
    //
    // Avec l'architecture round 2, le seul moyen d'avoir cette garantie
    // côté JS est de vérifier (a) qu'une RPC update_producer_onboarding
    // est bien appelée — donc la server action a traversé le code path —
    // et (b) que les params transmis incluent bien la case cochée et les
    // 3 enums identiques à ceux soumis. La décision finale de
    // PRÉSERVATION (ne pas écraser veracite_at + snapshot) est faite
    // atomiquement côté SQL et testée unitairement via le helper
    // shouldPersistDeclarationVeracite (cas « édition inerte → false »).
    const fd = makeFormData({
      nom_exploitation: "Ferme du Test — renommée",
      mode_elevage: "plein_air",
      alimentation: "pature_dominante",
      densite_animale: "extensive",
      declaration_indicateurs_veracite: "on",
    });

    await runAction(fd);

    const rpc = captured.rpcCalls.find(
      (c) => c.name === "update_producer_onboarding",
    );
    expect(rpc).toBeDefined();
    // Le nouveau nom_exploitation transite bien (sera écrit sans condition
    // par la RPC).
    expect(rpc?.params).toMatchObject({
      p_user_id: "user-42",
      p_nom_exploitation: "Ferme du Test — renommée",
      p_mode_elevage: "plein_air",
      p_alimentation: "pature_dominante",
      p_densite_animale: "extensive",
      p_declaration_cochee: true,
      p_wording_version: "v1.0",
    });
  });

  it("erreur RPC (RLS / contrainte) → la server action remonte l'erreur sans claim invitation ni bump lead", async () => {
    // Cas défensif : si la RPC SQL échoue (constraint violation, RLS
    // policy, producer non trouvé), la server action doit retourner une
    // erreur user-friendly et NE PAS continuer le claim invitation +
    // bump lead — sinon état incohérent (invitation marked used_at sans
    // producer.statut='pending').
    rpcResponses.update_producer_onboarding = [
      { data: null, error: { message: "Producer non trouvé" } },
    ];

    const res = await runAction(makeFormData());

    expect(res?.error).toMatch(/Finalisation échouée/i);
    expect(res?.error).toContain("Producer non trouvé");
    // Aucun UPDATE producer_invitations / producer_interests post-erreur.
    expect(
      captured.updates.find((u) => u.table === "producer_invitations"),
    ).toBeUndefined();
    expect(
      captured.updates.find((u) => u.table === "producer_interests"),
    ).toBeUndefined();
  });
});
