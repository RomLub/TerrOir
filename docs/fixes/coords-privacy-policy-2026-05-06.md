# Politique uniforme de floutage des coordonnées producteur — T-217

> Date : 2026-05-06
> Branche : master
> Tickets : T-217 (issu rapport sécurité comité T-200 rounds 1+2 + audit T-227, 03/05/2026)

---

## Décision

**Option A retenue** : maintien de l'arrondi à 2 décimales (`roundCoord`, ~1.1 km en latitude FR métro) sur tous les call sites publics, sans bascule vers commune-centroïde (B) ni grille snap (C).

### Rationale

1. La menace dominante T-227 (ré-identification par croisement) est portée par **photos exploitation + nom commune + indices contextuels**, pas par le GPS arrondi. Aucune des 3 options ne neutralise cette menace seule.
2. Effort minimal (zéro migration DB, zéro changement RPC, zéro régression UX). Permet de sortir vite du gap "ouvert public incomplet".
3. UX du `DistanceWidget` préservée — la distance reste parlante (~1-2 km d'erreur Haversine pour proximité, < 1 % à 100 km).
4. Découplage avec T-219 (cache CP→lat/lng) — aucune dépendance bloquante.

Options B et C explicitement écartées :
- **B (commune-centroïde, ~5-10 km)** : gros impact UX (filtre rayon cassé, distance "~8 km de votre commune" peu actionnable pour fermes proches), ~500 LOC + 3 migrations DB. Justifiée seulement si T-227 démontre que GPS arrondi est le facteur dominant — étude pas faite.
- **C (grille snap 1 km)** : précision équivalente à roundCoord 2dec mais révèle le motif de grille au scrape, pire que A pour scan exhaustif. Complexité injustifiée.

---

## Call sites publics — 4 surfaces verrouillées

Toute fonction qui sérialise lat/lng vers un client DOIT passer par `roundCoord` (ou par un fetcher qui le fait).

| Surface | Fichier | Site d'application | Mode |
|---|---|---|---|
| Fiche publique slug | `lib/producers/fetch-public.ts:98-99` | dans le fetcher (canonique) | indirect via `fetchPublicProducerBySlug` |
| Page produit publique | `app/(public)/producteurs/[slug]/produits/[id]/page.tsx:115-116` | consomme `fetchPublicProducerBySlug` (l. 45) | indirect |
| Carte + listing | `app/api/producers/search/route.ts:63-64` | dans la route, après RPC | direct `roundCoord(row.latitude/longitude)` |
| Fiche commande consumer | `app/(consumer)/compte/commandes/[id]/page.tsx:95-96` | dans la page | direct `roundCoord(producerRow?.latitude ?? null)` |

Le `CarteClient` (`app/(public)/carte/CarteClient.tsx:358`) consomme déjà `/api/producers/search` → propagation par chaîne, pas un site direct.

---

## Helper canonique

`lib/producers/coords.ts:roundCoord(v: number | null): number | null`

Garanties :
- Déterministe (anti-trilatération par requêtes répétées).
- Idempotent (`roundCoord(roundCoord(x)) === roundCoord(x)`).
- Fail-safe `null` sur NaN / Infinity.
- Précision exposée ≤ 0.01 (~1.1 km lat, ~750 m lng à 47° N).

Cf. doc enrichie en tête de fichier (modèle de menace, sites autorisés, garantie déterminisme).

---

## Tests anti-régression

Trois verrous indépendants :

1. **`tests/lib/producers/coords.test.ts`** — contrat unitaire du helper (déterminisme stress 10k itérations, idempotence, précision ≤ 0.005, propagation `null`).
2. **`tests/app/api/producers/search/route.test.ts`** — contrat sécurité de la route search (scan exhaustif des champs sortants, aucune coord > 2 décimales).
3. **`tests/app/(public)/producteurs/[slug]/page.test.tsx`** *(nouveau T-217)* — contrat sécurité du Server Component fiche publique : assertion sur les props passées à `<ProducerPageClient>` (latitude/longitude floutées). Pattern `findByName` sur l'arbre ReactElement, pas de rendu DOM.

---

## Pourquoi pas de `roundCoord` défensif au niveau de la page

Lors de l'audit T-217 préalable, l'hypothèse d'ajouter un appel `roundCoord` défensif au niveau de `app/(public)/producteurs/[slug]/page.tsx` (entre le fetcher et la frontière Server → Client) a été explicitement écartée. Quatre raisons :

1. **DRY** — la garantie est centralisée dans `fetchPublicProducerBySlug`. Dupliquer en surface, à 1 ligne du fetcher canonique, dilue le source of truth.
2. **Lisibilité** — un futur lecteur tomberait sur deux `roundCoord` consécutifs dans la chaîne et hésiterait entre cargo cult et fetcher non fiable. Les deux lectures sont mauvaises.
3. **Bon signal anti-régression** — le test contractuel `tests/app/(public)/producteurs/[slug]/page.test.tsx` verrouille la garantie au point où elle compte (frontière Server → Client). Si quelqu'un casse le fetcher, le test pète bruyamment. C'est précisément le rôle d'un test de régression — meilleur signal qu'un no-op silencieux.
4. **Cohérence pattern** — `tests/app/api/producers/search/route.test.ts` fait déjà ça pour la route search. Uniformisation : la garantie est testée au niveau de la frontière de sortie, pas redondée dans chaque maillon intermédiaire.

> Note pour les futurs audits : si un audit conclut "fuite sur `page.tsx` lignes 118-119" en ne regardant que le call site sans tracer la source du `producer`, c'est un faux positif. Le `producer` provient de `fetchCachedProducerBlock` → `fetchPublicProducerBySlug` qui applique déjà `roundCoord`.

---

## Menace résiduelle T-227 — recommandations producteur

Le modèle d'attaque résiduel n'est PAS GPS triangulation : c'est croisement social.

**Scénario type** :
1. Attaquant scrape les fiches publiques (nom ferme + commune + photos + GPS arrondi).
2. Filtre sur (commune, espèce, indices visuels).
3. Cherche Google Maps / Street View avec les indices visibles sur les photos (clôture, bâtiment, paysage).
4. Cross-référence visuel → ré-identification probable de l'adresse réelle.

L'arrondi `roundCoord` 2 décimales protège contre **scrape direct** mais pas contre cette chaîne. Aucune des options A/B/C ne la neutralise — la mitigation est éditoriale.

**Recommandations à intégrer à la politique privacy producteur** :
- Ne jamais publier ensemble photos exploitation rapprochées + adresse exacte (texte libre dans la bio).
- Privilégier les photos paysage / animaux / produits plutôt que les photos identifiables de bâtiments.
- Coordonnées arrondies à ~1 km affichées publiquement, adresse précise visible uniquement par les consumers ayant déjà passé commande (déjà en place via `app/(consumer)/compte/commandes/[id]/page.tsx` qui floute aussi).

T-227 reste **ouvert** dans la TODO — étude sérieuse de ré-identification + décision de bascule éventuelle (B/C) à reprogrammer si la menace évolue.

---

## Defense in depth — backlog

- **T-235** : créer une vue Postgres `producers_public` qui projette les coords arrondies au niveau DB. Defense in depth si quelqu'un oublie le helper applicatif. Une seule source de vérité côté Postgres.
- **T-238** : scan automatique "no raw coords leak" — test de méta-niveau qui scrute `app/api/**` et `app/(public|consumer)/**` à la recherche de `SELECT` contenant `latitude/longitude` non suivis d'un `roundCoord`. Empêche les régressions silencieuses lors de l'ajout de nouvelles routes.
- **T-236** : rate-limit sur `/api/producers/search` pour bloquer la trilatération inverse par énumération massive de CP.
- **T-218** : audit RLS global de la table `producers` au prochain chantier touchant la table.

T-235, T-236, T-238 restent **prérequis Live** (cf. T-244 priorisation bloquants Live).

---

## Continuité avec T-200 r1/r2/r3

T-217 ne change pas le contrat T-200 ; il le formalise comme **politique** (et non plus comme implémentation point par point). L'arrondi `roundCoord` 2 décimales reste le standard sur les 4 surfaces auditées. Le nouveau test contractuel sur la fiche slug ferme un trou de couverture (déjà couvert pour `/api/producers/search` en r3, manquant pour le Server Component public).

Aucune régression fonctionnelle : la garantie au runtime est strictement identique à avant T-217. Seule la couverture de tests change.
