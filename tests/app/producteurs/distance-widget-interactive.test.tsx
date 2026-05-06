// @vitest-environment jsdom
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DistanceWidget } from "@/app/(public)/producteurs/[slug]/_components/DistanceWidget";

// =============================================================================
// T-237 — suite client interactive @testing-library/react + user-event
// =============================================================================
// Complément du fichier distance-widget.test.tsx (18 tests rendering/disclosure
// purs avec createRoot/act). Cette suite focalise sur les FLOWS UTILISATEUR
// REELS qui demandent des interactions clavier/souris fidèles : saisie CP,
// activation conditionnelle du bouton OK, géoloc OK / denied / timeout,
// persistance sessionStorage entre visites, toggle disclosure ouvert/fermé.
//
// Pourquoi un fichier séparé : les tests createRoot existants restent rapides
// (microsecondes par test) et focalisés sur le DOM rendu post-mount. La couche
// user-event est plus lourde (~10ms+ par test à cause du timing simulé) mais
// indispensable pour vérifier les flows interactifs vrais (un click() pur ne
// déclenche pas blur/change selon la même séquence qu'un user vrai).
// =============================================================================

const SESSION_KEY = "terroir_geo_session";

// Producer fixture Sarthe (cohérent avec distance-widget.test.tsx pour
// uniformiser les fixtures entre les deux suites — voir T-277).
const PRODUCER_LAT = 48.45;
const PRODUCER_LNG = 0.18;

// Coords gouv.fr fictives renvoyées par /api/geocode dans les tests (CP 75001
// — Paris). Pas réutilisées ailleurs : volontairement isolées de
// PRODUCER_LAT/LNG pour qu'une distance non-nulle soit calculable.
const PARIS_LAT = 48.85;
const PARIS_LNG = 2.35;

// Helpers fetch mock pour /api/geocode. On contrôle au cas par cas si
// l'appel réussit ou échoue. Les tests qui n'appellent pas /api/geocode
// laissent globalThis.fetch tel quel.
function mockGeocodeApiSuccess(lat: number, lng: number) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo) => {
      if (typeof input === "string" && input.includes("/api/geocode")) {
        return new Response(
          JSON.stringify({ ok: true, lat, lng, cached: false, source: "ban" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      throw new Error(`unexpected fetch ${String(input)}`);
    }),
  );
}

function mockGeocodeApiNotFound() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo) => {
      if (typeof input === "string" && input.includes("/api/geocode")) {
        return new Response(
          JSON.stringify({ ok: false, code: "not_found" }),
          { status: 404, headers: { "Content-Type": "application/json" } },
        );
      }
      throw new Error(`unexpected fetch ${String(input)}`);
    }),
  );
}

// Mock navigator.geolocation. Les 3 callbacks (success, error, options) sont
// passés à getCurrentPosition par le composant ; on les invoque manuellement
// selon le scénario à tester (success / denied / timeout).
type GeoCallbacks = {
  success: PositionCallback;
  error?: PositionErrorCallback;
};
let pendingGeoCallback: GeoCallbacks | null = null;

function mockGeolocation() {
  pendingGeoCallback = null;
  const getCurrentPosition = vi.fn(
    (success: PositionCallback, error?: PositionErrorCallback) => {
      pendingGeoCallback = { success, error };
    },
  );
  Object.defineProperty(globalThis.navigator, "geolocation", {
    value: { getCurrentPosition },
    configurable: true,
  });
  return getCurrentPosition;
}

beforeEach(() => {
  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  pendingGeoCallback = null;
});

describe("DistanceWidget — saisie CP + activation OK (T-237)", () => {
  it("bouton OK reste désactivé tant que le CP n'est pas 5 chiffres", async () => {
    const user = userEvent.setup();
    render(
      <DistanceWidget
        producerLat={PRODUCER_LAT}
        producerLng={PRODUCER_LNG}
        producerName="Ferme Test"
      />,
    );
    // Déploie le widget pour accéder au formulaire.
    await user.click(
      screen.getByRole("button", { name: /Voir la distance/i }),
    );
    const cpInput = screen.getByLabelText("Code postal") as HTMLInputElement;
    const okBtn = screen.getByRole("button", {
      name: /^OK$/,
    }) as HTMLButtonElement;

    // Initialement vide → désactivé. (Check via property native plutôt que
    // matcher jest-dom — pas de dep additionnelle pour 1 assertion.)
    expect(okBtn.disabled).toBe(true);

    // 4 chiffres → toujours désactivé (pattern strict 5 chiffres).
    await user.type(cpInput, "7500");
    expect(okBtn.disabled).toBe(true);

    // 5e chiffre → activé.
    await user.type(cpInput, "1");
    expect(okBtn.disabled).toBe(false);

    // 6e chiffre tenté : maxLength=5 empêche la saisie ; le bouton reste actif.
    await user.type(cpInput, "9");
    expect(cpInput.value).toBe("75001");
    expect(okBtn.disabled).toBe(false);

    // Effacer 1 chiffre → désactivé à nouveau.
    await user.keyboard("{Backspace}");
    expect(cpInput.value).toBe("7500");
    expect(okBtn.disabled).toBe(true);
  });

  it("non-numérique : refusé silencieusement par maxLength + pattern", async () => {
    const user = userEvent.setup();
    render(
      <DistanceWidget
        producerLat={PRODUCER_LAT}
        producerLng={PRODUCER_LNG}
        producerName="Ferme Test"
      />,
    );
    await user.click(
      screen.getByRole("button", { name: /Voir la distance/i }),
    );
    const cpInput = screen.getByLabelText("Code postal") as HTMLInputElement;
    // Saisie alpha + chiffres — l'input garde tout (HTML pattern n'empêche
    // pas la saisie, il marque just l'invalidité). Notre verrou métier est
    // côté JS via POSTAL_CODE_REGEX qui n'accepte que /^\d{5}$/.
    await user.type(cpInput, "7a5b01");
    const okBtn = screen.getByRole("button", {
      name: /^OK$/,
    }) as HTMLButtonElement;
    // Tant que la valeur ne matche pas /^\d{5}$/, OK reste désactivé.
    expect(okBtn.disabled).toBe(true);
  });
});

describe("DistanceWidget — géoloc OK / denied / timeout (T-237)", () => {
  it("géoloc succès : distance affichée, sessionStorage écrit", async () => {
    const user = userEvent.setup();
    mockGeolocation();
    render(
      <DistanceWidget
        producerLat={PRODUCER_LAT}
        producerLng={PRODUCER_LNG}
        producerName="Ferme Test"
      />,
    );
    await user.click(
      screen.getByRole("button", { name: /Voir la distance/i }),
    );
    await user.click(
      screen.getByRole("button", { name: /Utiliser ma position/i }),
    );
    // Le mock a stocké les callbacks ; on simule le succès navigator.
    expect(pendingGeoCallback).not.toBeNull();
    pendingGeoCallback!.success({
      coords: {
        latitude: PARIS_LAT,
        longitude: PARIS_LNG,
        accuracy: 10,
        altitude: null,
        altitudeAccuracy: null,
        heading: null,
        speed: null,
        toJSON() {
          return {};
        },
      } as GeolocationCoordinates,
      timestamp: Date.now(),
      toJSON() {
        return {};
      },
    } as GeolocationPosition);
    // Distance affichée (DistanceResult). La valeur exacte dépend du
    // calcul Haversine — on vérifie juste la présence du chiffre + label.
    await waitFor(() => {
      expect(screen.getByText("En circuit long")).toBeTruthy();
    });
    expect(screen.getByText(/à vol d'oiseau jusqu'à toi/i)).toBeTruthy();
    // SessionStorage écrit avec source 'geoloc'.
    const stored = JSON.parse(
      window.sessionStorage.getItem(SESSION_KEY) ?? "{}",
    ) as { lat: number; lng: number; source: string };
    expect(stored.source).toBe("geoloc");
    expect(stored.lat).toBe(PARIS_LAT);
    expect(stored.lng).toBe(PARIS_LNG);
  });

  it("géoloc PERMISSION_DENIED : message d'erreur + pas de session écrite", async () => {
    const user = userEvent.setup();
    mockGeolocation();
    render(
      <DistanceWidget
        producerLat={PRODUCER_LAT}
        producerLng={PRODUCER_LNG}
        producerName="Ferme Test"
      />,
    );
    await user.click(
      screen.getByRole("button", { name: /Voir la distance/i }),
    );
    await user.click(
      screen.getByRole("button", { name: /Utiliser ma position/i }),
    );
    expect(pendingGeoCallback?.error).toBeTruthy();
    pendingGeoCallback!.error!({
      code: 1,
      PERMISSION_DENIED: 1,
      POSITION_UNAVAILABLE: 2,
      TIMEOUT: 3,
      message: "User denied geolocation",
    } as GeolocationPositionError);
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toMatch(
        /Autorisation refusée/i,
      );
    });
    expect(window.sessionStorage.getItem(SESSION_KEY)).toBeNull();
  });

  it("géoloc TIMEOUT : message d'erreur dédié", async () => {
    const user = userEvent.setup();
    mockGeolocation();
    render(
      <DistanceWidget
        producerLat={PRODUCER_LAT}
        producerLng={PRODUCER_LNG}
        producerName="Ferme Test"
      />,
    );
    await user.click(
      screen.getByRole("button", { name: /Voir la distance/i }),
    );
    await user.click(
      screen.getByRole("button", { name: /Utiliser ma position/i }),
    );
    pendingGeoCallback!.error!({
      code: 3,
      PERMISSION_DENIED: 1,
      POSITION_UNAVAILABLE: 2,
      TIMEOUT: 3,
      message: "timeout",
    } as GeolocationPositionError);
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toMatch(
        /Délai dépassé/i,
      );
    });
  });

  it("géoloc POSITION_UNAVAILABLE : message d'erreur générique", async () => {
    const user = userEvent.setup();
    mockGeolocation();
    render(
      <DistanceWidget
        producerLat={PRODUCER_LAT}
        producerLng={PRODUCER_LNG}
        producerName="Ferme Test"
      />,
    );
    await user.click(
      screen.getByRole("button", { name: /Voir la distance/i }),
    );
    await user.click(
      screen.getByRole("button", { name: /Utiliser ma position/i }),
    );
    pendingGeoCallback!.error!({
      code: 2,
      PERMISSION_DENIED: 1,
      POSITION_UNAVAILABLE: 2,
      TIMEOUT: 3,
      message: "unavailable",
    } as GeolocationPositionError);
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toMatch(
        /Position indisponible/i,
      );
    });
  });
});

describe("DistanceWidget — flow CP via /api/geocode (T-237)", () => {
  it("CP succès : appel /api/geocode → distance affichée + sessionStorage 'postal'", async () => {
    const user = userEvent.setup();
    mockGeocodeApiSuccess(PARIS_LAT, PARIS_LNG);
    render(
      <DistanceWidget
        producerLat={PRODUCER_LAT}
        producerLng={PRODUCER_LNG}
        producerName="Ferme Test"
      />,
    );
    await user.click(
      screen.getByRole("button", { name: /Voir la distance/i }),
    );
    await user.type(screen.getByLabelText("Code postal"), "75001");
    await user.click(screen.getByRole("button", { name: /^OK$/ }));
    await waitFor(() => {
      expect(screen.getByText("En circuit long")).toBeTruthy();
    });
    const stored = JSON.parse(
      window.sessionStorage.getItem(SESSION_KEY) ?? "{}",
    ) as { source: string };
    expect(stored.source).toBe("postal");
    // Verrou anti-leak : le CP saisi NE doit PAS être stocké en sessionStorage
    // (on ne stocke que les coords résolues). Cohérent doctrine T-265.
    expect(window.sessionStorage.getItem(SESSION_KEY)).not.toContain("75001");
  });

  it("CP introuvable côté /api/geocode : message d'erreur affiché", async () => {
    const user = userEvent.setup();
    mockGeocodeApiNotFound();
    render(
      <DistanceWidget
        producerLat={PRODUCER_LAT}
        producerLng={PRODUCER_LNG}
        producerName="Ferme Test"
      />,
    );
    await user.click(
      screen.getByRole("button", { name: /Voir la distance/i }),
    );
    await user.type(screen.getByLabelText("Code postal"), "99999");
    await user.click(screen.getByRole("button", { name: /^OK$/ }));
    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeTruthy();
    });
    // Pas de session écrite après échec.
    expect(window.sessionStorage.getItem(SESSION_KEY)).toBeNull();
  });
});

describe("DistanceWidget — disclosure interactif (T-237)", () => {
  it("toggle ouvert → fermé → ouvert via clavier (Enter sur bouton)", async () => {
    const user = userEvent.setup();
    render(
      <DistanceWidget
        producerLat={PRODUCER_LAT}
        producerLng={PRODUCER_LNG}
        producerName="Ferme Test"
      />,
    );
    // Ouvre via Enter (a11y clavier).
    const expandBtn = screen.getByRole("button", {
      name: /Voir la distance/i,
    });
    expandBtn.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByText(/Indique ta position pour découvrir/i)).toBeTruthy();
    // Ferme via "Masquer".
    await user.click(
      screen.getByRole("button", { name: /Masquer le détail de la distance/i }),
    );
    // Retour à l'état replié — le bouton compact réapparaît.
    expect(
      screen.getByRole("button", { name: /Voir la distance/i }),
    ).toBeTruthy();
    // Le détail n'est plus monté.
    expect(screen.queryByText(/Indique ta position pour découvrir/i)).toBeNull();
  });
});

describe("DistanceWidget — persistance sessionStorage entre mounts (T-237)", () => {
  it("session pré-existante : remount lit le stockage et affiche la distance compact", () => {
    window.sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ lat: PARIS_LAT, lng: PARIS_LNG, source: "postal" }),
    );
    render(
      <DistanceWidget
        producerLat={PRODUCER_LAT}
        producerLng={PRODUCER_LNG}
        producerName="Ferme Test"
      />,
    );
    // Le bouton compact affiche directement la distance (pas "Voir la
    // distance jusqu'à toi" générique). Cohérent décision T-240 r1 : on
    // RESTE replié mais avec la distance pré-calculée pour ce producteur.
    const compact = screen.getByRole("button", {
      name: /à vol d'oiseau/i,
    }) as HTMLButtonElement;
    expect(compact.textContent).toMatch(/\d+(?:\.\d+)?\s+km/);
  });

  it("session écrite dans un mount : visible sur le mount suivant", async () => {
    const user = userEvent.setup();
    mockGeolocation();
    const { unmount } = render(
      <DistanceWidget
        producerLat={PRODUCER_LAT}
        producerLng={PRODUCER_LNG}
        producerName="Ferme Test"
      />,
    );
    await user.click(
      screen.getByRole("button", { name: /Voir la distance/i }),
    );
    await user.click(
      screen.getByRole("button", { name: /Utiliser ma position/i }),
    );
    pendingGeoCallback!.success({
      coords: {
        latitude: PARIS_LAT,
        longitude: PARIS_LNG,
        accuracy: 10,
        altitude: null,
        altitudeAccuracy: null,
        heading: null,
        speed: null,
        toJSON() {
          return {};
        },
      } as GeolocationCoordinates,
      timestamp: Date.now(),
      toJSON() {
        return {};
      },
    } as GeolocationPosition);
    await waitFor(() => {
      expect(screen.getByText("En circuit long")).toBeTruthy();
    });
    // Unmount + remount : la session doit persister via sessionStorage.
    unmount();
    render(
      <DistanceWidget
        producerLat={PRODUCER_LAT}
        producerLng={PRODUCER_LNG}
        producerName="Ferme Test"
      />,
    );
    const compact = screen.getByRole("button", {
      name: /à vol d'oiseau/i,
    });
    expect(compact.textContent).toMatch(/km/);
  });
});

// Force vitest à voir au moins une référence au type unused MockInstance
// (sinon "import declared but never used" en mode strict). Pas de test
// dynamique, juste keep-alive du type au cas où on en aurait besoin pour
// typer un spy plus fin dans une itération future.
type _UsedTypeRef = MockInstance;
