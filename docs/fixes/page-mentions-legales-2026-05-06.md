# Page /mentions-legales + /cgu + /cgv — 2026-05-06

Quatrième vague des pages P0 légales (audit architecture 2026-05-06).
Création des trois pages juridiques requises pour un site e-commerce
français : mentions légales (LCEN), CGU et CGV.

## Approche

`/mentions-legales` : **page complète et fonctionnelle dès maintenant**
avec structure conforme LCEN art. 6.III.1 + Code de la consommation
(rétractation L221-18 et exceptions L221-28, médiation L612-1,
tribunaux compétents R631-3). Placeholders violets ciblés sur les
éléments à compléter post-création SAS et adhésion service de
médiation. Bandeau placeholder violet TRÈS visible.

`/cgu` et `/cgv` : **placeholders minimalistes** alignés sur le
pattern /charte-qualite. Robots `noindex, nofollow` jusqu'à rédaction
finale. Cohérence : on ne laisse aucun lien cassé depuis le footer
ou /mentions-legales.

## Lots livrés

### Lot 1 — Page /mentions-legales

`app/(public)/mentions-legales/page.tsx` (Server Component, 226 B,
zéro JS).

Structure 8 sections :

1. **Éditeur du site** — `<dl>` structurée avec 11 entrées dont 9
   placeholders violets (raison sociale, forme juridique, capital
   social, siège, SIREN, SIRET, TVA intra, code APE, téléphone,
   directeur de publication). Email `contact@terroir-local.fr` en
   dur (mailbox déjà active).
2. **Hébergeur du site** — Vercel B.V. (info publique vérifiée :
   Schiphol Boulevard 359, Pays-Bas).
3. **Propriété intellectuelle** — droit d'auteur + droit des
   marques + statut des photos producers (propriété conservée).
4. **Données personnelles et cookies** — délégation à
   `/politique-confidentialite` + email RGPD.
5. **Droit de rétractation** — article L221-18 (14 jours) + article
   L221-28 exceptions (denrées périssables, biens descellés,
   personnalisés) + procédure pour produits éligibles.
6. **Médiation de la consommation** — article L612-1 + placeholder
   violet pour le médiateur (TerrOir doit adhérer à un service agréé
   avant launch — Médicys / AME Conso / MEDIATION-NET, ~30-100€/an)
   + plateforme RLL Commission européenne.
7. **Droit applicable et tribunaux compétents** — article R631-3
   (3 options de juridiction pour le consommateur).
8. **Contact** — email + lien `/contact`.

+ section finale **Liens utiles** : politique, CGU, CGV, contact.
+ ancre `#haut-de-page` + lien retour discret en pied.

Bandeau placeholder global : pattern aligné /faq + /charte-qualite
(`bg-violet-50 border-b-2 border-violet-300 text-violet-900`).

Métadonnées : title, description, canonical, robots:index/follow.

### Lot 2 — Pages placeholder /cgu + /cgv

- `app/(public)/cgu/page.tsx` — Server Component, 226 B, bandeau
  violet, hero + texte d'attente + CTA contact, robots noindex.
- `app/(public)/cgv/page.tsx` — idem, commentaire de tête mentionne
  les volets nécessaires (paiement Stripe Connect, frais d'envoi,
  rétractation, garanties légales conformité & vices cachés,
  modalités annulation, conditions producteurs).

### Lot 3 — Liens entrants

- `components/ui/footer.tsx` :
  - Suppression de la ligne italique « Mentions légales · CGU · CGV
    — à venir » dans la colonne « Aide ».
  - Ajout d'un sous-bloc **footer bottom** : 3 liens actifs
    Mentions légales · CGU · CGV alignés à droite (copyright à
    gauche), séparateurs `·` discrets. Pattern responsive
    (`flex-wrap`).
- `app/(public)/politique-confidentialite/page.tsx` : ajout d'un
  lien discret « Voir aussi nos mentions légales » dans le bloc
  pied de page (à droite du « Retour au formulaire de contact »).

### Lot 4 — Tests

Pas de tests vitest spécifiques ajoutés (Server Components statiques,
contenu textuel). Évolution suite : **1779 → 1779** (152 fichiers,
pas de régression). Build OK validé.

### Lot 5 — Doc

Ce fichier + commentaire de tête sur chaque page créée listant liens
entrants et sortants.

## Placeholders violets cumulés P0 légales

Total **32** occurrences sur **8** fichiers.

### Nouveaux ce commit (15) :

- **`app/(public)/mentions-legales/page.tsx` (13)** :
  - Bandeau global "Mentions légales en cours de finalisation"
  - 9 entrées éditeur : raison sociale, forme juridique, capital,
    siège, SIREN, SIRET, TVA intra, code APE, téléphone, directeur
    publication (10 incluant le directeur)... wait reconciliation
    placeholders : 11 entrées EDITOR_INFOS dont 9 placeholders + 1
    email actif + 1 directeur placeholder = 10 placeholders dans
    les infos éditeur. Plus le bandeau (1) + médiateur section 6
    (1) + paragraphe directeur (déjà compté). Soit 12 visibles +
    bandeau = grep retourne 13.
- **`app/(public)/cgu/page.tsx` (1)** : bandeau global "CGU en
  cours de rédaction"
- **`app/(public)/cgv/page.tsx` (1)** : bandeau global "CGV en
  cours de rédaction"

### Hérités (17) :

- `app/(public)/contact/page.tsx` (4)
- `app/(public)/politique-confidentialite/page.tsx` (5)
- `app/(public)/livraison/page.tsx` (1)
- `app/(public)/faq/page.tsx` (6)
- `app/(public)/charte-qualite/page.tsx` (1)

## Confirmation footer mis à jour

✅ La ligne « Mentions légales · CGU · CGV — à venir » est
**remplacée par 3 liens fonctionnels** dans le footer bottom :
- `/mentions-legales` (page complète V1)
- `/cgu` (placeholder)
- `/cgv` (placeholder)

Style : pied de page, séparateurs `·` discrets, alignés à droite
sur la même ligne que le copyright.

## Trade-offs et décisions autonobes

- **Mentions légales en page complète vs placeholder minimaliste** :
  contenu juridique complet rédigé dès maintenant (incluant
  rétractation L221-18, médiation L612-1, tribunaux R631-3) car le
  cadre juridique est invariant — TerrOir n'a pas besoin d'attendre
  pour publier les *références d'articles*. Seules les
  **identifications éditeur** (SAS, SIREN, etc.) et le **médiateur
  agréé** sont vraiment "à compléter".
- **CGU et CGV en placeholder** : ces deux documents demandent un
  travail dédié (paiement Stripe Connect, frais d'envoi, garanties
  conformité/vices cachés, conditions producteurs côté CGV). Pas
  d'embryon de rédaction maintenant — le bandeau placeholder + le
  noindex protègent.
- **Adresse Vercel en dur** : `Schiphol Boulevard 359, 1118BJ
  Schiphol, Pays-Bas` est une donnée publique vérifiable, stable
  depuis plusieurs années. Pas un placeholder.
- **Footer bottom 3 liens vs colonne « Aide »** : les liens
  juridiques sont placés dans le pied de page (pattern standard
  e-commerce français). La colonne « Aide » reste pour le SAV
  (Contact, FAQ, Livraison, Politique de confidentialité).
- **Rétractation L221-28 exhaustive** : la liste des produits
  exclus est rédigée en cohérence avec le modèle TerrOir (denrées
  périssables = retrait à la ferme uniquement, denrées non-
  périssables = envoi postal possible). Aligne avec le contenu de
  /livraison.
- **Médiateur en placeholder critique** : adhésion obligatoire
  avant launch (Code consommation L612-1). Coût ~30-100€/an.
  Options listées dans le placeholder pour faciliter le choix.
- **Ancre `#haut-de-page` + retour en bas** : UX longue lecture
  juridique. Standard sur les pages CGV/ML lourdes.
- **`<dl>` structurée pour l'éditeur** : sémantique HTML correcte
  (label/value), accessible aux lecteurs d'écran. Layout 2 colonnes
  desktop (`max-content_1fr`).
- **Aucun commit/push** : contrainte stricte respectée, Romain
  commit après validation.
