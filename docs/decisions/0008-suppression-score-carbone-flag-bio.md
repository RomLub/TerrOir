# ADR-0008 — Refonte indicateurs producteur : suppression score-carbone, introduction flag bio validé

- **Statut** : Accepted
- **Date** : 2026-05-22
- **Décideurs** : Romain
- **Remplace** : [ADR-0002](0002-declarations-engageantes-snapshot-version.md) (Superseded)

## Contexte

Le système « score-carbone & bien-être animal » (chantier T-200) reposait
sur 3 enums déclaratifs sur la table `producers` — `mode_elevage`,
`alimentation`, `densite_animale` — accompagnés d'une **déclaration de
véracité DGCCRF** horodatée et versionnée (4 colonnes
`declaration_indicateurs_*`, pattern décrit par l'ADR-0002).

Constats ayant motivé la refonte (chantier 3, 2026-05) :

1. **Non déployé en pratique** : pré-launch, aucun producteur réel n'avait
   renseigné ces indicateurs ; la fonctionnalité ajoutait de la complexité
   (formulaire onboarding, filtres de recherche publics, fiche publique,
   RPC dédiée `update_producer_indicateurs`, codegen enums, doctrine
   wording) sans usage.
2. **Mécanisme de véracité lourd** : snapshot JSON + versioning du wording +
   re-dating atomique côté RPC + runbook d'extraction DGCCRF + convention de
   gouvernance du wording. Coût de maintenance élevé pour une valeur
   probatoire jamais exercée.
3. **Double source de vérité « bio »** : le « bio » existait déjà comme
   valeur libre dans `producers.labels[]` (filtrable, badge public) alors
   qu'on s'apprêtait à le traiter comme un indicateur — risque d'incohérence.

## Décision

1. **Suppression complète** du système score-carbone et de la déclaration de
   véracité DGCCRF : 7 colonnes `producers` droppées (`mode_elevage`,
   `alimentation`, `densite_animale`, `declaration_indicateurs_veracite_at`,
   `declaration_indicateurs_snapshot`, `declaration_indicateurs_wording_version`,
   `declaration_indicateurs_enums_version`), 3 filtres de recherche publics,
   la fiche publique (pastilles), la RPC `update_producer_indicateurs`, les
   composants UI dédiés, le helper `declaration-veracite.ts`. La comparaison
   distance « circuit court vs ~1500 km » (D'où vient ta viande + widget
   distance fiche publique) est **préservée** : elle partageait par accident
   le même fichier que les indicateurs, désormais isolée dans
   `lib/producers/gms-distance.ts`.

2. **Introduction d'un flag bio isolé et validé** :
   - `producers.bio boolean NOT NULL DEFAULT false` — déclaré par le
     producteur (producer-writable).
   - `producers.bio_certificate_number text` — numéro d'opérateur Agence Bio
     (producer-writable).
   - `producers.bio_validated_at timestamptz` — date de **validation admin**
     du certificat (**admin-only**, posée uniquement par un acte admin).
   - Exposition publique (filtre + badge) **conditionnée à la validation** :
     `bio = true AND bio_validated_at IS NOT NULL`. Avant validation, le
     producteur n'est jamais exposé comme bio (protection juridique TerrOir).
   - `'bio'` retiré de `producers.labels[]` (valeurs historiques nettoyées,
     **sans** auto-cocher `bio = true` — re-déclaration requise avec numéro
     de certificat).

## Conséquences

- **Perte temporaire** du filtrage par pratique d'élevage côté consommateur
  (on réintégrera autrement plus tard si besoin, pas de code déconnecté
  conservé en attendant).
- **Gain de sécurité juridique** sur la mention bio : plus de double source de
  vérité, exposition publique gatée par une validation admin explicite.
- Perte des valeurs historiques score-carbone/véracité : **assumée**,
  pré-launch, aucune donnée probatoire réelle.
- La doctrine ADR-0002 (snapshot daté + version pour déclarations engageantes)
  n'a plus de cas d'usage actif → **Superseded**. Le pattern reste consultable
  pour une future déclaration engageante, mais n'est plus implémenté.

## Alternatives considérées

- **Booléen `bio` libre sans validation** — rejeté : risque DGCCRF (un
  producteur pourrait s'auto-déclarer bio sans certification, TerrOir
  exposerait une allégation non vérifiée).
- **Garder `bio` dans `labels[]`** — rejeté : pas de validation possible, et
  le maintien d'une saisie libre « bio » à côté d'un flag dédié recréerait la
  double source de vérité qu'on cherche à éliminer.

## Reporté (Deferred)

- **Intégration automatique avec l'annuaire Agence Bio** : la validation du
  certificat est **manuelle par l'admin** pour le MVP. L'automatisation
  (vérification du numéro d'opérateur contre l'API Agence Bio) est reportée
  au déclencheur volume.
