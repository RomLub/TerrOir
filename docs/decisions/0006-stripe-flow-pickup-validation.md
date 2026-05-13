# ADR-0006 — Modèle de flux Stripe Connect et validation pickup : conservation du Separate Charges & Transfers + workflow incidents + programme TerrOir Confiance 3 niveaux

- **Statut** : Proposed
- **Date** : 2026-05-13
- **Décideurs** : Romain Lubin

## Contexte

L'audit factuel `docs/AUDIT_STRIPE_FLOW.md` (2026-05-13) a établi l'état
réel du flow d'argent TerrOir avant Live. Trois faits structurants
ressortent :

1. **Modèle Stripe Connect = Separate Charges & Transfers** (audit §1).
   Le PaymentIntent est créé sur la balance plateforme TerrOir, sans
   `transfer_data` ni `application_fee_amount` ni `on_behalf_of` (audit
   §2). Le virement net (`montant_total − 6%`) vers le compte Connect du
   producteur est déclenché plus tard par le cron `weekly-payout`
   (lundi 08:00 UTC, agrège les orders `statut='completed'` de la semaine
   précédente Europe/Paris — audit §3.1 / §3.2).

2. **`pickup_validated` est l'enabler implicite du transfer hebdo**
   (audit §6.4). L'event est posé SQL-side par la RPC
   `complete_pickup_by_producer` quand le producteur saisit le code
   `TRR-XXXXX` du consumer. La même RPC pose `statut='completed'` +
   `completed_at`, qui sont la condition unique d'entrée dans la fenêtre
   du cron `weekly-payout`. Sans saisie du code, l'order ne progresse
   jamais vers `completed` et le producteur n'est jamais payé.

3. **Risque clawback documenté** (audit §5.6 case 3). Une fois le payout
   Stripe → IBAN producteur exécuté (schedule Stripe par défaut, non
   surchargé par le code — audit §4.1), un refund ultérieur ne peut plus
   être compensé par `stripe.transfers.createReversal()` côté Connect :
   TerrOir absorbe 100% de la perte commerciale (commentaire
   `lib/stripe/reverse-transfer.ts:12-18`).

Romain s'inquiétait initialement que le modèle paie le producteur avant
livraison effective. L'audit montre que ce risque n'existe pas dans le
flow nominal : tant que `pickup_validated` n'est pas posé, l'argent
reste sur la balance plateforme. Le code `TRR-XXXXX` ne pouvant être
saisi par le producteur qu'en présence du consumer (secret bilatéral),
sa saisie constitue une preuve de remise effective. Le modèle actuel
est de fait un mini-escrow naturel, à condition que la chaîne
`pickup → code → transfer` reste intègre.

Quatre cas problématiques restent identifiés :

- **Consumer no-show** : le consumer ne se présente pas au créneau de
  retrait. L'order reste `confirmed`, jamais `completed`, jamais
  payoutée.
- **Producteur no-show** : le producteur ne tient pas le créneau (oubli,
  panne, accident). Pas de mécanisme actuel pour le consumer pour
  signaler.
- **Désaccord** : remise effective mais litige sur la quantité, la
  qualité, la conformité.
- **Scan raté** : remise effective mais code non saisi (oubli
  producteur, panne smartphone, code perdu côté consumer).

Le présent ADR fixe la doctrine de validation pickup, le traitement de
ces 4 cas, et introduit un programme de paiement accéléré à 3 niveaux
(« TerrOir Confiance ») pour ouvrir une porte de sortie au modèle hebdo
sans casser le mini-escrow par défaut.

## Décision

### 1. Conservation du modèle Separate Charges & Transfers

Le modèle Stripe Connect actuel est conservé. Pas de bascule vers
Destination Charge ni vers Direct Charge. La justification est que
l'audit révèle un mini-escrow de fait déjà en place et que le risque
initial redouté (producteur payé avant livraison) n'existe pas dans le
flow nominal.

Cette conservation est explicite : tout futur chantier qui modifierait
le modèle de charge devra ouvrir un ADR superseder du présent.

### 2. Validation pickup nominale — code TRR-XXXXX éternellement valide

Le code `TRR-XXXXX` reste l'unique mécanisme nominal de validation
pickup. Trois propriétés sont actées :

- Le code est un secret partagé connu uniquement du consumer (généré par
  le trigger Postgres `generate_order_code`, format
  `TRR-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{5,7}` —
  `lib/orders/pickup-validation.ts:17`).
- Sa saisie par le producteur constitue une preuve bilatérale de
  remise : le producteur ne peut l'obtenir qu'en présence du consumer
  qui le lui communique. La validation `confirmed → completed` est donc
  attestée par les deux parties simultanément, sans qu'aucune action
  supplémentaire du consumer ne soit requise.
- La saisie reste valide sans limite de temps après `date_retrait`.
  Aucun timeout côté `pickup_validated`, aucune fenêtre de contestation
  ouverte au consumer après scan, aucune auto-validation muette.

Conséquence : un code peut être saisi 1h ou 6 mois après le créneau
prévu, l'effet est identique. Cette propriété est volontaire — elle
absorbe sans bug les cas de remise différée (consumer en retard,
créneau replanifié hors plateforme).

### 3. Validation pickup exceptionnelle — workflow incidents arbitré admin

Quand la chaîne nominale échoue (cas no-show, désaccord, scan raté), un
workflow d'arbitrage admin est introduit.

- Nouvelle table `pickup_incidents` (schéma précis à définir au moment
  de l'implémentation). À minima : `order_id`, `reported_by`
  (producteur ou consumer), `kind` (`consumer_no_show`,
  `producer_no_show`, `remise_sans_code`, `disagreement`, `other`),
  `description` (texte libre obligatoire pour `other`),
  `reported_at`, `status` (`pending`, `resolved_delivered`,
  `resolved_not_delivered_refunded`, `resolved_replanned`,
  `resolved_dismissed`), `decided_by` (admin), `decided_at`,
  `decision_reason`.

- Surface producteur (`pro.terroir-local.fr`) : nouvelle UI « Signaler
  un incident » sur le détail commande, accessible tant que l'order
  n'est pas terminale. Choix entre `consumer_no_show`,
  `remise_sans_code`, `disagreement`, `other`.

- Surface consumer (`www.terroir-local.fr`) : nouvelle UI symétrique
  pour signaler `producer_no_show` ou `disagreement`.

- Surface admin (`admin.terroir-local.fr`) : nouvelle page
  `/pickup-incidents` (liste filtrable par statut, détail incident,
  formulaire de décision). L'admin choisit une résolution parmi :
  - **Marquer livrée** : transition `confirmed → completed` posée par
    une nouvelle RPC SECDEF dédiée (audit log
    `pickup_admin_validated_post_incident`, distinct du nominal
    `pickup_validated`). Le transfer hebdo prend ensuite le relais
    comme pour une saisie code normale.
  - **Marquer non livrée et rembourser** : refund consumer via
    `executeRefundFlow` existant + reversal Connect si applicable
    (cf. `lib/refunds/execute-refund.ts` et `lib/stripe/reverse-transfer.ts`).
    Audit log `pickup_admin_refunded`.
  - **Réplanifier** : conserver l'order `confirmed`, marquer
    l'incident `resolved_replanned`. Le code reste valide pour une
    saisie future (cf. §2).

- Notification admin sur création incident : email + (à terme) bandeau
  page `/pickup-incidents`. Volume attendu faible pré-Live, pas de SMS
  ni de hook prioritaire.

- Aucune auto-validation, aucun timeout silencieux. La résolution est
  toujours humaine.

### 4. Politique consumer no-show

La commande validée et payée engage le consumer au créneau de retrait
choisi. En cas d'absence consumer :

- Pas de remboursement automatique.
- Le producteur peut signaler `consumer_no_show` via le workflow §3.
- L'admin facilite la mise en contact entre consumer et producteur si
  le consumer en fait la demande (résolution amiable).
- Les cas exceptionnels (maladie, accident, force majeure documentée)
  sont arbitrés admin au cas par cas.

Cette politique est à inscrire en CGV consumer (cf. §6).

### 5. Programme TerrOir Confiance — 3 niveaux

Pour ouvrir une porte de sortie au cycle hebdo sans casser le
mini-escrow par défaut, un programme à 3 niveaux est introduit. Le
niveau d'un producteur est porté par une colonne dédiée sur
`producers` (cf. §7).

#### 5.1 Niveau 0 — Standard (défaut)

- Paiement via cron weekly lundi après `pickup_validated`. Modèle actuel
  inchangé.
- Pas de critère d'accès, c'est l'état par défaut de tout producteur
  validé KYC.
- Pas de garde-fou supplémentaire : le mini-escrow naturel actuel reste
  la seule protection (et il est suffisant).

#### 5.2 Niveau 1 — TerrOir Confiance

- Paiement via cron daily (heure à définir au moment de
  l'implémentation, suggestion 06:00 UTC) après `pickup_validated`. Le
  déclencheur reste `pickup_validated` ; seule la fréquence du cron
  change. Le mini-escrow naturel est intégralement préservé.
- Critères d'accès :
  - 6 mois d'ancienneté plateforme.
  - 50 commandes complétées.
  - 0 dispute lost dans les 6 derniers mois.
  - Taux d'incidents pickup < 2% (numérateur = `pickup_incidents`
    résolus `non livrée` ; dénominateur = total orders `completed +
    non livrée résolus`).
  - Validation admin manuelle (pas d'auto-promotion sur seuil atteint).
- Avantages :
  - Paiement plus rapide (jusqu'à −6 jours vs Niveau 0).
  - Badge « TerrOir Confiance » sur vitrine consumer.
- Risque TerrOir : négligeable. Le cron change de fréquence mais le
  modèle escrow reste intact.

#### 5.3 Niveau 2 — TerrOir Confiance Premium

- Paiement immédiat à la commande : `stripe.transfers.create()`
  plateforme → Connect déclenché dès `payment_intent.succeeded` ET
  funds available côté balance plateforme. Si la balance n'est pas
  encore settled au moment de l'event (settlement Stripe T+1 à T+7),
  le transfer est différé via un cron dédié `daily-premium-payout` qui
  retente jusqu'à availability (au plus tard 24h après funds available).
- Le déclencheur n'est plus `pickup_validated` pour ce niveau. C'est
  `payment_intent.succeeded`. **Le mini-escrow naturel est explicitement
  abandonné pour les producteurs Premium.**
- Critères d'accès :
  - Niveau 1 acquis depuis 6 mois minimum.
  - 200 commandes complétées totales.
  - 12 mois d'ancienneté plateforme totale.
  - Mandat SEPA B2B signé (cf. §6).
  - Validation admin manuelle.
- Avantages :
  - Tout du Niveau 1.
  - Paiement à la commande (impact fort pour producteurs à cycle long :
    vente plusieurs semaines à l'avance avec retrait différé).
  - Badge Premium + mise en avant homepage.
- Risque TerrOir : assumé mais couvert par mandat SEPA B2B (cf. §6).

### 6. Mandat SEPA B2B obligatoire pour Niveau 2

Le producteur candidat Niveau 2 signe un mandat SEPA B2B électronique
avant promotion. Le SEPA B2B (Business-to-Business) se distingue du
SEPA Core consumer par l'absence de droit de contestation 8 semaines,
ce qui le rend exploitable comme outil de recouvrement effectif.

Mécanisme de recouvrement en cas d'incident pickup résolu
`resolved_not_delivered_refunded` sur une commande d'un producteur
Niveau 2 :

1. TerrOir rembourse le consumer (depuis balance plateforme ou fonds
   propres si balance insuffisante) via `stripe.refunds.create()`
   classique.
2. TerrOir déclenche un prélèvement SEPA B2B sur le compte producteur
   pour récupérer le montant remboursé + frais. Suggestion de barème
   (à fixer définitivement en CGV producteur Premium) : montant
   remboursé + commission TerrOir doublée + frais de dossier 10€.
3. Si prélèvement SEPA réussit → incident clos.
4. Si prélèvement SEPA échoue → rétrogradation immédiate du producteur
   en Niveau 0 + procédure de recouvrement classique (mise en demeure,
   éventuellement contentieux).

Le choix technique d'implémentation (Stripe SEPA Direct Debit pour
Connect vs GoCardless) est volontairement reporté au moment du chantier
Phase 3 (cf. §8). Les deux options sont jouables ; la décision dépendra
de l'ergonomie côté signature électronique, du coût par prélèvement, et
de l'intégration avec le compte Connect existant.

### 7. Critères de rétrogradation entre niveaux

Les rétrogradations sont automatiques sur événement métier, manuelles
sur revue admin :

- 1 `pickup_incident` résolu `not_delivered_refunded` → rétrogradation
  −1 niveau (Niveau 2 → 1, Niveau 1 → 0).
- 1 dispute lost (`disputes.status = 'lost'`) → rétrogradation −1
  niveau.
- 1 prélèvement SEPA B2B échoué (Niveau 2 uniquement) →
  rétrogradation immédiate en Niveau 0 + revue admin.
- Inactivité > 3 mois (aucune order `completed` sur la période) →
  rétrogradation auto en Niveau 0. Une remontée nécessite une nouvelle
  validation admin selon les critères §5.

Les transitions de niveau (montée et descente) sont tracées en
`audit_logs` via les nouveaux event types §9.

### 8. Schéma DB à enrichir

Colonnes à ajouter sur `producers` (noms à raffiner au moment de
l'implémentation, pas critique dans le présent ADR) :

- `confiance_level` : enum `{standard, confiance, premium}`, default
  `standard`.
- `confiance_certified_at` : `timestamptz`, nullable.
- `confiance_certified_by` : `uuid`, nullable, FK vers l'admin ayant
  promu.
- `sepa_b2b_mandate_id` : `text`, nullable, référence externe
  (Stripe ou GoCardless).
- `sepa_b2b_mandate_signed_at` : `timestamptz`, nullable.

Une table `pickup_incidents` est introduite (schéma §3).

### 9. Nouveaux event_types `audit_logs`

- `pickup_incident_reported`
- `pickup_admin_validated_post_incident`
- `pickup_admin_refunded`
- `pickup_admin_replanned`
- `terroir_confiance_certified` (avec metadata `from_level`, `to_level`)
- `terroir_confiance_revoked` (avec metadata `from_level`, `to_level`,
  `reason`)
- `stripe_transfer_immediate_initiated` (Niveau 2)
- `stripe_transfer_immediate_failed` (Niveau 2)
- `sepa_b2b_mandate_signed`
- `sepa_b2b_debit_initiated`
- `sepa_b2b_debit_succeeded`
- `sepa_b2b_debit_failed`

Chaque nouvel event_type est ajouté aux 3 surfaces de consolidation
documentées par ADR-0005 §Forme canonique :
`app/(admin)/audit-logs/_lib/event-types.ts`,
`lib/audit-logs/labels.ts`,
`app/(admin)/audit-logs/_lib/categorize-event-type.ts`.

## Alternatives considérées

### Alternative A — Passage à Destination Charge avec `reverse_transfer` en cas de refund

**Rejetée**. Avantages théoriques : un seul appel API par order (PI
créé directement avec `transfer_data.destination`), pas de cron weekly,
pas de séquencement INSERT-before-transfer à gérer. Inconvénients
réels :

- Le producteur reçoit son net dès `payment_intent.succeeded` sur sa
  balance Connect. Le mini-escrow naturel actuel disparaît : si le
  producteur ne livre pas, TerrOir doit récupérer les fonds via
  `reverse_transfer` sur un Connect account potentiellement déjà
  payouté vers l'IBAN producteur — exactement le risque clawback §5.6
  case 3 documenté dans l'audit, mais étendu à 100% des orders au lieu
  des seuls cas pathologiques.
- Le bénéfice du modèle Connect (commission prélevée à la source côté
  Stripe) n'est pas un gain net : TerrOir prélève déjà sa commission
  via le calcul `montant_net_producteur = montant_total − commission`
  effectué dans le cron weekly. Pas de simplification réelle.
- Coût de migration élevé (changement de modèle de charge + adaptation
  des handlers webhook + adaptation des refunds + tests) pour un gain
  marginal qui dégrade le profil de risque.

### Alternative B — Double validation producteur + consumer

**Rejetée**. Mécanisme : après saisie du code par le producteur, le
consumer reçoit une notification et doit confirmer la bonne réception
dans l'app pour déclencher `pickup_validated`. Inconvénients :

- Charge cognitive consumer inutile. Le code `TRR-XXXXX` constitue déjà
  une preuve bilatérale (le producteur ne peut le saisir qu'en présence
  du consumer qui le lui communique).
- Introduit une race : si le consumer ne confirme jamais (oubli, perte
  d'accès au compte, mauvaise foi), l'order reste bloquée. Solution :
  timeout auto-validation → introduit exactement le problème qu'on veut
  éviter (auto-validation muette).
- Friction UX consumer en sortie de retrait, dans un contexte où le
  consumer veut juste rentrer chez lui avec ses produits.

### Alternative C — Fenêtre de contestation consumer J+48h après scan

**Rejetée**. Mécanisme : après saisie du code, le consumer dispose de
48h pour signaler un problème via la plateforme, sinon `pickup_validated`
est confirmé définitivement. Inconvénients :

- Introduit un timeout race (que faire si le consumer ouvre une
  contestation à H+47:59 ?).
- Complique l'UX (le consumer doit retenir qu'il a 48h, le producteur
  doit attendre 48h pour être payé même en cas nominal).
- Gain de sécurité marginal : les cas de désaccord post-scan sont
  couverts par le workflow `pickup_incidents` §3 sans introduire de
  fenêtre globale ; un consumer mécontent peut toujours ouvrir un
  incident `disagreement` après coup.

### Alternative D — Auto-validation J+X après `date_retrait`

**Rejetée**. Mécanisme : si une order reste `confirmed` plus de X jours
après `date_retrait`, on bascule auto en `completed` via cron. Le
producteur est ainsi payé même en cas de scan raté. Inconvénients :

- Auto-validation muette : on bascule en `completed` une commande dont
  on ne sait pas si elle a été réellement remise. Risque de payer un
  producteur défaillant (cas no-show producteur) ou d'incompatibilité
  avec un consumer qui s'apprêtait à ouvrir un incident.
- Préférence explicite pour l'arbitrage admin humain au volume actuel
  (pré-Live + premières semaines post-Live, volume faible). Si le
  volume devient incompatible avec une intervention manuelle, ouvrir un
  ADR superseder.

### Alternative E — Programme Confiance à 1 seul niveau (flag boolean)

**Rejetée**. Première version de la décision §5 envisageait un flag
boolean unique `terroir_confiance_certified` qui débranchait le cron
hebdo pour basculer sur transfer immédiat à `payment_intent.succeeded`.
Inconvénients :

- Saut binaire trop brutal entre « hebdo » et « immédiat ». La majorité
  des producteurs ont besoin de paiements plus rapides sans pour autant
  justifier le risque d'un paiement à la commande sans escrow.
- Pas de gradation des critères de confiance : un producteur jeune et
  un producteur établi devraient pouvoir signaler leur ancienneté de
  manière différenciée côté vitrine consumer.
- Le 3 niveaux Standard / Confiance / Premium permet une progression
  graduelle, avec un Niveau 1 sans risque clawback (escrow préservé)
  qui couvre 90% du besoin « paiement plus rapide » sans introduire de
  recouvrement SEPA B2B.

### Alternative F — Paiement à la commande sans garantie SEPA

**Rejetée après analyse juridique**. Mécanisme : Niveau 2 sans mandat
SEPA, en se reposant uniquement sur les recours judiciaires classiques
en cas de défaillance producteur. Inconvénients :

- Recours théoriques mais peu effectifs en pratique. Coût de procédure
  judiciaire 1 500 – 3 000 € vs commandes 30 – 200 € : ratio
  économiquement non-rentable sur les premiers cas isolés.
- Délais 12 – 18 mois entre incident et éventuelle récupération.
- Recouvrement faible si producteur insolvable au moment du jugement.
- Le mandat SEPA B2B contractuel est l'outil de recouvrement adapté à
  l'échelle marketplace : prélèvement immédiat, pas de contestation 8
  semaines, traçabilité Stripe/GoCardless native.

## Conséquences

### Positives

- **Conservation du mini-escrow naturel par défaut** : pour les
  producteurs Niveau 0 (qui constitueront la totalité du parc producteur
  au Live et pendant les premiers mois), le profil de risque reste
  intégralement celui de l'audit actuel — connu, documenté, testé.
- **Progression graduelle** entre paiement hebdo, daily, et immédiat.
  Aucun producteur n'est forcé de quitter l'escrow ; il faut une
  démarche active (atteinte critères + revue admin + mandat SEPA pour
  Niveau 2).
- **Workflow incidents pour 4 cas pathologiques** : couvre consumer
  no-show, producteur no-show, désaccord, scan raté avec un arbitrage
  humain unique, sans introduire d'automatisme silencieux risqué.
- **Mandat SEPA B2B comme outil de recouvrement effectif** sur le
  Niveau 2 : déplace le risque clawback documenté §5.6 d'une perte
  certaine pour TerrOir vers une perte recouvrable contractuellement.
- **Forensique systématique** : 12 nouveaux event types `audit_logs`
  tracent les transitions de niveau, les décisions admin sur incidents,
  les transferts immédiats Niveau 2 et les prélèvements SEPA. Aligne
  l'ADR sur la doctrine ADR-0005.
- **Doctrine claire pour les futurs chantiers Stripe** : tout
  changement de modèle de charge devra ouvrir un ADR superseder. Plus
  d'évolution silencieuse du flow d'argent.

### Négatives assumées

- **Charge admin pour le workflow incidents** : chaque cas pathologique
  nécessite une décision humaine. Pré-Live + premières semaines, volume
  attendu faible (estimation < 5 incidents/semaine). Si le volume
  augmente, ouvrir un chantier d'outillage admin (pré-classification,
  templates de décision, vues par kind d'incident) sans déléguer la
  décision à un automatisme.
- **Risque clawback résiduel pour les producteurs Niveau 2** : même
  avec mandat SEPA B2B, un producteur insolvable au moment du
  prélèvement reste un cas non couvert (TerrOir absorbe la perte
  commerciale + frais procédure de recouvrement classique). Mitigation
  partielle : les critères stricts d'accès Niveau 2 (12 mois ancienneté,
  200 commandes complétées, passage par Niveau 1 préalable) filtrent
  les profils à risque ; le volume de producteurs Niveau 2 reste
  volontairement faible au Live.
- **Complexité du calcul des critères automatiques** : le seuil
  « 0 dispute lost dans les 6 derniers mois », « taux d'incidents
  < 2% » nécessite une RPC dédiée ou un enrichissement de
  `get_producer_dashboard()`. Coût d'implémentation non négligeable.
  Mitigation : pas implémenté Phase 1 ; les calculs sont faits à la
  main par l'admin pendant la Phase 2 jusqu'à ce que le volume justifie
  l'automatisation.
- **Trois niveaux × CGV distinctes (ou sections distinctes)** : la
  charge juridique de rédaction des CGV producteur est significative,
  surtout pour le Niveau 2 (mandat SEPA B2B, barème de prélèvement,
  conditions de rétrogradation). À déléguer à un juriste pour la
  Phase 3.
- **Pas de mécanisme de bascule producteur side-channel** : un
  producteur en désaccord avec une rétrogradation n'a pas de recours
  applicatif. Mitigation : la rétrogradation auto est précédée d'un
  email producteur + 48h délai (à implémenter), suivi de la
  rétrogradation effective. L'admin peut annuler une rétrogradation auto
  manuellement.

### Implications techniques

- **Nouvelle table `pickup_incidents`** (schéma §3) + RLS associées
  (producteur peut INSERT scopé sur ses orders ; consumer peut INSERT
  scopé sur ses orders ; admin peut tout READ/UPDATE).
- **Nouvelle RPC SECDEF `validate_pickup_post_incident`** symétrique à
  `complete_pickup_by_producer` mais déclenchée par l'admin (audit log
  `pickup_admin_validated_post_incident`).
- **Nouvelle page admin `/pickup-incidents`** (pattern ADR-0005 Option
  3 : Server Component + service_role + API route admin pour les
  décisions + audit log).
- **Nouvelles UI producteur et consumer** « Signaler un incident
  retrait » sur le détail commande.
- **Nouvelles colonnes `producers.confiance_*`** (§8) + migration
  enum + index si requêtage par niveau côté vitrine.
- **Nouvelle table de tracking des transitions de niveau** OU
  utilisation des `audit_logs` (`terroir_confiance_certified` /
  `terroir_confiance_revoked` portent metadata `from_level` / `to_level`
  — décision à valider au moment du chantier Phase 2).
- **Nouveau cron `daily-confiance-payout`** (Niveau 1) qui reproduit
  la logique `processWeeklyPayouts` mais sur fenêtre J-1 + filtre
  `confiance_level='confiance'`. À développer en réutilisant le
  helper existant (paramétrer `previousWeekRange()` → fonction
  générique acceptant une fenêtre).
- **Nouveau cron `daily-premium-payout`** (Niveau 2) avec logique
  différente : itère sur les orders payées depuis le dernier run,
  vérifie funds available côté balance plateforme, déclenche
  `stripe.transfers.create()` immédiat. Réessai jusqu'à T+7
  (settlement Stripe).
- **Nouveau handler webhook ou logique inline** dans
  `lib/stripe/handle-payment-succeeded.ts` pour gater le transfer
  immédiat sur `producers.confiance_level = 'premium'`.
- **Intégration mandat SEPA B2B** : choix technique Stripe vs
  GoCardless reporté au chantier Phase 3.
- **Page admin `/admin/confiance`** : voir candidats éligibles aux
  promotions, valider/refuser, voir historique transitions, déclencher
  rétrogradation manuelle.

### Implications légales et CGV

- **CGV consumer article 5.4 à compléter** (aujourd'hui « calendrier
  prévu par Stripe Connect » — audit §9.2, trop vague). Préciser :
  « transfer hebdomadaire le lundi suivant la validation du pickup
  pour les producteurs Standard, fréquence accrue pour les producteurs
  TerrOir Confiance et TerrOir Premium ».
- **CGV consumer politique no-show** : ajouter une section claire sur
  l'engagement consumer au créneau de retrait, l'absence de
  remboursement automatique, et la procédure amiable §4.
- **Rédaction de CGV producteur Standard** : aucune n'existe
  actuellement (audit §9.4). À rédiger pour Phase 1, couvre le modèle
  hebdo + workflow incidents + rétrogradation.
- **CGV producteur Confiance** : ajout d'une section ou avenant
  spécifique au Niveau 1 (Phase 2). Couvre le cron daily + critères
  d'accès + critères de rétrogradation Niveau 1 → 0.
- **CGV producteur Premium** : ajout d'une section ou avenant
  spécifique au Niveau 2 (Phase 3). Couvre le transfer immédiat +
  mandat SEPA B2B + barème de prélèvement en cas d'incident + critères
  de rétrogradation Niveau 2 → 0.
- **Mandat SEPA B2B électronique** : formalisme à arbitrer avec
  juriste (DocuSign, Yousign, Stripe Setup natif ou flow inline
  GoCardless). Probablement signature qualifiée requise pour
  opposabilité.
- **Configurer explicitement le payout schedule Connect → IBAN** :
  aujourd'hui défaut Stripe non documenté côté code (audit §4.1). À
  fixer en Phase 1 (probablement schedule `daily` au minimum pour
  réduire le délai entre transfer plateforme → Connect et payout
  Connect → IBAN).

### Conséquences sur le futur

- **PR future modifiant le modèle de charge Stripe** : doit ouvrir un
  ADR superseder explicite du présent. Pas d'évolution silencieuse.
- **PR future ajoutant un nouveau niveau de confiance** (Niveau 3 ?
  Niveau « pro distributeur » ?) : extension de l'enum
  `producers.confiance_level` + ADR addendum décrivant les critères et
  le mécanisme de paiement associé.
- **PR future modifiant les critères de niveau** : ne supersede pas le
  présent ADR mais documenter dans `docs/CHANGELOG.md` la révision des
  seuils. Si modification structurante (ajout/retrait d'un critère),
  ADR addendum.
- **Si l'arbitrage admin sur `pickup_incidents` devient incompatible
  avec le volume** (estimation > 50 incidents/semaine à terme) : ouvrir
  un chantier d'outillage admin et envisager un sous-ADR sur les
  automatismes acceptables (pré-classification, templates de décision)
  — sans déléguer la décision finale à un automatisme silencieux.

## Plan de migration

### Phase 1 — P0 pré-launch

- Workflow `pickup_incidents` : table + RLS + page admin
  `/pickup-incidents` + UI producteur « Signaler incident retrait » +
  UI consumer « Signaler problème retrait » + nouvelle RPC SECDEF
  `validate_pickup_post_incident`.
- Configurer explicitement le payout schedule Stripe Connect → IBAN
  (probablement daily, à valider).
- Rédiger CGV producteur Standard (couvre modèle hebdo + workflow
  incidents + politique consumer no-show).
- Compléter CGV consumer article 5.4 (calendrier de paiement
  producteur) + section politique no-show.

Critère de sortie : Phase 1 livrée avant ouverture Live. Le programme
TerrOir Confiance n'est pas requis pour le Live.

### Phase 2 — P1 post-launch (~3 mois post-Live)

- Implémenter Niveau 1 (TerrOir Confiance) :
  - Migration `producers.confiance_level` enum + colonnes associées.
  - Cron `daily-confiance-payout` (généralisation du helper
    `processWeeklyPayouts` à une fenêtre paramétrable).
  - RPC dédiée pour calcul automatique des critères d'éligibilité OU
    enrichissement de `get_producer_dashboard()`.
  - Page admin `/admin/confiance` (revue candidats, promotion,
    rétrogradation).
  - Badge « TerrOir Confiance » sur vitrine consumer.
- Rédiger CGV producteur Confiance (avenant ou section dédiée).

Critère de sortie : Phase 2 livrée quand le volume orders justifie
(estimation 3 mois post-Live, à réviser selon traction réelle).

### Phase 3 — P2 post-launch (~6-12 mois post-Live)

- Choix technique mandat SEPA B2B (Stripe vs GoCardless).
- Intégration signature électronique du mandat (DocuSign / Yousign /
  Stripe Setup / inline GoCardless).
- Implémenter Niveau 2 (TerrOir Confiance Premium) :
  - Migration `producers.sepa_b2b_mandate_*` colonnes.
  - Logique transfer immédiat gated sur `confiance_level='premium'`
    dans `handle-payment-succeeded.ts` OU cron dédié
    `daily-premium-payout` avec retry sur funds availability.
  - Mécanique prélèvement SEPA B2B en cas d'incident pickup résolu
    `not_delivered_refunded`.
  - Page `/admin/confiance` étendue au Niveau 2.
  - Mise en avant homepage des producteurs Premium.
- Rédiger CGV producteur Premium (avenant ou section dédiée, inclut
  mandat SEPA + barème de prélèvement).

Critère de sortie : Phase 3 livrée quand au moins 5 producteurs Niveau
1 sont éligibles à la promotion Niveau 2.

## Suivi

Métriques à instrumenter (idéalement via PostHog + tableau de bord
admin) une fois les phases implémentées :

- Taux de `pickup_validated` via code `TRR-XXXXX` nominal vs via
  `pickup_admin_validated_post_incident`.
- Temps moyen de résolution d'un `pickup_incident` (création →
  décision admin).
- Distribution des `kind` d'incidents (`consumer_no_show`,
  `producer_no_show`, `remise_sans_code`, `disagreement`, `other`).
- Taux de refund post-`completed` (orders `refunded` qui avaient atteint
  `completed`) : indicateur du risque clawback résiduel §5.6.
- Distribution des producteurs par `confiance_level` (parc total et
  évolution mensuelle).
- Nombre de promotions et rétrogradations Niveau N → Niveau M par
  mois.
- Taux d'échec des prélèvements SEPA B2B (Niveau 2 uniquement).
- Perte commerciale TerrOir absorbée sur incidents (refund émis sans
  reversal possible ou sans recouvrement SEPA).

Re-évaluation du présent ADR : à 3 mois post-launch (révision Phase 1)
puis à 6 mois post-launch (révision Phase 2 si Niveau 1 implémenté). Si
les métriques révèlent un déséquilibre majeur (volume incidents trop
élevé, perte commerciale > budget, friction promotion Niveau 1 trop
forte), ouvrir un ADR addendum ou superseder.

## Références

- `docs/AUDIT_STRIPE_FLOW.md` (2026-05-13) — audit factuel ayant
  déclenché la rédaction du présent ADR.
- `docs/decisions/0005-pattern-admin-data-access.md` — pattern à
  appliquer pour les nouvelles surfaces admin (`/pickup-incidents`,
  `/admin/confiance`).
- `docs/decisions/0002-declarations-engageantes-snapshot-version.md` —
  doctrine de versioning des déclarations engageantes (applicable à la
  rédaction des CGV producteur Standard / Confiance / Premium).
- `lib/orders/pickup-validation.ts` — implémentation actuelle de la
  validation pickup nominale (à étendre par RPC
  `validate_pickup_post_incident`).
- `lib/stripe/payouts.tsx` — implémentation actuelle du cron weekly,
  à généraliser pour le cron daily Niveau 1.
- `lib/stripe/reverse-transfer.ts` — mécanisme clawback Connect, à
  conserver pour les Niveaux 0 et 1, à étendre pour la mécanique SEPA
  B2B du Niveau 2.
- `CLAUDE.md §3` (workflow git) + `CLAUDE.md §4` (SQL / Supabase) +
  `CLAUDE.md §6` (conventions code) — règles applicables aux chantiers
  Phase 1 à 3.
