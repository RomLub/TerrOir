# ADR-0010 — Réception des emails entrants pour la boîte admin (contact@) : MX OVH + IMAP

- **Statut** : Accepted (arbitrage Romain 2026-05-24)
- **Date** : 2026-05-24
- **Décideurs** : Romain

## Contexte

Le chantier 9 (« Mails ») ajoute une **boîte de réception dans l'admin** : lire
les emails reçus sur `contact@terroir-local.fr`, les classer (producteur /
consommateur / public), et répondre depuis `contact@`.

État du mail TerrOir : **envoi** via Resend (domaine racine `terroir-local.fr`
**vérifié**, DKIM + SPF OK — `no-reply@` + `auth@send.`). **Réception** : les
boîtes `contact@`/`support@`/`admin@` sont des mailboxes **OVH** (MX OVH) ;
rien dans l'app. Question structurante : **comment ingérer l'inbound ?**

## Décision (arbitrage Romain)

**Option A : MX reste OVH + polling IMAP.** Le MX n'est pas basculé pré-launch
(les boîtes OVH restent fonctionnelles, filet de sécurité). Un cron Vercel
relève `contact@` en IMAP, stocke dans `inbound_emails`, sans toucher les flags
(lecture seule — Zimbra/OVH gère son état en parallèle). Réponses via Resend
`from: contact@` (domaine racine déjà vérifié → **aucun changement DNS**).

L'option B (MX → Resend Inbound, push temps réel) est **écartée pour le MVP**
(bascule MX risquée, perte des mailboxes OVH sur la racine) — réévaluable plus
tard si le volume/temps-réel le justifie (choix réversible).

### Paramètres arbitrés

1. **Option A** (IMAP OVH). ✅
2. **Adresses** : la conf OVH réelle est **une seule boîte `admin@` (Zimbra)** ;
   `contact@` est une **redirection MX → admin@** (pas une boîte). On **polle
   donc `admin@`** (IMAP_USER=admin@) et on **répond depuis `contact@`**
   (interlocuteur unique, côté code). Architecture **multi-adresses** prête
   (table `inbound_email_accounts`, 1 ligne/adresse) pour ajouter d'autres
   boîtes plus tard. **Conséquence** : `admin@` étant la boîte principale, elle
   mélange mails utiles + bruit infra (Stripe/Resend/Vercel/OVH/GitHub…) →
   **pré-filtre par domaine expéditeur à l'ingestion** (blacklist
   `lib/admin/inbound/ignored-senders`, on n'insère pas le bruit ; le
   checkpoint avance quand même).
3. **Cadence** : 10 min visé. ⚠️ **Contrainte découverte au déploiement** :
   Vercel **Hobby** limite les crons à 1×/jour → le cron est calé sur
   `0 7 * * *` (quotidien) pour que le déploiement passe. Le 10 min nécessite
   **Vercel Pro** (puis `*/10 * * * *`) OU un **scheduler externe** (GitHub
   Actions cron déclenchant la route avec le `CRON_SECRET`). Décision cadence
   à trancher par Romain à l'activation (cron désactivé par défaut en attendant).
4. **Emplacement UI** : section **« Mails » au top niveau** de la sidebar
   (usage haute fréquence, accès direct), onglets internes Producteurs /
   Consommateurs / **Public** (3e onglet pour ne pas rater les visiteurs
   non-inscrits).
5. **Envoi depuis `contact@`** : vérifié — domaine racine `terroir-local.fr`
   **verified** côté Resend, sending enabled → `from: contact@` autorisé,
   **aucun DNS à modifier**.

### Garde-fous (points Romain)

- **Cron désactivé par défaut** (`INBOUND_EMAIL_CRON_ENABLED=false`). Romain
  l'active après avoir renseigné les identifiants IMAP et fait un test manuel
  (évite un spam de retries si les creds sont mauvais).
- **Lecture seule IMAP** (pas de marquage `\Seen` côté serveur).
- **Reprise par checkpoint** : `inbound_email_accounts.last_seen_uid` +
  `uid_validity` — on ne re-scanne pas l'historique. Premier run : on cale le
  checkpoint sur `uidNext-1` (pas de réimport massif ; l'historique reste dans
  le webmail OVH). UIDVALIDITY changée → re-checkpoint propre.
- **Déduplication par Message-ID** (`upsert ignoreDuplicates`).
- **Cap** `MAX_PER_RUN=50` par exécution (le reste au run suivant).

## Implémentation (chantier 9)

- Migration `20260524120000_inbound_emails.sql` : `inbound_email_accounts`
  (config + checkpoint par adresse, seed `contact@`) + `inbound_emails`
  (Message-ID unique, tag, lookups, read/replied). RLS admin-read.
- `lib/admin/inbound/` : `imap-fetch` (imapflow + mailparser), `tag`
  (lookup expéditeur → producteur/consommateur/public), `fetch`, `reply`.
- Cron `/api/cron/fetch-inbound` (POST, `assertCronAuth`, gate flag).
- UI `app/(admin)/mails/` (top niveau) : onglets par tag + détail + réponse
  (préremplie : To, « Re: », message cité ; envoi `from: contact@` + headers
  In-Reply-To/References).
- Audit `inbound_email_replied`.

## Conséquences

- Identifiants IMAP à fournir par Romain (env Vercel `IMAP_HOST`/`PORT`/`USER`/
  `PASSWORD`) + activation manuelle `INBOUND_EMAIL_CRON_ENABLED=true` après
  test. Tant que désactivé, le cron est un no-op.
- Choix MX réversible (A→B plus tard) ; B→A après bascule impliquerait de
  re-créer les mailboxes OVH (d'où la prudence pré-launch).

## Limites MVP assumées (décisions, pas dette silencieuse)

Périmètre volontairement borné pour le MVP. Chaque point est un choix
conscient, pas un oubli ; condition de revisite = **le volume/usage réel le
justifie** (inbound récurrent avec HTML riche / pièces jointes, ou litiges
fréquents nécessitant des justificatifs).

- **Mails — rendu** : on affiche le **texte** (dérivé du HTML si besoin via
  `html-to-text`, sans rendu HTML brut → aucune surface XSS dans l'admin).
  Suffisant pour lire/répondre ; pas de rendu HTML riche.
- **Mails — pièces jointes** : non ingérées (texte/HTML seulement). Une PJ
  reste consultable dans le **webmail OVH**. Ingestion + stockage (Supabase
  Storage) = V2 si le besoin se confirme.
- **Mails — fils** : liste à plat (pas de regroupement conversation). Le
  threading sortant existe (headers In-Reply-To/References) mais l'UI ne
  groupe pas. Acceptable au volume contact@.
- **Mails — tag** : lookup par **email exact** de l'expéditeur. Une personne
  écrivant depuis une autre adresse que celle enregistrée → onglet **Public**
  (par design : le Public est le filet pour les expéditeurs inconnus, revus
  manuellement). Pas de matching flou (non fiable).
- **Litiges — preuves** : champs **texte** uniquement (description, client,
  date, texte libre). Pas d'upload de justificatifs (suffisant pour une
  marketplace en retrait : la preuve forte = détails commande + validation du
  retrait). Upload fichier (Stripe File API) = V2.
- **Tests E2E des parcours admin** : non couverts en Playwright — le middleware
  `isAdmin` est **host-gated** (`admin.terroir-local.fr`), non testable en E2E
  sur localhost (doctrine CLAUDE.md). Compensation : tests vitest unitaires +
  validation réelle (RPC testées contre la base prod, ingestion mails testée
  contre la vraie boîte). Constat structurel, pas une dette à rattraper.
