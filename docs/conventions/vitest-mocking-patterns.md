# Vitest mocking patterns — convention TerrOir

> **Source** : leçons collectées sur le chantier pickup-validation 2026-05-06 (LOTs 3, 4, 5, 7).
> **Cible** : éviter aux futures sessions de re-tomber dans les mêmes pièges.
> **Stack** : `vitest@4` (rolldown) + `tests/setup.ts` global + `jsdom` ad hoc via `// @vitest-environment jsdom`.

Ce document grandit au fil des chantiers. Quand un piège est résolu deux fois, l'ajouter ici.

---

## 1. `importOriginal` dans `vi.mock` pour préserver les exports transverses

### Symptôme

Un fichier mocke `@/lib/<module-partagé>` pour stubber une seule fonction. Le test passe en isolation. **Mais en suite complète**, des tests sur un AUTRE module qui consomme le même `@/lib/<module-partagé>` cassent avec `TypeError: <autreFunction> is not a function`.

Cause racine : la factory `() => ({ ... })` passée à `vi.mock` **remplace tout le module** par l'objet retourné. Si la factory n'expose qu'une partie des exports d'origine, les autres exports deviennent `undefined` pour tout fichier qui hérite du même worker vitest.

### Exemple concret — incident LOT 3

`tests/app/api/producer/orders/validate-pickup/route.test.ts` mocke `@/lib/rate-limit` :

```ts
// ❌ AVANT (casse les tests producers/search en suite complète)
vi.mock("@/lib/rate-limit", () => ({
  consumeRateLimit: mockConsumeRateLimit,
  getPickupValidationRateLimit: () => ({}),
}));
```

Conséquence : `getProducersSearchRateLimit` (T-236) consommé par `tests/app/api/producers/search/route.test.ts` retourne `undefined`. Erreur runtime `TypeError: getProducersSearchRateLimit is not a function` à `app/api/producers/search/route.ts:19`.

### Fix — pattern canonique

```ts
// ✅ APRÈS
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return {
    ...actual,
    consumeRateLimit: mockConsumeRateLimit,
    getPickupValidationRateLimit: () => ({}),
  };
});
```

`importOriginal` charge le vrai module ; le `...actual` étale tous les exports d'origine, et l'override n'écrase que les fonctions ciblées. Les autres tests qui consomment `getProducersSearchRateLimit`, `getStripeRefundRateLimit`, etc. continuent de fonctionner.

### Quand l'appliquer

- **Toujours** sur les modules avec ≥ 3 exports utilisés par plusieurs fichiers de test (`@/lib/rate-limit`, `@/lib/audit-logs/labels`, `@/lib/orders/stateMachine`...).
- Inutile sur les modules à 1-2 exports stricts (ex. mock d'un helper dédié à un seul call site).

---

## 2. Imports directs vs barrel `index.ts` pour les tests jsdom

### Symptôme

Test jsdom d'un composant client. À l'exécution `vitest run`, échec en phase de transformation Vite avec :

```
Error: Failed to resolve import "server-only" from "lib/<...>.ts"
Plugin: vite:import-analysis
```

Le `vi.mock("server-only", () => ({}))` global du `tests/setup.ts` n'agit qu'au runtime. **Il arrive trop tard** : Vite analyse les imports avant que les mocks soient appliqués.

Cause : importer un composant simple (`Button`) depuis le barrel `@/components/ui` aspire **toute la chaîne de re-exports**. Si un seul des composants exportés par le barrel importe transitivement un fichier `server-only`, l'analyse Vite plante.

### Exemple concret — incident LOT 4

`PickupValidationCard.tsx` importe `Button` et `AdminModal` :

```ts
// ❌ AVANT (casse le test jsdom)
import { Button, AdminModal } from '@/components/ui';
```

Chaîne de transformation :
```
@/components/ui (index.ts)
  → re-exporte NavbarPublic
    → import use-logout-flow
      → import app/connexion/logout-action
        → import "@/lib/audit-logs/log-auth-event"
          → import "server-only"  ❌ Vite plante ici
```

### Fix

```ts
// ✅ APRÈS
import { Button } from '@/components/ui/button';
import { AdminModal } from '@/components/ui/admin-modal';
```

Imports directs vers les fichiers réels — Vite ne suit que les sub-imports nécessaires (Tailwind primitives, etc.).

### Quand l'appliquer

- **Tout composant client** ciblé par un test jsdom interactif qui importe `@/components/ui` (barrel).
- L'overhead lecture/typage est minime (imports nommés multiples vs barrel) ; gain : tests verts en suite complète.
- Pour les Server Components rendus via `renderToStaticMarkup` (env=node), le barrel passe car Vite ne charge pas la sous-chaîne `'use client'` côté serveur.

### Comment détecter le bon import direct

`grep -E "^export \{ <Composant>" components/ui/index.ts` → fichier source dans le `from "./..."`.

---

## 3. `act()` autour des helpers DOM custom qui déclenchent `setState`

### Symptôme

Test jsdom avec `createRoot` + `act()` qui passe **mais émet des warnings** :

```
Warning: An update to <Component> inside a test was not wrapped in act(...).
When testing, code that causes React state updates should be wrapped into act(...):
```

Cause : un helper DOM custom (ex. `setInputValue`) dispatche un event qui déclenche un `onChange` React → setState. Si le helper n'est pas wrappé, React voit le state update hors de `act` et warn.

### Exemple concret — incident LOT 4

`PickupValidationCard` a un input `<input onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 12))}>`. Pour simuler la saisie utilisateur :

```ts
// ❌ AVANT (warnings act)
function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype, "value"
  )!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
```

Le `dispatchEvent('input')` déclenche le React onChange → `setCode()` → re-render. React detecte l'update hors `act` et warn.

### Fix

```ts
// ✅ APRÈS
function setInputValue(input: HTMLInputElement, value: string) {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, "value"
    )!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
```

### Quand l'appliquer

- Tout helper qui dispatche un event DOM (`input`, `change`, `submit`, `click`) sur un élément monté.
- Pour les async events (fetch + setState), utiliser `await act(async () => {...})` qui attend les microtasks.
- Pour `btn.click()` sur un bouton dont le handler `setState`, idem : wrap dans `act`.

### Note IS_REACT_ACT_ENVIRONMENT

Le flag `IS_REACT_ACT_ENVIRONMENT = true` (posé en haut des tests jsdom du repo) **active** la détection des `setState` non-wrappés. C'est ce qui produit le warning. Le flag ne masque rien — il révèle les oublis. Le pattern `act` complet est la résolution propre.

---

## 4. Mock Supabase admin builder — queue par-table FIFO + capture

### Pattern réutilisable

Pose en LOT 2 (`tests/lib/orders/pickup-validation.test.ts`), réutilisé sans modif en LOTs 3, 5 et 7. Permet de mocker un client Supabase admin avec :
- chaînage `.from().select().eq().eq().maybeSingle()` ou `.update().eq().select().maybeSingle()`
- queue de réponses FIFO **par table et par opération** (select / update / insert)
- capture des appels (`fromCalls`, `selects`, `updates`, `inserts`, `eqCalls`) pour les assertions

### Squelette type

```ts
type ChainResp = { data?: unknown; error?: unknown };

interface Captured {
  from: string[];
  selectCols: Array<{ table: string; cols: string }>;
  updates: Array<{ table: string; payload: unknown }>;
  inserts: Array<{ table: string; payload: unknown }>;
  eqCalls: Array<{ table: string; col: string; val: unknown }>;
}

let captured: Captured;
let responses: Record<string, Partial<Record<"select" | "update" | "insert", ChainResp[]>>>;

function consume(table: string, op: "select" | "update" | "insert"): ChainResp {
  const queue = responses[table]?.[op];
  if (queue && queue.length > 0) return queue.shift()!;
  return defaultResp(table, op);
}

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from: (table: string) => {
      captured.from.push(table);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const builder: any = { _op: "select" };
      builder.select = (cols: string) => {
        captured.selectCols.push({ table, cols });
        builder._op = "select";
        return builder;
      };
      builder.update = (payload: unknown) => {
        captured.updates.push({ table, payload });
        builder._op = "update";
        return builder;
      };
      builder.insert = (payload: unknown) => {
        captured.inserts.push({ table, payload });
        return Promise.resolve({ data: null, error: null });
      };
      builder.eq = (col: string, val: unknown) => {
        captured.eqCalls.push({ table, col, val });
        return builder;
      };
      builder.maybeSingle = () => Promise.resolve(consume(table, builder._op));
      builder.then = (onFulfilled: (r: ChainResp) => unknown) =>
        onFulfilled(consume(table, builder._op));
      return builder;
    },
  }),
}));
```

### Forces

- **Sans `vi.mock` global** d'autres helpers : on teste le call site avec sa vraie chaîne `getOwnedProducerId / userOwnsProducer / etc.` — sauf si on les mocke explicitement.
- **Queue par-table** : utile quand le SUT fait plusieurs requêtes sur la même table (ex. SELECT lookup + UPDATE returning + re-fetch race-safe).
- **Capture eqCalls** : permet de vérifier que `WHERE statut='confirmed'` est bien appliqué (verrou anti-régression sur les UPDATE atomiques).

### Limites connues

- Ne supporte pas natif `.select(cols, { count: 'exact', head: true })` (count). Adapter le builder si besoin.
- Les méthodes chainées non utilisées (`.gte`, `.lte`, `.in`, `.not`, `.order`, `.limit`) doivent être ajoutées au builder selon les besoins du test (`builder.gte = () => builder`).

---

## 5. Hoisted env stubs pour les modules qui valident l'env au load

### Symptôme

Au load d'un fichier de test, erreur `Missing NEXT_PUBLIC_<VAR> env variable` thrown depuis `lib/env/urls.ts`.

Cause : ce fichier valide les variables d'env **au load** (top-level throw si absent), ce qui pète dès que le test importe transitivement n'importe quel module qui l'importe (templates email, helpers de routing, etc.).

### Fix

```ts
import { describe, it, expect, vi } from "vitest";

// ⚠️ AVANT les imports applicatifs
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_APP_URL =
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  process.env.NEXT_PUBLIC_PRODUCER_URL =
    process.env.NEXT_PUBLIC_PRODUCER_URL ?? "http://localhost:3001";
  process.env.NEXT_PUBLIC_ADMIN_URL =
    process.env.NEXT_PUBLIC_ADMIN_URL ?? "http://localhost:3002";
});

import { POST } from "@/app/api/...";
```

`vi.hoisted` exécute son callback **avant** tous les imports du fichier (contrairement à un simple `process.env.X = ...` au top-level qui s'exécute après les imports hoistés par esbuild).

### Quand l'appliquer

- Tout test qui importe (directement ou transitivement) `@/lib/env/urls` ou un autre validateur d'env au load.
- En général : tests sur les routes API, les templates Resend, les composants qui font du linking absolu.

### Articulation avec la CI GitHub Actions

Le pattern `vi.hoisted` + `?? "fallback"` fonctionne uniquement si `process.env` n'est PAS déjà pollué quand le test démarre. En CI, si les placeholders d'env sont posés au niveau JOB (`jobs.<id>.env`), ils sont injectés AVANT le step `Test` et écrasent les fallbacks des 92+ fichiers de test qui suivent ce pattern.

**Règle** : en CI, scoper les env vars placeholders au niveau du STEP qui en a besoin (typiquement le step `Build` qui collecte les page data en évaluant les modules au boot), JAMAIS au niveau JOB. Le step `Test` reste sans bloc `env:`, ce qui laisse `process.env` vide et permet aux fallbacks `vi.hoisted` de prendre la main.

Exemple concret : `.github/workflows/ci.yml` (PR #126, commit `aa18701`).

```yaml
jobs:
  ci:
    env:
      TZ: Europe/Paris   # ← seules les vars système globales ici
    steps:
      - name: Build
        env:             # ← placeholders au step uniquement
          RESEND_API_KEY: re_placeholder
          # ...
        run: npm run build
      - name: Test       # ← pas de env:, vi.hoisted fait son job
        run: npm test
```

---

## Checklist avant de pousser un nouveau test vitest

- [ ] Si je mocke un module avec ≥ 3 exports : `importOriginal` pattern (§ 1).
- [ ] Si je teste un composant client en jsdom : imports directs `@/components/ui/<file>` plutôt que barrel (§ 2).
- [ ] Si j'ai des helpers DOM custom qui déclenchent setState : wrap `act` (§ 3).
- [ ] Si je mocke Supabase admin : pattern queue par-table FIFO + capture (§ 4).
- [ ] Si l'import applicatif throw sur env manquantes : `vi.hoisted` env stubs (§ 5).
- [ ] Run en isolation **et** en suite complète pour détecter la pollution worker.
- [ ] Si nouveau pattern récurrent identifié : l'ajouter ici.
