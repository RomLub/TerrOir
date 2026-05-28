# ADR-0016 — Indisponibilités producteur (option B : blocage de dates indépendant des créneaux)

- **Statut** : Accepted
- **Date** : 2026-05-28
- **Décideurs** : Romain

## Contexte

Le bouton « Poser des vacances » de l'espace producteur (`/creneaux`) repose
sur un mécanisme bas niveau : `bulkExcludeRangeAction` (cf.
`app/(producer)/creneaux/actions.ts:766`) marque les **slots déjà
matérialisés** dans la plage avec un timestamp `slots.excluded_at` (cf.
`supabase/migrations/20260422400000_slots_adhoc_and_exceptions.sql`).

Trois limites bloquantes pour la suite produit :

1. **Réactif, pas proactif** : `excluded_at` ne peut exclure que ce qui
   existe au moment de la pose. Une **règle récurrente créée APRÈS**
   l'exclusion crée de nouveaux slots non-exclus, qui redeviennent
   réservables — violation de la sémantique attendue par le producteur
   (« j'ai posé mes vacances en août »).
2. **Couplage temporel** : le producteur ne peut pas poser ses congés
   d'août en mai si son planning d'août n'est pas encore configuré.
3. **Erreur silencieuse** : la version actuelle **skip silencieusement** les
   slots avec commandes actives sans informer le producteur. Pas de
   pattern « annuler-et-fermer » comme PR #198.

## Décision

### Une nouvelle entité `unavailabilities` (date, owner-only raison)

Table dédiée, **indépendante des slots et des règles** :

```
public.unavailabilities (
  id, producer_id, date, raison?, created_at, created_by, updated_at,
  UNIQUE (producer_id, date)
)
```

- **Granularité** : jour entier Europe/Paris (pas de demi-journée).
- **Raison** : optionnelle, **owner-only strict** (peut contenir du perso
  type « rdv médical »). Lecture publique limitée à `(id, producer_id,
  date)` via grants column-level (REVOKE SELECT puis GRANT SELECT col,
  pattern identique à `producers`).
- **RLS** : owner all (`owns_producer`), admin all (`is_admin`), lecture
  publique restreinte aux indispos des producteurs `statut='public'`
  (limitée par les column-grants).

Migration : `supabase/migrations/20260528300000_unavailabilities.sql`.

### Défense en profondeur : 2 gardes complémentaires

1. **Génération** (`lib/slots/generate.ts`) : la matérialisation des slots
   skip les jours marqués indisponibles. Un slot ne sera jamais créé sur
   une date fermée, **même si une règle récurrente créée APRÈS l'indispo
   la couvre**.
2. **Réservation** (RPC `create_order_with_items`) : ajout d'une étape 3bis
   qui refuse la commande si le slot tombe sur un jour indisponible
   (`raise exception` avec errcode `23514`). Filet de sécurité contre les
   races conditions (slot matérialisé puis indispo posée juste après) et
   les slots legacy non régénérés.

Migration RPC : `supabase/migrations/20260528310000_create_order_blocks_unavailability.sql`.

Justification des deux : la génération est idempotente avec TTL 15 min ;
une requête de réservation arrivant exactement pendant la fenêtre de
génération pourrait voir un slot créé puis immédiatement indisponible. La
RPC rattrape ce cas extrême.

### `excluded_at` devient un artefact bas niveau

`slots.excluded_at` reste comme mécanisme de **cohérence display** pour le
calendrier producteur : à la pose d'une indispo, les slots existants du
jour sont marqués `excluded_at = now()` ; à la suppression, ils sont
restaurés (`excluded_at = NULL`) puis régénérés. **Aucun chemin producteur
ne pose `excluded_at` directement après PR #2** (suppression de
`bulkExcludeRangeAction` + bouton « Poser des vacances »). La source de
vérité est `unavailabilities`.

### Régénération CIBLÉE au delete (pas full-horizon)

`generateSlotsForProducerOnDate(supabase, producerId, date)` : nouvelle
fonction publique qui régénère **uniquement le jour ciblé**, bypass TTL
(intention explicite). Helper privé `buildSlotsForRuleOnDay` partagé avec
`generateSlotsForProducer` — pas de duplication, deux entrées publiques à
personnalité claire au-dessus d'un cœur commun.

Ordre du `deleteUnavailability` (sécurisé) :
1. Lookup + ownership check (capture la date).
2. DELETE de l'indispo (la garde générative ne voit plus le jour).
3. UN-exclude des slots existants du jour (`excluded_at = NULL`).
4. `generateSlotsForProducerOnDate`. UPSERT idempotent
   (`ignoreDuplicates: true`) → slots avec commandes actives strictement
   intacts.

### Pattern « annuler-et-fermer » (PR #198) réutilisé

Si une indispo est posée sur un jour avec commandes actives, la server
action retourne `{ error, code: 'BLOCKING_ORDERS', blocking_orders: [...] }`
avec la shape `BlockingOrderForUnavail` (extension de `BlockingOrder`
existante avec `date_key`). L'UI (PR #2) déclenchera le modal d'annulation
séquentielle existante, puis retentera la pose.

## Alternatives rejetées

- **`excluded_at` seul** : démontré insuffisant (cf. Contexte point 1).
  Aucun moyen propre de garantir qu'un jour reste fermé indépendamment des
  règles futures.
- **Trigger DB propagation** (`INSERT unavailabilities → UPDATE slots`) :
  complexité ajoutée, opacité côté code applicatif, dur à raisonner. Le
  pattern « server action explicite » garde le contrôle côté TS et reste
  testable unitairement.
- **Régénération full-horizon au delete** : disproportionné (90 jours pour
  libérer 1), même si l'UPSERT idempotent évite tout dégât réel. La
  fonction dédiée est plus claire à lire dans le caller.
- **Migration des `slots.excluded_at` legacy vers `unavailabilities`** :
  l'audit prod (2026-05-28) révèle 37 lignes sur **1 producteur en
  statut `deleted`** → données factices, zéro valeur fonctionnelle. Pas
  de migration de données, table créée vierge.

## Conséquences

- **Pour le producteur (PR #2)** : nouveau flow « Indisponibilité » via
  calendrier multi-mois clic jour par jour, message d'erreur bloquant et
  actionnable si commandes actives, suppression ré-ouvre le jour
  automatiquement.
- **Pour le checkout consumer** : aucune régression attendue, la RPC reste
  fonctionnellement identique tant qu'aucune indispo n'existe (smoke test
  post-apply migration confirmé : `unavailabilities` + `v_slot_date`
  présents dans la fonction installée, signature inchangée).
- **Pour le calendrier consumer** : grants column-level autorisent la
  lecture publique de `(id, producer_id, date)` → le calendrier saura
  qu'une date est fermée sans exposer la raison.
- **Pour PR #2** : **disparition obligatoire** du bouton « Poser des
  vacances », de `VacationModal`, et de `bulkExcludeRangeAction` →
  condition non négociable (« un seul concept d'indispo à la fin du
  chantier »). La PR #2 vérifie qu'aucun chemin producteur ne pose
  `excluded_at` hors du flow `unavailabilities`.

## Découpage

- **PR #1 (cette PR)** — `feat/unavailabilities-backend` : DB + backend
  dormant (table, RPC garde, garde générative, helpers + server actions,
  tests). Migrations appliquées avant merge (dormantes : aucun `if exists`
  ne mord tant que la table est vide).
- **PR #2** — UI calendaire : composant calendrier multi-mois, intégration
  `/creneaux`, marquage des jours indisponibles sur la grille hebdo,
  suppression complète de l'ancien flow vacances.
