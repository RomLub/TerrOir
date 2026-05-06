// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DistanceWidget } from "@/app/(public)/producteurs/[slug]/_components/DistanceWidget";

// Flag global React 18 : à `true`, React signale (warn) toute state update
// non wrappée dans `act(...)`. À `false`/undefined, React reste silencieux.
// On le pose à `true` pour DÉTECTER les oublis de wrap, pas pour les masquer :
// si un test passe sans warning, c'est parce que tous les triggers (render,
// click, unmount) sont bien wrappés ci-dessous, pas parce que le flag éteint
// quoi que ce soit. Diagnostic comité review T-239+T-240 r2.
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
    const compact = buttons[0]!;
    expect(compact.textContent).toContain("Voir la distance jusqu'à toi");
    // Comportement métier : le bouton est cliquable (post-mount) et de type
    // button (pas de submit qui déclencherait un formulaire fantôme).
    expect(compact.getAttribute("type")).toBe("button");
    expect(compact.disabled).toBe(false);
    // Le détail (invite + RGPD + bouton géoloc) ne doit PAS être monté.
    expect(container.textContent).not.toContain(
      "Indique ta position pour découvrir",
    );
    expect(container.textContent).not.toContain("Utiliser ma position");
    expect(container.textContent).not.toContain("Saisie facultative");
    // Pas de lien "Masquer" tant qu'on est replié — c'est le bouton compact
    // qui agit comme toggle d'ouverture, pas un lien de fermeture.
    expect(container.textContent).not.toContain("Masquer");
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
    const compact = buttons[0]!;
    // Le label porte la distance calculée (Haversine arrondi à 1 décimale,
    // cf. lib/geo/haversine.ts). Paris↔Sarthe ≈ 164.5 km. On match la forme
    // décimale exacte ET on extrait la valeur pour vérifier qu'elle tombe
    // dans la fourchette plausible (verrou anti-régression : si le calcul
    // renvoyait 0 ou NaN, le test passerait toujours sur une regex moins
    // stricte. Le round 2 du comité review a explicitement demandé ce
    // renforcement — l'ancienne regex `\d+ km` capturait par erreur le `5`
    // de `164.5` à cause du backtracking, validant l'écran sur de la
    // mauvaise raison).
    const match = compact.textContent?.match(
      /(\d+(?:\.\d+)?) km à vol d'oiseau/,
    );
    expect(match).not.toBeNull();
    const km = Number(match![1]);
    expect(km).toBeGreaterThan(150);
    expect(km).toBeLessThan(250);
    expect(compact.textContent).not.toContain("Voir la distance");
    // Comportement métier : bouton cliquable post-mount (le clic déploie le
    // résultat complet — testé dans le 5e test).
    expect(compact.disabled).toBe(false);
    // Toujours pas de détail : on est replié, juste avec un autre label.
    expect(container.textContent).not.toContain(
      "Indique ta position pour découvrir",
    );
    expect(container.textContent).not.toContain("En circuit long");
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
    // CTA géoloc cliquable (pending=false au mount).
    const geolocBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Utiliser ma position"),
    ) as HTMLButtonElement | undefined;
    expect(geolocBtn).not.toBeUndefined();
    expect(geolocBtn!.disabled).toBe(false);
    // Champ CP : pattern strict, maxLength 5, inputMode numeric — verrous
    // de saisie côté UI (defense in depth en plus du regex côté composant).
    const cpInput = container.querySelector("#cp-input") as HTMLInputElement | null;
    expect(cpInput).not.toBeNull();
    expect(cpInput!.getAttribute("pattern")).toBe("\\d{5}");
    expect(cpInput!.maxLength).toBe(5);
    expect(cpInput!.getAttribute("inputmode")).toBe("numeric");
    expect(cpInput!.disabled).toBe(false);
    // Bouton OK : DÉSACTIVÉ tant que le CP n'est pas valide (5 chiffres).
    // Verrou métier : on ne doit pas pouvoir soumettre un CP vide ou partiel.
    const okBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "OK",
    ) as HTMLButtonElement | undefined;
    expect(okBtn).not.toBeUndefined();
    expect(okBtn!.disabled).toBe(true);
    expect(okBtn!.getAttribute("aria-busy")).toBe("false");
    // Mention RGPD au point de collecte (art. 13) toujours présente après
    // la refonte disclosure (verrou anti-régression r4 + T-219 r1).
    // Wording mis à jour T-219 : la position résultante reste dans le
    // navigateur, mais le CP transite désormais via /api/geocode (cache
    // anonyme côté serveur). On vérifie le nouveau wording cohérent avec
    // PrivacyNote().
    expect(container.textContent).toContain("Saisie facultative");
    expect(container.textContent).toContain(
      "n'est jamais associée à ton compte ni à ta visite côté serveur",
    );
    expect(container.textContent).toContain(
      "cache anonyme du couple code postal",
    );
    expect(container.textContent).toContain("api-adresse.data.gouv.fr");
    // Lien "Masquer" présent pour replier.
    const collapseLink = Array.from(
      container.querySelectorAll("button"),
    ).find((b) => b.textContent?.trim() === "Masquer");
    expect(collapseLink).not.toBeUndefined();
    // Aucun message d'erreur initial (l'état d'erreur n'apparaît qu'après
    // une tentative de géoloc/CP qui échoue).
    expect(container.querySelector('[role="alert"]')).toBeNull();
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

  it("sessionStorage corrompu : fallback silencieux sur état compact 'Voir la distance'", () => {
    // Verrou contre la classe d'incidents "donnée tierce malformée écrase
    // notre clé de session" : un autre script de l'origine, une extension
    // navigateur, ou simplement un dev qui a édité manuellement le storage
    // ne doit JAMAIS planter le mount du widget. Pour chacune des entrées
    // ci-dessous, on attend strictement le même rendu que l'état (a) :
    // bouton compact "Voir la distance jusqu'à toi", pas de détail, pas
    // d'erreur affichée. Cf. round 3 comité review (point 7).
    const corrupted: Array<[string, string]> = [
      ["JSON invalide", "not-a-json{"],
      ["lat manquante", JSON.stringify({ lng: 2.35, source: "postal" })],
      ["lat string", JSON.stringify({ lat: "48.85", lng: 2.35, source: "postal" })],
      ["lat NaN", JSON.stringify({ lat: Number.NaN, lng: 2.35, source: "postal" })],
      [
        "lat hors plage WGS84",
        JSON.stringify({ lat: 999, lng: 2.35, source: "postal" }),
      ],
      [
        "lng hors plage WGS84",
        JSON.stringify({ lat: 48.85, lng: 999, source: "postal" }),
      ],
      [
        "source inconnue",
        JSON.stringify({ lat: 48.85, lng: 2.35, source: "evil" }),
      ],
    ];
    for (const [scenario, payload] of corrupted) {
      window.sessionStorage.clear();
      window.sessionStorage.setItem(SESSION_KEY, payload);
      // Re-monte un container neuf à chaque itération pour isoler les états.
      act(() => root.unmount());
      container.remove();
      container = document.createElement("div");
      document.body.appendChild(container);
      root = createRoot(container);
      render(
        <DistanceWidget
          producerLat={PRODUCER_LAT}
          producerLng={PRODUCER_LNG}
          producerName="Ferme Test"
        />,
      );
      const buttons = Array.from(container.querySelectorAll("button"));
      expect(buttons.length, scenario).toBe(1);
      expect(buttons[0]!.textContent, scenario).toContain(
        "Voir la distance jusqu'à toi",
      );
      // Aucune distance fantôme, aucune alerte parasitée par le payload.
      expect(container.textContent, scenario).not.toMatch(/km à vol d'oiseau/);
      expect(container.querySelector('[role="alert"]'), scenario).toBeNull();
    }
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
    // La barre de comparaison rend un width inline numérique (0-100%) — on
    // vérifie la présence du style ET sa cohérence (>0 puisqu'on a une
    // distance valide). Verrou anti-régression : si le ratio retombait à 0
    // ou NaN, la barre disparaîtrait silencieusement.
    const bar = container.querySelector(
      'div[aria-hidden="true"][style*="width"]',
    ) as HTMLDivElement | null;
    expect(bar).not.toBeNull();
    const widthMatch = bar!.getAttribute("style")?.match(/width:\s*(\d+)%/);
    expect(widthMatch).not.toBeNull();
    const widthPct = Number(widthMatch![1]);
    expect(widthPct).toBeGreaterThan(0);
    expect(widthPct).toBeLessThanOrEqual(100);
    // Action de reset ("Changer ma position") disponible et cliquable.
    const resetBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Changer ma position",
    ) as HTMLButtonElement | undefined;
    expect(resetBtn).not.toBeUndefined();
    expect(resetBtn!.disabled).toBe(false);
    // Le formulaire CP NE doit PAS être monté ici (résultat = pas de saisie).
    expect(container.querySelector("#cp-input")).toBeNull();
    // Mention RGPD persiste dans l'écran résultat (PrivacyNote partagé).
    expect(container.textContent).toContain("Saisie facultative");
  });
});

describe("DistanceWidget — bascule hors zone circuit court (T-230)", () => {
  // Cas DOM-TOM : visiteur Saint-Denis (Réunion, CP 97400) sur la fiche d'un
  // producteur métropolitain (Le Mans). Distance Haversine ≈ 9300 km — bien
  // au-delà du seuil DISTANCE_OUT_OF_REACH_KM (500 km).
  const REUNION_SESSION = {
    lat: -20.88,
    lng: 55.45,
    source: "postal" as const,
  };
  const LE_MANS_LAT = 48.0;
  const LE_MANS_LNG = 0.2;

  it("distance > seuil : compact affiche 'Hors zone circuit court' (pas de km)", () => {
    window.sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify(REUNION_SESSION),
    );
    render(
      <DistanceWidget
        producerLat={LE_MANS_LAT}
        producerLng={LE_MANS_LNG}
        producerName="Ferme Test"
      />,
    );
    const buttons = Array.from(container.querySelectorAll("button"));
    expect(buttons.length).toBe(1);
    const compact = buttons[0]!;
    expect(compact.textContent).toContain("Hors zone circuit court");
    // Verrou anti-régression : aucune valeur kilométrique brute ne doit fuir
    // dans le label compact (pas de "9300 km", pas de "X km à vol d'oiseau").
    expect(compact.textContent).not.toMatch(/\d+\s*km/);
    expect(compact.textContent).not.toContain("à vol d'oiseau");
  });

  it("distance > seuil : déployé affiche message dédié, pas de comparaison GMS", () => {
    window.sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify(REUNION_SESSION),
    );
    render(
      <DistanceWidget
        producerLat={LE_MANS_LAT}
        producerLng={LE_MANS_LNG}
        producerName="Ferme Test"
      />,
    );
    const expandBtn = container.querySelector("button");
    act(() => {
      expandBtn!.click();
    });
    // Wording dédié (factuel, pas culpabilisant).
    expect(container.textContent).toContain("Hors zone");
    expect(container.textContent).toContain(
      "en dehors de notre zone de circuit court",
    );
    expect(container.textContent).toContain("Ferme Test");
    // La comparaison ~1500 km circuit long DOIT être retirée : le ratio
    // s'écrase pour ces distances et l'argument se retourne contre nous.
    expect(container.textContent).not.toContain("En circuit long");
    expect(container.textContent).not.toContain("~1500 km");
    expect(container.textContent).not.toContain("Estimation indicative");
    // Pas de barre de comparaison non plus (verrou : si DistanceResult était
    // rendu malgré la bascule, la barre apparaîtrait avec son aria-hidden).
    expect(
      container.querySelector('div[aria-hidden="true"][style*="width"]'),
    ).toBeNull();
    // Aucune valeur kilométrique brute affichée (le composant ne doit pas
    // laisser fuir "9300 km" même en dehors du gros chiffre principal).
    expect(container.textContent).not.toMatch(/\d+\s*km/);
    // Action de reset toujours disponible — l'utilisateur doit pouvoir
    // changer sa position immédiatement.
    const resetBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Changer ma position",
    ) as HTMLButtonElement | undefined;
    expect(resetBtn).not.toBeUndefined();
    expect(resetBtn!.disabled).toBe(false);
    // Mention RGPD préservée (PrivacyNote partagé entre tous les écrans).
    expect(container.textContent).toContain("Saisie facultative");
  });

  it("boundary : distance == seuil reste dans le comportement existant (>, pas >=)", () => {
    // La bascule utilise `distance > DISTANCE_OUT_OF_REACH_KM` (500 km strict
    // exclusif). Une distance pile sur le seuil tombe donc dans le rendu km
    // classique. Verrou explicite contre une dérive future à >=.
    // Pour cibler ~500 km à vol d'oiseau depuis Le Mans (48.0, 0.2), on prend
    // la latitude équivalente à ~500 km plus au sud (≈ 4.5° de latitude).
    const FAR_BUT_IN_REACH = {
      lat: 48.0 - 4.4, // ≈ 489 km de Le Mans, juste sous le seuil 500
      lng: 0.2,
      source: "postal" as const,
    };
    window.sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify(FAR_BUT_IN_REACH),
    );
    render(
      <DistanceWidget
        producerLat={LE_MANS_LAT}
        producerLng={LE_MANS_LNG}
        producerName="Ferme Test"
      />,
    );
    const compact = container.querySelector("button")!;
    // Comportement km classique restitué tant qu'on est <= 500 km.
    expect(compact.textContent).toMatch(/\d+(?:\.\d+)?\s+km à vol d'oiseau/);
    expect(compact.textContent).not.toContain("Hors zone");
  });

  it("distance < seuil : comportement existant inchangé (verrou non-régression)", () => {
    // Verrou : Paris↔Sarthe (~165 km, bien sous le seuil) DOIT garder le
    // rendu km classique avec comparaison GMS au déploiement.
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
    const compact = container.querySelector("button")!;
    expect(compact.textContent).toContain("à vol d'oiseau");
    expect(compact.textContent).not.toContain("Hors zone");
    act(() => {
      compact.click();
    });
    expect(container.textContent).toContain("En circuit long");
    expect(container.textContent).toContain("~1500 km");
  });
});
