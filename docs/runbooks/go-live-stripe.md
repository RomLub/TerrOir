# Runbook — bascule Stripe test → live

> **Statut : WIP — phase B à compléter** (3DS exhaustif, RGS payouts, communication producteurs).
>
> Dernière mise à jour : 2026-05-05 (fix audit Stripe phase A — finding M-5 + L-5 + L-2 + M-6).
> Ce runbook prépare la bascule du compte Stripe test (`acct_1TNw9nGuakpserKp`) vers le compte live définitif au go-live TerrOir (~juillet 2026).

## Pré-requis bouclés

- ✅ Audit Stripe phase A (`docs/audits/audit-stripe-2026-05-05.md`) lu.
- ✅ Phase 1 fixes audit Stripe : `docs/fixes/fix-stripe-phase-1-2026-05-05.md` (idempotency revival, cron disputes deadline, guard charges_enabled, business_type prompt natif, refund producer audit, runbook draft).
- ⏳ Phase 2 fixes audit Stripe : H-2 Connect v2, M-1 dynamic payment methods, M-3 webhook events utiles. **À faire avant go-live.**
- ⏳ Phase 3 fixes audit Stripe : H-1 + H-3 upgrade SDK + apiVersion. **Impératif avant go-live** (cumuler bug version + bug env live = double périmètre debug en prod).
- ⏳ Audit conformité (phase B) : PCI DSS, 3DS testing exhaustif, RGS payouts. À ouvrir en parallèle du dev V1.x.

---

## Étape 0 — Préparer le compte Stripe live

> Avant la bascule technique. À faire 1-2 semaines avant cutover.

1. **Créer le compte Stripe live** depuis Dashboard (https://dashboard.stripe.com → Activate account). KYC plateforme : SIRET TerrOir, RIB, justificatif d'activité (marketplace circuit court). Délai de validation Stripe : 1-3 jours ouvrés.
2. **Configurer l'API version live** sur `2026-04-22.dahlia` (alignée sur la version pinned dans `lib/stripe/server.ts:10` après Phase 3). Workbench → Overview → API versions → Upgrade.
3. **Configurer les Connect settings live** : branding plateforme (logo, couleurs, ToS link). Si décision V1.x = migration v2, créer aussi les controller properties.
4. **Activer dynamic payment methods** côté Dashboard (référé par audit M-1 — phase 2). Pré-configurer Apple Pay, Google Pay, SEPA si Phase 2 lifted.
5. **Apple Pay domain verification** (audit L-3, phase 2) : déposer le fichier `.well-known/apple-developer-merchantid-domain-association` sur `terroir-local.fr` puis cliquer "Verify" dans Dashboard Stripe.

---

## Étape 1 — Créer les nouveaux secrets Stripe live dans Vercel

> Vars à ajouter en `Production` (laisser les `sk_test_*` en `Preview` + `Development` pour conserver les staging branches). À faire le jour J avant la bascule code.

| Variable | Valeur | Environment |
|---|---|---|
| `STRIPE_SECRET_KEY` | `sk_live_***` (Restricted Key avec scopes minimum : Charges write, Refunds write, Customers write, Connect write, Webhooks read) | Production only |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | `pk_live_***` | Production only |
| `STRIPE_WEBHOOK_SECRET` | `whsec_***` (généré à l'étape 2) | Production only |
| `STRIPE_CONNECT_CLIENT_ID` | `ca_***` live (si OAuth Connect, sinon non applicable pour Express) | Production only |

> ⚠️ Ne PAS écraser les `sk_test_*` côté Preview. Les déploiements de feature branches doivent continuer de pointer sur le compte test.

---

## Étape 2 — Créer le webhook endpoint live côté Stripe Dashboard

> Stripe live a un endpoint distinct du test. URL = `https://www.terroir-local.fr/api/stripe/webhook`.

1. Dashboard Stripe (live) → Developers → Webhooks → Add endpoint.
2. URL : `https://www.terroir-local.fr/api/stripe/webhook`.
3. Events à activer : **réplique stricte du test**, c.-à-d. la liste de la `DEDUP_TARGETS` du switch dans `app/api/stripe/webhook/route.tsx` :
   - `payment_intent.succeeded`
   - `payment_intent.payment_failed`
   - `account.updated`
   - `payout.paid`
   - `payout.failed`
   - `charge.dispute.created`
   - `charge.dispute.updated`
   - `charge.dispute.closed`
   - **Si phase 2 M-3 fixée** : ajouter `radar.early_fraud_warning.created` + `charge.refunded` (+ `account.application.deauthorized` selon arbitrage).
4. Récupérer le **signing secret** (`whsec_***`) → poser dans Vercel `STRIPE_WEBHOOK_SECRET` (cf. étape 1).
5. **Désactiver l'endpoint test** au moment du cutover (ou le laisser actif si la prod test continue d'exister pour staging).

---

## Étape 3 — Purge des IDs Stripe en DB (stratégie test→live drift)

> Décision audit M-5 : **Option 1 retenue** (purge one-shot). Plus simple que le tracking `stripe_env` colonne (Option 2) et préférable à un cutover hard (Option 3, qui suppose 0 user existant — non vrai au go-live ~juillet).

### SQL exact à exécuter au cutover

```sql
-- Étape 3.a — Purger les customer IDs test
UPDATE public.users
SET stripe_customer_id = NULL
WHERE stripe_customer_id IS NOT NULL;

-- Étape 3.b — Purger les producer Connect IDs + flags
UPDATE public.producers
SET stripe_account_id = NULL,
    stripe_charges_enabled = false,
    stripe_payouts_enabled = false,
    stripe_details_submitted = false
WHERE stripe_account_id IS NOT NULL;
```

### Ordre d'exécution

1. Bascule clés env Vercel test → live (étape 1, redéploiement Production).
2. Webhook endpoint live activé (étape 2).
3. **PURGE SQL ci-dessus** via Supabase SQL editor (production projet).
4. (Avant tout premier checkout / onboarding live) communication producteurs (étape 5).

> ⚠️ **Ne pas exécuter la purge AVANT la bascule Vercel.** Si la purge tourne pendant que des users continuent de checkout sur le compte test, on risque de recréer des `stripe_customer_id` test dans la fenêtre. La séquence : env first, webhook second, SQL third.

### Impact UX

- **Producteurs** : doivent re-onboard Connect (5min chacun via `/api/stripe/connect/onboard`). Ils repartent KYC live (pas un re-KYC complet — Stripe peut réutiliser le KYC test si même SIRET, mais doivent re-cliquer le accountLink). **Communication explicite requise** (étape 5).
- **Consumers** : ne voient rien. Le `stripe_customer_id` est recréé silencieusement au prochain checkout via `getOrCreateStripeCustomer()` (`lib/stripe/customer.ts`). Les CB sauvegardées Stripe test ne migrent PAS vers live (impossible techniquement) — mais le flow `setup_future_usage` ressavera la nouvelle CB au 1er paiement live.
- **Pending orders au moment de la purge** : à éviter. Si possible, faire la purge à un moment de très faible activité (3h du matin un dimanche). Le cron `order-timeout` daily (9h UTC) attrape les pending qui ont raté la fenêtre cutover dans les 24-48h suivantes.

---

## Étape 4 — Vérification post-cutover

> Smoke tests à exécuter dans l'ordre, juste après la purge SQL.

1. **Stripe live ping** : ouvrir Dashboard Stripe live, vérifier que `livemode: true` partout. Spot-check Customers list = vide (purge OK).
2. **Webhook live** : Dashboard → Webhooks → l'endpoint live → "Send test webhook" sur `payment_intent.succeeded` → vérifier que la requête arrive en 200 sur Vercel logs `[STRIPE_WEBHOOK]` (pas de `[STRIPE_WEBHOOK_INVALID_SIGNATURE]`).
3. **Connect onboard** : créer un compte producer test interne (via UI `/inscription-producteur` → onboarding Connect). Vérifier que `stripe.accounts.create()` renvoie un `acct_*` live (commence pas par `acct_1TN`...). Le compte producer reste KYC `restricted` jusqu'à ce que les docs business_type soient fournis (Stripe demande natif depuis fix L-2).
4. **Checkout E2E** : 1 commande consumer = 1€ avec test card `4242 4242 4242 4242` en mode live (la CB sera *réelement débitée*). Refund immédiat via `/api/stripe/refund` (admin route) pour ne pas garder le 1€. Vérifier :
   - PaymentIntent live créé (préfixe `pi_3...` avec live indicator dans Dashboard).
   - Webhook `payment_intent.succeeded` reçu.
   - DB : order créée + `stripe_customer_id` posé sur le user + audit_log `order_payment_succeeded`.
   - Refund émis + audit_log `order_admin_refund_succeeded` (event ajouté Phase 1 fix L-5).
5. **Cron disputes-deadline-check** : déclencher manuellement (`curl -H "Authorization: Bearer $CRON_SECRET" https://www.terroir-local.fr/api/cron/disputes-deadline-check`) → doit renvoyer `{processed:0,items:[]}` (no disputes ouvertes en live à J-0).
6. **Balance Stripe live** : Dashboard → Balance = 0 EUR available (cohérent : refund immédiat du smoke test). Compare au compte test (où on a `-571 cents` après les test cycles refund — laissé en l'état, pas migré).

> Si **n'importe quelle étape ci-dessus échoue**, déclencher rollback (étape 6).

---

## Étape 5 — Communication producteurs

> À envoyer juste après la purge SQL, avant que les producers ne tentent un checkout.

**Template email** (à finaliser phase B — copy à valider Romain) :

> Sujet : [Action requise] Reconnectez votre compte Stripe pour TerrOir
>
> Bonjour [prenom],
>
> Bonne nouvelle : TerrOir vient de basculer en mode production. Vous pouvez désormais recevoir de vrais paiements de vos clients.
>
> **Action requise** : reconnectez votre compte Stripe (5 minutes) pour pouvoir continuer à recevoir vos virements hebdomadaires.
>
> [Bouton : Reconnecter mon compte Stripe → URL = `/connect/refresh`]
>
> Sans cette action, vos commandes futures ne pourront pas vous être payées.
>
> Si vous aviez déjà fourni vos justificatifs business à Stripe, ce flow sera très court (Stripe réutilise le KYC). Sinon, prévoyez carte d'identité + RIB.
>
> Cordialement, l'équipe TerrOir.

**Channels** :
- Email transactionnel (Resend, template à créer phase B).
- SMS Twilio si le producer a `sms_optin=true` (template à créer phase B).
- Bannière in-app sur `/dashboard` côté producer tant que `stripe_charges_enabled=false`.

---

## Étape 6 — Rollback (procédure d'urgence J-0)

> Si bug critique pendant les premières 24h post-cutover (smoke test foireux, payment loop fail, webhook signature fail répété, dispute en cascade…).

1. **Vercel** : revert les 4 vars env `STRIPE_*` à `sk_test_*` / `pk_test_*` / `whsec_test_*`. Redeploy Production.
2. **Webhook Stripe live** : disable l'endpoint dans Dashboard live (pas delete — pour réactiver vite après fix).
3. **DB** : pas de rollback automatique de la purge. Les producteurs qui ont déjà re-onboard live ont des `stripe_account_id` live invalides en mode test. Acceptable temporairement (les checkouts vont fail clean sur 409 `producer_not_ready` grâce au guard M-6 phase 1 — le consumer sera bloqué, pas charged).
4. **Communication** : email d'excuse aux producteurs concernés + ETA de rebascule.
5. **Post-mortem** : ouvrir un audit_log forensique custom + Linear ticket avec les Vercel logs `[STRIPE_*]` filtrés sur la fenêtre du cutover.

> **Le rollback doit être décidé dans les 24h** sinon l'argent reçu en live commence à se settle (T+2 sur Stripe, irréversible côté plateforme). Au-delà de 24h, on fix forward (pas rollback).

---

## Items à compléter pendant phase B

> À l'inverse des items phase 1/2/3 (qui DOIVENT être bouclés avant go-live), les items ci-dessous peuvent être traités après le 1er mois live, sur la base des observations réelles.

- **Conformité PCI DSS** : self-assessment SAQ A (le plus simple, applicable si TerrOir n'héberge jamais de PAN) à valider avec un consultant.
- **3DS testing exhaustif** : SCA réglementation EU 2025 = 3DS obligatoire ≥30€. Tester les 4 paths Stripe (`requires_action`, `requires_payment_method`, fallback OTP, fallback challenge) via test cards live `4000 0027 6000 3184` (challenge) et `4000 0082 6000 3178` (OOB).
- **RGS payouts** : Stripe Connect Express verse en T+7 par défaut (configurable T+2). Pour les producers, T+7 risque de générer du support "où est mon argent" — arbitrer si on bumpe à T+2 (cashflow plateforme moins bon mais UX producer mieux).
- **L-1 IP allowlist webhook Stripe** : defense-in-depth via Vercel Edge Middleware ou Cloudflare WAF (audit phase A backlog).
- **L-3 Apple Pay domain verification** : couplé Phase 2 M-1 dynamic payment methods.
- **Cron dispute deadline check** : observation réelle des thresholds 24h / 72h. Si les disputes arrivent toutes le matin (déjà observé sur volumes test), aligner le cron à 6h UTC pour laisser plus de marge admin.

---

## Liens

- Audit phase A : [`docs/audits/audit-stripe-2026-05-05.md`](../audits/audit-stripe-2026-05-05.md)
- Fix phase 1 : [`docs/fixes/fix-stripe-phase-1-2026-05-05.md`](../fixes/fix-stripe-phase-1-2026-05-05.md)
- Conventions idempotency : [`docs/conventions/stripe-idempotency.md`](../conventions/stripe-idempotency.md)
- Audit RPC/Edge (recoupement) : [`docs/audits/audit-rpc-edge-2026-05-05.md`](../audits/audit-rpc-edge-2026-05-05.md)
- Stripe doc — going live : https://docs.stripe.com/test-mode
- Stripe doc — Connect production : https://docs.stripe.com/connect/going-live
