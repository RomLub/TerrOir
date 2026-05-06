# Audit Stripe metadata pre-Live (champs T-200) — 2026-05-06 (T-228)

**Périmètre** : tous les call sites Stripe SDK (`stripe.X.create / update`)
qui transmettent un objet `metadata` à Stripe. Vérification absence des 3
champs T-200 (`mode_elevage`, `alimentation`, `densite_animale`) et des 3
champs probatoires DGCCRF T-241 (`declaration_indicateurs_veracite_at`,
`declaration_indicateurs_snapshot`, `declaration_indicateurs_wording_version`).

**Méthode** : grep `stripe\.\w+\.(create|update)` sur tout le repo, suivi
d'un grep `metadata:` dans les fichiers Stripe SDK identifiés. Les `metadata:`
qui apparaissent dans des appels `notifications.insert`, `logPaymentEvent`,
`sendEmail` (Resend) ou `audit_logs.insert` ne sont PAS des metadata Stripe
(ce sont des colonnes `metadata jsonb` côté tables internes TerrOir).

---

## Inventaire call sites Stripe SDK avec metadata

| Fichier | Ligne | Call site | Metadata |
|---------|-------|-----------|----------|
| `app/api/stripe/create-payment-intent/route.ts` | 191 | `stripe.paymentIntents.create` | `{ order_id, producer_id, consumer_id }` |
| `lib/stripe/customer.ts` | 48 | `stripe.customers.create` | `{ user_id }` |
| `lib/stripe/payouts.tsx` | 252 | `stripe.transfers.create` (path resume) | `{ producer_id, periode_debut, periode_fin }` |
| `lib/stripe/payouts.tsx` | 346 | `stripe.transfers.create` (path nominal) | `{ producer_id, periode_debut, periode_fin }` |

## Inventaire call sites Stripe SDK SANS metadata

| Fichier | Ligne | Call site | Verdict |
|---------|-------|-----------|---------|
| `app/api/stripe/connect/onboard/route.ts` | 83 | `stripe.accounts.create` | pas de metadata posé |
| `app/api/stripe/connect/onboard/route.ts` | 125 | `stripe.accountLinks.create` | pas de metadata possible |
| `app/(consumer)/compte/paiements/actions.ts` | 64 | `stripe.setupIntents.create` | pas de metadata posé |
| `app/(consumer)/compte/paiements/actions.ts` | 162 | `stripe.customers.update` | `invoice_settings` only |
| `app/(consumer)/compte/paiements/actions.ts` | 223 | `stripe.customers.update` | `invoice_settings` only |
| `lib/stripe/handle-early-fraud-warning.tsx` | 160 | `stripe.refunds.create` | pas de metadata |
| `lib/stripe/handle-payment-succeeded.ts` | 216 | `stripe.refunds.create` | pas de metadata |
| `app/api/stripe/refund/route.tsx` | * | `stripe.refunds.create` | pas de metadata |

---

## Verdict par call site

### `paymentIntents.create` ✓ conforme
```ts
metadata: {
  order_id: order.id,           // identifiant interne TerrOir
  producer_id: order.producer_id, // identifiant interne TerrOir
  consumer_id: order.consumer_id ?? "", // identifiant interne TerrOir
}
```
Aucun champ T-200, aucun champ probatoire DGCCRF, aucune donnée allégation.

### `customers.create` ✓ conforme
```ts
metadata: { user_id: userId } // identifiant interne TerrOir
```
Aucun champ T-200.

### `transfers.create` ✓ conforme (2 call sites, même metadata)
```ts
const transferMetadata = {
  producer_id: producerId,    // identifiant interne TerrOir
  periode_debut: periodeDebut, // métadonnée comptable (date)
  periode_fin: periodeFin,     // métadonnée comptable (date)
};
```
Aucun champ T-200, aucun champ probatoire DGCCRF. Les périodes comptables
sont des métadonnées fonctionnelles légitimes pour un transfer Connect
(rapprochement comptable côté Stripe Dashboard producteur).

---

## Conclusion

**Aucune fuite détectée**. Les 4 call sites Stripe SDK avec metadata
respectent déjà la doctrine "minimisation données + identifiants internes
uniquement".

**Décision** : pas de fix code nécessaire. Ajout d'un **test contractuel
défensif** (vitest) sur le call site le plus critique
(`paymentIntents.create`) pour verrouiller la régression future.

Test ajouté : `tests/app/api/stripe/create-payment-intent/route.test.ts`
section `C''. T-228 — metadata Stripe : allowlist stricte`. Trois assertions :
1. `metadata = { order_id, producer_id, consumer_id }` exactement (allowlist
   stricte).
2. Aucun champ T-200 (`mode_elevage` / `alimentation` / `densite_animale`).
3. Aucun champ probatoire DGCCRF (`declaration_indicateurs_*`).

Une régression future qui ajouterait par mégarde un de ces champs au
metadata du PaymentIntent fera échouer le test au CI.

---

## Doctrine formalisée

> **Stripe metadata = identifiants internes TerrOir + données fonctionnelles
> strictement nécessaires uniquement.**
>
> - Identifiants : `order_id`, `producer_id`, `consumer_id`, `user_id`,
>   `payment_intent_id`, `refund_id`, etc.
> - Données fonctionnelles légitimes : `periode_debut`, `periode_fin`
>   (rapprochement comptable transfers), `customer_id` (link payment method).
> - **JAMAIS** : allégations producteur (`mode_elevage`, `alimentation`,
>   `densite_animale`), données probatoires DGCCRF (`declaration_indicateurs_*`),
>   adresse complète, téléphone, IBAN, SIRET en clair, badges, scores
>   internes, état d'abonnement, photos, descriptifs marketing.
>
> Pourquoi : minimisation données chez sous-traitant (RGPD), séparation des
> responsabilités (Stripe = paiement, TerrOir = catalogue + allégations),
> valeur probatoire DGCCRF préservée côté TerrOir (pas chez Stripe qui
> n'est pas un point de référence légal).

---

## Backlog

- À chaque ajout de colonne business sur `producers` ou ailleurs (cf.
  doctrine T-218 cas A backlog T-235), **arbitrer** son inclusion ou non
  dans les metadata Stripe. Par défaut : NON.
- Étendre le test contractuel à `customers.create` et `transfers.create`
  si une dérive est observée (pour l'instant, le test sur `paymentIntents`
  couvre le call site le plus exposé en termes de fréquence et de
  proximité à l'utilisateur).
- Aligné avec doctrine T-218 RLS producers : doctrine "ceinture +
  bretelles" — backlog `T-235` pour la vue `producers_public` projetée.
