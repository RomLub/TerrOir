# ADR-0013 — Latence de navigation : getClaims + streaming Suspense maintenant, cacheComponents différé

- **Statut** : Accepted (migration cacheComponents : **Rejected** — cf. mise à jour 2026-05-25 en fin de document)
- **Date** : 2026-05-24
- **Décideurs** : Romain (constat terrain + arbitrage risque) + CC (audit + proposition + pushback)

## Contexte

Constat utilisateur : un skeleton plein écran qui clignote de façon furtive
entre deux clics, et une latence de navigation perçue. Audit (2026-05-24) :

1. **Vérification de session par appel réseau à chaque requête.** Le middleware
   (exécuté à chaque navigation) et `lib/auth/session.ts` appelaient
   `supabase.auth.getUser()`, qui valide le JWT en tapant l'Auth server par le
   réseau. Sur le chemin chaud, c'est un aller-retour réseau par clic (souvent
   deux : un dans le middleware, un dans la page/layout).
2. **Pages dynamiques sans pré-chargement.** Quasi toutes les pages
   authentifiées (et plusieurs pages publiques) étaient `force-dynamic` +
   `revalidate = 0` → reconstruites côté serveur à chaque visite, donc pas de
   préfetch possible : au clic, Next va chercher la page et affiche le
   `loading.tsx` du groupe de routes (skeleton plein écran) pendant l'attente.
   Quand l'aller-retour est rapide, le skeleton clignote (l'« écran furtif »).
3. **La base de données n'est pas en cause** : les requêtes applicatives
   répondent en 20-30 ms (pg_stat_statements). Le coût est dans l'architecture
   de rendu et la vérification de session, pas dans les données.

Le projet utilise des clés de signature JWT **asymétriques (ES256)**, et le
`@supabase/supabase-js` installé expose `auth.getClaims()` (validation locale
via Web Crypto, sans réseau). Next.js 16 a par ailleurs **supprimé** l'ancien
flag PPR (`experimental.ppr` / `experimental_ppr`) au profit d'un mode global
`cacheComponents`.

## Décision

### 1. getClaims à la place de getUser sur le chemin chaud (Lot A)

`middleware.ts`, `getSessionUser` et `getInitialUserPayload` passent à
`getClaims()` : validation cryptographique **locale** du JWT (clés ES256), zéro
aller-retour réseau par requête. Comportement, types de retour et lookups DB
(rôles / admin) inchangés ; fail-closed conservé. C'est le remplacement
recommandé par Supabase pour le SSR.

### 2. Streaming via Suspense classique (Lots B et C)

Les pages retournent leur chrome **instantanément** et streament les données
lourdes derrière des `<Suspense>` (au lieu d'un skeleton plein écran via
`loading.tsx` à chaque clic). Les `loading.tsx` de groupe sont réduits à la
zone `<main>` (la sidebar / le header rendus par le layout restent fixes entre
clics). Les pages publiques sans session sont passées en `revalidate`
(pré-chargeables) ; les pages liées à la décision d'achat (stock live) restent
dynamiques mais à shell streamé. L'accueil est rendu préfetchable (bannière
`compte-supprime` déportée en Client Component sous Suspense).

### 3. Migration cacheComponents (PPR Next 16) — **Deferred**

`cacheComponents` (successeur de PPR) apporterait un shell **statique prérendu**
en plus du streaming. Il a été évalué (flag activé, build de diagnostic) puis
**reporté en chantier dédié**. Raisons :

- **Ampleur** : mode global ; ~45 réglages `export const dynamic/revalidate/
  runtime` à retirer (vague 1), puis chaque page **et chaque layout** lisant la
  session/les cookies à restructurer pour isoler la lecture dynamique (~30
  pages + 3 layouts, vague 2). ~50 fichiers, dont la couche auth.
- **Risque sécurité spécifique** : `cacheComponents` impose de marquer chaque
  donnée `'use cache'` (partagée entre tous) vs `'use cache: private'` (par
  utilisateur). Une erreur de portée sur une donnée utilisateur (commande,
  profil) **passe le build au vert** mais provoque une **fuite inter-utilisateur**
  au runtime. Inacceptable à précipiter sur un site bientôt public.
- A+B+C livrent déjà l'essentiel du ressenti (plus de flash, navigation plus
  rapide). cacheComponents sera traité avec revue de portée de cache
  fonction par fonction + test de chaque parcours de connexion.

**Acquis pour la suite** : les frontières `<Suspense>` posées par B/C sont
précisément le prérequis de `cacheComponents`. La future migration en devient
une étape plus petite et plus sûre, pas un big-bang.

## Conséquences

- ✅ Plus de skeleton plein écran clignotant ; cadre de page instantané ;
  navigation plus rapide ; zéro aller-retour réseau de session par clic.
- ✅ Comportement fonctionnel et sécurité inchangés (mêmes gardes, mêmes
  lookups rôles/admin, fail-closed conservé).
- ✅ Validé : lint + type-check + build + `npm test` (3109 tests) verts.
- ⏭️ `cacheComponents` reste à faire (chantier dédié) ; ne pas le réactiver
  sans la revue de portée de cache + tests auth décrits ci-dessus.
- ℹ️ Effet de bord cache : `notre-demarche` passe en `revalidate=300` sans
  invalidation par tag (staleness ≤ 5 min sur une page éducative, acceptée) ;
  l'invalidation immédiate sera câblée lors du chantier cacheComponents (via
  `updateTag`).

---

## Mise à jour (2026-05-25) — cacheComponents évalué puis ÉCARTÉ ; approche standard adoptée

Le « chantier cacheComponents » mentionné en décision n°3 a été **tenté pour de
vrai** (flag activé, build de diagnostic complet, migration partielle), puis
**abandonné** au profit de l'approche standard des gros sites. Statut de la
décision n°3 : **Deferred → Rejected**.

### Pourquoi cacheComponents est écarté

Au-delà de l'ampleur déjà notée (~50 fichiers, toute la couche auth), deux
blocages de fond sont apparus, plus une confirmation de l'état de l'art :

1. **Conflit avec la CSP nonce.** TerrOir génère un nonce CSP **par requête**
   (middleware). Une page **statiquement prérendue** ne peut pas porter un nonce
   régénéré à chaque requête → `cacheComponents` (shell statique) est
   incompatible avec l'approche CSP nonce actuelle. La résoudre imposerait de
   modifier le dispositif de sécurité CSP.
2. **Fondation d'auth + flash.** Le `RootLayout` fournit l'état de session à
   toute l'UI via `getInitialUserPayload()` (lecture cookies). Pour des shells
   statiques, cette lecture devrait basculer côté client → **flash d'état
   connecté** au premier rendu de chaque page.
3. **Vie privée (état de l'art).** Les gros sites ne mettent pas en cache / ne
   pré-construisent pas les pages connectées : une page connectée mise en cache
   puis resservie fuiterait des données entre utilisateurs. Règle standard :
   « bypass cache pour tout utilisateur connecté ». `cacheComponents` poussait
   dans la direction opposée.

### Approche adoptée (standard, « comme Amazon/Gmail »)

- **Pages publiques** : cache (`revalidate`) + streaming (état Lots B/C,
  inchangé) ; pré-chargées par Next quand statiques.
- **Espaces connectés** (acheteur / producteur / admin) : **non mis en cache**
  (vie privée). Suppression de l'**écran de chargement plein écran**
  (`loading.tsx` de groupe) → le **cadre (layout) reste affiché en permanence**
  (non re-rendu entre pages sœurs), au clic **seul le contenu se rafraîchit**
  (Suspense + pattern Gate : page synchrone, lecture session/searchParams/fetch
  dans le flux). Ressenti « app » sans cache de données privées.
- **Aucun changement** sur la fondation d'auth ni sur la CSP. Pas de flash
  d'état connecté ajouté.

### Conséquences de la mise à jour

- ✅ Disparition de l'écran intermédiaire au clic dans les espaces connectés.
- ✅ Sécurité / vie privée préservées (aucune page connectée mise en cache).
- ✅ lint + type-check + build + `npm test` (3109) verts.
- 🚫 Ne PAS réactiver `cacheComponents` sans résoudre d'abord (1) la CSP nonce et
  (2) la fondation d'auth, et en gardant les pages connectées hors cache.
