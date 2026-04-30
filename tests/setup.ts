import { vi } from "vitest";

// Mock global du package `server-only` de Next.js. C'est un import virtuel
// résolu uniquement par le webpack de Next à la build : non disponible
// dans l'environnement vitest (qui tourne en Node pur). Sans ce stub, tout
// fichier de test qui importe transitivement un module `import "server-only"`
// échoue avec "Cannot find package 'server-only'".
//
// Mutualisation T-080 finitions : remplace ~46 occurrences locales du
// même mock pattern à travers tests/. Centralisé ici via test.setupFiles
// du vitest.config.ts → applique à tous les fichiers de tests.
vi.mock("server-only", () => ({}));
