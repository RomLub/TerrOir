# Vérification CHECK constraint `declaration_indicateurs_wording_version` — 2026-05-06 (T-292)

**Source live** : MCP Supabase `read-write` sur prod (Postgres 17.6).
**Périmètre** : CHECK constraint sur `public.producers.declaration_indicateurs_wording_version`.

**Pourquoi cette vérif** : la valeur probatoire DGCCRF des snapshots
`declaration_indicateurs_*` (T-241) repose sur le fait que
`_wording_version` ne peut contenir que des versions explicitement
archivées dans `lib/producers/declaration-veracite.ts`
(`DECLARATION_VERACITE_WORDINGS`). Sans CHECK constraint, un bug app
ou une migration mal cadrée pourrait écrire un `_wording_version`
introuvable dans la map et casser la reconstitution du texte exact
qu'a vu le producteur.

---

## Constatation en DB live

Constraint présente :

```
declaration_indicateurs_wording_version_check
  CHECK ((declaration_indicateurs_wording_version IS NULL)
         OR (declaration_indicateurs_wording_version = ANY (ARRAY['v1.0'::text, 'v1.1'::text])))
```

Whitelist alignée avec la map `DECLARATION_VERACITE_WORDINGS`
(`v1.0` courant + `v1.1` placeholder pré-archivé).

---

## Smoke tests post-vérif

Tests joués via table TEMP `_t292_smoke*` reproduisant la définition
de la contrainte (impossible de tester directement en UPDATE sur
`producers` car le trigger T-218 bloque les UPDATE non-admin avant
même que la CHECK ne soit évaluée — protection en profondeur
volontaire, cf. T-287).

| Test | Valeur | Attendu | Résultat |
|------|--------|---------|----------|
| 1 | `NULL` | accepté | ✅ accepté |
| 2 | `'v1.0'` | accepté | ✅ accepté |
| 3 | `'v1.1'` | accepté | ✅ accepté |
| 4 | `'v0.9'` | rejeté | ✅ ERROR 23514 violates check constraint |
| 5 | `'v2.0'` | rejeté | ✅ ERROR 23514 violates check constraint |

5/5 conforme.

---

## Cohérence avec la doctrine T-282 (gouvernance wording)

Pour bumper `v1.2` ou ultérieur :

1. Ajouter l'entrée dans `DECLARATION_VERACITE_WORDINGS`
   (`lib/producers/declaration-veracite.ts`) — **ne jamais modifier
   les entrées existantes**.
2. Bumper `DECLARATION_VERACITE_WORDING_VERSION` vers la nouvelle
   version courante.
3. Migration SQL `ALTER TABLE producers DROP CONSTRAINT IF EXISTS
   declaration_indicateurs_wording_version_check; ALTER TABLE
   producers ADD CONSTRAINT declaration_indicateurs_wording_version_check
   CHECK (... IN ('v1.0', 'v1.1', 'v1.2'));` (forward-only,
   idempotent).
4. Apply via MCP Supabase (`mcp__supabase__apply_migration`).
5. Re-générer les types Supabase (`npm run codegen`) et committer.

Cf. runbook T-293 pour le détail du bump.

---

## Verdict T-292

**Clôturé sans migration corrective**. La CHECK constraint a été
appliquée précédemment (commit `3516f7c chore(codegen): regenerer
enums apres T-292 CHECK constraint wording_version`) et la vérif
2026-05-06 confirme :
- Constraint présente et active.
- Whitelist alignée sur la map TS.
- Comportement runtime conforme (3 acceptés, 2 rejetés).

Item P0 checklist pré-Live → ✅.

---

## Références

- Doctrine wording certifié DGCCRF : `CLAUDE.md` section « Doctrine
  wording certifié DGCCRF ».
- Single source of truth wording : `lib/producers/declaration-veracite.ts`.
- Audit RLS declaration_indicateurs (T-287) : `docs/security/
  audit-rls-declaration-indicateurs-t287-2026-05-06.md`.
- Audit RPC parente : `docs/security/audit-rpc-update-producer-onboarding-pre-live-2026-05-06.md`.
