# PHOTOS_AUDIT — TerrOir

Audit des emplacements d'images dans le repo + proposition de mapping
avec l'inventaire éditorial fourni (`~/Downloads/files (5).zip` →
6 photos × multiples formats).

Date : 2026-05-17. Aucune modification de code n'a été effectuée.

---

## 1. Inventaire éditorial disponible

6 photos uniques, livrées en plusieurs ratios :

| Photo                       | Sujet                                                            | Formats disponibles                                | Notes                                                  |
|-----------------------------|------------------------------------------------------------------|----------------------------------------------------|--------------------------------------------------------|
| `photo06_paysage-piquets`   | Prairie bocage, piquets clôture, granges, ciel chargé            | hero-16x9, bloc-4x3, card-1x1                      | Espace négatif ciel (overlay texte OK)                 |
| `photo11_troupeau-aligne`   | ~20 vaches alignées contre clôture, regards caméra               | hero-16x9, bloc-4x3, card-1x1                      | ⚠️ Boucles oreilles lisibles (2456) — retoucher avant prod |
| `photo13_champ-cielbleu`    | Champ moissonné, ciel bleu lumineux                              | hero-16x9, bloc-4x3, card-1x1                      | Ambiance ouverte, ensoleillée                          |
| `photo15_charolaise-veau`   | Charolaise avec son veau                                          | bloc-4x3, card-1x1, portrait-4x5, banner-9x16       | Pas de hero-16x9 (sujet vertical)                      |
| `photo16_chemin-arbres`     | Chemin de campagne bordé d'arbres                                | bloc-4x3, card-1x1, portrait-4x5, banner-9x16       | Pas de hero-16x9 (sujet vertical)                      |
| `photo20_eolienne-orage`    | Éolienne sous orage                                              | hero-16x9, bloc-4x3, card-1x1                      | Très atmosphérique, ton dramatique                     |

---

## 2. Inventaire de l'existant (emplacements images dans le code)

### 2.1 — Home consumer (`app/(public)/page.tsx` + sous-composants)

| # | Fichier:ligne                                                | Bloc                                | Intention sémantique                                   | État actuel                                                            |
|---|--------------------------------------------------------------|-------------------------------------|--------------------------------------------------------|------------------------------------------------------------------------|
| 1 | `app/(public)/_components/home/Hero.tsx:76-110`              | Hero principal (col droite, aspect 4/5) | Visuel emblématique "marketplace producteurs Sarthe" + tag producteur overlay | **Placeholder** : dégradé terra 3-stop + texture stripes en background |
| 2 | `app/(public)/_components/home/Steps.tsx`                    | 3 étapes (icônes)                   | Pédagogie "comment ça marche" (3 icônes)               | **Définitif** : SVG inline (basket / card / pin)                       |
| 3 | `app/(public)/_components/home/NotreDemarcheTeaser.tsx`      | Encart pédagogique                  | Teaser "Sur 24€ payés en GMS, l'éleveur touche 5€"     | **Aucun visuel** (texte centré pur)                                    |
| 4 | `app/(public)/_components/home/FeaturedProducts.tsx`         | Produits du moment                  | Grille `ProductCard` produits réels Supabase           | **Dynamique** (photos DB ou placeholder via `ProductCard`)             |
| 5 | `app/(public)/_components/home/SarthemapPostit.tsx`          | Carte + post-it                     | Carte Sarthe interactive + post-it manuscrit citation  | **Définitif** : `MapSarthe` (SVG) + composant `PostIt` (texte)         |
| 6 | `app/(public)/_components/home/Reassurance.tsx`              | 4 piliers réassurance               | 4 arguments (zone, paiement, circuit, retrait)         | **Définitif** : 4 SVG icônes inline                                    |
| 7 | `app/(public)/_components/home/CtaBand.tsx`                  | CTA final dark                      | Bandeau closing green-900                              | **Définitif** : radial-gradient terra sur fond green-900               |

### 2.2 — Pages publiques storytelling

| # | Fichier:ligne                                                | Bloc                                    | Intention sémantique                                       | État actuel                                                                      |
|---|--------------------------------------------------------------|-----------------------------------------|------------------------------------------------------------|----------------------------------------------------------------------------------|
| 8 | `app/(public)/a-propos/page.tsx:25-30`                       | Bandeau panoramique 16/7                | "Photo panoramique — ferme sarthoise au lever du soleil"   | **Placeholder** : dégradé vert 45° stripes                                       |
| 9 | `app/(public)/devenir-producteur/page.tsx:97-100`            | Visuel hero col droite (aspect 4/5)     | "Photo éleveur en pré" (cible : éleveur potentiel)         | **Placeholder** : dégradé blanc/transparent sur fond terra-700                  |
| 10 | `app/(public)/comment-ca-marche/page.tsx:137-140`           | 3 illustrations étapes (aspect 4/3)     | "Illustration étape 1/2/3" (conso + producteur, 2×3 blocs) | **6 placeholders** dégradé vert stripes (3 conso + 3 producteur)                 |
| 11 | `app/(public)/notre-demarche/page.tsx` + ses _components     | Hero + Circuit + Comparison + Disclaimer + CTA | Pédagogie circuit court vs GMS                          | **Aucun visuel** — page 100% texte/tableau/gradient                              |
| 12 | `app/(public)/charte-qualite/page.tsx`                        | Page placeholder noindex                | Charte qualité (placeholder stub)                          | **Aucun visuel** — page texte                                                    |

### 2.3 — Fiches producteur et produit

| #  | Fichier:ligne                                                          | Bloc                                | Intention sémantique                                       | État actuel                                                                              |
|----|------------------------------------------------------------------------|-------------------------------------|------------------------------------------------------------|------------------------------------------------------------------------------------------|
| 13 | `app/(public)/producteurs/[slug]/ProducerPageClient.tsx:117-141`       | Hero producteur (h-400 plein)       | Photo immersive du producteur                              | **Dynamique** : `heroPhoto` Supabase OU fallback **Unsplash hardcodé** (`DEFAULT_HERO_PHOTO`, l.21-22) |
| 14 | `app/(public)/producteurs/[slug]/ProducerPageClient.tsx:163`           | "Photo de famille devant la ferme"  | Storytelling section histoire (aspect 4/5)                 | **Placeholder** vert stripes (composant `PhotoPlaceholder`)                              |
| 15 | `app/(public)/producteurs/[slug]/ProducerPageClient.tsx:193-214`       | Galerie ferme                       | 3-6 photos (1 large + 2-5 thumbs)                          | **Dynamique** : photos Supabase ou placeholders                                          |
| 16 | `app/(public)/producteurs/[slug]/produits/[id]/ProductPageClient.tsx:185-230` | Photo produit + 4 thumbs            | UI commerce, présentation produit                          | **Dynamique** : photos DB OU fallback **Unsplash hardcodé** (`PRODUCT_PHOTOS` beef/pork/lamb, l.23-27) |
| 17 | `components/ui/producer-card.tsx:46-52`                                | Vignette producteur (80×80)         | Card carte / listings                                      | **Dynamique** : `photo` Supabase OU fallback **Unsplash hardcodé** (`DEFAULT_PRODUCER_PHOTO`, l.6-7) |
| 18 | `components/ui/product-card.tsx:43-67`                                 | Vignette produit (aspect 4/3)       | Card grille produits                                       | **Dynamique** : `image` ou rien (fond green-100)                                         |

### 2.4 — UI consumer (panier)

| #  | Fichier:ligne                                                | Bloc                          | Intention sémantique           | État actuel                                                |
|----|--------------------------------------------------------------|-------------------------------|--------------------------------|------------------------------------------------------------|
| 19 | `app/(consumer)/compte/panier/PanierClient.tsx:222-234`      | Thumbnail produit panier (80×80) | Rappel visuel produit          | **Dynamique** : `image` cart ou placeholder vert stripes   |

### 2.5 — UI producteur (privé, hors champ éditorial)

| #  | Fichier                                                       | Bloc                          | Note                                                                                  |
|----|---------------------------------------------------------------|-------------------------------|---------------------------------------------------------------------------------------|
| 20 | `app/(producer)/catalogue/CatalogueClient.tsx:188-204`        | Vignettes catalogue privé     | Affichage des photos produit uploadées par le producteur — pas d'image éditoriale à fournir |
| 21 | `app/(producer)/catalogue/nouveau/page.tsx:390-402`           | Aperçu uploads en cours       | `URL.createObjectURL` local, hors champ                                               |
| 22 | `app/(producer)/catalogue/[id]/modifier/page.tsx`             | Aperçu uploads en cours       | Hors champ                                                                            |
| 23 | `app/(producer)/ma-page/page.tsx:327-430`                     | Preview "Ma page" + uploads   | Photos producteur uploadées par le producteur lui-même, hors champ éditorial          |

### 2.6 — Visuels structurels (définitifs)

| #  | Fichier                                                       | Bloc                              | État                                          |
|----|---------------------------------------------------------------|-----------------------------------|-----------------------------------------------|
| 24 | `app/(public)/decoupe-boeuf/page.tsx`                          | Schéma morceaux bœuf              | **Définitif** : SVG `public/images/cow.svg`   |
| 25 | `public/Logo_TerrOir.jpeg`, `public/logo/logo-source.svg`     | Logo brand                        | **Définitif**                                  |
| 26 | `public/email-assets/logo-email.png`                           | Logo emails transactionnels       | **Définitif**                                  |
| 27 | `app/icon.png`, `app/apple-icon.png`, OG images auto-gen      | Favicons + OG                     | **Définitif** (auto-générés via `scripts/generate-brand-assets.mjs`) |

---

## 3. Mapping inventaire ↔ emplacements

### 3.1 — Propositions fortes (à shipper)

| Emplacement                                                                            | Photo proposée                                          | Format                | Justification                                                                                            |
|----------------------------------------------------------------------------------------|---------------------------------------------------------|-----------------------|----------------------------------------------------------------------------------------------------------|
| #1 Hero home (aspect 4/5)                                                              | `photo15_charolaise-veau`                               | `portrait-4x5`        | Seul format strictement vertical disponible ; sujet Charolaise+veau = emblématique terroir/Maine, tendresse renforce le storytelling "lien direct producteur". |
| #8 A-propos panoramique (aspect 16/7)                                                  | `photo13_champ-cielbleu`                                | `hero-16x9`           | Ciel bleu lumineux ouvert = exactement l'esprit "panoramique". Recadrage 16/7 sans perte sur un 16/9. Évite le cliché "lever du soleil" tout en restant lumineux. |
| #9 Devenir-producteur visuel hero (aspect 4/5)                                         | `photo11_troupeau-aligne`                               | `hero-16x9` recadré 4/5 OU futur portrait | Sujet "troupeau + regards caméra" = parle directement à un éleveur en lui projetant son métier. ⚠️ Retouche boucles avant prod (cf. inventaire). Alternative : `photo15_charolaise-veau_portrait-4x5` si on veut éviter la retouche. |
| #10 Comment-ça-marche — 3 illustrations étape **consumer** (aspect 4/3)                | `photo16_chemin-arbres` → `photo15_charolaise-veau` → `photo06_paysage-piquets` | `bloc-4x3` ×3         | Narration visuelle : chemin (= choisir un éleveur) → animal (= choisir la pièce) → ferme (= récupérer). Tous en ratio exact 4/3. |
| #10 Comment-ça-marche — 3 illustrations étape **producteur** (aspect 4/3)              | `photo20_eolienne-orage` → `photo13_champ-cielbleu` → `photo11_troupeau-aligne` | `bloc-4x3` ×3         | Narration côté éleveur : se moderniser (éolienne / outil numérique) → produire (champ) → vendre direct (troupeau). |
| #13 Hero fiche producteur — fallback (`DEFAULT_HERO_PHOTO` Unsplash hardcodé)          | `photo11_troupeau-aligne` OU `photo06_paysage-piquets`  | `hero-16x9`           | Remplace l'URL Unsplash actuelle. photo11 si producteur éleveur bovin (cas dominant), photo06 si autre profil (paysage neutre). À router selon `especes`. |
| #17 Producer card — fallback (`DEFAULT_PRODUCER_PHOTO` Unsplash hardcodé)              | `photo06_paysage-piquets`                               | `card-1x1`            | Format 1×1 exact (container 80×80). Paysage neutre adapté à tous types de producteurs. Supprime la dépendance Unsplash. |

### 3.2 — Propositions discutables (à arbitrer avec toi)

| Emplacement                                          | Photo proposée                                  | Format                 | Réserve                                                                                   |
|------------------------------------------------------|-------------------------------------------------|------------------------|-------------------------------------------------------------------------------------------|
| #3 NotreDemarcheTeaser (home, full texte aujourd'hui) | `photo13_champ-cielbleu`                        | `bloc-4x3`             | Aujourd'hui texte centré pur. Ajouter une photo casserait potentiellement le rythme texte de la home. À tester. |
| #14 "Photo de famille devant la ferme" (fiche producteur, storytelling) | `photo15_charolaise-veau`              | `portrait-4x5`         | Sémantique conflictuelle : le placeholder dit "famille devant la ferme", la photo proposée montre des animaux. À remplacer seulement si aucune photo réelle producteur disponible — sinon laisser le placeholder pour inciter l'éleveur à uploader. |
| #16 Fallback produit (Unsplash beef/pork/lamb hardcodé) | **Aucun**                                       | —                      | L'inventaire ne contient aucune photo de produits/découpe/charcuterie. Recommandation : remplacer Unsplash par un placeholder neutre (pas par une photo de troupeau qui suggère faussement de la viande crue). |

---

## 4. Manques et excès

### 4.1 — Sections sans visuel qui en bénéficieraient

| Section                                                | Manque                                                                                 | Priorité |
|--------------------------------------------------------|----------------------------------------------------------------------------------------|----------|
| `/notre-demarche` (page entière)                       | 100 % texte/tableau/gradient. Page-clé pédagogique sans aucune respiration visuelle.   | **HAUTE** — c'est la page manifeste de la marque, elle mérite 1-2 photos d'ambiance (proposition : `photo20_eolienne-orage_hero-16x9` en hero pour le ton "enjeux ruralité moderne", `photo13_champ-cielbleu_bloc-4x3` en transition entre Circuit et Comparison). |
| `/charte-qualite` (placeholder stub)                   | Aucune photo                                                                            | Basse — la page elle-même est un stub. Quand rédigée : prévoir 1 hero + 2-3 visuels par critère. |
| Home `NotreDemarcheTeaser`                             | Bloc texte centré sans visuel                                                          | Moyenne — voir 3.2.                                                                       |
| `/a-propos` section "2024 — Le démarrage"              | Texte storytelling seul (grid 5fr/7fr)                                                 | Moyenne — un visuel d'archive/lieu manque. Inventaire ne couvre pas (archives perso).   |

### 4.2 — Sections avec visuel qui marcheraient mieux sans

| Section                                                | Excès                                                                                 |
|--------------------------------------------------------|---------------------------------------------------------------------------------------|
| Home Hero — aspect 4/5                                 | Ratio 4/5 imposé alors que 4 photos sur 6 de l'inventaire sont en 16/9. Soit on bascule le hero en 16/9 (recommandé pour ouvrir le choix éditorial), soit on s'enferme dans 2 photos utilisables (photo15, photo16). |
| Comment-ça-marche — 6 illustrations étape              | 6 placeholders pour 6 étapes assez abstraites ("Trouve un éleveur", "Choisis tes pièces", etc.). La home utilise des SVG icônes pour la même intention (Steps.tsx) et c'est plus lisible. Option : aligner sur des SVG (cohérence DS) et garder les photos pour les sections vraiment narratives. |

### 4.3 — Photos de l'inventaire sans usage naturel

| Photo                       | Statut                                                                                                    |
|-----------------------------|-----------------------------------------------------------------------------------------------------------|
| `photo20_eolienne-orage`    | Pas d'usage naturel dans les emplacements existants. À conserver pour `/notre-demarche` (section manifeste / enjeux ruralité — cf. 4.1) ou pour une éventuelle page éditoriale future. Sans création de section dédiée, reste inutilisée. |

Toutes les autres photos (photo06, photo11, photo13, photo15, photo16) ont au moins un usage proposé dans le tableau 3.1.

### 4.4 — Dépendances externes à supprimer (sécurité éditoriale + perf)

Trois URLs **Unsplash hardcodées** subsistent dans le code, en fallback :

- `components/ui/producer-card.tsx:6-7` — `DEFAULT_PRODUCER_PHOTO`
- `app/(public)/producteurs/[slug]/ProducerPageClient.tsx:21-22` — `DEFAULT_HERO_PHOTO`
- `app/(public)/producteurs/[slug]/produits/[id]/ProductPageClient.tsx:23-27` — `PRODUCT_PHOTOS` (beef/pork/lamb)

Ces URLs sont chargées depuis `images.unsplash.com` à chaque render fallback (perf + dépendance tierce + risque licence). Le mapping 3.1 propose des remplaçants locaux pour les deux premières. Pour `PRODUCT_PHOTOS` : voir 3.2 (pas de candidat dans l'inventaire — décision à prendre : placeholder neutre OU shooting produit dédié).

---

## 5. Synthèse priorités

1. **Quick wins** (mapping direct, formats matchés) : #1, #8, #10×6, #13, #17.
2. **À arbitrer** : ratio Hero home (4/5 vs 16/9), usage photo20 sur `/notre-demarche`, présence visuel sur `NotreDemarcheTeaser`.
3. **Hors inventaire** : pas de candidat pour photos produits/découpe (#16), photos famille/portrait éleveur (#14), photos archives historiques (`/a-propos`).
4. **Action sécurité éditoriale** : remplacer les 3 fallbacks Unsplash hardcodés par des assets locaux (impact direct sur la cohérence visuelle de la fiche producteur tant qu'aucun éleveur n'a uploadé sa propre photo).

---

*Audit initial en lecture seule — la section §6 ci-dessous trace les
arbitrages pris à la suite de cet audit.*

---

## 6. Décisions arbitrées 2026-05-17

Arbitrages explicites sur les emplacements et photos non couverts par les
3 PRs en cours (PR1 hero home, PR2 `/notre-demarche`, PR3 fallbacks).

### 6.1 — Photos sans usage immédiat

| Photo                       | Décision                                                                                                                       | Action / suivi                                                                                                  |
|-----------------------------|--------------------------------------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------|
| `photo11_troupeau-aligne`   | À intégrer plus tard sur `/devenir-producteur` (visuel hero éleveur), **mais pas tant que les boucles oreilles (2456) ne sont pas retouchées** | Issue [#141](https://github.com/RomLub/TerrOir/issues/141) "Retoucher photo11 — boucles oreilles 2456" + PR4 d'intégration post-retouche |
| `photo13_champ-cielbleu`    | **Intégrée en PR3** pour le hero fallback fiche producteur (`DEFAULT_HERO_PHOTO`). L'usage `/a-propos` panoramique reste un emploi futur potentiel — l'issue de rappel n'est pas refermée. | Issue [#142](https://github.com/RomLub/TerrOir/issues/142) toujours ouverte pour le second usage `/a-propos` |
| `photo15_charolaise-veau`   | **Conservée en stock pour réseaux sociaux / communication externe**. Aucun usage prévu sur le site                              | Aucune issue côté site                                                                                          |

### 6.2 — Pages sans intégration photo

| Page                  | Décision                                                                                                                                                                                                                                                              |
|-----------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `/comment-ca-marche`  | **Décision explicite : ne pas ajouter de photos**. La page reste fonctionnelle texte + icônes, cohérent avec la home `Steps.tsx` (SVG inline). Les 6 placeholders dégradés actuels seront remplacés par des SVG icônes ou simplement supprimés lors d'une prochaine itération design — pas par des photos. |

### 6.3 — Rappel hors-scope des 3 PRs en cours

- `/a-propos` panoramique → en attente (cf. issue #142 photo13)
- `/devenir-producteur` hero → en attente (cf. issue #141 photo11)
- Photo "famille devant la ferme" sur fiche producteur → laisser le
  placeholder pour inciter l'éleveur à uploader sa propre photo
- Fallback photos produits (beef/pork/lamb) → composant `ProductFallback`
  réutilisable en PR3, pas de photo de l'inventaire (l'inventaire ne
  contient aucune photo produit / découpe / charcuterie)

---

## 7. PR3 — fallbacks Unsplash remplacés

Trois dépendances `images.unsplash.com` hardcodées dans le code source
ont été retirées au profit d'assets locaux ou de SVG inline.

### 7.1 — `components/ui/producer-card.tsx`

- **Avant** : `DEFAULT_PRODUCER_PHOTO = "https://images.unsplash.com/photo-1416879595882-3373a0480b5b?w=400"`
- **Après** : `"/images/editorial/photo16_chemin-arbres_card-1x1.jpg"`
- Format card-1x1 (606 KB source, Next l'optimise à la volée), sizes
  `80px` côté ProducerCard inchangé.

### 7.2 — `app/(public)/producteurs/[slug]/ProducerPageClient.tsx`

- **Avant** : `DEFAULT_HERO_PHOTO = "https://images.unsplash.com/photo-1500595046743-cd271d694d30?w=1600"`
- **Après** : `"/images/editorial/photo13_champ-cielbleu_hero-16x9.jpg"`
- Format hero-16x9 (830 KB source). Choix de photo13 (et non photo06
  qui est utilisée sur le hero home depuis PR1) pour éviter le doublon
  visuel entre la home et la fiche producteur.

### 7.3 — `PRODUCT_PHOTOS` beef/pork/lamb → `<ProductFallback />`

Le triplet d'URLs Unsplash hardcodées + la fonction `pickProductImage(name)`
(regex sur le nom du produit) ont été remplacés par un composant
réutilisable `ProductFallback`.

**Architecture** :
- `components/icons/categories/{viande, charcuterie, legumes, fromages, miel, oeufs, autres, fallback}.tsx` — 8 SVG inline custom, style trait fin 1.5, viewBox 24×24, linecap/join round (cohérent avec `Steps.tsx` et `Reassurance.tsx`).
- `components/ui/category-icon.tsx` — sélecteur slug → icône. Normalisation interne (NFD + remove combining + lowercase + ligatures œ/æ) pour accepter aussi bien `"viande"` que `"Viande"` que `"Œufs"`. Catégorie inconnue → `FallbackIcon` (panier).
- `components/ui/product-fallback.tsx` — carré `bg-terra-100` + icône `text-terra-800` (validé pour contraste, surchargeable via `iconClassName`).
- `components/ui/product-card.tsx` — utilise `<ProductFallback />` en interne quand `product.image` est null. Affecte automatiquement tous les usages de ProductCard (grilles produits, listings, panier, etc.).

**Décisions clés** :
- **SVG inline custom** plutôt que `lucide-react` (cohérence avec le pattern existant du repo, zéro dépendance ajoutée).
- **Granularité catégorie seule** — la distinction beef/pork/lamb par regex sur le nom du produit n'existe plus. Décision produit assumée : un produit de catégorie "Viande" affiche l'icône os à moelle qu'il soit bœuf, porc ou agneau.
- **Mapping catégorie → icône** :

| Slug | Icône | Sémantique |
|---|---|---|
| `viande` | 4 cercles + cylindre central | Os à moelle stylisé |
| `charcuterie` | Forme arrondie + ligatures | Saucisse |
| `legumes` | Triangle + 3 feuilles | Carotte |
| `fromages` | Triangle + 3 cercles | Quart de meule emmental |
| `miel` | Hexagone + goutte centrale | Alvéole de ruche |
| `oeufs` | Ovale asymétrique | Œuf |
| `autres` | Anse + corps tressé | Panier en osier |
| `fallback` (catégorie absente ou inconnue) | Identique à `autres` (fichier dédié pour évolution future indépendante) |

### 7.4 — Hors-scope PR3 (à noter pour cohérence visuelle future)

- `app/(public)/producteurs/[slug]/produits/[id]/ProductPageClient.tsx`
  utilise encore son `PhotoPlaceholder` local (dégradé vert stripes)
  pour le cas photo produit absente. Cohérence visuelle imparfaite avec
  les grilles qui passent désormais par `ProductFallback`. Si tu veux
  aligner, c'est trivial — j'ai laissé tel quel pour respecter le scope
  PR3 strict (remplacement des fallbacks Unsplash uniquement).

---

## 8. Statut final inventaire (post-PR3)

| Photo                       | Statut                                                                                                            |
|-----------------------------|-------------------------------------------------------------------------------------------------------------------|
| `photo06_paysage-piquets`   | **Intégrée** — hero home consumer (PR1)                                                                            |
| `photo11_troupeau-aligne`   | **En attente retouche** — issue [#141](https://github.com/RomLub/TerrOir/issues/141) (boucles oreilles 2456) + PR4 d'intégration `/devenir-producteur` post-retouche |
| `photo13_champ-cielbleu`    | **Intégrée** — hero fallback fiche producteur (PR3). Usage futur potentiel `/a-propos` (issue [#142](https://github.com/RomLub/TerrOir/issues/142) ouverte) |
| `photo15_charolaise-veau`   | **En stock hors-site** — réservée réseaux sociaux / communication externe. Aucun usage prévu sur le site         |
| `photo16_chemin-arbres`     | **Intégrée** — fallback `producer-card` (PR3)                                                                      |
| `photo20_eolienne-orage`    | **Intégrée** — hero `/notre-demarche` (PR2)                                                                        |

**Bilan** : 4 photos sur 6 actuellement servies par le site. 1 en attente conditionnée (retouche). 1 réservée usage externe. Zéro URL Unsplash hardcodée restante dans le code source.
