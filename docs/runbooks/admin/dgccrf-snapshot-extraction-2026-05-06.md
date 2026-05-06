# Runbook admin — extraction snapshot DGCCRF

> **À usage Romain** (admin TerrOir, plateforme), en cas de réquisition / contrôle DGCCRF demandant la trace probatoire de la déclaration sur l'honneur d'un ou plusieurs producteurs.
>
> Session de création : 2026-05-06 (T-279). Source à jour : `lib/producers/declaration-veracite.ts` § `DECLARATION_VERACITE_WORDINGS`.

---

## Contexte

Depuis **T-241** (chantier 04/05/2026), la table `public.producers` archive la trace probatoire de la coche « Je certifie que les indicateurs déclarés correspondent à ma pratique réelle » du formulaire d'onboarding. Cette case devient obligatoire dès qu'au moins un des 3 enums score-carbone (`mode_elevage`, `alimentation`, `densite_animale`) est rempli.

Trois colonnes sur `public.producers` portent l'engagement déclaratif :

| Colonne | Type | Rôle |
|---|---|---|
| `declaration_indicateurs_veracite_at` | `timestamptz` | Horodatage de la coche (ou re-coche en cas de modification d'un enum score-carbone). |
| `declaration_indicateurs_snapshot` | `jsonb` | Snapshot des 3 valeurs enums déclarées au moment de la coche. |
| `declaration_indicateurs_wording_version` | `text` | Version du libellé certifié au moment de la coche (ex. `v1.0`). |

**Valeur probatoire** : la version du wording (`v1.0`, `v1.1`, …) seule ne suffit pas — il faut pouvoir reconstituer le **texte exact** que le producteur a vu et coché à la date de l'horodatage. Cette correspondance version → texte est archivée **en code source** dans la map `DECLARATION_VERACITE_WORDINGS` (`lib/producers/declaration-veracite.ts`), volontairement immuable au fil des bumps (cf. T-282 gouvernance wording).

---

## Données concernées

Surface des 3 colonnes : `public.producers` (1 ligne par producteur). Aucune table d'historique séparée — la sémantique « snapshot at last meaningful update » est suffisante en pré-Live (cf. T-241 décisions). Le producteur peut re-cocher (recoche datée) en modifiant un enum score-carbone après la première soumission.

Sémantique de présence :
- **Toutes les 3 colonnes NULL** : producteur n'a pas (encore) déclaré, ou pre-T-241 sans backfill.
- **Toutes les 3 colonnes NON NULL** : déclaration archivée à `veracite_at`, sur les valeurs `snapshot`, vue sous le wording `wording_version`.
- **Mix partiel NULL / NON NULL** : ne devrait jamais arriver — la RPC `update_producer_onboarding` écrit les 3 colonnes en bloc atomique (ou aucune). Si rencontré, escalader (anomalie data, à investiguer avant remise au contrôleur).

---

## Procédure d'extraction

### Étape 1 — Identifier le producteur

Plusieurs angles selon la requête du contrôleur :

- **Par `email`** (cas typique, le contrôleur envoie un courrier nominatif) :
  ```sql
  SELECT id, user_id, nom_exploitation, slug
  FROM public.producers p
  JOIN public.users u ON u.id = p.user_id
  WHERE u.email = 'producteur@example.com';
  ```

- **Par `slug` public** (URL fiche `/producteurs/<slug>`) :
  ```sql
  SELECT id, user_id, nom_exploitation, slug
  FROM public.producers
  WHERE slug = 'ferme-des-quatre-vents';
  ```

- **Par `user_id`** (UUID identifiant Supabase Auth) :
  ```sql
  SELECT id, user_id, nom_exploitation, slug
  FROM public.producers
  WHERE user_id = '00000000-0000-0000-0000-000000000000';
  ```

### Étape 2 — Extraire le snapshot pour 1 producteur

Une fois le `producer_id` ou `user_id` identifié :

```sql
SELECT
  p.id                                            AS producer_id,
  p.user_id,
  p.nom_exploitation,
  p.slug,
  u.email,
  u.prenom,
  p.declaration_indicateurs_veracite_at           AS coche_at,
  p.declaration_indicateurs_snapshot              AS snapshot,
  p.declaration_indicateurs_wording_version       AS wording_version,
  -- Coords floutées (cf. lib/producers/coords.ts) — la précision native
  -- ne quitte jamais le serveur. Si le contrôleur a besoin de l'adresse
  -- précise, la croiser avec p.adresse côté DB (champ texte saisi par
  -- le producteur lui-même, non flouté).
  p.adresse,
  p.commune,
  p.code_postal
FROM public.producers p
JOIN public.users u ON u.id = p.user_id
WHERE p.id = '<producer_id>'::uuid
   OR p.user_id = '<user_id>'::uuid;
```

### Étape 3 — Extraire pour TOUS les producteurs ayant déclaré

Pour un audit transverse (tous les producteurs avec une déclaration archivée), avec filtre date optionnel :

```sql
SELECT
  p.id                                            AS producer_id,
  p.user_id,
  u.email,
  p.nom_exploitation,
  p.slug,
  p.declaration_indicateurs_veracite_at           AS coche_at,
  p.declaration_indicateurs_snapshot              AS snapshot,
  p.declaration_indicateurs_wording_version       AS wording_version
FROM public.producers p
JOIN public.users u ON u.id = p.user_id
WHERE p.declaration_indicateurs_veracite_at IS NOT NULL
  -- Optionnel : restreindre à une fenêtre temporelle.
  -- AND p.declaration_indicateurs_veracite_at >= '2026-01-01'::timestamptz
  -- AND p.declaration_indicateurs_veracite_at <  '2026-12-31'::timestamptz
ORDER BY p.declaration_indicateurs_veracite_at DESC;
```

### Étape 4 — Reconstituer le texte exact du wording certifié

Le contrôleur a besoin du **texte exact** présenté au producteur, pas seulement de la version. Pour chaque ligne extraite à l'étape 2 ou 3 :

1. Lire la valeur de `wording_version` (ex. `"v1.0"`).
2. Ouvrir `lib/producers/declaration-veracite.ts` à la version commit / branche **en vigueur à la date `coche_at`** (cf. `git log --oneline -- lib/producers/declaration-veracite.ts`).
3. Chercher l'entrée correspondante dans la map `DECLARATION_VERACITE_WORDINGS`. Exemple v1.0 :
   > « Je certifie que les indicateurs déclarés ci-dessus (mode d'élevage, alimentation, densité) correspondent à ma pratique réelle, et je m'engage à les mettre à jour si ça change. »

4. Joindre le texte au snapshot remis au contrôleur.

**Anomalie** : si la valeur de `wording_version` ne figure PAS dans la map au commit historique, c'est une **anomalie probatoire**. NE PAS remettre le snapshot tel quel — escalader pour audit avant remise au contrôleur (vraisemblablement un bug ou une corruption data, cf. T-282 § procédure correction wording courant).

---

## Format de remise au contrôleur

Deux options selon le format demandé :

### Option A — CSV via Supabase Studio

1. Coller la requête SQL (étape 2 ou 3) dans **Supabase Studio → SQL Editor**.
2. Exécuter.
3. Bouton **« Download CSV »** en haut à droite du résultat.
4. Joindre le texte du wording (étape 4) en tant que document séparé ou colonne ajoutée manuellement.

### Option B — JSON formaté manuel (par producteur)

Pour une remise nominative avec mise en forme contrôlée :

```json
{
  "producer_id": "00000000-0000-0000-0000-000000000000",
  "user_id": "00000000-0000-0000-0000-000000000000",
  "email": "producteur@example.com",
  "nom_exploitation": "Ferme des Quatre Vents",
  "declaration": {
    "horodatage": "2026-05-06T14:32:11.000Z",
    "snapshot_indicateurs": {
      "mode_elevage": "plein_air",
      "alimentation": "100_pct_ferme",
      "densite_animale": "faible"
    },
    "wording_version": "v1.0",
    "wording_text": "Je certifie que les indicateurs déclarés ci-dessus (mode d'élevage, alimentation, densité) correspondent à ma pratique réelle, et je m'engage à les mettre à jour si ça change.",
    "wording_source": "lib/producers/declaration-veracite.ts § DECLARATION_VERACITE_WORDINGS"
  }
}
```

---

## Articulation autres chantiers

- **T-241** — chantier d'origine, persistance des 3 colonnes via RPC atomique `update_producer_onboarding`.
- **T-282** (livré dans la même session que ce runbook) — gouvernance du wording : doctrine immuabilité, procédure bump v1.X → v1.(X+1), procédure correction typo (interdite, bump version obligatoire). À lire avant tout bump.
- **T-292** (livré dans la même session) — contrainte CHECK côté DB sur `declaration_indicateurs_wording_version` (whitelist `v1.0` / `v1.1`). Defense-in-depth applicative + DB.
- **T-293** (backlog) — runbook bump v1.0 → v1.1 (procédure pas-à-pas pour exécuter le premier bump quand le wording v1.1 sera validé juridiquement).
- **T-296** (backlog) — infra de tests d'intégration SQL contre Supabase (parser le SQL identique côté JS et SQL pour la RPC).
- **Politique de confidentialité TerrOir** (T-041 / T-207, backlog) — la mention « horodatage et conservation à des fins probatoires » sera reflétée dans la version v1.1 du wording, à valider juridiquement.

---

## Liens

- `lib/producers/declaration-veracite.ts` — source de vérité du wording certifié, map `DECLARATION_VERACITE_WORDINGS`.
- `supabase/migrations/20260504100000_t241_declaration_veracite_persistance.sql` — migration originale T-241.
- `docs/conventions/wording-veracite-governance-2026-05-06.md` — gouvernance T-282.
- DGCCRF — [Direction générale de la concurrence, de la consommation et de la répression des fraudes](https://www.economie.gouv.fr/dgccrf).
