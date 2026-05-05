# Audit Email & Deliverability — 2026-05-05

**Source live (DNS prod)** : résolution publique via `nslookup` sur `8.8.8.8` (Google Public DNS) du 2026-05-05.
**Source repo** : `lib/resend/**` (1 client + 1 sender + 1 layout + 22 templates), `lib/rgpd/**` (2 modules), `app/(public)/desabonnement/**`, `app/api/stock-alerts/{confirm,unsubscribe}/**`, callers `sendTemplate` (54 fichiers grep, dont ~16 routes/handlers réels).
**Référence skill** : `email-best-practices` (Resend, installé 2026-05-05).
**Périmètre** :
- Configuration DNS d'authentification (SPF, DKIM, DMARC) sur `terroir-local.fr` apex + sous-domaines.
- Stack `Resend` (sortant) : client, helper `sendTemplate`, idempotence, retry, headers.
- Templates React Email (anti-spam, mobile, dark mode, list-unsubscribe).
- Flows opt-in / opt-out / suppression / bounces / complaints.
- Webhook Resend entrant (event ingestion, suppression list).
- Conformité RGPD (consent, retention, masking PII).

> Cet audit cross-référence l'**audit RPC/Edge du même jour** (`audit-rpc-edge-2026-05-05.md`) — finding L-4 « Pas de webhook Resend entrant » re-priorisé en HIGH ici (H-3) avec contexte délivrabilité, pas redoublé.
>
> Lecture seule, aucune modification appliquée. Liste pour arbitrage.

---

## Synthèse priorisée

| Sévérité | Compte | Type d'enjeu                                                                                                                                                  |
|----------|:------:|---------------------------------------------------------------------------------------------------------------------------------------------------------------|
| CRITICAL |   0    | DNS auth en place (SPF, DKIM, DMARC publiés) — historique greylisting/alignement résolu. Aucune panne immédiate de délivrabilité détectée.                  |
| HIGH     |   4    | Apex partagé OVH ↔ Resend sans subdomain isolant ; pas de `List-Unsubscribe` header (Gmail/Yahoo bulk); pas de webhook Resend (rappel L-4 RPC); From `no-reply@` sans Reply-To monitored |
| MEDIUM   |   7    | DMARC `p=none` permanent + pas de `rua` ; DKIM record sans préfixe `v=DKIM1; k=rsa;` ; pas d'`Idempotency-Key` Resend ; pas de retry/backoff `sendTemplate` ; pas de suppression list ; pas de séparation marketing/transactional ; SPF orphelin sur `send.terroir-local.fr` |
| LOW      |   6    | Pas de version texte multipart ; pas de cron purge `notifications` ; aucun feedback loop Postmaster/SNDS ; opt-in transactional implicit (Auth-driven) ; logo image hébergée si app down ; subjects admin avec `URGENT`/`⚠️`         |

---

## Verdict opérationnel (5 points clés)

1. **Pas de risque de délivrabilité immédiat** : SPF (`v=spf1 include:mx.ovh.com include:amazonses.com ~all`), DKIM (`resend._domainkey.terroir-local.fr`) et DMARC (`v=DMARC1; p=none; adkim=r; aspf=r`) sont publiés et alignés relâché — la règle Gmail/Yahoo Feb 2024 (auth obligatoire) est satisfaite. Le greylisting historique est résolu. **Pas d'action urgente avant go-live**.

2. **Le risque structurel le plus tangible est l'absence de webhook Resend entrant** (rappel audit RPC §L-4, re-priorisé en HIGH ici). `notifications.statut='sent'` reflète uniquement le 200 du POST Resend — pas de visibilité sur `email.bounced`, `email.complained`, `email.delivery_delayed`. Sans suppression list dérivée, on continuera à pousser vers des adresses mortes → dégradation lente de la réputation. À chiffrer par Phase 8.

3. **L'apex `terroir-local.fr` mutualise OVH Zimbra (inbound MX) + Resend (outbound transactional)**. DMARC alignment est volontairement relâché (`adkim=r aspf=r`) pour cohabiter. C'est défendable en V1, mais empêche de durcir DMARC vers `p=quarantine`/`p=reject` plus tard sans casser un flux. Migration future vers `mail.terroir-local.fr` (transactionnel dédié) est l'investissement reputation le plus rentable. Un SPF orphelin existe déjà sur `send.terroir-local.fr` (sans DKIM ni MX) — résidu de configuration à finaliser ou nettoyer.

4. **Aucun `List-Unsubscribe` header sur les emails sortants**. Gmail/Yahoo l'exigent pour les bulk senders (>5k/jour). Volume actuel TerrOir vraisemblablement <100/jour → pas critique en valeur. Mais 3 templates qualifient de bulk-like : `producer-invitation`, `review-request` (dayOffset 0/2/7), `stock-alert-back-in-stock`. Risque dossier spam quand le volume monte (Phase 8 — vision funnel).

5. **From `no-reply@terroir-local.fr` sans Reply-To**. Skill best-practice : « Avoid `noreply@` — users reply to transactional emails ». Quand un consumer répond pour signaler un problème commande, sa réponse part dans la boîte `no-reply@` d'OVH Zimbra — non monitorée par convention (footer dit « ne pas y répondre »). Risque support fantôme. Fix simple : ajouter `replyTo: SUPPORT_EMAIL` dans `sendTemplate`.

---

# CRITICAL

Aucun finding CRITICAL détecté. La stack d'authentification email (SPF + DKIM + DMARC) est opérationnelle, la configuration DNS publique répond, et les flows transactionnels (commande, OTP, dispute) ne présentent pas de défaut bloquant à l'envoi.

---

# HIGH

## H-1 — Apex `terroir-local.fr` partagé OVH Zimbra (inbound) + Resend (outbound), sans subdomain isolant

**Preuve DNS (apex)** :

```
$ nslookup -type=TXT terroir-local.fr
"v=spf1 include:mx.ovh.com include:amazonses.com ~all"

$ nslookup -type=MX terroir-local.fr
1   mx0.mail.ovh.net
5   mx1.mail.ovh.net
50  mx2.mail.ovh.net
100 mx3.mail.ovh.net

$ nslookup -type=TXT _dmarc.terroir-local.fr
"v=DMARC1; p=none; adkim=r; aspf=r"
```

**Preuve config app** : `lib/resend/client.ts:9` lit `RESEND_FROM_EMAIL` depuis l'env. `.env.example:39` :

```
RESEND_FROM_EMAIL=no-reply@terroir-local.fr
```

→ envoi Resend depuis l'apex, MX apex pointe vers OVH Zimbra. DMARC `adkim=r aspf=r` est en alignment relâché précisément pour autoriser cette cohabitation (sans relaxed, l'alignement DKIM strict ne couvrirait que la signature `d=resend.dev` et l'envoi Resend casserait DMARC).

**Pourquoi c'est HIGH** :
- **Réputation couplée** : tout incident côté OVH Zimbra (un compte support compromis qui spam) impacte l'IP/domain reputation Resend, et inversement. Skill `deliverability.md` recommande explicitement : *« Use different subdomains for different sending purposes (e.g., `t.example.com` for transactional emails and `m.example.com` for marketing emails) »*.
- **Verrou DMARC** : on ne peut pas durcir DMARC à `p=quarantine` ou `p=reject` sans risquer de casser un flux mal-aligné côté apex (typiquement, un email envoyé depuis un poste OVH Zimbra qui ne signe pas DKIM correctement).
- **Confusion users** : un email de TerrOir et un email d'un humain TerrOir partent du même domaine — pas de distinction visuelle entre sender automatique et personne.

**Contexte mitigé** :
- TerrOir n'envoie pas (encore) de marketing. Tous les sends sont transactionnels purs (orders, OTP, dispute, alerts, leads RGPD-OK).
- Le volume est bas (vraisemblablement <100 mails/jour avant go-live). Risque réputation à court terme = faible.
- Un SPF orphelin existe déjà sur `send.terroir-local.fr` (cf. M-7) — la config a été commencée mais non terminée.

**Fix recommandé** :
- **Court terme (avant go-live)** : ne pas changer. Le setup actuel fonctionne, le coût/risque d'un re-DKIM-onboarding maintenant > bénéfice immédiat.
- **Moyen terme (Phase 8)** : migrer `RESEND_FROM_EMAIL` vers `no-reply@mail.terroir-local.fr` (ou `t.terroir-local.fr`), publier SPF/DKIM/DMARC dédiés sur ce subdomain, garder l'apex pour les humains OVH Zimbra. Permet ensuite de pousser DMARC apex vers `p=reject` sans risquer Resend.
- **Pré-requis** : finaliser ou supprimer le record `send.terroir-local.fr` orphelin (cf. M-7).

## H-2 — Aucun header `List-Unsubscribe` / `List-Unsubscribe-Post: List-Unsubscribe=One-Click`

**Preuve grep** :

```
$ rg "replyTo|reply_to|Reply-To|List-Unsubscribe|listUnsubscribe" lib/ app/
(no matches)
```

`lib/resend/send.ts:55-61` envoie uniquement `from`, `to`, `subject`, `html` — aucun header custom passé à `resend.emails.send()`.

**Pourquoi c'est HIGH** :
- Skill `deliverability.md` : *« List-Unsubscribe header — required by Gmail/Yahoo since Feb 2024 (see Compliance) »*. La règle officielle Google s'applique aux **bulk senders >5k/jour**. TerrOir est très loin de ce volume aujourd'hui mais :
  1. Plusieurs templates envoient à des destinataires qui ne sont pas en relation contractuelle directe : `producer-invitation` (lead producer_interests), `review-request` (3 envois espacés à un consumer post-livraison), `stock-alert-back-in-stock` (alerte opt-in mais user pourrait ne plus se rappeler).
  2. Sans `List-Unsubscribe`, certains MUA (Gmail, Outlook) n'affichent pas l'icône d'unsubscribe natif → plainte spam plus probable que clic unsubscribe → `email.complained` → réputation dégradée.
  3. Pour le volume marketing futur (newsletter, promo producteur), le header sera obligatoire — autant aligner maintenant.
- Il existe déjà 2 mécanismes d'opt-out applicatifs (`/desabonnement` pour producer_interests, `/api/stock-alerts/unsubscribe` pour alerts), donc le coût d'ajout du header se résume à brancher l'URL existante.

**Fix recommandé** :
- Ajouter dans `sendTemplate` un paramètre optionnel `unsubscribeUrl: string | null`. Quand fourni, injecter dans la requête Resend :
  ```
  headers: {
    'List-Unsubscribe': `<${unsubscribeUrl}>, <mailto:unsubscribe@terroir-local.fr>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  }
  ```
- Pour les transactionnels purs (OTP, order confirmation, dispute admin alert), l'URL peut pointer vers une page « ces emails sont essentiels au service, contactez le support pour suppression de compte » — pas de désinscription (légal car transactional, mais l'icône Gmail s'affiche).
- Pour `producer-invitation` et `stock-alert-*`, lien direct vers le flow opt-out existant.
- Pour `review-request`, équivaut à un opt-out global future-proof — décision business à prendre.

## H-3 — Pas de webhook Resend entrant (rappel audit RPC §L-4, re-priorisé HIGH côté délivrabilité) — **FIXED 2026-05-05**

> **Status FIXED** — cf [`docs/fixes/fix-email-h3-m5-webhook-resend-2026-05-05.md`](../fixes/fix-email-h3-m5-webhook-resend-2026-05-05.md).
> Webhook handler `app/api/webhooks/resend/route.ts` créé avec vérification
> Svix HMAC-SHA256 (manuel, pas de dep `svix`), dédup applicative
> `webhook_events_processed` namespacée `resend_${svixId}`, routing 4 events
> critiques (`email.bounced` Permanent/Transient, `email.complained`,
> `email.delivered`, `email.delivery_delayed`) + 2 audit_logs forensiques
> (`email_complaint_received` légal CASL, `email_hard_bounce_suppressed`).
> Pré-requis manuel Romain : provisionner `RESEND_WEBHOOK_SECRET` (Vercel +
> .env.local) + configurer le webhook côté Dashboard Resend. Détails
> §"Action manuelle Romain post-deploy" du fix.

**Preuve grep** :

```
$ rg "resend.*webhook|svix|email.bounced|email.complained" app/ lib/
docs/conventions/stripe-idempotency.md (pas un handler)
```

Aucun fichier `app/api/webhooks/resend/route.ts` ni équivalent. Confirmé dans `audit-rpc-edge-2026-05-05.md:262-268` (L-4) :

> *Le grep `app/api/**/route` ne contient aucun handler `resend` ou `email-event`. Resend est utilisé en envoi sortant uniquement (`lib/resend/send.ts` via `sendTemplate`). Conséquences : Pas de visibilité sur les événements `email.bounced`, `email.complained`, `email.delivery_delayed` côté DB. Les `notifications.statut` reflètent uniquement le « accepté par Resend » (200 du POST), pas le statut réel de delivery (bounced 5xx, soft bounce, complaint). Pas une faille de sécurité, mais une dette d'observabilité côté délivrabilité. À considérer pour Phase 8.*

**Pourquoi je remonte de LOW à HIGH côté délivrabilité** :

L'audit RPC évalue l'absence de webhook comme dette d'observabilité. Côté délivrabilité, c'est plus structurel parce que **sans ingestion d'événements Resend, on ne peut implémenter aucun des contrôles que le skill `list-management.md` qualifie d'obligatoires** :

| Contrôle skill              | Dépend du webhook ?        | Statut TerrOir          |
|-----------------------------|----------------------------|-------------------------|
| Suppression list automatique | OUI (sur `email.bounced`)  | inexistante (M-5)       |
| Hard bounce → suppression immédiate | OUI                | manuel uniquement       |
| Complaint → suppression immédiate (légal) | OUI          | aucun mécanisme         |
| Soft bounce 3x → suppression | OUI                       | inexistant              |
| Métriques bounce rate (cible <2%) | OUI                  | non mesurable           |
| Métriques complaint rate (cible <0.05%) | OUI            | non mesurable           |

Aujourd'hui, si un consumer marque un email TerrOir comme spam, on continue à lui envoyer toutes ses confirmations de commande, et on ne le sait pas. Au-delà de quelques dizaines de complaints (volume modeste), Gmail blackliste le domaine — découverte tardive.

**Quantification volume actuel** : `notifications.created_at` indique le rythme. Sans accès live, estimation indicative : ~5-30 envois/jour aujourd'hui (test/staging) ; post-go-live avec 50 producteurs actifs et ~200 commandes/mois : ~50-100 envois/jour. À ce volume, un seul complaint suffit à dégrader la réputation chez Resend qui surveille le ratio.

**Fix recommandé** :
- Créer `app/api/webhooks/resend/route.ts` :
  1. Lire `RESEND_WEBHOOK_SECRET` (à provisionner), vérifier signature Svix (cf. `webhooks-events.md`).
  2. Idempotence applicative comme le webhook Stripe : INSERT exclusif sur PK `event_id` (table `webhook_events_processed` existe déjà).
  3. Routes `email.bounced` → INSERT `email_suppressions(email, reason='hard_bounce', source_email_id)`. Pour `bounce_type='soft'`, incrément counter, suppress après 3.
  4. Routes `email.complained` → INSERT suppression IMMÉDIATE + log audit (`spam_complaint_received`).
  5. Routes `email.delivered` → UPDATE `notifications.metadata.delivered_at`.
- Créer table `email_suppressions(email PK, reason, created_at, source_resend_id)`.
- Helper `canSendTo(email): Promise<boolean>` à brancher dans `sendTemplate` avant l'appel Resend (early return + log skip).
- Configurer le webhook dans le dashboard Resend (events: `email.bounced`, `email.complained`, `email.delivery_delayed`, `email.delivered`).

Charge : ~4-8h. Bloque pas le go-live si le volume reste <50/jour les premières semaines, mais à scheduler Phase 8 au plus tard.

## H-4 — From `no-reply@terroir-local.fr` sans Reply-To, footer dit « ne pas répondre »

**Preuve** :

```ts
// .env.example:39
RESEND_FROM_EMAIL=no-reply@terroir-local.fr

// lib/resend/templates/layout.tsx:104-106 (footer commun à tous les templates)
TerrOir — la marketplace des produits du terroir.
Cet email est automatique, merci de ne pas y répondre.
```

`lib/resend/send.ts:56-61` n'utilise pas `replyTo`. Toutes les variantes templates héritent du footer.

**Pourquoi c'est HIGH** :

1. **Skill best-practice (`transactional-emails.md` Sender Configuration)** :

   > *Avoid `noreply@` - users reply to transactional emails.*

2. **Réalité opérationnelle** : un consumer dont la commande a un problème (producteur absent au retrait, qualité produit) répond intuitivement à l'email de confirmation. Sa réponse arrive dans `no-reply@terroir-local.fr` côté MX OVH Zimbra. Soit la boîte n'existe pas → bounce 550 → frustration consumer + signal négatif réputation. Soit elle existe et n'est pas monitorée → support fantôme, le consumer pense être ignoré → review négative ou chargeback (cf. audit Stripe sur disputes).

3. **Reply-To monitored existe déjà** : `lib/env/support-email-public.ts:25` documente `support@terroir-local.fr`, et `lib/resend/templates/account-deleted.tsx:28-31` met déjà ce mailto dans le corps. La data existe, juste pas exposée comme header.

4. **Spam scoring** : SpamAssassin et plusieurs filtres entreprise pénalisent les `From: noreply@` (règle `MISSING_REPLY_TO` ou `NOREPLY_FROM`). Effet typique = +0.5 à +1.0 sur le score spam. Pas bloquant en isolation, mais cumule avec d'autres signaux.

**Fix recommandé** :
- Ajouter à `sendTemplate` un paramètre optionnel `replyTo?: string` (défaut `process.env.SUPPORT_EMAIL`).
- Pour les emails admin (dispute, EFW, payout failed) — déjà envoyés à `support@terroir-local.fr` — Reply-To peut rester `no-reply@` (l'admin lit le mail, ne répond pas).
- Pour les emails consumer (`order-confirmed-consumer`, `order-reminder-consumer`, `order-timeout-cancelled`, `order-revival-blocked`, `account-deleted`, `email-change-otp-*`, `producer-page-approved`) → Reply-To = `support@terroir-local.fr`.
- Mettre à jour le footer du layout : remplacer « merci de ne pas y répondre » par « pour toute question, répondez à cet email ».
- Garde-fou : surveiller que la boîte `support@` ne sature pas avec les questions consumer post-launch (signal positif d'engagement, pas de panique).

---

# MEDIUM

## M-1 — DMARC `p=none` permanent + pas de `rua=mailto:...` (aggregate reports)

**Preuve DNS** :

```
$ nslookup -type=TXT _dmarc.terroir-local.fr
"v=DMARC1; p=none; adkim=r; aspf=r"
```

Trois manques par rapport au skill `deliverability.md` (« Rollout: `p=none` (monitor) → `p=quarantine; pct=25` → `p=reject` ») :

1. Pas de progression du `p=none`. Skill : *« Rollout: `p=none` (monitor) → `p=quarantine; pct=25` → `p=reject` »*. SPF + DKIM sont en place et alignés — il n'y a aucun frein technique à durcir.
2. Pas de `rua` (reporting URI for aggregate). Conséquence : aucun rapport quotidien des serveurs récepteurs (Gmail, Outlook, Yahoo) sur les emails alignés/non-alignés. On vole à l'aveugle.
3. Pas de `ruf` (forensic reports). Optionnel, mais utile pour audit incident — non bloquant.

**Pourquoi MEDIUM** :
- `p=none` est neutre : pas de rejet, juste pas de protection. Les emails passent quoi qu'il arrive.
- Le risque actif est qu'un attaquant impersonne `terroir-local.fr` (par ex. phishing à un consumer en se faisant passer pour TerrOir). DMARC `p=none` n'empêchera pas l'arrivée du mail dans la boîte du consumer.

**Fix recommandé** :
- **Étape 1 (immédiat)** : ajouter `rua=mailto:dmarc@terroir-local.fr` (créer la mailbox côté OVH Zimbra ou un alias vers support). Coût ≈ 5 min DNS + provisioning. Bénéfice : 7-14 jours plus tard, tous les MTA majeurs envoient des rapports XML quotidiens listant les IPs sources qui prétendent envoyer pour `terroir-local.fr`. Permet de découvrir : phishing tentatives, mail-out depuis Vercel preview branches, comptes OVH compromis.
- **Étape 2 (après 14j de monitoring `rua`)** : passer `p=quarantine; pct=10`, observer 14j, monter `pct=25`, `pct=50`, `pct=100`, puis `p=reject`. Cela suppose H-1 résolu (subdomain dédié) — sinon `p=quarantine` apex risque de pénaliser des envois OVH Zimbra légitimes mal-DKIM.

## M-2 — DKIM record sans préfixe `v=DKIM1; k=rsa;`

**Preuve DNS** :

```
$ nslookup -type=TXT resend._domainkey.terroir-local.fr
"p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDt/4P9V5XHu...QIDAQAB"
```

Le record commence directement par `p=...` (clé publique). RFC 6376 §3.6.1 spécifie que `v=DKIM1` est défaut si absent — donc le record reste valide pour Gmail, Outlook, Yahoo. Mais :
- Certains validateurs stricts (notamment quelques anti-spam d'entreprise plus anciens) marquent le record comme malformé.
- Convention de skill : *« Your email service will provide you with a TXT record »* — la doc Resend actuelle publie en standard `v=DKIM1; k=rsa; p=...`. Ce record-ci semble dater d'une époque où Resend simplifiait.

**Pourquoi MEDIUM** :
- Pas de bug fonctionnel observé (les emails passent les checks Gmail/Yahoo).
- Mais en cas de migration DNS future, ou de changement de validateur, le risque de faux-négatif est non-nul.
- Cosmétique en première lecture, pose un signal de dette de configuration.

**Fix recommandé** :
- Ouvrir le dashboard Resend, regénérer ou re-vérifier le DKIM record. Si Resend produit aujourd'hui un format complet `v=DKIM1; k=rsa; p=...`, mettre à jour le record DNS en conséquence (TTL bas avant flip, attendre 1h, push, restaurer TTL haut).
- Si Resend confirme que `p=...` seul est leur format actuel, documenter dans `METHODOLOGY.md` pour éviter qu'un futur dev pense le record cassé.

## M-3 — Pas d'`Idempotency-Key` sur `resend.emails.send()`

**Preuve** : `lib/resend/send.ts:55-61` :

```ts
const { data, error } = await resend.emails.send({
  from: resendFromEmail,
  to,
  subject,
  html,
});
```

Aucun deuxième argument `{ headers: { 'Idempotency-Key': ... } }`. Skill `sending-reliability.md` : *« Send a unique key with each request. If the same key is sent again, the server returns the original response instead of sending another email. »*

**Pourquoi MEDIUM** :
- TerrOir n'a pas de retry caller-side aujourd'hui (cf. M-4) → la fenêtre de duplication est étroite (uniquement reseaux qui réussissent côté serveur Resend mais perdent la réponse côté client).
- Mais `waitUntil(sendTemplate(...))` dans plusieurs handlers Stripe (`handle-payout-failed`, `handle-dispute-created`, `handle-account-deauthorized`, etc.) → si Vercel re-exécute le handler suite à un timeout (Stripe webhook retry sur 500), `sendTemplate` est rejoué. La dédup applicative `webhook_events_processed` empêche la double-exécution du handler complet, donc le risque actuel est bloqué en amont.
- Mais demain, si un cron est rejoué (`weekly-payout` qui timeout en M-1 audit RPC), un email `payout-summary` peut partir en double — pas de garde idempotence.

**Fix recommandé** :
- Ajouter dans `sendTemplate` un paramètre optionnel `idempotencyKey?: string`. Convention : composer depuis le business event (skill recommandation : `${template}-${userId ?? hash(to)}-${eventDiscriminator}`).
- Exemple `payout-summary` : `payout-summary-${producerId}-${weekIso}`. Idempotency key cache Resend ≈ 24h, donc expire avant le run cron suivant.
- Pour les sends fire-and-forget sans event ID stable (`account-deleted`), accepter le risque (l'utilisateur ne sera supprimé qu'une fois, donc pas de duplication).

## M-4 — Pas de retry/backoff sur `sendTemplate` en cas de 5xx ou 429

**Preuve** : `lib/resend/send.ts:55-99` — un seul appel `resend.emails.send()`, log `[EMAIL_SEND_FAIL]`, INSERT `notifications` statut='failed', return `{ ok: false }`. Pas de boucle, pas de backoff.

**Pourquoi MEDIUM** :
- Skill `sending-reliability.md` : *« 5xx / 429 / network timeout → retry with exponential backoff. »* TerrOir ne le fait pas.
- Pour les emails critiques :
  - **OTP `email-change-otp-current/new`** : si Resend renvoie 503, l'utilisateur ne reçoit jamais le code → bloqué sur le flow change_email. Le code expire dans 10 min (`email-change-otp-current.tsx:56`) → re-tape le formulaire requis.
  - **`order-confirmed-consumer`** : envoyé `waitUntil(...)` côté webhook Stripe `payment_intent.succeeded`. Si Resend 503, le consumer ne reçoit pas la confirmation → support tickets, perception « commande perdue ».
  - **`admin-dispute-action-required`** : alerte critique deadline disputeable. Si Resend 503, Romain ne reçoit pas l'alerte → loss-by-default.
- Tous les calls `waitUntil(sendTemplate(...))` sont ainsi à mercy d'un single-shot.

**Fix recommandé** :
- Wrapper `sendTemplate` (ou helper interne) avec `sendWithRetry`, pattern skill :
  ```
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await resend.emails.send(...); }
    catch (err) {
      if (!isRetryable(err) || attempt === 2) throw err;
      await sleep(1000 * 2**attempt + Math.random() * 1000);
    }
  }
  ```
  où `isRetryable` = `statusCode >= 500 || statusCode === 429 || code === 'ETIMEDOUT'`.
- Garde la logique INSERT `notifications` au final, mais après les retries.
- Coût : ~30 lignes. Bénéfice : couvre les transients Resend (~99% des incidents).

## M-5 — Pas de table `email_suppressions` ni pre-send check — **FIXED 2026-05-05**

> **Status FIXED** — cf [`docs/fixes/fix-email-h3-m5-webhook-resend-2026-05-05.md`](../fixes/fix-email-h3-m5-webhook-resend-2026-05-05.md).
> Migration `20260505600000_audit_email_h3_m5_email_suppressions.sql`
> applique table `public.email_suppressions` (PK email, reasons
> hard_bounce/complained/soft_bounce_threshold/soft_bounce_pending/manual,
> RLS service-role only) + ALTER `notifications.statut` pour ajouter
> 'skipped'. Helper `lib/resend/suppressions.ts` (canSendTo / addSuppression
> / incrementSoftBounce) branché en pre-send check dans `sendTemplate`
> (court-circuit + INSERT notifications statut='skipped'). 16 tests vitest
> sur le helper, 3 sur sendTemplate.

**Preuve grep** :

```
$ rg "suppression|email_suppressions" supabase/migrations/ lib/
(no matches)
```

Aucun mécanisme pour empêcher l'envoi à un email déjà déclaré bouncing/complained.

**Pourquoi MEDIUM** :
- Lié à H-3 (pas de webhook → on n'a pas le signal pour suppress automatiquement). Sans webhook, table de suppression vide en pratique.
- Aujourd'hui : si un consumer commande, son email bounce une fois (typo, boîte fermée), TerrOir continue à pousser pour toutes les notifications futures (rappel J-1, review-request, etc.) → augmente le bounce rate cumulé → réputation dégradée.
- Skill `list-management.md` : *« Always check suppression before sending: `if (!await canSendTo(to)) { return { skipped: true }; }` »*

**Fix recommandé** :
- Conjoint avec H-3. Migration `supabase/migrations/YYYYMMDD_email_suppressions.sql` créant la table + index unique sur `email`.
- Helper `canSendTo(email): Promise<boolean>` injecté dans `sendTemplate` avant l'appel Resend.
- Initialisation : à la mise en place du webhook Resend, demander à Resend l'historique des suppressions (l'API en propose) pour seed la table.

## M-6 — Aucune séparation marketing vs transactional (config Resend, domaine, audience)

**Preuve** : un seul `RESEND_API_KEY`, un seul `RESEND_FROM_EMAIL`, un seul domaine vérifié Resend (déduit de l'unique selector DKIM `resend._domainkey`). Aucun template ne se distingue technique-wise comme « marketing only ».

**Pourquoi MEDIUM** :
- Skill `deliverability.md` : *« Use different subdomains for different sending purposes »* + *« Keep separate: Transactional / Marketing »* (`list-management.md`).
- Aujourd'hui TerrOir n'envoie quasi pas de marketing :
  - `producer-invitation` : zone grise (sollicitation B2B → est marketing au sens GDPR/CASL, mais légalement défendable comme intérêt légitime).
  - `review-request` (3 envois espacés) : zone grise également.
  - `stock-alert-back-in-stock` : transactional (l'utilisateur a opt-in explicite, double opt-in via `stock-alert-confirm`).
- Demain (Phase 8 vision funnel) : newsletter producteur, promo nouveauté, panier-abandon. Si on les envoie depuis le même setup que les OTP, une plainte marketing dégrade les transactionnels.

**Fix recommandé** :
- Dès qu'un mail purement marketing est envisagé (newsletter, promo) :
  1. Provisionner sous-domaine `m.terroir-local.fr` côté DNS + Resend.
  2. Créer un second `RESEND_API_KEY_MARKETING` en env, second `RESEND_FROM_EMAIL_MARKETING`.
  3. Helper séparé `sendMarketingTemplate` qui force consultation suppression list + List-Unsubscribe header.
- Ne pas s'occuper de cette séparation aujourd'hui (over-engineering tant qu'on est 100% transactionnel).

## M-7 — SPF orphelin sur `send.terroir-local.fr` (pas de DKIM, pas de MX, pas utilisé)

**Preuve DNS** :

```
$ nslookup -type=TXT send.terroir-local.fr
"v=spf1 include:amazonses.com ~all"

$ nslookup -type=TXT resend._domainkey.send.terroir-local.fr
NXDOMAIN

$ nslookup -type=MX send.terroir-local.fr
NXDOMAIN

$ nslookup -type=TXT _dmarc.send.terroir-local.fr
NXDOMAIN
```

→ SPF tout seul, sans DKIM, sans MX, sans DMARC, sans usage applicatif (l'env var `RESEND_FROM_EMAIL=no-reply@terroir-local.fr` pointe sur l'apex).

**Pourquoi MEDIUM** :
- Pas de risque d'envoi mal-aligné aujourd'hui (personne n'envoie depuis ce subdomain).
- Mais : signal de configuration inachevée. Il y a deux interprétations :
  - **Soit** quelqu'un a commencé à provisionner Resend sur `send.terroir-local.fr` puis a switché à l'apex sans cleanup → record mort.
  - **Soit** c'est une intention future (migration H-1) qui a été partiellement amorcée puis abandonnée.
- Sans documentation explicite, c'est de la dette de cognition pour le prochain dev/ops qui regarde le DNS.

**Fix recommandé** :
- **Option A** (cleanup) : supprimer le record TXT `send.terroir-local.fr`. Coût 1 min DNS, 0 risque.
- **Option B** (finalisation, plus rentable) : compléter la config sur `send.` (DKIM Resend, DMARC dédié), puis flipper `RESEND_FROM_EMAIL=no-reply@send.terroir-local.fr`. Résout aussi H-1.
- Décision business : adopter B si Phase 8 rapproche (<3 mois), A sinon.

---

# LOW

## L-1 — Pas de version texte (multipart `text/plain`)

**Preuve** : `lib/resend/send.ts:38` n'utilise que `render(element)` qui produit du HTML. `resend.emails.send` est appelé avec `html` mais sans `text`.

**Impact** :
- Anti-spam scoring : SpamAssassin règle `MIME_HTML_ONLY` ajoute ~+0.1 à +0.5 au score. Marginal.
- Accessibilité : lecteurs texte (Lynx, certains screen readers, clients très anciens) verront le HTML cru.
- Quelques providers entreprise (Mimecast strict mode) refusent les emails sans texte alternatif.

**Fix optionnel** : `@react-email/render` accepte `render(element, { plainText: true })` qui produit la version texte. Branche dans `sendTemplate` :
```ts
const html = await render(element);
const text = await render(element, { plainText: true });
return resend.emails.send({ from, to, subject, html, text });
```

Coût ~5 lignes. Bénéfice deliverability marginal mais positif.

## L-2 — Pas de cron de purge `notifications` (croissance indéfinie + RGPD)

**Preuve** : `audit-rpc-edge-2026-05-05.md` Annexe C liste les 9 crons existants — aucun ne touche `notifications`. La table est INSERT-only depuis `lib/resend/send.ts:45-83`.

**Impact** :
- `notifications.metadata.email` est en clair (commenté dans `lib/rgpd/mask-email.ts:9` comme acceptable « traçabilité serveur »). Acceptable si retention bornée.
- Skill `list-management.md` : *« Send attempts: 90 days. Email logs: 90 days. »*
- Sans purge, la table grossit linéairement avec le volume (estimation : 50-100 envois/jour × 365j = ~30k rows/an). Pas critique en taille, mais retention RGPD non bornée.

**Fix recommandé** :
- Cron daily `purge-notifications` (pattern aligné `purge-otp-codes`, `purge-stock-alerts`) qui DELETE `WHERE created_at < now() - interval '90 days'`.
- Garder une exception pour `statut='failed'` : retention plus longue (180j) pour audit incident.

## L-3 — Pas de feedback loops Postmaster Tools / SNDS / Yahoo CFL

**Preuve** : aucun script ou doc référençant `postmaster.google.com`, `sendersupport.olc.protection.outlook.com`, ou Yahoo CFL signup.

**Impact** :
- Pas de visibilité sur reputation domain côté Gmail (le plus gros volume B2C français).
- Skill `deliverability.md` : *« Set up with Gmail (Postmaster Tools), Yahoo, Microsoft SNDS. Remove complainers immediately. »*
- À volume actuel <100/jour, les outils sont sous-utiles (pas assez de signal). Devient critique >1000/jour.

**Fix optionnel (Phase 8)** : créer compte Google Postmaster Tools, ajouter le record TXT de vérification, attendre 7-14j pour data. À faire avant la première campagne marketing (M-6 ouvert).

## L-4 — Opt-in transactional implicit (driven par Supabase Auth)

**Preuve** :
- `producer-interests` (leads) : opt-in explicite via formulaire `/devenir-producteur`. ✓
- `stock-alerts` : double opt-in (template `stock-alert-confirm` puis bouton). ✓
- Consumer transactional (orders, OTP, dispute) : pas d'opt-in dédié, dérivé du compte Supabase Auth (l'inscription = opt-in implicite pour les emails de service). ✓ légalement (transactional, GDPR contract fulfillment).

**Pourquoi LOW** :
- Conforme RGPD comme transactional (skill `compliance.md` : *« Transactional emails: Can send based on contract fulfillment or legitimate interest »*).
- Mais aucune trace explicite du consentement (`users.consent_marketing_at`, `users.consent_terms_at`) → si demain TerrOir veut envoyer du marketing aux consumers existants, pas de bascule fine.

**Fix optionnel** : si marketing prévu, ajouter colonne `users.consent_marketing_email_at timestamptz` et checkbox au signup (non pré-cochée, skill `compliance.md`). À planifier avec M-6.

## L-5 — Logo image hébergé sur `${NEXT_PUBLIC_APP_URL}/email-assets/logo-email.png`

**Preuve** : `lib/resend/templates/layout.tsx:11` :

```ts
const LOGO_URL = `${NEXT_PUBLIC_APP_URL}/email-assets/logo-email.png`;
```

**Impact** :
- Si `terroir-local.fr` est down (incident Vercel, déploiement raté), les emails déjà envoyés affichent un logo cassé chez les consumers (avec `alt="TerrOir"` en fallback, OK).
- Pour les emails archivés, après 5+ ans si le path change, idem.
- Spam scoring : ratio image/texte est très faible (1 seule image, beaucoup de texte) → pas de finding `MIME_HTML_MOSTLY_IMAGES`.

**Fix optionnel** : pas critique. Une variante serait d'inliner le logo en base64 (alourdit le HTML, parfois marqué comme suspect par anti-spam). Le statu quo est un bon compromis.

## L-6 — Subjects admin contiennent `URGENT`, `⚠️`, mots-clés à risque spam

**Preuve** : `lib/resend/templates/admin-dispute-action-required.tsx:24`, `admin-payout-failed.tsx:22`, `admin-account-deauthorized.tsx`, `admin-early-fraud-warning.tsx`. Tous avec `[TerrOir Admin]` + `⚠️` + mots forts.

**Impact** :
- Tous envoyés à `SUPPORT_EMAIL` (admin@terroir-local.fr ou support@terroir-local.fr) — boîte interne. Si OVH Zimbra héberge, pas de filtre spam strict consumer-grade.
- En 2026 les emojis dans les subjects ne sont plus pénalisés (Gmail les supporte nativement). `URGENT` peut déclencher SpamAssassin `URG_BIZ` mais marginal.

**Pourquoi LOW** :
- Le destinataire est interne et contrôlé. Aucun impact réputation domaine.
- Si OVH Zimbra envoie ces alertes en spam, c'est un problème filter-side (whitelist locale).

**Fix non requis**. Documenter dans `METHODOLOGY.md` que ce pattern est volontaire pour les alertes admin et ne doit pas être étendu aux emails consumer.

---

# Annexe A — Inventaire des templates et leur classification

| Template                                      | Type           | Destinataire    | List-Unsubscribe attendu | Reply-To recommandé |
|-----------------------------------------------|----------------|-----------------|--------------------------|---------------------|
| `order-confirmed-consumer`                    | transactional  | consumer        | non (transactional pur)  | support             |
| `order-confirmed-producer`                    | transactional  | producer        | non                      | support             |
| `order-reminder-consumer`                     | transactional  | consumer        | non                      | support             |
| `order-timeout-cancelled`                     | transactional  | consumer        | non                      | support             |
| `order-revival-blocked`                       | transactional  | consumer        | non                      | support             |
| `email-change-otp-current/new`                | transactional  | consumer        | non                      | support             |
| `account-deleted`                             | transactional  | consumer        | non                      | support             |
| `producer-page-approved`                      | transactional  | producer        | non                      | support             |
| `payout-summary`                              | transactional  | producer        | non                      | support             |
| `producer-invitation`                         | bulk-like      | lead (B2B)      | **OUI** (déjà unsub URL en footer applicatif) | support             |
| `opt-out-link`                                | meta (RGPD)    | lead (B2B)      | **OUI**                  | support             |
| `review-request`                              | bulk-like      | consumer        | **OUI**                  | support             |
| `stock-alert-confirm` (double opt-in)         | transactional  | consumer        | non (premier mail)       | support             |
| `stock-alert-back-in-stock`                   | bulk-like      | consumer opt-in | **OUI** (déjà unsub footer applicatif) | support             |
| `admin-dispute-action-required`               | admin alert    | support@        | non (admin)              | non                 |
| `admin-dispute-closed`                        | admin alert    | support@        | non                      | non                 |
| `admin-dispute-deadline-warning`              | admin alert    | support@        | non                      | non                 |
| `admin-payout-failed`                         | admin alert    | support@        | non                      | non                 |
| `admin-transfer-failed`                       | admin alert    | support@        | non                      | non                 |
| `admin-early-fraud-warning`                   | admin alert    | support@        | non                      | non                 |
| `admin-producer-refund-alert`                 | admin alert    | support@        | non                      | non                 |
| `admin-account-deauthorized`                  | admin alert    | support@        | non                      | non                 |

22 templates. 3 nécessitent `List-Unsubscribe` header dès lors que H-2 est traité (`producer-invitation`, `review-request`, `stock-alert-back-in-stock`). Les 9 templates consumer transactionnels nécessitent un `Reply-To: support@` dès lors que H-4 est traité.

---

# Annexe B — Évents Resend traités vs non-traités (référence H-3)

| Évent Resend                | Traité ?  | Action TerrOir requise                                    |
|-----------------------------|-----------|-----------------------------------------------------------|
| `email.sent`                | partiel   | INSERT `notifications statut='sent'` (déjà fait au POST)  |
| `email.delivered`           | NON       | UPDATE `notifications.metadata.delivered_at` (manquant)   |
| `email.bounced` (hard)      | **NON**   | INSERT `email_suppressions reason='hard_bounce'` (manquant) |
| `email.bounced` (soft)      | **NON**   | Increment counter, suppression après 3 (manquant)         |
| `email.complained`          | **NON**   | INSERT suppression IMMÉDIATE + audit log (manquant, légal CASL) |
| `email.delivery_delayed`    | **NON**   | UPDATE `notifications.metadata.delayed_count` (manquant)  |
| `email.opened`              | NON       | (engagement tracking — pas critique pour transactional)   |
| `email.clicked`             | NON       | (engagement tracking — pas critique pour transactional)   |

L'absence des 4 lignes en gras est le cœur du finding H-3.

---

# Annexe C — Cross-références aux audits du jour

| Finding ici | Cross-ref                                                                       |
|-------------|---------------------------------------------------------------------------------|
| H-3         | `audit-rpc-edge-2026-05-05.md` §L-4 (origine du constat — re-priorisé HIGH ici) |
| M-3         | `audit-rpc-edge-2026-05-05.md` §L-2 (idempotency-key Stripe convention)         |
| M-4         | `audit-rpc-edge-2026-05-05.md` §M-1 (crons sans concurrence — pattern similaire de robustesse) |
| L-2         | `audit-rls-2026-05-05.md` (data retention contexte général)                     |

Aucun chevauchement avec `audit-stripe-2026-05-05.md` ni `audit-stripe-sdk-upgrade-plan-2026-05-05.md`.

---

# Annexe D — Ce que cet audit ne couvre pas

- **OVH Zimbra inbound** (mailboxes humaines `admin@`, `support@`, etc.) : la config côté Zimbra (filtres, sieve, anti-spam) est hors scope, mais peut absorber les retours `Reply-To` post-fix H-4.
- **Volume historique réel** : pas de query `notifications` sur live (pas de volonté d'effet de bord). Estimation chiffrée à valider via `select count(*) from notifications where created_at > now() - interval '7 days'` post-audit.
- **SMS Twilio** : périmètre email uniquement. Notifications SMS suivent un pattern parallèle (cron `reminder-sms`) non analysé ici.
- **Tests E2E delivery** : pas d'envoi réel à mail-tester.com / Gmail / Outlook pour mesurer score spam observé. Recommandation : faire passer un envoi de chaque template à `https://www.mail-tester.com` pre-go-live.
- **Audit du flow Supabase Auth (signup confirmation, magic link, password reset)** : ces emails sont envoyés par Supabase, pas par Resend. Configuration côté dashboard Supabase (templates customisés, SMTP custom override si activé) hors scope.

---

# Recommandations d'action (priorisé)

1. **Avant go-live (Immediate)** :
   - Décider H-4 (Reply-To) — fix simple, 30 min de code. Bénéfice support immédiat.
   - Ajouter `rua=mailto:dmarc@terroir-local.fr` dans le DMARC (M-1 étape 1) — 5 min DNS + provisioning mailbox. Bénéfice : visibility 14j post-go-live.
   - Décider H-2 (List-Unsubscribe) — recommandé d'aligner pour les 3 templates bulk-like avant qu'un consumer reporte spam.

2. **Court terme (post-go-live, Sprint 1-2)** :
   - H-3 + M-5 conjoints : webhook Resend + table `email_suppressions` + helper `canSendTo`. ~4-8h. Couvre les 4 events critiques (Annexe B).
   - M-4 retry/backoff sur `sendTemplate`. ~30 lignes. Cible OTP, dispute admin, order confirmation.
   - L-2 cron `purge-notifications` daily 90j. ~50 lignes (pattern existant).

3. **Moyen terme (Phase 8 — vision funnel)** :
   - H-1 + M-7 conjoints : migration `RESEND_FROM_EMAIL` vers `mail.terroir-local.fr` ou `send.terroir-local.fr`, finaliser DKIM/DMARC subdomain, durcir DMARC apex.
   - M-1 étape 2 : passer DMARC apex à `p=quarantine; pct=10` puis montée progressive.
   - M-3 idempotency-key pour les sends crons (`payout-summary`, etc.).
   - L-3 setup Postmaster Tools / SNDS / Yahoo CFL avant ouverture marketing.

4. **Long terme (si marketing ouvert)** :
   - M-6 séparation marketing/transactional (clé Resend dédiée, subdomain dédié, helper séparé).
   - L-4 colonne `consent_marketing_email_at` pour bascule fine.

5. **Cosmétique / non bloquant** :
   - M-2 vérifier format DKIM côté Resend dashboard.
   - L-1 ajouter `text/plain` multipart (bénéfice marginal mais ~5 lignes).
   - L-6 documenter conventions subjects admin dans `METHODOLOGY.md`.

Aucune action n'a été appliquée. Liste pour arbitrage.
