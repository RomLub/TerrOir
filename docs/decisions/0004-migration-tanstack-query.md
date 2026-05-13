# ADR-0004 — Migration de la couche fetch client vers TanStack Query

- **Statut** : Accepted
- **Date** : 2026-05-13
- **Décideurs** : Romain
- **Critère de clôture** : merge de la PR `chore/migrate-fetch-to-tanstack-query`,
  réactivation des règles `react-hooks/set-state-in-effect` et
  `react-hooks/purity` (passage `off` → `error`) dans `eslint.config.mjs`.

## Contexte

La migration ESLint 9 + `eslint-config-next` 16 (PR
`chore/migrate-eslint-9-flat-config`) a livré la version 7 d'
`eslint-plugin-react-hooks` qui introduit des règles strictes du React
Compiler 19. Le run exploratoire sur master a remonté :

- **21 occurrences** de `react-hooks/set-state-in-effect` (« Calling
  setState synchronously within an effect can trigger cascading
  renders »)
- **7 occurrences** de `react-hooks/purity` (« Cannot call impure
  function during render » / « Cannot access refs during render »)

Toutes ces erreurs proviennent du **même pattern architectural** :
chaque page client (admin, pro, consumer, public) fait son propre
`fetch` Supabase dans un `useEffect`, avec gestion manuelle des `useState`
loading/error/data. Ex :

```tsx
const [rows, setRows] = useState<Row[]>([]);
const [loading, setLoading] = useState(true);

const refresh = async () => {
  setLoading(true);   // ← setState sync dans le useEffect au mount
  const { data, error } = await supabase.from("animals").select(...);
  if (error) { setError(error.message); setLoading(false); return; }
  setRows(data);
  setLoading(false);
};

useEffect(() => { void refresh(); }, []);
```

Trois approches ont été évaluées :

| Approche | Effort | Adéquation |
|---|---|---|
| A — Refactor manuel cas par cas (déplacer setLoading init, gérer abort, etc.) | 4-6 h | Garde l'archi sous-optimale. Gain marginal sur des pages admin/pro pas hot path. Risque de régression. |
| B — Migration vers TanStack Query | 1-2 jours | Élimine la classe entière de bugs en une fois. Apporte cache + invalidation + optimistic updates. Pattern standard React 19 moderne. |
| C — Exception locale par occurrence (`eslint-disable-next-line` × 28) | 30 min | Dette consciente documentée. Sale visuellement, perpétue l'archi sous-optimale. |

## Décision

**Approche B : adopter [@tanstack/react-query](https://tanstack.com/query) v5+
comme couche fetch+cache+invalidation côté client.**

Justifications du choix de TanStack Query (vs SWR / refactor manuel) :

- **Mutations + invalidation cache + optimistic updates** sont
  critiques pour les CRUD admin/pro (catégorisation, gestion
  producteurs, refunds, mes-avis) et pour les flux Stripe → Supabase
  (checkout, webhook, refund clawback).
- **Query keys hiérarchiques + invalidation cascade** : très utile
  pour orchestrer la cohérence après un événement Stripe (ex :
  invalider toutes les queries `producer-*` après un `payout.paid`).
- **Devtools** dédiés (`@tanstack/react-query-devtools`) en dev pour
  inspecter le cache, simuler des states, debugger les invalidations.
- **Écosystème + intégrations Next 16 documentées** (App Router,
  Server Components + hydration, RSC streaming).
- **Bundle plus lourd que SWR** (~12 KB gzip vs ~4 KB) mais TerrOir
  est en pré-Live, non bloquant.

## Mécanisme transitoire

Le merge de la PR ESLint 9 ne peut pas attendre la livraison complète
de la migration TanStack Query (plusieurs jours). Pour permettre le
merge ESLint 9 sans bloquer la suite, les deux règles
`react-hooks/set-state-in-effect` et `react-hooks/purity` sont mises
à `"off"` dans `eslint.config.mjs` avec un commentaire pointant vers
le présent ADR.

**Cette désactivation n'est pas un backlog vivant.** Elle est tracée,
datée, opposable, et adossée à une PR dédiée
(`chore/migrate-fetch-to-tanstack-query`) qui la fermera. Si la PR ne
progresse pas, le présent ADR force l'arbitrage explicite — pas de
fuite par oubli.

## Plan d'exécution

1. **PR ESLint actuelle** (`chore/migrate-eslint-9-flat-config`) :
   désactivation temporaire des 2 règles + cet ADR dans le même
   commit. Merge.
2. **PR TanStack** (`chore/migrate-fetch-to-tanstack-query`) : branche
   dédiée depuis master post-merge ESLint.
   - Install `@tanstack/react-query` + `@tanstack/react-query-devtools`
     (dernière version stable compatible Next 16 + React 19, vérif
     peer deps sans `--legacy-peer-deps`).
   - Setup `QueryClient` + `QueryClientProvider` dans le layout
     racine. Gestion hydration SSR Next 16 (per-request `QueryClient`,
     `HydrationBoundary` autour des arbres consumer/pro/admin).
   - Refactor cas par cas, en commençant par les pages admin
     (CRUD simples : catégorisation animaux/morceaux/categories) pour
     poser le pattern de référence, puis pro / consumer / public.
     Premier cas → validation Romain avant boucle.
   - Suppression progressive des `useEffect + fetch + setState`
     remplacés par `useQuery` / `useMutation`.
3. **Clôture** : quand 0 occurrence des 2 patterns subsiste,
   réactivation des règles ESLint dans `eslint.config.mjs` (passage
   à `"error"`). Statut de cet ADR → `Implemented` + date de clôture.

## Conséquences

**Effets positifs**
- ✅ Élimination structurelle de 28+ violations React Compiler 19
  d'un coup, sans patcher 28 sites manuellement.
- ✅ Cache + invalidation déclarative pour orchestrer les CRUD complexes
  (déjà essentiel sur `/admin/gestion-producteurs`,
  `/admin/categorisation/*`, `/admin/refunds/pending`, `/mes-avis`,
  `/comptabilite`).
- ✅ Pattern standard moderne, courbe d'apprentissage utile pour la
  suite (mutations optimistes Stripe checkout, etc.).
- ✅ Devtools pour debug pendant le pre-Live.

**Contraintes acceptées**
- ❌ Bundle +12 KB gzip. Acceptable pré-Live, à mesurer post-Live si
  Core Web Vitals impactés.
- ❌ Refactor de tous les call sites client touchant Supabase. ~30+
  fichiers concernés (toutes les pages avec un `useEffect + fetch`).
- ❌ Tests à adapter : mocks Supabase devront être consommés par
  `useQuery` au lieu d'être appelés directement dans `useEffect`.
- ❌ Hydration SSR Next 16 : nécessite per-request `QueryClient` +
  `HydrationBoundary`. Pattern documenté mais à vérifier sur les
  routes mixtes server/client de TerrOir.

**Points de vigilance pendant la migration**
- Cas complexes (fetch conditionnel multi-source, logique métier
  entrelacée, side-effects autres que setState dans l'effect) : à
  remonter pour arbitrage individuel, pas à forcer dans un fit
  TanStack sale.
- Préserver le comportement runtime exact : pas de régression
  fonctionnelle attendue, seulement remplacement de la couche
  fetch+cache.

## Liens

- PR ESLint qui désactive temporairement les règles :
  `chore/migrate-eslint-9-flat-config`
- PR de migration : `chore/migrate-fetch-to-tanstack-query` (à créer)
- Doc TanStack Query : https://tanstack.com/query/latest
- React Compiler rules de pureté :
  https://react.dev/reference/rules/components-and-hooks-must-be-pure
