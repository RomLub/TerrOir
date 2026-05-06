# Scoping `terroir_geo_session` — T-276

> **Cluster** : T-261 (RGPD pré-Live consolidé) / T-200 r1 (doctrine privacy).
> **Scope** : confirmer que la clé `terroir_geo_session` (sessionStorage,
> DistanceWidget) est isolée par construction navigateur entre les
> sous-domaines applicatifs `www.`, `pro.`, `admin.terroir-local.fr`.
> Vérifier qu'aucun mécanisme TerrOir ne contourne cette isolation
> (postMessage cross-subdomain, share API, etc.).
> **Méthode** : revue théorique same-origin policy + grep `postMessage`
> + audit fonctionnel des call sites de la clé.
> **Date** : 2026-05-06.

---

## TL;DR

**Vérification ✅ conforme par construction navigateur.**
- `sessionStorage` est strictement scopé par **origin** (scheme + host +
  port). `https://www.terroir-local.fr` et `https://pro.terroir-local.fr`
  ont des origins distinctes → **stores sessionStorage indépendants**.
- TerrOir n'utilise **aucun** `postMessage` cross-subdomain, ni Share
  API, ni iframe cross-origin, ni broadcast channel.
- Le DistanceWidget vit uniquement sur `www.` (fiche producteur publique
  `/producteurs/[slug]`). Il n'a même pas de réplique sur `pro.` ou
  `admin.`.
- Conclusion : un consumer connecté sur `www.terroir-local.fr` qui
  saisit son CP sur la fiche producteur ne fuite pas sa coord vers
  `pro.terroir-local.fr` ni `admin.terroir-local.fr`, même si une
  authentification cross-subdomain existait.

→ **T-276 peut être marqué ✅ dans la checklist pré-Live.** R1 (doctrine
opposable) recommandée pour empêcher l'introduction silencieuse d'un
postMessage cross-subdomain.

---

## Méthodologie

### Patterns grepés
- `postMessage` (toute occurrence dans `app/`, `components/`, `lib/`).
- `terroir_geo_session` (toutes les références à la clé).
- `BroadcastChannel`, `navigator\.share`, `iframe.*src=.*terroir-local`
  (mécanismes de communication cross-context).

### Périmètre
- `app/**/*.{ts,tsx}` + `components/**/*.{ts,tsx}` + `lib/**/*.ts`.
- `middleware.ts` (host routing).

### Hors scope (couvert par d'autres tasks)
- Non-fuite vers tiers (Resend, Stripe, Vercel) → T-253.
- Cookies cross-subdomain (`SameSite`, `Domain` attribute) → out of
  scope ici (le problème T-276 est sessionStorage, pas les cookies).

---

## Rappel théorique : same-origin policy sessionStorage

### Définition de l'origine
Selon la spec [HTML Living Standard § Storage](https://html.spec.whatwg.org/multipage/webstorage.html#dom-sessionstorage-dev),
`sessionStorage` est scopé par :

> **origin** = `(scheme, host, port)` triplet.

Conséquence : `https://www.terroir-local.fr` et
`https://pro.terroir-local.fr` ont des hosts différents → leurs origins
sont distinctes → leurs `sessionStorage` sont **physiquement séparés**
côté navigateur.

Ce comportement est **enforce par le navigateur** lui-même. Aucun code
JavaScript de la page ne peut "lire" le sessionStorage d'une autre
origine, même via `iframe.contentWindow.sessionStorage` (le browser
throw `SecurityError`).

### Cas particulier : sous-domaines de même domaine parent
Contrairement aux cookies (qui peuvent être partagés via
`Domain=.terroir-local.fr`), **sessionStorage ne propose AUCUN mécanisme
de partage cross-subdomain**. La spec est explicite : pas d'attribut
domain, pas d'opt-in. Stricte isolation.

### Distinction avec localStorage
Idem : `localStorage` est aussi scopé par origin, et n'a pas de
mécanisme de partage cross-subdomain non plus. La doctrine TerrOir
T-266 / T-266-bis / T-266-tris (préfixe `terroir_` opposable) couvre
les deux storage de manière uniforme.

---

## Audit applicatif TerrOir

### Hosts définis dans TerrOir
Source : `middleware.ts:10-11, 16` :
```ts
const PRODUCER_HOST = "pro.terroir-local.fr";
const ADMIN_HOST = "admin.terroir-local.fr";
const APEX = "terroir-local.fr";
```
Hosts utilisés en prod : `www.terroir-local.fr`, `pro.terroir-local.fr`,
`admin.terroir-local.fr`. 3 origines distinctes.

### Pages utilisant `terroir_geo_session`
Source : grep `terroir_geo_session` :
- `app/(public)/producteurs/[slug]/_components/DistanceWidget.tsx:28`
  — seule occurrence applicative.

Pages servant ce composant :
- `app/(public)/producteurs/[slug]/page.tsx` — fiche producteur, servie
  sur **`www.terroir-local.fr/producteurs/[slug]`**.
- (Indirectement) `app/(public)/producteurs/[slug]/produits/[id]/
  page.tsx` n'inclut PAS le DistanceWidget (cf. ProductPageClient — il
  inclut MiniMap mais pas DistanceWidget).

→ **Le DistanceWidget vit exclusivement sur `www.terroir-local.fr`.**
Pas de surface `pro.` ni `admin.`. Même un consumer authentifié qui
naviguerait entre `www.` et `pro.` (futur scenario) verrait deux
sessionStorage strictement disjoints.

### Recherche de mécanismes de partage cross-context

#### `postMessage`
Grep `postMessage` dans `app/`, `components/`, `lib/` :
- 0 occurrence applicative.

→ **Aucun usage de `window.postMessage` dans TerrOir.** Pas de risque
de fuite cross-iframe ou cross-window.

#### `BroadcastChannel`
Grep `BroadcastChannel` :
- 0 occurrence applicative.

#### `navigator.share` (Web Share API)
Grep `navigator\.share` :
- 0 occurrence applicative.

#### Iframes cross-subdomain
Grep `iframe` :
- Iframes Stripe Elements (chargées depuis `https://js.stripe.com`,
  cross-origin externe — pas TerrOir-controllable).
- Aucune iframe pointant vers `pro.terroir-local.fr` ou
  `admin.terroir-local.fr` depuis `www.terroir-local.fr`.

→ **Aucune surface de communication cross-subdomain à TerrOir.**
L'isolation navigateur est intégrale.

---

## Findings

### F1. Isolation totale sessionStorage par construction
3 origines TerrOir → 3 stores `sessionStorage` indépendants. Aucun
mécanisme TerrOir ne contourne cette isolation.

### F2. DistanceWidget mono-origin par design
Le DistanceWidget vit uniquement sur `www.`. Pas de réplique sur
`pro.` ou `admin.`. Donc même si un futur dev introduisait un
postMessage cross-subdomain pour un autre besoin, il n'y aurait
**aucune raison fonctionnelle** que `pro.` ou `admin.` cherchent à
lire `terroir_geo_session` (le widget n'y existe pas).

### F3. Continuité doctrine T-266 préfixe `terroir_`
Le préfixe `terroir_` (lint opposable T-266) sert aussi à clarifier
visuellement les clés storage TerrOir vs. clés tierces (ex. Stripe SDK,
extensions browser, etc.). Cohérent avec la doctrine d'isolation T-276.

---

## Recommandations

### R1. Doctrine opposable « pas de postMessage cross-subdomain TerrOir »
**Priorité** : moyenne (formalise une absence, opposable PR review).

À ajouter dans `docs/conventions/` (par ex. compléter
`docs/conventions/lint-storage-namespace-2026-05-06.md` avec une section
"Communication cross-subdomain") :

> **postMessage entre sous-domaines TerrOir interdit par défaut.**
> `www.terroir-local.fr`, `pro.terroir-local.fr`,
> `admin.terroir-local.fr` doivent rester isolés au niveau
> sessionStorage / localStorage. L'introduction d'un mécanisme de
> partage (postMessage, BroadcastChannel via SharedWorker, OAuth flow
> en iframe…) requiert un audit privacy préalable confirmant qu'aucune
> donnée géo / PII consumer ne traverse l'isolation.

Bénéfice : opposable face à un futur chantier "synchroniser le panier
entre www. et pro." (ex.) qui pourrait, par défaut, broadcast tout le
state cross-subdomain.

### R2. Documenter `terroir_geo_session` dans le backlog T-267
**Priorité** : faible (déjà tracé T-267).

Le backlog identifie déjà T-267 (« Documenter clé `terroir_geo_session`
globale »). Inclure dans cette documentation le rappel d'isolation
T-276 + le caractère mono-origin (`www.`) du widget.

### R3. Tests E2E cross-subdomain (post-Live, dette)
**Priorité** : faible (defense in depth).

Au moment où des E2E Playwright multi-subdomain sont mis en place
(actuellement les E2E ne testent que `www.`), ajouter un test
contractuel :
1. Visiter `www.terroir-local.fr/producteurs/<slug>` et saisir un CP.
2. Visiter `pro.terroir-local.fr` (ou ouvrir un onglet dessus).
3. Vérifier `window.sessionStorage.getItem("terroir_geo_session")`
   retourne `null` (pas leaké).

→ Bénéfice : verrou non-régression si une feature future essayait de
synchroniser sessionStorage cross-subdomain via un hack (e.g. iframe
hidden + postMessage). Coûteux à mettre en place — recommandé après
Live.

---

## Cross-références

- `docs/conventions/lint-storage-namespace-2026-05-06.md` (T-266) —
  préfixe `terroir_` opposable.
- `docs/security/audit-sessionstorage-non-fuite-tiers-2026-05-06.md`
  (T-253) — non-fuite vers tiers.
- `docs/security/csp-audit-t-264-2026-05-06.md` (T-264) — CSP
  anti-exfiltration cross-origin.
- **Tasks liées** :
  - T-267 (backlog dette : doc clé `terroir_geo_session` globale).
  - T-266 / T-266-bis / T-266-tris (lint préfixe `terroir_`).
- **Spec externe** : [HTML Living Standard § Storage](https://html.spec.whatwg.org/multipage/webstorage.html)
  — same-origin policy sessionStorage / localStorage.

---

## Conclusion

T-276 ✅ — l'isolation `terroir_geo_session` entre les 3 sous-domaines
TerrOir est garantie **par construction navigateur** (same-origin
policy). Aucun mécanisme TerrOir n'enfreint cette isolation.
Recommandation R1 (doctrine opposable PR review) à acter pour pérenniser
l'absence de postMessage cross-subdomain dans le temps.
