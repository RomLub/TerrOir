# Runbook — Extraction snapshot déclaration véracité DGCCRF (T-279)

**Périmètre** : procédure standardisée pour extraire, en cas de
réquisition DGCCRF (ou demande équivalente), la trace probatoire
complète de la déclaration sur l'honneur d'un producteur (T-241).

**Audience** : Romain (admin-only). À étendre si onboarding d'un
deuxième admin.

**Cross-référence** :
- T-241 (persistance déclaration véracité — schema + RPC).
- T-282 (gouvernance wording certifié, runbook bump v1.x).
- T-287 (audit RLS `declaration_indicateurs_*`).
- T-292 (CHECK constraint `_wording_version`).
- T-295 (audit RPC `update_producer_onboarding`).

---

## Quoi extraire

Pour chaque réquisition, fournir à l'autorité un export **autoportant**
contenant :

1. **Identité du producteur** : `id`, `slug`, `forme_juridique`,
   `prenom_affichage` ou raison sociale, `created_at`.
2. **Snapshot probatoire** :
   - `declaration_indicateurs_veracite_at` (timestamp UTC ISO 8601)
   - `declaration_indicateurs_snapshot` (JSON brut)
   - `declaration_indicateurs_wording_version` (ex. `v1.0`)
3. **Texte exact certifié** correspondant à la version archivée — issu
   de la map `DECLARATION_VERACITE_WORDINGS` dans
   `lib/producers/declaration-veracite.ts`. C'est ce texte que le
   producteur a vu et coché à `_veracite_at`.
4. **Hash code source** du fichier `lib/producers/declaration-veracite.ts`
   au moment de l'extraction (preuve d'intégrité du wording archivé).

---

## Procédure

### Étape 1 — Validation de la réquisition

- Vérifier la **base légale** de la demande (réquisition judiciaire,
  contrôle DGCCRF, demande RGPD article 15 par le producteur lui-même).
- Si demande tierce non judiciaire : refuser ou orienter vers RGPD/CNIL
  selon le cas. Ne JAMAIS extraire sur simple demande informelle.
- Conserver la trace écrite de la requête (PDF officiel, courrier,
  etc.) dans le dossier conformité.

### Étape 2 — Identification du producteur cible

```sql
SELECT id, slug, prenom_affichage, forme_juridique, created_at, deleted_at
FROM producers
WHERE slug = '<slug-cible>'
   OR id = '<uuid-cible>';
```

Si plusieurs producteurs matchent (homonymes, comptes successifs),
documenter le choix avec preuve (SIREN, email contact, adresse).

### Étape 3 — Extraction snapshot principal

Requête à jouer via SQL Editor Supabase (admin only) ou MCP :

```sql
SELECT
  p.id,
  p.slug,
  p.prenom_affichage,
  p.forme_juridique,
  p.declaration_indicateurs_veracite_at,
  p.declaration_indicateurs_snapshot,
  p.declaration_indicateurs_wording_version,
  p.created_at
FROM producers p
WHERE p.id = '<uuid-cible>';
```

**Vérifier que `_veracite_at IS NOT NULL`**. Si NULL :
- Producteur jamais coché (ou créé avant T-241 sans re-soumission). 
- Pas de trace probatoire à fournir, le mentionner explicitement dans
  la réponse à l'autorité.

### Étape 4 — Récupération texte wording exact

À partir de la valeur de `declaration_indicateurs_wording_version` (ex.
`v1.0`), aller chercher le texte dans le code source :

- Fichier : `lib/producers/declaration-veracite.ts`
- Constante : `DECLARATION_VERACITE_WORDINGS["<version>"]`
- Commit hash courant : `git rev-parse HEAD` au moment de l'extraction.
- Hash fichier : `git hash-object lib/producers/declaration-veracite.ts`.

La map est archivée immuablement : la doctrine wording certifié
(CLAUDE.md + commentaire en tête du fichier) interdit toute
modification d'une entrée existante. Le texte historique est donc
toujours retrouvable même après bump de version.

### Étape 5 — Audit log de l'extraction

L'extraction elle-même DOIT être loggée dans `audit_logs` (chaîne de
garde). Cluster `legal_compliance` à étendre avec un nouveau type
`admin_dgccrf_extraction_done` (cf. backlog : ajouter ce type dans
`LEGAL_COMPLIANCE_EVENT_TYPES` au moment de la première extraction
réelle, ou écrire le log manuellement via `mcp__supabase__execute_sql`
en attendant) :

```sql
INSERT INTO audit_logs (user_id, event_type, metadata)
VALUES (
  '<uuid-admin-extracteur>',
  'admin_dgccrf_extraction_done',
  jsonb_build_object(
    'producer_id', '<uuid-producteur>',
    'reason', 'requisition DGCCRF n°XXX du YYYY-MM-DD',
    'wording_version_extracted', '<v1.0>',
    'veracite_at_extracted', '<timestamp ISO>',
    'extracted_at', now(),
    'commit_hash', '<git rev-parse HEAD>'
  )
);
```

**Important** : le metadata ne contient JAMAIS le snapshot lui-même
ni le texte wording (déjà accessible en base + en code). On log la
TRACE de l'extraction, pas son contenu (RGPD : minimisation).

### Étape 6 — Format export à fournir à l'autorité

Format **PDF autoportant** (généré manuellement, pas d'outil dédié à
ce stade pré-Live). Sections :

```
=== EXTRACTION SNAPSHOT DÉCLARATION VÉRACITÉ ===
Plateforme : TerrOir (terroir-local.fr)
Demande : <référence réquisition>
Date d'extraction : <timestamp UTC ISO>
Extracteur : <nom admin>

--- Producteur ---
ID interne     : <uuid>
Slug           : <slug>
Nom d'affichage: <prenom_affichage>
Forme juridique: <forme_juridique>
Création compte: <created_at ISO>

--- Déclaration sur l'honneur ---
Date de coche  : <_veracite_at ISO>
Wording version: <_wording_version>
Snapshot enums :
  mode_elevage   : <valeur>
  alimentation   : <valeur>
  densite_animale: <valeur>

--- Texte exact certifié (wording <version>) ---
<texte intégral récupéré depuis DECLARATION_VERACITE_WORDINGS>

--- Intégrité ---
Code source fichier : lib/producers/declaration-veracite.ts
Hash fichier (sha1) : <git hash-object>
Commit repo (sha1)  : <git rev-parse HEAD>
URL repo (privé)    : github.com/RomLub/TerrOir
```

Joindre en annexe :
- Capture d'écran de l'écran d'onboarding tel qu'affiché aux
  producteurs à `_veracite_at` (si reproductible — sinon mentionner).
- Référence migration de mise en prod du wording :
  `supabase/migrations/20260504100000_t241_declaration_veracite_persistance.sql`.

Optionnel : format CSV si l'autorité le demande explicitement
(reprendre les mêmes champs en colonnes, même PDF en PJ comme
référence légale).

### Étape 7 — Conservation copie locale

Conserver une copie de l'export PDF dans le dossier conformité :
- Localement chez Romain (chiffré).
- Référence dans le dossier de la réquisition.

Durée de conservation à aligner sur durée d'instruction +
prescription (à valider juriste — typique 5 ans).

---

## Cas particulier — producteur supprimé (`deleted_at IS NOT NULL`)

Si le producteur a soft-deleted son compte mais que l'extraction est
légalement nécessaire :

1. Vérifier que `declaration_indicateurs_*` n'a pas été purgé (cf.
   politique T-285 — purge/anonymisation). Si purgé : impossible de
   fournir, mentionner dans la réponse.
2. Si non purgé : extraction normale via la même requête (la
   ligne existe toujours en base, juste filtrée du fetcher public).
3. Logger explicitement dans `metadata.deleted_account = true`.

---

## Cas particulier — bump wording v1.0 → v1.1 entre déclaration et
extraction

Le `_wording_version` archivé reste `v1.0` (immutable). L'extraction
récupère le texte v1.0 depuis la map, PAS le texte v1.1 courant.
C'est exactement le scénario que protège la doctrine T-282
(immuabilité des entrées de `DECLARATION_VERACITE_WORDINGS`).

Si à la lecture de la map l'entrée `v1.0` a été modifiée au lieu d'un
ajout `v1.1` (= violation doctrine) : **STOP**, ne pas extraire,
remonter à Romain. La trace probatoire est compromise.

Vérification rapide possible :

```bash
git log --all -p -- lib/producers/declaration-veracite.ts | grep -A 3 'v1.0'
```

Si plusieurs versions du texte `v1.0` existent dans l'historique git :
la doctrine a été enfreinte, escalader.

---

## Backlog post-Live (T-279 amélioration continue)

- Cluster `dgccrf_*` dédié dans `lib/audit-logs/log-dgccrf-event.ts`
  (à créer au volume — pour l'instant 1-2 extractions par an attendu).
- Script CLI `npm run dgccrf:extract -- --producer-id=<uuid>` qui
  génère le PDF autoportant + insert audit_log automatiquement (à
  créer si volume).
- Vue admin `/admin/dgccrf/extractions` pour consulter l'historique
  des extractions (post-Live, dépend du volume).
- Documenter durée conservation legale précise (T-284 + juriste).

---

## Références

- Schéma probatoire : `lib/producers/declaration-veracite.ts`.
- Migration source : `supabase/migrations/20260504100000_t241_declaration_
  veracite_persistance.sql`.
- Audit RPC : `docs/security/audit-rpc-update-producer-onboarding-pre-live-2026-05-06.md`.
- Audit RLS colonnes : `docs/security/audit-rls-declaration-indicateurs-t287-2026-05-06.md`.
- CHECK constraint : `docs/security/verification-check-constraint-wording-version-t292-2026-05-06.md`.
- Doctrine wording certifié : `CLAUDE.md` section « Doctrine wording
  certifié DGCCRF ».
