# ADR-0014 — Monitoring du remplissage des places sur /creneaux

- **Statut** : Accepted
- **Date** : 2026-05-28
- **Décideurs** : Romain (besoin métier + arbitrage maquette) + CC (audit +
  proposition + implémentation)

## Contexte

L'écran `/creneaux` introduit par [ADR-0012](0012-refonte-creneaux-retrait.md)
sert exclusivement l'**ajout / la fermeture** d'ouvertures (grille
hebdomadaire 7 jours, gestes « ouverture régulière / ponctuelle / fermer
ce jour / vacances »). Cette grille ne montre PAS le remplissage des
places : un bloc affiche son label horaire et son mode (« sur RDV · 12
créneaux » ou « 8 places »), mais pas combien de places sont
effectivement réservées.

Pour piloter ses ouvertures (« faut-il en ouvrir plus ? puis-je fermer
ce jour ? mes RDV se remplissent-ils en début ou en fin de plage ? »),
le producteur a besoin d'une **vue de monitoring du remplissage**, en
complément de la grille d'ajout.

## Décision

### 1. Section « Remplissage des places » sous la grille d'ajout

Ajouter une section `<MonitoringSection>` **en dessous** de la grille
d'ajout existante (composant `CreneauxCalendarClient`). La grille du
haut reste l'outil d'AJOUT (création / fermeture). La section du bas
est l'outil de **MONITORING** (consultation du remplissage). Rien n'est
remplacé.

Rendu **server-side pur** (aucun « use client », zéro JS additionnel
sur la page) : la donnée est calculée dans le server component
`CreneauxContent` et le composant `MonitoringSection` n'a pas besoin
d'interactivité (les liens internes utilisent `next/link`).

### 2. Granularité d'affichage : 1 bloc = 1 rule par jour (collapse RDV)

Cohérent avec la grille du haut (même découpage visuel). Pour une rule
RDV cap 4 sur 9h-12h en 30 min :

- la grille d'ajout affiche **1 bloc** « 9h–12h · sur RDV · 6 créneaux » ;
- le monitoring affiche également **1 bloc** « 9h–12h » avec **24 cases**
  (6 sous-slots × 4 places).

Alternative écartée : « 1 bloc par sous-slot ». Trop verbeux pour cap 1
(1 bloc = 1 case), explose visuellement le mode RDV, et casse la
cohérence avec la grille du haut.

### 3. 1 case = 1 place réservable

- **Case pleine** (terra `#A0522D` = `bg-terra-700`) : place réservée.
  Élément `<Link>` cliquable vers `/commandes/[orderId]` (route producteur
  existante, partagée avec dashboard et liste commandes).
- **Case vide** (bordure neutre) : place libre. Non cliquable.
- Wrap **8 cases par ligne** (grille CSS `grid-cols-8`). Pas de
  séparateur visuel entre sous-slots en mode RDV ; la lecture passe
  par le compteur global du bloc + le tooltip de chaque case.

### 4. Ordre des cases dans un bloc

Pour chaque sous-slot dans l'ordre chronologique, on émet d'abord les
cases **réservées** (triées par `orders.created_at` ascendant, tie-break
`order.id`), puis les cases **libres** restant à concurrence de la
capacité du sous-slot. Conséquences :

- en mode libre (1 sous-slot) : on voit en un coup d'œil le ratio
  réservées/libres dans l'ordre d'arrivée ;
- en mode RDV : on voit comment se remplissent les premières tranches
  vs les dernières (info la plus utile en pratique pour décider d'ouvrir
  plus ou de fermer).

### 5. Tooltip et accessibilité

Tooltip (attribut HTML `title` + `aria-label`) :

- **Case réservée** :
  - mode libre : `PPPP-CCCCC · Prénom` ou `PPPP-CCCCC · Client` si prénom NULL ;
  - mode RDV : `HHhMM · PPPP-CCCCC · Prénom` (l'heure correspond au
    sous-slot porteur).
- **Case libre** :
  - mode libre : `Place libre` ;
  - mode RDV : `HHhMM · libre`.

Pas de composant Tooltip lourd : l'attribut natif `title` + `aria-label`
suffit (accessible clavier + lecteur d'écran, zéro JS).

### 6. Jours sans créneau actif : **absents** du retour

Un jour qui n'a aucun sous-slot actif (tous exclus ou aucun slot du
tout) **disparaît entièrement** du monitoring (pas d'en-tête, pas de
date). Le grouping est filtré côté helper. La grille d'ajout du haut
suffit à voir qu'un jour est vide ou fermé.

Conséquence : si la **semaine entière** est vide, la section monitoring
est complètement masquée (retour vide → composant renvoie `null`).

### 7. Sous-slots exclus : retirés AVANT grouping

Un bloc partiellement exclu (certains sous-slots fermés, d'autres ouverts)
n'affiche **que les cases des sous-slots actifs**. Une place sur un
sous-slot fermé n'est pas réservable, donc pas de case pour elle. Pour
les ad-hoc, la rupture de contiguïté provoquée par un sous-slot exclu
casse naturellement le bloc en deux blocs distincts (cohérent avec la
sémantique « le sous-slot n'existe plus pour la réservation »).

### 8. Helper dédié, pas de partage avec dashboard

Création d'un helper pur `lib/slots/group-creneaux-monitoring.ts`
(testé à 17 cas unitaires), distinct de `groupWeekSlots` (qui sert la
grille d'ajout) et de `groupIntoBands` (qui sert le dashboard PR #199).
Raisons :

- la logique d'exclusion diverge subtilement entre les trois usages
  (la grille d'ajout affiche les blocs fermés barrés, le dashboard les
  ignore via filtre RPC, le monitoring les retire AVANT grouping) ;
- éviter un sur-couplage entre 3 features actives. Un refactor de
  mutualisation reste possible plus tard si la divergence s'estompe.

### 9. Pas de nouvelle RPC

L'enrichissement de la donnée tient en **un seul élargissement de la
query existante** dans `CreneauxContent` :

```ts
.select("id, code_commande, slot_id, created_at, consumer:users!orders_consumer_id_fkey(prenom)")
```

Le même résultat alimente à la fois :

- le `Set<slot_id>` existant (garde « Fermer ce jour ») ;
- la `Map<slot_id, MonitoringOrder[]>` nouvelle (monitoring).

Payload additionnel mesuré : **~5 KB / semaine** pour ~60 commandes
actives en moyenne. Négligeable. Pas de RPC supplémentaire à maintenir.

## Invariants à NE PAS casser

1. **Route `/commandes/[id]`** : route producteur unique pour le détail
   d'une commande, partagée avec dashboard et liste commandes. Ne pas
   inventer de route monitoring spécifique.
2. **Statuts comptés comme « réservé »** : `ACTIVE_ORDER_STATUTS =
   ['pending', 'confirmed']` (cf. `lib/orders/stateMachine.ts`).
   Cohérent avec dashboard et avec la garde « Fermer ce jour ».
3. **Capacité visuelle** = `nombre_de_sous_slots_actifs ×
   capacity_per_slot`. Un sous-slot exclu retire sa contribution.
4. **Aucune écriture côté monitoring** : section read-only. Tous les
   gestes de modification d'ouverture restent dans la grille du haut.
5. **`createCreneauxClientCalendar` non modifié** : son contrat (props
   `days`, `rules`) reste intact, le monitoring est rendu en frère du
   client component, pas à l'intérieur.

## Alternatives écartées

- **1 bloc par sous-slot** (cf. décision 2) : verbeux en RDV cap 1, casse
  la cohérence avec la grille d'ajout.
- **Page ou modale séparée** : crée un aller-retour pour une info qui
  vit naturellement à côté de la grille d'ajout. Le producteur doit
  voir le remplissage SUR la même page qu'il consulte pour décider
  d'ouvrir / fermer.
- **Nouvelle RPC `get_creneaux_monitoring`** : ajoute une surface SQL
  à maintenir pour un gain payload négligeable (~5 KB). La query
  élargie suffit.
- **Affichage des blocs entièrement fermés** (en grisé / barré) :
  redondant avec la grille d'ajout du haut qui les affiche déjà avec
  leur statut.
- **Séparateur visuel entre sous-slots en mode RDV** : ajoute du bruit
  pour une info déjà portée par le tooltip + le compteur global.

## Conséquences

- **Impact UX** : le producteur a en bas de page un tableau de bord
  visuel du remplissage, par jour et par bloc. La grille du haut reste
  son outil d'action (ajout/fermeture), la section du bas son outil de
  pilotage (monitoring).
- **Impact perf** : nul. SSR pur côté composant (zéro bundle JS
  additionnel), +5 KB de payload sur la query orders.
- **Impact code** : 1 helper pur (~280 lignes), 1 composant server
  (~150 lignes), 3 commits + ADR + E2E. Aucun changement de schéma DB,
  aucune migration.
- **Couverture tests** : 17 tests unitaires sur le helper + 7 tests RTL
  sur le composant + 3 scenarii E2E (libre, RDV, exclusion partielle).

## Liens

- [ADR-0011 — Refonte de l'espace producteur](0011-refonte-espace-producteur.md)
- [ADR-0012 — Refonte UX des créneaux de retrait](0012-refonte-creneaux-retrait.md)
- Fichiers clés : `lib/slots/group-creneaux-monitoring.ts`,
  `app/(producer)/creneaux/_components/MonitoringSection.tsx`,
  `app/(producer)/creneaux/page.tsx`.
