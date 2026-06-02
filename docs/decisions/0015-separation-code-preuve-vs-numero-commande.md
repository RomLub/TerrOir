# ADR-0015 — Séparation `code_commande` (preuve de remise) vs `numero_commande` (identifiant affichable)

- **Statut** : Accepted
- **Date** : 2026-05-28
- **Décideurs** : Romain (besoin métier sécurité) + CC (audit + plan + implémentation)

## Contexte

Le `code_commande` (format historique `TRR-XXXXX`, nouveau format
`TRR-XXXXXXX` depuis la migration `20260511007000_p0_sweep_f033_generate_order_code_7chars.sql`, généré par trigger Postgres
`generate_order_code()`) a vocation de **preuve de remise** : le client le
présente au producteur au moment du retrait, le producteur le saisit dans
`PickupValidationCard` qui appelle la RPC `complete_pickup_by_producer`
pour effectuer la transition atomique `confirmed → completed`.

**Problème identifié 2026-05-28** : le `code_commande` était affiché côté
producteur sur **7 surfaces** avant la remise (tooltips monitoring,
dashboard prochain retrait, liste commandes, détail commande, email
"Nouvelle commande à confirmer", planning vertical, RPC dashboard).
Conséquence : la « preuve » était cassée — le producteur la voyait avant
que le client ne la présente.

Aucun identifiant lisible neutre n'existait sur `orders` (uniquement `id`
UUID non-affichable + le `code_commande` lui-même).

## Décision

### 1. Deux identifiants distincts, deux rôles distincts

| Identifiant | Forme | Rôle | Visibilité |
|---|---|---|---|
| `code_commande` | `TRR-XXXXX` ou `TRR-XXXXXXX` | **Preuve de remise** (secret jusqu'à présentation client) | **Client** : partout (confirmation, /compte/commandes, /compte/commandes/[id], email, SMS). **Producteur** : `PickupValidationCard` **POST-saisie uniquement** (preview après que le producteur a saisi le code). **Admin** : partout (support / litiges). |
| `numero_commande` | `PPPP-CCCCC` (4 chiffres producteur + 5 chiffres séquence par producteur) | **Identifiant affichable** pour désigner une commande sans révéler la preuve | **Client** : partout (en plus du code). **Producteur** : partout (en lieu et place du code). **Admin** : partout (en plus du code). |

Exemples :
- `0042-00128` = 128ᵉ commande du producteur 0042.
- `0001-00001` = 1ʳᵉ commande du tout premier producteur inscrit.

Format extensible : le producer_number reste `int` en DB pour cohérence
de tri et compacité. Si un préfixe alphanumérique devient nécessaire à
terme, on ajoute une colonne `producer_number_prefix text` en complément
sans migrer le type existant.

### 2. Schéma de génération

**`producers.producer_number`** (int, unique, NOT NULL)
- Posé automatiquement à l'INSERT via trigger BEFORE INSERT
  `assign_producer_number()` qui consomme `nextval('producer_number_seq')`.
- Séquentiel d'inscription : 1, 2, 3, …
- Affichage : zero-padding à 4 chiffres (`0001` à `9999`, extensible
  au-delà sans changement de type).
- Backfill historique : par `created_at ASC, id ASC`.

**`orders.producer_order_seq`** (int, NOT NULL)
- Posé automatiquement à l'INSERT via trigger BEFORE INSERT
  `assign_producer_order_seq()`.
- Compteur centralisé sur `producers.next_order_seq` :
  ```sql
  UPDATE producers SET next_order_seq = next_order_seq + 1
  WHERE id = NEW.producer_id RETURNING next_order_seq
  ```
- L'`UPDATE...RETURNING` acquiert un **row lock** sur le producer →
  sérialise les INSERTs concurrents pour le **même producteur**, sans
  bloquer les producteurs distincts.
- Contrainte unique `(producer_id, producer_order_seq)` = filet de
  sécurité défense-en-profondeur.
- Backfill historique : par `created_at ASC, id ASC` PARTITION par
  `producer_id`.

### 3. Concurrence — analyse deadlock

Ordre d'acquisition des locks dans le checkout
(`create_order_with_items`) :

1. `SELECT slots ... FOR UPDATE` → lock slot
2. `PERFORM products ... ORDER BY id FOR UPDATE` → lock products
3. `INSERT orders` → trigger `assign_producer_order_seq` →
   `UPDATE producers RETURNING` → lock producer (row)
4. `INSERT order_items`, `UPDATE products` stock

**Ordre constant pour tous les checkouts : slot → products → producer.**

Aucun autre flow connu n'enchaîne lock producer puis lock slot/orders dans
la même transaction (vérifié par grep des UPDATE/FOR UPDATE producers
dans tout le repo). Risque de deadlock : nul.

### 4. Composition de l'affichage

Helper TS pur `lib/orders/order-number.ts` :

```ts
formatOrderNumber(producerNumber, producerOrderSeq) // → "0042-00128"
```

Côté RPC dashboard (où le `p_producer_id` est déjà l'auth scope), la
composition se fait en SQL pour exposer directement un champ
`numero_commande TEXT` prêt à consommer.

Côté query Supabase JS, on joint `producers(producer_number)` quand
nécessaire (la jointure existe déjà sur la plupart des surfaces).

### 5. Stratégie de déploiement — 3 migrations en 2 temps

**Migration A** (`20260528210000_order_number_separation.sql`) :
schéma + triggers + backfill. **Additive**, appliquée AVANT merge via
MCP. Dormante côté code déployé qui ne consomme pas encore les
nouvelles colonnes.

**Migration B** (`20260528220000_dashboard_add_numero_commande.sql`) :
RPC `get_producer_dashboard` expose `numero_commande` **EN PLUS du**
`code_commande` dans les 3 zones (`pending_orders`, `upcoming_orders`,
`slots[].orders[]`). **Additive**, appliquée AVANT merge via MCP. L'ancien
code déployé continue de lire `code_commande` sans souci.

**Migration C** (`20260528230000_dashboard_drop_code_commande_from_payload.sql`) :
RPC retire `code_commande` du payload. **Non additive — change la
shape**. À appliquer **APRÈS deploy Vercel** du code consommateur
(post-merge), via MCP, sinon dashboard prod cassé pendant la fenêtre
intermédiaire. Cf. doctrine CLAUDE.md §8.

**Migration de la vue `producers_public`** (`20260528240000_producers_public_add_producer_number.sql`) :
expose `producer_number` (non sensible, équivalent fonctionnel du slug
public). Additive, appliquée AVANT merge.

### 6. Garde anti-régression permanente

E2E `tests/e2e/producer/order-code-no-leak.spec.ts` parcourt `/commandes`,
`/commandes/[id]`, `/dashboard`, `/creneaux` après seed d'une commande
au statut `confirmed`, et assert qu'**aucun motif `TRR-{5 ou 7 chars}` n'apparaît
dans le HTML rendu**. Bloquant en CI : toute future régression côté
producteur (UI, API, RPC, template email) qui réintroduirait le code en
pré-remise cassera ce test.

Seul `PickupValidationCard` POST-saisie peut afficher le code (le
producteur vient de le saisir, ce n'est pas une fuite — c'est la
confirmation visuelle de sa frappe).

## Invariants à NE PAS casser

1. **RPC `complete_pickup_by_producer`** continue de prendre
   `p_submitted_code` (code-preuve) en paramètre et de vérifier
   l'équivalence DB-side (defense-in-depth). La preuve = ce code, pas
   le numéro.
2. **`PickupValidationCard` POST-saisie** : l'affichage du code après
   saisie est LEGITIME et reste en place. Toute future régression qui
   tenterait de retirer cet affichage casserait l'UX de validation.
3. **Format `numero_commande`** : `PPPP-CCCCC`. Le séparateur tiret est
   sémantique (= 4+5 distincts). Ne pas le retirer en pensant
   « optimiser ».
4. **`producer_number` ne change jamais après assignation** (séquentiel
   d'inscription). Aucun flow ne doit l'UPDATE après le premier INSERT.
5. **Trigger d'assignation `producer_order_seq`** : la concurrence est
   gérée par `UPDATE...RETURNING` sur `producers.next_order_seq`. Ne
   jamais réécrire ce trigger en `SELECT MAX(...) + 1` (race condition
   garantie).
6. **Côté client/admin**, le `code_commande` reste affiché (client = sa
   preuve à présenter ; admin = support technique). Ne pas le retirer
   « par cohérence ».

## Alternatives écartées

- **Séquentiel global cross-producteurs** : moins lisible (« commande
  #14523 » vs « 5ᵉ commande chez ce producteur »). Le séquentiel par
  producteur est plus parlant.
- **Hash court dérivé de l'UUID** : non tri-friendly, moins humain au
  téléphone (« commande a1b2c3d4 »).
- **Dénormalisation complète du numéro** (stockage `PPPP-CCCCC` sur
  `orders`) : 2 colonnes au lieu d'1, ~10 bytes vs 4. Coût stockage et
  rigidité au format. La composition côté code est trivialement
  testable.
- **Suppression complète du `code_commande`** : casse la preuve de
  remise (le client n'aurait plus rien à présenter, on retomberait sur
  une vérification d'identité moins fiable).
- **RPC qui change brutalement de shape sans transition** : risque
  cassage dashboard prod pendant la fenêtre déploiement Vercel ↔ apply
  RPC. La séquence en 2 temps (additive puis cleanup) est obligatoire.

## Conséquences

- **Surfaces UI touchées** : 7 surfaces producteur (toutes migrent vers
  `numero_commande` + 1 exception POST-saisie pour le code), 5 surfaces
  consumer (ajout du numéro à côté du code), 2 surfaces admin
  (statu quo, admin garde l'accès au code).
- **Surfaces email/SMS** : template `order-confirmed-producer` migre
  vers `numero_commande`. Template `order-confirmed-consumer` ajoute le
  numéro à côté du code. SMS `sendReminderSms` consumer continue de
  contenir le code (légitime). SMS `sendNewOrderProducerSms` ne
  contenait pas le code (sans changement).
- **Couverture tests** : tests unitaires `formatOrderNumber` (7 cas),
  tests RTL `MonitoringSection` (asserts numéro), tests E2E
  `creneaux-monitoring` (asserts numéro + absence TRR-), nouveau E2E
  `order-code-no-leak` (garde permanente sur 4 surfaces producteur).
- **Impact perf** : nul. Helper TS trivial, jointure producers déjà
  présente sur la plupart des surfaces, composition côté SQL pour la
  RPC dashboard sans coût additionnel.
- **Backfill data** : pré-launch, données factices. Backfill effectué
  dans la même transaction que l'ALTER TABLE en migration A. Aucune
  commande prod réelle impactée.

## Liens

- [ADR-0006 — Stripe flow pickup validation](0006-stripe-flow-pickup-validation.md)
- [ADR-0012 — Refonte UX des créneaux de retrait](0012-refonte-creneaux-retrait.md)
- [ADR-0014 — Monitoring des places sur /creneaux](0014-monitoring-places-creneaux.md)
- Fichiers clés : `lib/orders/order-number.ts`,
  `lib/orders/pickup-validation.ts`,
  `app/(producer)/commandes/_components/PickupValidationCard.tsx`,
  `tests/e2e/producer/order-code-no-leak.spec.ts` (garde permanente).
