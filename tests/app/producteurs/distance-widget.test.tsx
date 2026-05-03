// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DistanceWidget } from "@/app/(public)/producteurs/[slug]/_components/DistanceWidget";

// Flag global React 18 pour signaler à React qu'on est dans un test runner
// qui supporte `act(...)`. Sans ça React émet un warning à chaque flush.
// Cf. https://github.com/reactwg/react-18/discussions/102
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

// T-239+T-240 round 1 (comité review) : couverture des 3 états du nouveau
// disclosure du widget distance. Tests manuels DOM sans @testing-library
// pour limiter la surface de deps (jsdom seul suffit). Si on étend la
// couverture interactive un jour (saisie CP, géoloc denied, etc.), basculer
// sur @testing-library/react + userEvent — cf. T-237 sur la TODO.

const SESSION_KEY = "terroir_geo_session";

// Coords producteur (Maraîchage des Alpes Mancelles, ~Sarthe).
const PRODUCER_LAT = 48.45;
const PRODUCER_LNG = 0.18;
// Coords consumer (Paris). Distance Haversine attendue ~205 km.
const CONSUMER_SESSION = { lat: 48.85, lng: 2.35, source: "postal" as const };

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  // sessionStorage est par défaut vide pour un nouveau jsdom mais on
  // s'assure qu'il l'est explicitement entre tests pour ne jamais dépendre
  // de l'ordre d'exécution.
  window.sessionStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  vi.restoreAllMocks();
});

function render(node: React.ReactElement) {
  act(() => {
    root.render(node);
  });
}

describe("DistanceWidget — disclosure 3 états (T-240)", () => {
  it("(a) replié vide : bouton compact 'Voir la distance jusqu'à toi', pas de détail", () => {
    render(
      <DistanceWidget
        producerLat={PRODUCER_LAT}
        producerLng={PRODUCER_LNG}
        producerName="Ferme Test"
      />,
    );
    const buttons = Array.from(container.querySelectorAll("button"));
    // Un seul bouton dans l'état replié vide (le CTA d'expansion).
    expect(buttons.length).toBe(1);
    expect(buttons[0]?.textContent).toContain("Voir la distance jusqu'à toi");
    // Le détail (invite + RGPD + bouton géoloc) ne doit PAS être monté.
    expect(container.textContent).not.toContain(
      "Indique ta position pour découvrir",
    );
    expect(container.textContent).not.toContain("Utiliser ma position");
    expect(container.textContent).not.toContain("Saisie facultative");
  });

  it("(b) replié avec session : bouton compact affiche directement '… km à vol d'oiseau'", () => {
    window.sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify(CONSUMER_SESSION),
    );
    render(
      <DistanceWidget
        producerLat={PRODUCER_LAT}
        producerLng={PRODUCER_LNG}
        producerName="Ferme Test"
      />,
    );
    const buttons = Array.from(container.querySelectorAll("button"));
    expect(buttons.length).toBe(1);
    // Le label porte la distance calculée (Haversine Paris↔~Sarthe ≈ 205 km
    // à 1 km près selon arrondi). On match la forme générique pour ne pas
    // verrouiller un chiffre exact qui dépendrait de l'arrondi exact.
    expect(buttons[0]?.textContent).toMatch(/\d+ km à vol d'oiseau/);
    expect(buttons[0]?.textContent).not.toContain("Voir la distance");
    // Toujours pas de détail : on est replié, juste avec un autre label.
    expect(container.textContent).not.toContain(
      "Indique ta position pour découvrir",
    );
  });

  it("(c) déployé après clic : invite + bouton géoloc + champ CP + RGPD montés", () => {
    render(
      <DistanceWidget
        producerLat={PRODUCER_LAT}
        producerLng={PRODUCER_LNG}
        producerName="Ferme Test"
      />,
    );
    const expandBtn = container.querySelector("button");
    expect(expandBtn).not.toBeNull();
    act(() => {
      expandBtn!.click();
    });
    // Invite personnalisée avec le nom du producteur.
    expect(container.textContent).toContain(
      "Indique ta position pour découvrir",
    );
    expect(container.textContent).toContain("Ferme Test");
    // CTA géoloc + champ CP + bouton OK montés.
    expect(container.textContent).toContain("Utiliser ma position");
    expect(container.querySelector("#cp-input")).not.toBeNull();
    const okBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "OK",
    );
    expect(okBtn).not.toBeUndefined();
    // Mention RGPD au point de collecte (art. 13) toujours présente après
    // la refonte disclosure (verrou anti-régression r4).
    expect(container.textContent).toContain("Saisie facultative");
    expect(container.textContent).toContain(
      "jamais envoyée ni enregistrée sur nos serveurs",
    );
    expect(container.textContent).toContain("api-adresse.data.gouv.fr");
    // Lien "Masquer" présent pour replier.
    const collapseLink = Array.from(
      container.querySelectorAll("button"),
    ).find((b) => b.textContent?.trim() === "Masquer");
    expect(collapseLink).not.toBeUndefined();
  });

  it("producer sans coords : composant ne rend rien (early-return)", () => {
    render(
      <DistanceWidget
        producerLat={null}
        producerLng={null}
        producerName="Ferme Test"
      />,
    );
    expect(container.textContent).toBe("");
    expect(container.querySelector("button")).toBeNull();
  });

  it("(c) déployé avec session pré-existante : DistanceResult + comparaison circuit long", () => {
    window.sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify(CONSUMER_SESSION),
    );
    render(
      <DistanceWidget
        producerLat={PRODUCER_LAT}
        producerLng={PRODUCER_LNG}
        producerName="Ferme Test"
      />,
    );
    const expandBtn = container.querySelector("button");
    act(() => {
      expandBtn!.click();
    });
    // En présence d'une session valide, le clic d'expansion mène au
    // DistanceResult (résultat complet), pas au formulaire vide.
    expect(container.textContent).toContain("Jusqu'à toi");
    expect(container.textContent).toContain("En circuit long");
    expect(container.textContent).toContain("~1500 km");
    expect(container.textContent).toContain("Estimation indicative");
    expect(container.textContent).toContain("à vol d'oiseau jusqu'à toi");
    // Action de reset ("Changer ma position") disponible.
    const resetBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Changer ma position",
    );
    expect(resetBtn).not.toBeUndefined();
  });
});
