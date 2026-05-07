// Helper de type partagé pour les mocks Supabase PostgREST utilisés dans
// les tests Stripe (`tests/lib/stripe/*.test.ts`).
//
// Pattern : les helpers `from()` retournent un builder fluent qui chaîne
// `select()`, `eq()`, `update()`, `insert()`, `in()`, `gte()`, `order()`,
// `limit()`, `then()`, `maybeSingle()`, `single()` etc. Le builder se
// référence lui-même (les méthodes intermédiaires retournent `this`).
//
// Avant T-Cluster-E (2026-05-07) ces builders étaient typés `any` avec
// directive `// eslint-disable-next-line @typescript-eslint/no-explicit-any`.
// Cleanup : la règle n'est pas activée dans .eslintrc.json, les directives
// étaient donc obsolètes (signalées par next lint comme rules not found).
//
// Type signature minimaliste — on accepte n'importe quelle méthode/propriété
// (les builders ne sont jamais introspectés par TypeScript, seulement
// invoqués par le code testé). L'index signature `unknown` couvre les
// callbacks de chainage et les promesses des méthodes finales.

export type ChainableMockBuilder = {
  [method: string]: unknown;
};
