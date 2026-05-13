# ADR-0007 — Vente au poids variable

- **Statut** : Proposed
- **Date** : 2026-05-13
- **Décideurs** : Romain Lubin
- **Tags** : payments, stripe, products, pickup

> Stub. Sujet capturé pour ne pas le perdre. Contexte minimal posé,
> options listées sans arbitrage. Réflexion à approfondir dans une
> session dédiée (cf. § Prochaine étape).
>
> Convention `Draft` non admise par le repo (cf. `CLAUDE.md §3` :
> `Proposed | Accepted | Deferred | Rejected | Superseded`) — statut
> `Proposed` retenu en lieu et place.

## Contexte

Certains produits TerrOir sont vendus au poids (viande, fromages,
charcuterie). Le poids définitif n'est connu qu'au moment du
conditionnement par le producteur, après commande et paiement
consumer.

Exemple concret : un consumer commande « 1 colis de bœuf 5 kg
estimé » à 25 €/kg. Au conditionnement, le colis pèse 5,3 kg =
132,50 € au lieu des 125 € payés à la commande.

Aujourd'hui, le modèle de prix TerrOir est ferme à la commande
(`orders.montant_total` figé). Pas de mécanisme d'ajustement
post-commande selon poids réel.

## Décision

À trancher. Voir § Options envisagées pour les pistes.

## Options envisagées (à arbitrer ultérieurement)

### Option A — Prix fixe au colis, fourchette tolérée (±5%)

Le producteur garantit un poids dans une fourchette. Pas d'ajustement
transactionnel. Contraint la découpe producteur.

### Option B — Prix à la commande = acompte, ajustement bidirectionnel au pickup

Second paiement consumer si poids > estimation, refund partiel si
poids < estimation. Implique stockage carte + second charge Stripe
(friction SCA potentielle).

### Option C — Prix à la commande = fourchette haute, refund partiel au pickup

Consumer pré-paye estimation majorée 10%. Au pickup, poids réel saisi,
refund automatique du delta. Préserve le modèle escrow d'ADR-0006,
simplicité technique, protection consumer.

### Option D — Hybride par type de produit

Poids fixe (œufs, légumes standardisés) = prix ferme.
Poids variable (viande, fromages) = Option B ou C.

## Cas particuliers à trancher

- Poids réel > fourchette haute pré-payée : refus livraison ou accord
  exceptionnel consumer ?
- Calcul commission TerrOir : sur caution ou sur montant final ?
- TVA : ajustement si montant final différent du montant caution ?

## Implications techniques pressenties

- Schéma DB : `order_items` à enrichir (`quantity_estimated`,
  `quantity_actual`, `unit_price`, `amount_charged`,
  `amount_due_after_pickup`).
- UX commande consumer : afficher fourchette de caution + simulateur.
- UI producteur : saisie poids réel au conditionnement.
- RPC `complete_pickup_by_producer` : à enrichir avec saisie poids
  réels + calcul montant final + refund partiel automatique.
- CGV consumer : article dédié vente au poids variable.

## Dépendances

- **ADR-0006** (modèle Stripe Connect + validation pickup) : décidé,
  l'option retenue ici doit être compatible avec le pattern escrow
  d'ADR-0006 (transfer hebdo gated sur `pickup_validated`).

## Prochaine étape

Audit factuel du code actuel pour comprendre :

- Comment `order_items` gère le pricing aujourd'hui.
- Si une logique de poids variable est partiellement présente.
- Quelles colonnes existent déjà dans le schéma.

Puis arbitrage entre options A / B / C / D et rédaction complète de
l'ADR (transition `Proposed` → `Accepted` après validation Romain).
