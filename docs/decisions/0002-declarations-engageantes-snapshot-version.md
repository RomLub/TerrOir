# ADR-0002 — Pattern déclarations engageantes producteur : snapshot daté + version

- **Statut** : Accepted
- **Date** : 2026-05-13 (cadrage 2026-05-04, livré 2026-05-06)
- **Décideurs** : Romain

## Contexte

TerrOir capture des **allégations producteur** déclaratives qui peuvent
engager juridiquement la plateforme (DGCCRF, loi Climat & Résilience).
Premier cas concret : les 3 enums score-carbone (`mode_elevage`,
`alimentation`, `densite_animale`) coché sur l'honneur par le
producteur dans le formulaire `StepInfos` à l'onboarding.

À mesure que d'autres déclarations engageantes seront ajoutées (origine
produits, étiquetage allergènes, certifications labels...), il faut un
pattern unifié pour :
1. tracer **quand** le producteur a coché (horodatage),
2. tracer **quelles valeurs exactes** il a confirmées au moment du coche
   (snapshot),
3. tracer **avec quel libellé** il a coché (le wording certifié peut
   évoluer pour clarification juridique — le snapshot probatoire perd
   sa valeur si on ne sait pas quel libellé exact le producteur a
   accepté),
4. gérer la **re-coche** quand un producteur modifie une valeur après
   le coche initial.

## Décision

Pattern centralisé en 3 composants :

1. **Map versionnée de wordings** (TS) :
   `lib/producers/declaration-veracite.ts` exporte
   `DECLARATION_VERACITE_WORDINGS` qui archive le **texte exact** de
   chaque version (`v1.0`, `v1.1`, ...). NE JAMAIS modifier une entrée
   existante (sinon les snapshots perdent leur valeur probatoire).
   Toute modif = nouvelle version.

2. **RPC SQL atomique** : `update_producer_onboarding` (SECURITY
   DEFINER) fait le `SELECT FOR UPDATE` + décision de re-persistance
   + `UPDATE` dans une seule transaction PostgreSQL. Pas de fenêtre
   lecture-modification non atomique.

3. **CHECK constraint whitelist** :
   `producers.declaration_indicateurs_wording_version` contraint à
   `('v1.0', 'v1.1')`. Pour bump v1.2+ : nouvelle migration
   `DROP + ADD CONSTRAINT` avec liste étendue.

Le helper testable `shouldPersistDeclarationVeracite` est un miroir
lisible de la logique CASE WHEN SQL (re-persiste uniquement si la
déclaration est cochée ET au moins un enum est non-NULL ET au moins une
valeur diffère du snapshot précédent).

## Conséquences

- ✅ Trace probatoire DGCCRF unifiée et atomique.
- ✅ Pattern réutilisable pour toute future déclaration engageante
  producteur (origine produits, allergènes, labels) — pas de
  re-développement ad hoc.
- ✅ Évolution du libellé (clarification juridique) sans casser les
  snapshots historiques.
- ❌ Coût de doctrine : tout contributeur doit comprendre que
  `DECLARATION_VERACITE_WORDINGS` est immuable historiquement (clé
  documentée dans CLAUDE.md section pièges Stripe / DGCCRF).
- ❌ Le bump de version ne propage pas automatiquement aux producteurs
  déjà certifiés : il faut un mécanisme UX dédié (re-coche, bandeau,
  blocage soft) à définir au moment du premier bump v1.0 → v1.1.

## Application future

Quand une nouvelle déclaration engageante émerge :
1. Créer une map `XXX_WORDINGS` versionnée dans `lib/producers/`.
2. Créer la colonne snapshot `declaration_xxx_snapshot jsonb` et
   `declaration_xxx_wording_version text` avec CHECK constraint
   whitelist.
3. Réutiliser le pattern RPC SECURITY DEFINER atomique pour la
   re-persistance.
4. Tests unitaires sur le helper `shouldPersistXxx` (miroir SQL).

## Liens

- `lib/producers/declaration-veracite.ts`
- `supabase/migrations/20260504100000_t241_declaration_veracite_persistance.sql`
- `supabase/migrations/20260506202622_t243_score_carbone_enums_version.sql`
- CLAUDE.md section « Pièges Stripe / DGCCRF »
