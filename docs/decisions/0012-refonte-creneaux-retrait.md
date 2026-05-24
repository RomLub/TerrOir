# ADR-0012 — Refonte UX des créneaux de retrait : calendrier visuel unique + deux modes d'ouverture

- **Statut** : Accepted
- **Date** : 2026-05-24
- **Décideurs** : Romain (besoin métier + arbitrage 2 modes) + CC (audit + proposition)

## Contexte

L'écran `/creneaux` actuel demande au producteur de raisonner comme un
développeur : trois sections séparées (« Règles récurrentes », « Créneaux
ponctuels », « Exceptions et absences ») et un vocabulaire abstrait
(« périodicité en semaines », « durée de créneau en minutes » qui découpe la
plage en tranches dans son dos, « matérialisation sur 3 mois », « exclure un
créneau »). La cible de TerrOir est majoritairement composée de producteurs
peu à l'aise avec l'informatique ; cet écran est un point de friction majeur.

Constat clé de l'audit (2026-05-24) : le **modèle de données existant supporte
déjà** les trois besoins exprimés, sans modification de fond.

- `slot_rules` (récurrent) → génère des `slots` concrets via
  `generateSlotsForProducer` (horizon 90 j, upsert idempotent sur
  `(producer_id, starts_at)`).
- `slots` avec `rule_id IS NULL` = ouverture ponctuelle.
- `slots.excluded_at` = fermeture ponctuelle / vacances.
- Le consommateur ne voit que des `slots` concrets (`starts_at`, `ends_at`,
  `capacity_per_slot`) ; il ignore totalement la notion de « règle » ou de
  « tranche ».

La refonte est donc **UI-only** : on refait l'écran producteur, pas la base ni
le parcours de réservation côté client.

## Décision

### 1. Un seul calendrier visuel, langage courant, trois gestes

Remplacer les 3 sections abstraites par **un agenda hebdomadaire visuel**
(navigation semaine via `WeekNavigator`, grille `grid-cols-7`, blocs colorés —
même pattern que `DashboardClient`). Trois gestes, dans la langue du
producteur (jamais les mots « règle / périodicité / tranche / exclusion ») :

1. **Ajouter une ouverture régulière** (récurrente).
2. **Ajouter une ouverture ponctuelle** (exceptionnelle).
3. **Fermer ponctuellement** : « Fermer ce jour » (un clic sur un bloc) ou
   « Poser des vacances » (une plage). Les ouvertures régulières reprennent
   automatiquement après.

### 2. Deux modes d'ouverture proposés au choix

À la création d'une ouverture (régulière ou ponctuelle), le producteur choisit
l'un des deux modes, expliqués en français simple :

- **« Ouverture libre » (défaut)** : un seul créneau couvrant toute la plage,
  `X` clients max sur la plage. Les clients passent quand ils veulent. C'est le
  cas majoritaire d'une vente à la ferme.
- **« Sur rendez-vous »** : la plage est découpée en tranches de 15/30/60 min,
  `X` clients par tranche (= comportement historique).

« Ouverture libre » est un **cas particulier du moteur existant** :
`slot_duration_minutes = durée totale de la plage` → la boucle de
`generate.ts` produit exactement 1 slot par jour (zéro changement moteur).

**Source de vérité du mode : une colonne explicite `slot_rules.mode`
(`'libre' | 'rdv'`), ajoutée de façon additive (défaut `'rdv'`)** — plutôt que
de déduire le mode de l'égalité `durée == amplitude`. Raison : la déduction
est ambiguë au cas-limite (une plage 9h–10h en RDV 60 min = 1 tranche, donc
indiscernable d'une ouverture libre), et le pré-remplissage du formulaire
d'édition + le libellé du bloc calendrier ont besoin d'une valeur stable. Le
mode n'est PAS stocké sur `slots` (les slots sont déjà la vérité
matérialisée : un libre = 1 ligne, un RDV = N lignes ; le « ponctuel » se
dérive de `rule_id IS NULL`).

### 3. Réutiliser les actions serveur existantes

Tout le module `creneaux/actions.ts` est déjà en `"use server"` (bon point) et
reste le socle. Adaptations :

- `createSlotRuleAction` / `updateSlotRuleAction` : acceptent `mode` et
  **dérivent la durée côté serveur** pour le mode libre (ne pas faire
  confiance au client).
- `createAdHocSlotAction` : branche libre (1 ligne, comme aujourd'hui) vs
  branche RDV (découpage serveur en N lignes via un helper pur
  `lib/slots/slice-window.ts`, upsert idempotent).
- Fermetures : `excludeSlotAction` / `unexcludeSlotAction` /
  `bulkExcludeRangeAction` réutilisés tels quels ; seul le déclencheur UX
  change (clic calendrier au lieu de modales de sélection). Le libellé de la
  plage devient « Poser des vacances ».
- La périodicité (« toutes les N semaines ») est **masquée** côté formulaire
  (défaut : chaque semaine) ; le support moteur est conservé pour un éventuel
  « une semaine sur deux » ultérieur.

## Invariants à NE PAS casser

Vérifiés sur le code actuel ; la refonte les préserve tous :

1. **`orders.slot_id` FK sans CASCADE** : jamais de hard-delete d'un slot
   référencé par une commande (gardes existantes dans `delete*Action`). Le
   nouveau delete groupé d'un ponctuel RDV (N lignes) doit répliquer la garde
   par-id. La fermeture (UPDATE `excluded_at`) est toujours sûre.
2. **Snapshot `date_retrait` / `heure_retrait`** posé à la création de la
   commande (RPC) : fermer/exclure un slot laisse la commande intacte.
3. **Capacité via `SELECT ... FOR UPDATE` dans `create_order_with_items`** :
   intacte (aucun chemin d'écriture consommateur touché). En mode libre, la
   capacité du slot unique = le plafond sur toute la plage, et le recount sous
   verrou l'applique gratuitement.
4. **`excluded_at` orthogonal à `active`** : les deux sont testés au checkout
   (`active = true AND excluded_at IS NULL`). Le calendrier rend « fermé »
   (exclu) et « désactivé » (inactif) distinctement, sans les confondre.
5. **Pas de hard-delete d'une règle ayant des commandes** : message
   « désactivez plutôt » conservé.

## Alternatives écartées

- **Supprimer purement les tranches** (proposition initiale CC : ne garder que
  l'ouverture libre) : écarté par Romain au profit d'**offrir les deux modes**.
  Coût faible (le moteur gère déjà les deux), et on couvre les producteurs qui
  veulent étaler les arrivées.
- **Déduire le mode de `durée == amplitude`** : écarté (ambiguïté au cas-limite,
  cf. décision 2).
- **Conserver les 3 sections abstraites** : écarté (cause racine de la
  friction).

## Conséquences

- **Impact consommateur quasi nul** : en mode libre, une journée affiche 1
  créneau long (« 9h–18h · 8 places ») au lieu de N courts. La requête et le
  picker consommateur (`produits/[id]`) gèrent déjà un slot par jour sans
  changement de code. Différence visible : moins de créneaux, plus longs
  (souhaitable).
- **Migration `slot_rules.mode` additive** (`ADD COLUMN ... DEFAULT 'rdv'` +
  CHECK) → dormante, appliquable avant merge ; les règles existantes gardent
  leur rendu actuel.
- **Tests** : unitaires `generate.ts` (libre = 1 slot/plage vs RDV = N
  tranches), helper `slice-window` (découpage, tranches passées ignorées,
  reliquat non divisible), E2E parcours calendrier (ajout libre, fermer ce
  jour / rouvrir, vacances, garde commande active).
- **Nettoyage en dernier** : retrait des composants des 3 sections
  (`SlotRulesList`, `AdHocSlotsList`, `ExceptionsList` + modales) une fois le
  calendrier vérifié.

## Liens

- [ADR-0011 — Refonte de l'espace producteur](0011-refonte-espace-producteur.md)
- [ADR-0003 — Mode livraison : retrait à la ferme](0003-mode-livraison-retrait-ferme.md)
- Fichiers clés : `app/(producer)/creneaux/page.tsx`,
  `app/(producer)/creneaux/actions.ts`, `lib/slots/generate.ts`,
  `lib/slots/validators.ts`, `app/(producer)/dashboard/DashboardClient.tsx`
  (pattern grille semaine), `app/(public)/producteurs/[slug]/produits/[id]`
  (consommation slots).
