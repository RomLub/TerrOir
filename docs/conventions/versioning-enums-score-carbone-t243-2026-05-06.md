# Versioning enums score carbone — convention T-243 (2026-05-06)

## Objectif

Permettre à un audit DGCCRF rétrospectif de répondre, pour toute
déclaration sur l'honneur archivée par T-241, à 2 questions :

1. **Quelles VALEURS d'enums** étaient possibles au moment de la
   déclaration (`mode_elevage`, `alimentation`, `densite_animale`) ?
2. **Quelle DÉFINITION métier** (label public + hint pédagogique) était
   associée à chaque valeur à ce moment-là ?

C'est strictement le pendant de T-241/T-292 qui adresse le TEXTE de la
phrase d'engagement (« Je certifie que… »). T-243 adresse les valeurs
elles-mêmes.

## Pourquoi 2 colonnes (wording + enums) au lieu d'une seule version

Les deux peuvent évoluer indépendamment :

- **Bump wording sans bump enums** : reformulation de la phrase
  certifiée (ex. ajout d'une mention RGPD), sans toucher aux valeurs
  enum ni à leurs définitions.
- **Bump enums sans bump wording** : ajout d'une nouvelle valeur
  (ex. `silvopastoralisme` pour `mode_elevage`), ou révision du label
  public ou du hint d'une valeur existante (ex. raffiner ce que
  `pature_dominante` signifie précisément).

Un champ unique forcerait à bumper les deux à chaque modif d'un seul
côté → perte de granularité probatoire + bruit dans la trace.

D'où :

| Colonne | Stamp | Source de vérité texte |
|---------|-------|------------------------|
| `declaration_indicateurs_wording_version` | Version du TEXTE certifié | `lib/producers/declaration-veracite.ts` § `DECLARATION_VERACITE_WORDINGS` |
| `declaration_indicateurs_enums_version` | Version des VALEURS et de leur définition métier | `lib/producers/score-carbone-enums-versions.ts` § `SCORE_CARBONE_ENUMS_WORDINGS` |

## Pattern (identique à T-241/T-282)

### 1. Map TS versionnée immuable

`lib/producers/score-carbone-enums-versions.ts` exporte :

- `SCORE_CARBONE_ENUMS_VERSION` (string courante, ex. `"v1.0"`).
- `SCORE_CARBONE_ENUMS_WORDINGS` (map versionnée immuable
  `version → { mode_elevage, alimentation, densite_animale }` avec
  pour chaque valeur d'enum un `{ label, hint }`).
- `getScoreCarboneEnumsSnapshot(version?)` (helper de relecture
  rétrospective pour audit DGCCRF).

**Règle d'or** : NE JAMAIS modifier ni supprimer une entrée existante
de la map. Pour faire évoluer un enum, AJOUTER une nouvelle version
(`v1.1`, `v1.2`, …) et bumper `SCORE_CARBONE_ENUMS_VERSION`. Les
producteurs en `v1.0` conservent leur trace probatoire intacte.

### 2. Colonne SQL avec CHECK constraint

```sql
alter table public.producers
  add column if not exists declaration_indicateurs_enums_version text;

alter table public.producers
  add constraint declaration_indicateurs_enums_version_check
  check (
    declaration_indicateurs_enums_version is null
    or declaration_indicateurs_enums_version = any (array['v1.0'::text])
  );
```

Whitelist alignée sur les clés de `SCORE_CARBONE_ENUMS_WORDINGS`.
À étendre via ALTER TABLE DROP/ADD CONSTRAINT à chaque bump (cf. T-292
pour le wording).

### 3. Stampage atomique dans la RPC

`update_producer_onboarding` (signature 16 args) reçoit un nouveau
paramètre `p_enums_version`. Il est écrit dans la même
transaction/SAVEPOINT que les 3 colonnes T-241, soumis à la même
condition `v_persist` (cohérence atomique snapshot ↔ wording_version
↔ enums_version).

Si `v_persist = false` (cas « tous enums vidés »), on ne touche pas la
colonne — préservation de la trace historique cohérente avec T-241.

### 4. Server action passe la constante

`app/(producer)/invitation/_actions/complete-onboarding.ts` importe
`SCORE_CARBONE_ENUMS_VERSION` et le passe en `p_enums_version` à
chaque appel RPC. Le call site est l'unique point de stampage — pas
d'appel libre depuis ailleurs.

## Procédure de bump (v1.0 → v1.1)

Reproduire le runbook T-293 (bump wording v1.0 → v1.1) en l'adaptant
aux enums :

1. **Ajouter** une nouvelle entrée dans `SCORE_CARBONE_ENUMS_WORDINGS`
   avec la clé `"v1.1"`. NE PAS modifier `"v1.0"`.
2. **Bumper** `SCORE_CARBONE_ENUMS_VERSION = "v1.1"`.
3. Si la modification implique un changement de valeurs SQL (ajout
   `silvopastoralisme` à `mode_elevage`), créer une **migration SQL**
   qui DROP + ADD le CHECK constraint sur `producers.mode_elevage`
   pour inclure la nouvelle valeur (ne pas oublier le codegen
   `lib/types/generated/enums.ts`).
4. **Migration SQL** qui DROP + ADD `declaration_indicateurs_enums_version_check`
   pour inclure `'v1.1'` dans la whitelist.
5. **Apply** les migrations via MCP Supabase.
6. **Smoke tests** post-apply :
   - RPC stamp `'v1.1'` (cas nominal).
   - RPC rejette `'v0.5'` (cas erreur).
   - Producteur déjà stampé `'v1.0'` reste à `'v1.0'` jusqu'à
     re-coche éventuelle (cohérence T-241 « pas d'écrasement
     rétroactif »).
7. **Push** le code (mise à jour TS + migration).
8. Mettre à jour le runbook T-279 (extraction snapshot DGCCRF) si la
   procédure de reconstitution change.

## Cohabitation avec l'ancienne signature 15 args

Pour éviter une fenêtre incompatibilité migration apply ↔ déploiement
code, la migration T-243 a créé la signature 16 args **en parallèle**
de l'ancienne 15 args (T-241). Les deux coexistent en prod avec la
même ACL service_role only.

Backlog **T-243-bis** : DROP de l'ancienne signature 15 args dans une
migration suivante, après confirmation que le déploiement code 16 args
est stable et qu'aucun call site externe ne référence encore la 15
args.

## Cas particulier — enum SQL inchangé mais hint/label modifié

Exemple typique : on garde `pature_dominante` comme valeur SQL, mais
on raffine son hint pour distinguer mieux des aliments achetés. Cas
qui justifie un bump enums sans bump wording.

Procédure :
1. Ajouter `"v1.1": { ..., alimentation: { pature_dominante: { label: ...,
   hint: "<nouveau hint>" }, ... } }` dans la map TS.
2. Bumper `SCORE_CARBONE_ENUMS_VERSION = "v1.1"`.
3. Migration ALTER `declaration_indicateurs_enums_version_check` pour
   whitelist v1.1.
4. Pas de migration SQL sur les CHECK constraints des 3 enums (les
   valeurs n'ont pas changé).
5. Smoke tests + apply.

## Références

- Migration : `supabase/migrations/20260506202622_t243_score_carbone_enums_version.sql`
- Map TS source de vérité : `lib/producers/score-carbone-enums-versions.ts`
- Convention sœur (wording) : `docs/conventions/wording-veracite-governance-2026-05-06.md`
- Audit RPC parente : `docs/security/audit-rpc-update-producer-onboarding-pre-live-2026-05-06.md`
- Audit RLS colonnes DGCCRF : `docs/security/audit-rls-declaration-indicateurs-t287-2026-05-06.md`
- CHECK constraint wording : `docs/security/verification-check-constraint-wording-version-t292-2026-05-06.md`
- Runbook extraction DGCCRF : `docs/runbooks/admin/dgccrf-snapshot-extraction-2026-05-06.md`
- Doctrine immuabilité wording : `CLAUDE.md` § « Doctrine wording certifié DGCCRF »
- Convention idempotence migrations : `docs/conventions/migrations-idempotence-2026-05-06.md`
