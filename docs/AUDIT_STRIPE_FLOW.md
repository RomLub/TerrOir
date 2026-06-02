# Audit parcours Stripe — 2026-06-01

## Verdict

Le parcours Stripe nominal est cohérent avec la décision ADR-0006 :
TerrOir conserve le modèle **Separate Charges & Transfers**.

Concrètement :

1. Le client paie sur le compte plateforme TerrOir via un PaymentIntent Stripe.
2. La commande passe à `confirmed` quand le webhook `payment_intent.succeeded` est reçu.
3. Le producteur valide le retrait avec le code client `TRR-*`.
4. La commande passe à `completed`.
5. Le virement net producteur est déclenché par le cron hebdomadaire `weekly-payout`.

Le producteur n'est donc pas payé avant retrait validé dans le parcours standard.
Le paiement est conservé côté plateforme jusqu'à la validation du retrait.

## Sources vérifiées

- `app/api/stripe/create-payment-intent/route.ts`
- `app/api/stripe/webhook/route.tsx`
- `lib/stripe/handle-payment-succeeded.ts`
- `lib/orders/pickup-validation.ts`
- `app/api/orders/[id]/complete/route.tsx`
- `app/api/producer/orders/validate-pickup/route.ts`
- `lib/stripe/payouts.tsx`
- `lib/refunds/execute-refund.ts`
- `lib/stripe/reverse-transfer.ts`
- `docs/decisions/0006-stripe-flow-pickup-validation.md`
- `docs/decisions/0015-separation-code-preuve-vs-numero-commande.md`

## État du parcours

### Paiement client

`/api/stripe/create-payment-intent` crée un PaymentIntent en EUR sur le compte plateforme.
Aucun `transfer_data.destination`, aucun `application_fee_amount`, aucun `on_behalf_of` n'est utilisé sur le PaymentIntent.

Le code applique les protections attendues :

- authentification client ;
- propriété de la commande ;
- commande encore `pending` ;
- producteur prêt à encaisser (`stripe_charges_enabled`) ;
- création idempotente du PaymentIntent via `pi_create_${order.id}` ;
- protection contre les doubles clics et les requêtes parallèles.

### Webhook Stripe

`/api/stripe/webhook` vérifie la signature Stripe, journalise les IP inconnues, limite les abus, puis déduplique les événements persistants via `webhook_events_processed`.

Les événements critiques sont couverts :

- `payment_intent.succeeded`
- `payment_intent.payment_failed`
- `account.updated`
- `payout.paid`
- `payout.failed`
- `charge.dispute.*`
- `radar.early_fraud_warning.created`
- `charge.refunded`
- `account.application.deauthorized`

### Validation retrait

La preuve de remise est le code `TRR-*` présenté par le client.
La RPC `complete_pickup_by_producer` pose `statut='completed'` et l'audit log `pickup_validated` dans la même transaction.

Correction appliquée pendant cet audit :

- le code acceptait seulement `TRR-XXXXX` ;
- la base génère maintenant aussi des codes `TRR-XXXXXXX` ;
- `lib/orders/pickup-validation.ts` accepte désormais les deux formats ;
- une migration resserre la contrainte DB pour refuser la longueur 6, qui était autorisée par erreur ;
- les messages producteur et les tests ont été alignés.

### Virement producteur

`lib/stripe/payouts.tsx` agrège les commandes `completed` de la semaine précédente, crée une ligne `payouts` en `processing`, puis déclenche `stripe.transfers.create`.

Le parcours protège contre les doubles virements :

- création DB avant appel Stripe ;
- clé Stripe stable `transfer_${producerId}_${periodeDebut}` ;
- reprise des lignes `processing` sans recréer un virement ;
- refus de reprendre automatiquement les lignes `failed`.

### Remboursements et litiges

`executeRefundFlow` tente d'abord de récupérer le virement producteur si un `transfer_id` existe, puis émet le remboursement Stripe.

`reverseTransferIfNeeded` est volontairement fail-safe : un échec de récupération côté compte Connect ne bloque pas le remboursement client, mais il est tracé.

## Corrections appliquées pendant finalisation

1. Acceptation des codes de retrait 5 ou 7 caractères.
2. Ajout de la migration `20260601133000_fix_order_code_format_check.sql`.
3. Mise à jour des textes producteur autour du format de code.
4. Mise à jour de l'ADR-0015 et du registre RGPD sur le format réel du code.
5. Correction de textes publics qui laissaient entendre que le producteur recevait l'argent immédiatement.
6. Recréation du rapport d'audit manquant référencé par ADR-0006.

## Points de vigilance

### Wording public

Le wording public doit rester aligné sur le flux réel :

- dire que les paiements **transitent par Stripe** ;
- dire que le producteur est payé **après retrait validé** ;
- éviter "le producteur reçoit directement son argent" pour le parcours standard.

### Incidents de retrait

Le parcours standard couvre le cas nominal : retrait validé par code.
Les cas non nominaux (client absent, producteur absent, remise sans code, désaccord) sont cadrés par ADR-0006 comme workflow d'arbitrage admin distinct.

Tant que ce workflow n'est pas livré, ces cas se traitent par support manuel hors outil dédié. Ce n'est pas une faille Stripe : c'est une surface produit d'arbitrage.

### Passage Live Stripe

Le runbook `docs/runbooks/go-live-stripe.md` reste la référence pour la bascule test vers live.
Les actions Stripe UI-only restent dans `docs/post-launch-checklist.md` avec condition de déblocage explicite.
