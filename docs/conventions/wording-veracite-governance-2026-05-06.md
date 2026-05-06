# Convention — gouvernance du wording certifié `DECLARATION_VERACITE_WORDINGS`

> Source canonique : `lib/producers/declaration-veracite.ts` § `DECLARATION_VERACITE_WORDINGS`.
>
> Session de création : 2026-05-06 (T-282). Articulation T-241 (chantier d'origine), T-279 (runbook extraction DGCCRF), T-292 (CHECK constraint DB), T-288 / T-278 (déclencheur business + UX re-coche), T-293 (runbook bump v1.0 → v1.1).

---

## Pourquoi cette convention

L'engagement déclaratif certifié par le producteur (« Je certifie que les indicateurs déclarés correspondent à ma pratique réelle ») a une **valeur probatoire DGCCRF** uniquement si on peut reconstituer, à la date de l'horodatage de la coche, **le texte exact** présenté au producteur. La version stockée en base (`v1.0`, `v1.1`, …) ne sert à rien si la correspondance version → texte évolue silencieusement.

La map `DECLARATION_VERACITE_WORDINGS` (en code source) est le **single source of truth** pour cette correspondance. Elle est versionnée par `git` et archivée indéfiniment. La gouvernance de cette map dicte donc directement la solidité de la trace probatoire : sans procédure écrite, le snapshot perd sa valeur dès qu'on modifie le wording sans en bumper la version.

---

## Doctrine d'immuabilité

> **Une entrée existante de `DECLARATION_VERACITE_WORDINGS` ne se modifie JAMAIS.** Une fois publiée en prod, `v1.0` reste `v1.0` pour toujours. Toute évolution = nouvelle entrée + bump de version.

Cette règle est absolue, sans exception, y compris :

- **Correction de typo** (« indique » → « indiquer ») : INTERDIT de modifier l'entrée existante. Bump de version obligatoire (`v1.X` → `v1.(X+1)`).
- **Précision sémantique** (renommer « densité » en « densité animale ») : INTERDIT de modifier l'entrée existante. Bump version.
- **Ajout de mention RGPD / loi Climat** (mention horodatage probatoire) : INTERDIT de modifier l'entrée existante. Bump version.
- **Reformulation pour validation juridique** : INTERDIT de modifier l'entrée existante. Bump version.

**Justification** : un producteur qui a coché v1.0 sur la version « densité » a coché ce texte précis à un instant donné. Si on modifie cette entrée a posteriori en « densité animale », l'horodatage continue de pointer vers une entrée map dont le texte n'est plus celui qu'il a effectivement vu. La trace probatoire devient fausse — c'est exactement ce que la map est censée empêcher.

**Cas particulier — entrée pré-publiée mais jamais utilisée** : tant que `DECLARATION_VERACITE_WORDING_VERSION` reste sur `v1.0`, l'entrée `v1.1` (déjà présente comme placeholder pour préparation T-293) peut être modifiée librement — aucun producteur ne l'a vue. La règle d'immuabilité s'applique dès le bump effectif (étape (a) du runbook T-293, où la version `v1.1` devient présentée à l'UI). Cf. commentaire dans `lib/producers/declaration-veracite.ts` ligne 53-66.

---

## Qui valide un bump de version

### Pré-Live (état actuel — 2026-05-06)

**Romain seul.** TerrOir n'est pas Live, le risque externe est limité. Romain valide :
- la pertinence de l'évolution (cohérence avec les enums score-carbone, conformité aux échanges juridiques en cours),
- le texte exact de la nouvelle entrée,
- le bump de la constante `DECLARATION_VERACITE_WORDING_VERSION`,
- l'extension de la whitelist DB CHECK constraint (T-292) pour accepter la nouvelle valeur.

### Post-Live (à confirmer par Romain quand cadre juridique posé)

**Romain + juriste DGCCRF / RGPD obligatoire.** Le wording engage la responsabilité de TerrOir vis-à-vis du producteur (loyauté de l'information) ET vis-à-vis du consommateur (exactitude des allégations en application loi Climat & Résilience + DGCCRF). Toute évolution post-Live doit faire l'objet d'une review juridique avant déploiement, à intégrer dans T-003 (audit pré-Live transverse).

À cadrer plus précisément quand Romain aura validé l'identité du juriste référent et le format de la review (PR commentée, e-mail formel, document signé).

---

## Procédure d'un bump v1.X → v1.(X+1)

> Pas-à-pas. À doubler avec **T-293** (runbook bump v1.0 → v1.1 spécifiquement, à créer juste avant le premier bump effectif).

### Étape 1 — Préparation du nouveau wording

1. Rédiger le texte candidat dans une PR draft (pas encore mergeable). Indiquer la motivation du bump (correction typo, précision sémantique, contrainte juridique nouvelle).
2. Si post-Live : envoyer au juriste pour review avec contexte (ancienne version, raison du bump, articulation indicateurs score-carbone).
3. Itérer jusqu'à validation.

### Étape 2 — Modification du code

1. **Ajouter** une nouvelle entrée dans la map `DECLARATION_VERACITE_WORDINGS` (`lib/producers/declaration-veracite.ts`) avec la clé `v1.(X+1)`.
2. **NE PAS toucher** aux entrées existantes (cf. doctrine immuabilité).
3. **Bumper** la constante `DECLARATION_VERACITE_WORDING_VERSION` à la nouvelle valeur.
4. Si applicable : ajuster les tests vitest qui assertent le wording courant.

### Étape 3 — Modification de la contrainte DB (T-292)

La contrainte `CHECK declaration_indicateurs_wording_version IN ('v1.0', 'v1.1', …)` doit accepter la nouvelle valeur, sinon l'écriture par la RPC `update_producer_onboarding` plantera (`ERROR 23514`).

**Pattern** (idempotent, conforme T-297) :

```sql
ALTER TABLE public.producers
  DROP CONSTRAINT IF EXISTS declaration_indicateurs_wording_version_check;

ALTER TABLE public.producers
  ADD CONSTRAINT declaration_indicateurs_wording_version_check
  CHECK (
    declaration_indicateurs_wording_version IS NULL
    OR declaration_indicateurs_wording_version IN ('v1.0', 'v1.1', 'v1.2')
    --                                                                ^^^^^^
    --                                                                nouvelle valeur ajoutée
  );
```

**À ne PAS faire** : retirer une ancienne valeur de la whitelist (les producteurs déjà certifiés en `v1.0` doivent pouvoir réécrire la même valeur si la RPC ré-évalue snapshot identique → no-op transactionnel).

### Étape 4 — UX re-coche producteurs déjà certifiés (T-288)

Quand un producteur certifié en `v1.X` revient sur la fiche d'onboarding et qu'on a bumpé en `v1.(X+1)` entre temps, il faut décider : re-cocher obligatoire (nouvelle déclaration sur la nouvelle version), ou conserver la coche `v1.X` historique tant qu'il ne modifie aucun indicateur ?

Décision figée par T-288 (à raffiner) : **conserver la coche historique** tant que les enums ne sont pas modifiés. Si un enum change → re-coche obligatoire qui repassera par la RPC `update_producer_onboarding` avec la nouvelle version courante. Cf. logique `shouldPersistDeclarationVeracite` dans `lib/producers/declaration-veracite.ts` ligne 109.

### Étape 5 — Validation prod + smoke test

1. Apply la migration `T-292-bis` (ou `T-XXX` selon nomenclature du moment) via MCP Supabase.
2. Smoke test : tenter un INSERT/UPDATE avec la nouvelle valeur (doit passer), puis avec une valeur hors whitelist (doit échouer ERROR 23514).
3. Vérifier qu'au moins un producteur de test peut compléter l'onboarding et générer une ligne avec la nouvelle valeur.

### Étape 6 — Communication producteur (post-Live)

À cadrer avec le juriste : faut-il informer les producteurs déjà certifiés du bump (e-mail) ? Cohérent avec la doctrine RGPD information loyale.

---

## Procédure correction typo / ajustement mineur sur wording courant

> **Réponse courte : INTERDIT.** Toute correction passe par un bump de version, même pour un point virgule.

**Justification** : si l'on accepte « bah, juste ce point virgule, on patche silencieusement v1.0 », la trace probatoire perd sa garantie d'immuabilité — et avec elle sa valeur. Mieux vaut un bump v1.0 → v1.1 « cosmétique » (procédure complète, audit trail clair) qu'un patch silencieux qui mine la confiance dans le système.

Coût d'un bump pour typo : ~30 minutes (modif map + bump constante + migration CHECK + déploiement). Bénéfice : le système probatoire reste intact, vérifiable, opposable au contrôleur.

---

## Procédure recovery — wording courant modifié par erreur

Si un commit a malencontreusement modifié une entrée existante de `DECLARATION_VERACITE_WORDINGS` (ex. typo « corrigée » directement dans `v1.0`) :

1. **`git revert` du commit fautif** dès détection. Restauration immédiate du texte d'origine.
2. **Audit log applicatif** (event `wording_governance_violation` avec metadata commit SHA + auteur + ancien/nouveau texte) — à câbler quand l'infra audit_logs supportera ce cluster.
3. **Notification Romain** (et juriste post-Live) du quasi-incident.
4. **Decision-tree** :
   - Si le texte fautif n'a **jamais été déployé** en prod (commit en feature branch, repéré avant merge) : `git revert` suffit, aucune trace en prod.
   - Si le texte fautif a été **déployé en prod** : il faut figer la nouvelle « ligne probatoire » du producteur en bumpant immédiatement vers `v1.(X+1)` avec le texte révoqué publié comme v1.X (paradoxalement, on ASSUME le texte fautif comme étant `v1.X` puisque c'est ce que les producteurs ont vu pendant la fenêtre d'incident) ET on rétablit le texte initial sous v1.(X+1). Le contrôleur lira alors la chronologie : producteurs certifiés avant l'incident → `v1.X` ancien (impossible à séparer du fautif post-incident) ; producteurs certifiés après le bump → `v1.(X+1)` clean. Trade-off cher mais cohérent avec la doctrine.

Cas limite anti-pattern à NE PAS faire : modifier silencieusement l'entrée pour la « rétablir », puis prétendre que rien ne s'est passé. Ce serait le scénario le plus dommageable pour la valeur probatoire (incohérence indétectable côté DB ↔ map).

---

## Articulation autres chantiers

- **T-241** — chantier d'origine, persistance des 3 colonnes via RPC atomique `update_producer_onboarding`.
- **T-279** (livré dans la même session) — runbook admin extraction snapshot DGCCRF.
- **T-292** (livré dans la même session) — contrainte CHECK côté DB sur `declaration_indicateurs_wording_version` (whitelist `v1.0` / `v1.1`).
- **T-278** (backlog) — déclencheur business du bump v1.0 → v1.1 (mention horodatage probatoire dans le wording, RGPD information loyale).
- **T-288** (backlog) — UX re-coche producteurs déjà certifiés au moment du bump.
- **T-293** (backlog) — runbook bump v1.0 → v1.1 (procédure pas-à-pas spécifique au premier bump).
- **T-296** (backlog) — infra de tests d'intégration SQL contre Supabase (parser identique JS ↔ SQL).

---

## Liens

- `lib/producers/declaration-veracite.ts` — source canonique du wording certifié.
- `docs/runbooks/admin/dgccrf-snapshot-extraction-2026-05-06.md` — extraction snapshot pour réquisition.
- `supabase/migrations/20260504100000_t241_declaration_veracite_persistance.sql` — RPC `update_producer_onboarding`.
- DGCCRF — [Direction générale de la concurrence, de la consommation et de la répression des fraudes](https://www.economie.gouv.fr/dgccrf).
