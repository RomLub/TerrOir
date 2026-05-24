# ADR-0010 — Réception des emails entrants pour la boîte admin (contact@) : MX OVH + IMAP vs Resend Inbound

- **Statut** : Proposed (en attente d'arbitrage Romain — **avant tout code** du chantier 9)
- **Date** : 2026-05-24
- **Décideurs** : Romain (arbitrage MX OVH ↔ Resend inbound)

## Contexte

Le chantier 9 (« Mails ») veut une **boîte de réception dans l'admin** :
lire les emails reçus sur `contact@terroir-local.fr` (et éventuellement
`support@`), les classer (producteur / consommateur / public), et répondre
depuis `contact@`.

État actuel du mail TerrOir :
- **Envoi** : Resend uniquement. `no-reply@terroir-local.fr` (transactionnel)
  + `auth@send.terroir-local.fr` (emails Auth, DKIM sur le sous-domaine
  `send.`). Le domaine racine `terroir-local.fr` est authentifié Resend (le
  `no-reply@` part bien).
- **Réception** : **rien dans l'app**. Les boîtes `contact@` / `support@` /
  `admin@` sont des mailboxes **OVH** (MX OVH). Aucun code IMAP ni webhook
  inbound n'existe.

La question structurante du chantier 9 : **comment l'app ingère-t-elle les
emails entrants ?** Deux architectures s'excluent (le MX d'une adresse ne
peut pointer qu'à un endroit).

## Options

### Option A — MX reste OVH + polling IMAP (recommandée)

`contact@` reste une mailbox OVH. Un cron Vercel se connecte en **IMAP**,
récupère les nouveaux messages, les stocke dans `inbound_emails`, les marque
lus. Réponses envoyées via Resend `from: contact@terroir-local.fr`.

- **Pour** :
  - **Aucun changement DNS / MX** → zéro risque sur le flux mail existant
    (toutes les boîtes OVH continuent de fonctionner, webmail + backup
    conservés).
  - Resend reste **envoi-only** (stack actuelle inchangée, éprouvée).
  - Mécanique IMAP bien comprise, indépendante d'une feature tierce récente.
  - La mailbox OVH reste source de vérité (filet : rien n'est perdu si l'app
    a un bug d'ingestion).
- **Contre** :
  - IMAP est **stateful** ; en serverless (cron Vercel), on fait des fetches
    **courts** par run (connexion → fetch UNSEEN → store → déconnexion).
    Acceptable mais moins élégant qu'un push.
  - **Latence de polling** (ex : toutes les 5–15 min, pas temps réel).
  - On **parse le MIME nous-mêmes** (texte/HTML, pièces jointes) via une lib.
  - Identifiants IMAP `contact@` à stocker en env (`IMAP_HOST`, `IMAP_USER`,
    `IMAP_PASSWORD`).

### Option B — MX → Resend Inbound

Pointer le MX (racine ou sous-domaine) vers **Resend Inbound**. Resend reçoit,
parse, et **webhook** vers `/api/webhooks/resend-inbound` → `inbound_emails`.

- **Pour** : **push temps réel**, parsing MIME délégué à Resend, stack
  cohérente (même fournisseur envoi + réception), pas de polling serverless.
- **Contre** :
  - **Changement MX** = risque sur le flux mail existant. Si on bascule le MX
    **racine**, **toutes** les adresses (`contact@`, `support@`, `admin@`…)
    quittent OVH → on **perd les mailboxes OVH** (webmail, backup) sauf
    re-architecture. Inacceptable tel quel pré-launch.
  - Variante « sous-domaine dédié » (MX `inbound.terroir-local.fr` → Resend) :
    l'adresse publique devient moche (`contact@inbound.…`) ou nécessite une
    redirection OVH `contact@` → `…@inbound.…` (retour à une dépendance OVH).
  - Resend Inbound est une feature plus récente (maturité/robustesse à
    valider).

### Note — hybride possible (mentionné, non recommandé pour le MVP)

OVH garde le MX `contact@` + **règle de transfert** d'une copie vers une
adresse Resend Inbound (sous-domaine MX→Resend) → push + mailbox OVH
conservée. Donne le meilleur des deux mais **double la surface** (OVH rule +
Resend inbound + webhook) pour un gain marginal au MVP.

## Recommandation

**Option A (MX OVH + polling IMAP).** Raisons : zéro risque DNS pré-launch,
mailboxes OVH conservées comme filet, Resend reste envoi-only (éprouvé), et la
latence de polling est sans impact pour un volume contact@ faible. On garde
B en tête si le volume/temps-réel le justifie un jour (changement réversible).

## Périmètre chantier 9 (à coder APRÈS arbitrage)

1. **Ingestion** (selon l'option retenue) :
   - A : cron Vercel `/api/cron/fetch-inbound` (IMAP fetch UNSEEN → insert) +
     env IMAP.
   - B : webhook `/api/webhooks/resend-inbound` (signature Svix) + MX Resend.
2. **Table `inbound_emails`** : `id`, `message_id` (unique, dédup),
   `in_reply_to`, `from_email`, `from_name`, `to_email`, `subject`,
   `body_text`, `body_html`, `received_at`, `category` (producer | consumer |
   public), `matched_user_id` (nullable), `handled_at` (nullable), `raw`
   (jsonb). RLS admin-read, service_role write.
3. **Auto-tag par rôle** : matcher `from_email` → `admin_users` / `producers`
   (via `users`) / `users` → catégorie producteur / consommateur / public
   (inconnu). Calcul à l'ingestion (stocké) + recalcul possible.
4. **UI split-view** (section Gouvernance ou Consommateurs ?) : onglets
   **Producteurs / Consommateurs / Public**, liste + détail d'un fil.
5. **Répondre depuis `contact@`** : compose + `sendTemplate`/Resend
   `from: contact@terroir-local.fr` (domaine racine déjà authentifié Resend)
   + header `In-Reply-To` pour le threading. Trace audit.

## Points à arbitrer par Romain (avant code)

1. **Option A ou B ?** (recommandation : A).
2. **Adresses à ingérer** : `contact@` seul, ou aussi `support@` ?
3. **Si A** : Romain fournit les identifiants IMAP OVH de `contact@` (env) +
   cadence de polling (proposition : toutes les 10 min via cron Vercel).
4. **Emplacement UI** : la boîte mails va sous **Gouvernance** ou une section
   dédiée « Mails » dans la sidebar ?
5. **Confirmer** que Resend peut envoyer `from: contact@terroir-local.fr`
   (domaine racine authentifié — à vérifier côté dashboard Resend ; sinon
   ajouter l'auth).

## Conséquences

- Aucune tant que l'ADR est `Proposed`. Une fois `Accepted`, le chantier 9
  est codé selon l'option retenue. Le choix MX est **réversible** (A→B
  possible plus tard), mais B→A après une bascule MX implique de re-créer les
  mailboxes OVH — d'où la prudence pré-launch.
