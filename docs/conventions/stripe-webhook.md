# Stripe — webhook endpoint (sécurité, IP allowlist, signature)

> Document fixé par l'audit Stripe phase B (2026-05-05) finding L-1 — IP allowlist en défense en profondeur derrière la signature HMAC.

## Stack défense actuelle

Le endpoint `POST /api/stripe/webhook` empile 3 lignes de défense, dans cet ordre :

1. **IP allowlist** (`lib/stripe/ip-allowlist.ts`) — en production uniquement, 403 si l'IP cliente n'est pas dans la liste officielle Stripe. Coupe le bruit AVANT d'évaluer le HMAC.
2. **Signature HMAC** (`stripe.webhooks.constructEvent`) — vérifie que le body est signé avec `STRIPE_WEBHOOK_SECRET`. C'est la défense principale ; un attaquant qui aurait fuité le secret bypass la signature, mais il devrait aussi spoof l'IP source pour passer.
3. **Dédup applicative** (`webhook_events_processed`) — INSERT exclusif sur PK `event_id`, court-circuite les rejouages Stripe (auto-retry 5xx, replay manuel Dashboard) AVANT d'exécuter les effets de bord (UPDATE DB, emails, SMS).

Chaque couche est indépendante : si l'une saute (ex. fuite secret), les autres tiennent.

## IP allowlist — comportement par environnement

| Environnement       | `process.env.VERCEL_ENV` | Comportement                                                  |
|---------------------|--------------------------|---------------------------------------------------------------|
| Production Vercel   | `"production"`           | Enforce stricte — 403 si IP ∉ STRIPE_WEBHOOK_IPS              |
| Preview Vercel      | `"preview"`              | Bypass — return 200 sans vérifier IP (tests PR)               |
| Development Vercel  | `"development"`          | Bypass — facilite `stripe listen --forward-to`                |
| Local `next dev`    | `undefined`              | Bypass — facilite tests locaux (vitest, manuel)               |

La gate prod-only est intentionnelle :
- En **prod** on veut couper les scans/floods.
- En **preview/dev** on accepte du trafic non-Stripe (rejouages locaux, fixtures, vitest avec headers vides).

## Liste source — comment la mettre à jour

Stripe documente officiellement la liste à : https://docs.stripe.com/ips (section "Webhook notifications"). Format brut machine-readable :
- https://stripe.com/files/ips/ips_webhooks.txt (one per line)
- https://stripe.com/files/ips/ips_webhooks.json

À l'audit phase B (2026-05-05) la liste contient **15 IPv4 individuelles**, aucune CIDR ni IPv6. Si Stripe ajoute des entrées :

1. Récupérer la liste à jour : `curl https://stripe.com/files/ips/ips_webhooks.txt`
2. Comparer avec `STRIPE_WEBHOOK_IPS` dans `lib/stripe/ip-allowlist.ts`.
3. Mettre à jour la constante (ajouter / retirer les IPs concernées).
4. Bumper le `expect(STRIPE_WEBHOOK_IPS.size).toBe(15)` dans `tests/lib/stripe/ip-allowlist.test.ts` au nouveau count.
5. Commit séparé avec en-tête `chore(stripe): refresh webhook IP allowlist` + lien vers le diff Stripe.

**Cadence de check recommandée** : trimestrielle (cron manuel ou ticket récurrent). Stripe communique rarement les changements en avance — un IP retiré peut générer du 403 pendant 1-2 jours si la sync est en retard.

**Fail-mode si désync** : Stripe retry les webhooks 5xx pendant 3 jours. Si une nouvelle IP n'est pas encore dans la liste, on perd 0 event après refresh manuel (Stripe rejoue les events qui ont reçu 403 ? **Non — 403 est un client error, Stripe ne retry que sur 5xx**). Donc en cas d'IP manquante, les events sont **perdus définitivement** pendant la fenêtre de désync. Conséquence : il vaut mieux pécher par excès et ajouter une IP douteuse plutôt que la rejeter.

**Alternative envisagée (rejetée) — fetch dynamique** : appeler `https://stripe.com/files/ips/ips_webhooks.txt` au démarrage de l'app et cacher le résultat. Avantage : auto-refresh. Inconvénient : dépendance HTTP au démarrage, risque d'init bloqué si stripe.com répond mal, surface d'attaque (MITM Stripe IP list = bypass total). Décision : **liste hardcodée + check trimestriel**.

## Signature webhook

Géré par `stripe.webhooks.constructEvent(rawBody, signature, secret)`. Le `STRIPE_WEBHOOK_SECRET` doit être différent en test et en prod (Dashboard Stripe émet 2 secrets distincts). Cf. `docs/runbooks/go-live-stripe.md` pour la procédure de cutover test→live.

## Dédup applicative

Cf. `lib/webhook-events/check-or-mark-processed.ts` + migration `20260429000000_*`. La liste `DEDUP_TARGETS` dans `app/api/stripe/webhook/route.tsx` filtre les events ayant des effets de bord persistés — les events `customer.created` (et autres redondants pour TerrOir) ne polluent pas la table.

## Liens

- [Stripe IP addresses](https://docs.stripe.com/ips)
- [Webhook signature verification](https://docs.stripe.com/webhooks/signature)
- [Stripe webhook retry policy](https://docs.stripe.com/webhooks#retries) — Stripe retry les 5xx pendant 3 jours, pas les 4xx.
- Audit Stripe phase A (2026-05-05) §L-1 — constat manque IP allowlist.
- Audit Stripe phase B (2026-05-05) — fix L-1 implémenté.
- `docs/conventions/stripe-idempotency.md` — autre couche de défense côté API Stripe.
