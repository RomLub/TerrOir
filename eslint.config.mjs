// ESLint flat config (ESLint 9+). Remplace l'ancien `.eslintrc.json`,
// déprécié dans ESLint 9. Next 16 a également retiré la commande
// `next lint` ; on appelle désormais `eslint .` directement (cf.
// scripts.lint dans package.json).
//
// Le package `eslint-config-next` 16+ expose des configs flat natives
// via les sous-chemins `/core-web-vitals`, `/typescript`, `/parser`.
// On consomme directement `/core-web-vitals` (équivalent flat de
// l'ancien `extends: "next/core-web-vitals"`) — pas besoin du wrapper
// `FlatCompat` de `@eslint/eslintrc`.

import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

export default [
  ...nextCoreWebVitals,
  {
    // Patterns ignorés. `eslint-config-next` ignore déjà par défaut
    // `.next/**`, `out/**`, `build/**` et `next-env.d.ts` à la racine,
    // mais ces defaults ne capturent pas :
    //   - les `.next/` imbriqués dans les worktrees agent CC,
    //   - les artefacts session CC (worktrees, locks, caches),
    //   - les répertoires d'outils tiers (Playwright reports, coverage,
    //     Turbo, Vercel, etc.).
    // Sans ces ignores, ESLint plonge dans ~750 000 fichiers générés
    // sous `.claude/worktrees/agent-*/...` (16+ worktrees × ~50 000
    // fichiers chacun incluant node_modules + .next), bloquant le lint
    // pendant 13+ min sans terminer. Diagnostic 2026-05-13.
    ignores: [
      // Build outputs Next.js — récursif pour capturer les .next/
      // imbriqués (default eslint-config-next ne couvre que la racine).
      "**/.next/**",

      // Dependencies (explicite même si c'est un default ESLint).
      "**/node_modules/**",

      // Artefacts session Claude Code : worktrees agent (copies
      // complètes du repo + node_modules + .next), locks, caches futurs.
      // Note : .claude/agents/ NE DOIT PAS être ignoré quand il existera
      // (sub-agents définis par Romain à versionner). On est ici plus
      // restrictif que `.claude/**` pour préserver cette extensibilité.
      ".claude/worktrees/**",
      ".claude/cache/**",
      ".claude/sessions/**",

      // Outputs build / coverage standards (préventif — absents
      // aujourd'hui mais conventions Node/TS à exclure d'office).
      "coverage/**",
      "dist/**",
      "out/**",
      "build/**",
      ".turbo/**",

      // Vercel local
      ".vercel/**",

      // Playwright outputs (rapports HTML, traces, caches).
      "playwright-report/**",
      "test-results/**",
      "blob-report/**",
      "playwright/.cache/**",

      // Scripts ad-hoc one-shot non versionnés (cf. .gitignore).
      ".tmp/**",

      // TS build info (incrémental tsc).
      "*.tsbuildinfo",
      "**/*.tsbuildinfo",
    ],
  },
  {
    rules: {
      // Règles TerrOir spécifiques (issues T-255 et T-266). Reprises à
      // l'identique depuis l'ancien `.eslintrc.json` — l'éradication des
      // apostrophes courbes U+2019 et l'enforcement du préfixe
      // `terroir_` sur les clés storage sont des invariants doctriaux
      // (cf. CLAUDE.md section conventions code).
      "no-restricted-syntax": [
        "error",
        {
          selector: "Literal[value=/\\u2019/]",
          message:
            "T-255: Apostrophe courbe U+2019 interdite. Utiliser apostrophe droite ASCII (') ou entité HTML &rsquo;/&apos; selon contexte JSX.",
        },
        {
          selector: "TemplateElement[value.raw=/\\u2019/]",
          message:
            "T-255: Apostrophe courbe U+2019 interdite. Utiliser apostrophe droite ASCII (') ou entité HTML &rsquo;/&apos; selon contexte JSX.",
        },
        {
          selector: "JSXText[raw=/\\u2019/]",
          message:
            "T-255: Apostrophe courbe U+2019 interdite en source JSX. Utiliser apostrophe droite ASCII (') ou entité HTML &rsquo; (rendu typographique courbe préservé) / &apos;.",
        },
        {
          selector:
            "CallExpression[callee.object.name=/^(local|session)Storage$/][callee.property.name=/^(set|get|remove)Item$/][arguments.0.type='Literal'][arguments.0.value!=/^terroir_/]",
          message:
            "T-266: clé sessionStorage/localStorage non préfixée terroir_ interdite. Utiliser terroir_<scope>_<key> (ex. terroir_geo_session). Plus de tolérance terroir- legacy depuis T-266-tris (migration finalisée).",
        },
        {
          selector:
            "CallExpression[callee.object.property.name=/^(local|session)Storage$/][callee.object.object.name='window'][callee.property.name=/^(set|get|remove)Item$/][arguments.0.type='Literal'][arguments.0.value!=/^terroir_/]",
          message:
            "T-266: clé sessionStorage/localStorage non préfixée terroir_ interdite. Utiliser terroir_<scope>_<key> (ex. terroir_geo_session). Plus de tolérance terroir- legacy depuis T-266-tris (migration finalisée).",
        },
      ],
    },
  },
];
