# Brief avocat — Allégation « Bio » & CGV (TerrOir)

> Document de préparation à une consultation juridique. Objectif : permettre à
> l'avocat de cadrer rapidement les questions (heures facturées minimisées).
> Préparé le 2026-05-24.

## 1. TerrOir en bref

- **Activité** : marketplace de circuit court en Sarthe — met en relation des
  **producteurs locaux** (viande, produits fermiers) et des **consommateurs**.
  Vente en ligne, **retrait à la ferme** (pas d'expédition).
- **Statut** : projet **pré-lancement** (pas encore ouvert au public). Forme
  juridique prévue : **SAS** (non encore immatriculée — SIREN/SIRET/RCS « à
  confirmer » dans les mentions légales).
- **Paiements** : **Stripe Connect** — les fonds transitent par Stripe ;
  TerrOir agit comme plateforme d'intermédiation (commission), chaque
  producteur a son propre compte Connect. TerrOir ne détient pas les fonds.
- **Rôle de TerrOir** : **plateforme** (hébergeur de l'offre des producteurs).
  Le producteur est le vendeur ; TerrOir fournit la place de marché.

## 2. État actuel des CGV / CGU / mentions légales

- Pages présentes dans le produit (rédigées en interne, **non validées
  juridiquement**) :
  - `app/(public)/cgv` — Conditions Générales de Vente
  - `app/(public)/cgu` — Conditions Générales d'Utilisation
  - `app/(public)/mentions-legales` — mentions légales (entité SAS « à
    confirmer », médiation de la consommation mentionnée)
- À l'inscription, le producteur **coche CGU + CGV** (acceptation tracée).
- **Aucune clause spécifique « bio »** n'existe aujourd'hui dans les CGV.

## 3. Le mécanisme « Bio » implémenté

Modèle de données (table `producers`) :

| Champ | Qui l'écrit | Rôle |
|---|---|---|
| `bio` (booléen) | **le producteur** | déclare être bio |
| `bio_certificate_number` (texte) | **le producteur** | numéro d'opérateur / certificat (type Agence Bio) |
| `bio_validated_at` (date) | **l'admin TerrOir uniquement** | horodatage de validation du certificat par l'admin |

Règles :

- Le producteur **déclare** lui-même son statut bio + saisit son numéro de
  certificat depuis son espace (`/ma-page`).
- Un **admin TerrOir valide manuellement** (vérifie le certificat) → pose
  `bio_validated_at`. Acte réservé à l'admin (un producteur ne peut pas se
  valider lui-même — verrou en base).
- **Exposition publique conditionnée** : le badge « Bio » sur la fiche
  publique **et** le filtre de recherche « bio » ne s'affichent **que si**
  `bio = true ET bio_validated_at IS NOT NULL`. **Une déclaration bio non
  validée par l'admin n'est JAMAIS visible publiquement.** (Vérifié dans la
  vue publique + le moteur de recherche.)
- **Intégration automatique Agence Bio** (vérification API du numéro
  d'opérateur) : **non implémentée** — la validation est **manuelle (admin)**
  pour le MVP. Décision tracée : `docs/decisions/0008-suppression-score-carbone-flag-bio.md`.

## 4. Questions à valider par l'avocat

1. **Wording du badge « Bio »** sur la fiche publique : le simple libellé
   « Bio » (affiché uniquement après validation admin du certificat) est-il
   **légalement acceptable** ? Faut-il une mention plus précise (ex. « Certifié
   Agriculture Biologique », référence au certificat, logo AB, n° d'organisme
   certificateur) ? Y a-t-il un risque sur l'usage du mot « bio » / du logo AB
   sans contrôle d'un organisme certificateur agréé ?

2. **Responsabilité TerrOir vis-à-vis de la DGCCRF** : en tant que
   **plateforme**, si un producteur affiche « bio » **sans certificat valide**,
   **qui est responsable** (le producteur-vendeur, TerrOir-plateforme, ou les
   deux) ? La validation **manuelle** par l'admin TerrOir engage-t-elle la
   responsabilité de TerrOir (TerrOir « endosse » l'allégation en la validant) ?
   Vaut-il mieux, juridiquement, **ne pas valider** et laisser le producteur
   seul responsable, ou la validation admin est-elle un facteur de diligence
   protecteur ?

3. **Clauses CGV à inclure** : quelle **déclaration sur l'honneur** /
   engagement contractuel demander au producteur concernant son statut bio
   (véracité du certificat, obligation de signaler une perte/expiration de
   certification, clause de responsabilité/indemnisation envers TerrOir en cas
   de fausse déclaration) ? Rédaction de la clause type.

4. **Validation manuelle (admin) vs intégration automatique Agence Bio** :
   laquelle constitue une **diligence suffisante** côté plateforme ? La
   validation manuelle d'un n° de certificat est-elle acceptable juridiquement,
   ou faut-il viser à terme la vérification automatique via l'annuaire officiel
   des opérateurs bio (Agence Bio) ?

5. **Expiration du certificat entre deux validations** : aujourd'hui, une fois
   `bio_validated_at` posé, le badge reste affiché **sans re-vérification
   automatique** de l'expiration. **Quel est le risque** et quelle obligation
   en découle (re-validation périodique imposée, date d'expiration à stocker +
   masquage auto à échéance, engagement producteur de signaler) ?

## 5. Documents techniques à montrer à l'avocat

Romain produira des captures (le code/produit existe) :

- **Flow d'inscription producteur** + écran d'acceptation CGU/CGV.
- **Capture du formulaire** où le producteur déclare « bio » + saisit son
  numéro de certificat (espace producteur `/ma-page`).
- **Capture du badge « Bio »** sur la fiche publique d'un producteur validé.
- **Capture de l'écran admin de validation** du certificat (back-office).
- Les **CGV/CGU actuelles** (pages `/cgv`, `/cgu`) pour relecture.

---

*Annexe — références internes (ne pas transmettre à l'avocat, pour Romain) :*
*ADR-0008 (mécanisme bio), migrations `20260522091000_producers_bio_flag.sql`*
*+ `20260522160000_producers_public_bio_exposure.sql`, route admin*
*`app/api/admin/producers/[id]/bio-validation/route.ts`.*
