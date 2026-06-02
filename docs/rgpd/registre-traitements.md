# Registre des traitements de données personnelles — TerrOir

> Version : **draft 1.0 — 10 mai 2026**
> Statut : à valider avec avocat externe avant ouverture publique (T-003 audit pré-launch)
> Auteur du draft : chantier P0-TT audit pré-launch (F-013)

---

## 1. Responsable de traitement

- **Entité** : TerrOir (marque) — entreprise individuelle, en cours d'immatriculation
- **Représentant légal** : Romain Lubin
- **Contact RGPD** : `lubin.rom@gmail.com` (à remplacer par `contact@terroir-local.fr` ou `dpo@terroir-local.fr` au lancement)
- **Site web** : `https://www.terroir-local.fr`
- **DPO** : non désigné à ce stade (seuil obligatoire non franchi — à valider avec avocat selon volume utilisateurs cible et nature des traitements)

## 2. Périmètre

Ce registre couvre les traitements de données personnelles opérés par TerrOir sur ses 3 sous-domaines (`www`, `pro`, `admin`) et ses 8 sous-traitants techniques (cf. §10).

Hors périmètre : les traitements relevant des producteurs partenaires sur leurs propres systèmes hors plateforme TerrOir (cahier de production, comptabilité interne, etc.) — chaque producteur est responsable de traitement de ses propres données.

## 3. Liste des traitements

| Code  | Nom                                | Finalité principale                      |
| ----- | ---------------------------------- | ---------------------------------------- |
| T-01  | Gestion du compte consommateur     | Authentification, profil, droits RGPD    |
| T-02  | Gestion des commandes              | Cycle de vie achat → retrait → archivage |
| T-03  | Paiement et reversement            | Encaissement Stripe + payouts producteurs |
| T-04  | Notifications transactionnelles    | Emails / SMS opérationnels (commande, retrait, paiement) |
| T-05  | Candidatures producteur (leads)    | Pipeline acquisition producteurs B2B     |
| T-06  | Audit forensique sécurité          | Détection abus / brute-force / forensique post-incident |
| T-07  | Mesure d'audience (futur)          | Statistiques d'usage anonymisées (PostHog, non actif) |

---

## T-01 — Gestion du compte consommateur

### Finalité
Permettre à un utilisateur de créer un compte, se connecter, gérer son profil (nom, email, téléphone), et exercer ses droits RGPD (accès, rectification, effacement, portabilité).

### Base légale
- **Exécution du contrat** (RGPD art. 6.1.b) pour la création / gestion du compte
- **Obligation légale** (RGPD art. 6.1.c) pour conservation des CGU acceptées (preuve de consentement contractuel)
- **Consentement** (RGPD art. 6.1.a) pour l'opt-in SMS

### Catégories de personnes concernées
Consommateurs inscrits sur `www.terroir-local.fr`.

### Catégories de données
- Identité : prénom, nom
- Contact : email, téléphone (optionnel pour SMS opt-in)
- Authentification : mot de passe haché côté Supabase Auth (bcrypt), session JWT
- Traçabilité contractuelle : version CGU + date d'acceptation
- Métadonnées techniques : date de création compte, dates de mise à jour

### Destinataires
- **Interne** : équipe technique TerrOir (Romain Lubin, accès admin via `admin.terroir-local.fr`)
- **Sous-traitants** : Supabase (hébergement Postgres + Auth), Vercel (hébergement applicatif), Resend (envoi emails transactionnels), OVH (DNS + mail entrant), Upstash (rate-limit Redis)

### Transferts hors UE
- Supabase : data center région UE configurée (à confirmer — voir §11)
- Vercel : edge compute mondial mais data sensible en UE via configuration (à confirmer)
- Resend : opère via Amazon SES — transferts hors UE possibles, clauses contractuelles types (SCC) à vérifier

### Durée de conservation
- Compte actif : pour toute la durée d'usage
- Compte inactif (pas de connexion 3 ans) : à anonymiser ou supprimer (à valider avec avocat)
- Compte supprimé volontairement : hard delete immédiat si aucune commande, sinon anonymisation soft (`statut='deleted'`, données identifiantes effacées, lignes orders conservées pour obligations comptables)

### Mesures de sécurité
- Mots de passe hachés (bcrypt côté Supabase Auth)
- Sessions JWT signées HttpOnly, isolation `admin` vs `www`/`pro` (cookies séparés)
- Row Level Security (RLS) Postgres sur toutes les tables sensibles
- Trigger DB d'exclusion mutuelle `admin` ↔ `consumer/producer`
- Magic link OTP (token_hash) pour reset password — pas d'envoi de mot de passe en clair
- Rate-limit applicatif Upstash sur signup, login, recovery
- Audit forensique des events sensibles (cf. T-06)

---

## T-02 — Gestion des commandes

### Finalité
Permettre la commande de produits auprès d'un producteur (panier, validation slot retrait, confirmation, retrait à la ferme), la traçabilité du cycle de vie, et la conservation des justificatifs comptables.

### Base légale
- **Exécution du contrat** (RGPD art. 6.1.b)
- **Obligation légale** (RGPD art. 6.1.c) — conservation des justificatifs commerciaux (Code de commerce art. L123-22, 10 ans)

### Catégories de personnes concernées
Consommateurs ayant passé commande + producteurs ayant validé / livré.

### Catégories de données
- Identifiants consumer et producer (FK Postgres)
- Détail commande : produits, quantités, prix, montant total, commission TerrOir
- Slot de retrait : date, heure, lieu (ferme du producteur)
- Code de retrait : `TRR-XXXXX` historique ou `TRR-XXXXXXX` courant (généré par trigger Postgres)
- Statut + horodatages : created, confirmed, completed, cancelled
- Notes client (texte libre, optionnel)
- Référence Stripe Payment Intent (cf. T-03)

### Destinataires
- **Interne** : consumer (sa propre commande), producteur (commandes le concernant), admin TerrOir (modération, support)
- **Sous-traitants** : Supabase (Postgres), Stripe (référence PI), Resend (notifications cycle de vie)

### Transferts hors UE
- Stripe : Stripe Payments France SAS (France) + Stripe Inc. (États-Unis) pour certains traitements techniques — clauses contractuelles types (SCC) en vigueur

### Durée de conservation
- Données comptables (montants, commission, dates) : **10 ans** (obligation Code de commerce L123-22)
- Données opérationnelles non-comptables (notes client, slot info) : à anonymiser après expiration des recours commerciaux (à valider avec avocat — pratique courante 3 ans après dernière interaction)

### Mesures de sécurité
- RLS strict (un consumer ne voit que ses commandes, idem producer)
- RPC SECDEF atomique `create_order_with_items` (validation slot capacity + stock anti-race)
- RPC SECDEF `revive_order_with_stock_check` (résurrection cancelled→pending avec checks)
- Audit log forensique des transitions sensibles (`order_payment_*`, `order_revival_*`)
- Triggers Postgres pour cohérence (restore stock à l'annulation, etc.)

---

## T-03 — Paiement et reversement

### Finalité
Encaisser le paiement consommateur via Stripe (carte bancaire avec 3DS), reverser la part producteur via Stripe Connect (Express), prélever la commission TerrOir.

### Base légale
- **Exécution du contrat** (RGPD art. 6.1.b)
- **Obligation légale** (RGPD art. 6.1.c) — conservation des justificatifs de paiement, lutte anti-blanchiment (LCB-FT)

### Catégories de personnes concernées
Consommateurs payeurs + producteurs bénéficiaires.

### Catégories de données collectées par TerrOir
- Référence Stripe Customer (consommateur) — pas de PAN carte côté TerrOir
- Référence Stripe Connect Account (producteur)
- Référence Stripe Payment Intent par commande
- Montants : brut, commission, net producteur
- Statut Connect : `charges_enabled`, `payouts_enabled` (flags miroirs)
- Référence Stripe Payout (reversement producteur)

### Données traitées par Stripe (pas par TerrOir)
- Numéro de carte (PAN), CVV, expiration — **jamais en base TerrOir**
- Données d'identité KYC producteur (CNI, justificatif domicile, IBAN) — gérées dans le tunnel Stripe Connect hosted onboarding

### Destinataires
- **Interne** : admin TerrOir (visibilité sur les flux pour réconciliation comptable)
- **Sous-traitants** : Stripe (Stripe Payments France SAS + Stripe Inc.), Supabase (Postgres pour les références), Resend (notifications paiement / payout)

### Transferts hors UE
- Stripe Inc. (États-Unis) : transferts encadrés par clauses contractuelles types (SCC) Stripe + Data Processing Addendum signé via Dashboard

### Durée de conservation
- Références Stripe et flux comptables : **10 ans** (obligation Code de commerce + LCB-FT)
- Logs Stripe webhooks reçus (audit forensique) : 1 an (cf. T-06)

### Mesures de sécurité
- TerrOir n'a aucun accès aux données PCI (PAN/CVV) — périmètre SAQ-A (Self-Assessment Questionnaire A)
- Webhook Stripe vérifié par signature HMAC `stripe-signature` + IP allowlist soft-warn + rate-limit
- Assertion runtime `livemode` au boot serveur (anti déploiement mauvais env)
- Cap absolu producer self-refund (audit P0-TB F-014)
- Idempotency keys Stripe sur retentatives de remboursement
- Audit log forensique de tous les events Stripe sensibles

---

## T-04 — Notifications transactionnelles

### Finalité
Envoyer les emails / SMS opérationnels liés au cycle de vie d'une commande, du compte ou de la sécurité : confirmation commande, rappel retrait, paiement réussi/échoué, reset mot de passe, alerte sécurité, etc.

### Base légale
- **Exécution du contrat** (RGPD art. 6.1.b) pour les notifications liées à une commande / compte
- **Intérêt légitime** (RGPD art. 6.1.f) pour les alertes sécurité (login depuis nouvelle IP, changement d'email, etc.)
- **Consentement** (RGPD art. 6.1.a) pour les notifications SMS (opt-in explicite)

### Catégories de personnes concernées
Consommateurs et producteurs ayant un compte actif.

### Catégories de données
- Email destinataire
- Téléphone destinataire (uniquement si opt-in SMS)
- Contenu du message (généré à partir d'un template Resend / Twilio)
- Métadonnées : type d'event, template utilisé, statut d'envoi, horodatages

### Destinataires
- **Sous-traitants** : Resend (emails transactionnels via SMTP custom + API), Twilio (SMS — à confirmer si activé en prod)

### Transferts hors UE
- Resend : transferts via Amazon SES — SCC en vigueur (à confirmer)
- Twilio : USA — SCC en vigueur

### Durée de conservation
- Métadonnées d'envoi (table `notifications`) : conservées 90 jours côté in-app (purge automatique au-delà, cf. F-011 export portabilité)
- Contenu effectif des emails : journalisé côté Resend / Twilio selon leur politique (durée non maîtrisée par TerrOir — à documenter dans la politique de confidentialité)

### Mesures de sécurité
- Pas d'envoi de mot de passe en clair (magic link OTP token_hash uniquement)
- SPF + DKIM + DMARC configurés sur `terroir-local.fr` (OVH zone DNS)
- Templates Supabase Auth migrés vers `{{ .RedirectTo }}?token_hash=...`
- Notifications email non bloquantes côté webhook Stripe (waitUntil pattern)

---

## T-05 — Candidatures producteur (leads B2B)

### Finalité
Permettre à un producteur d'exprimer son intérêt pour rejoindre TerrOir (formulaire `/devenir-producteur`), gérer le pipeline d'acquisition côté admin, permettre l'opt-out via lien HMAC.

### Base légale
- **Consentement** (RGPD art. 6.1.a) — l'utilisateur soumet volontairement ses coordonnées via le formulaire public
- **Intérêt légitime** (RGPD art. 6.1.f) pour le traitement des leads créés en interne lors d'une invitation admin directe (source `invitation_directe`)

### Catégories de personnes concernées
Producteurs prospects (non encore inscrits sur la plateforme).

### Catégories de données
- Identité : prénom, nom
- Contact : email, téléphone
- Projet : nom d'exploitation envisagé, commune, espèces élevées, message libre
- Métadonnées : source (`formulaire_public` ou `invitation_directe`), statut (new / contacted / onboarded / opted_out), horodatages

### Destinataires
- **Interne** : admin TerrOir uniquement (`/producer-interests`)
- **Sous-traitants** : Supabase (Postgres), Resend (email d'opt-out HMAC)

### Transferts hors UE
Néant (Supabase UE + Resend SCC déjà couverts).

### Durée de conservation
- Lead actif : pour toute la durée du pipeline d'acquisition
- Lead opt-out (refus) : hard delete via flow opt-out token HMAC
- Lead inactif (pas de conversion 3 ans) : à anonymiser ou supprimer (à valider avec avocat)

### Mesures de sécurité
- Token opt-out HMAC SHA256 (audit P0-TT bonus F-027 : ajouter expiration + audit log)
- Flow opt-out 2-step (anti email scanner pré-fetch)
- Rate-limit applicatif sur POST `/api/producer-interests`
- Helper centralisé `upsertProducerInterest` idempotent

---

## T-06 — Audit forensique sécurité

### Finalité
Tracer les événements sensibles pour la sécurité du service (tentatives de login, changements d'email, signatures CGU/CGV, exercice des droits RGPD, événements de paiement, créations d'invitations admin, etc.) afin de détecter les abus (brute-force, énumération, comptes compromis) et de pouvoir répondre à un incident de sécurité ou à une demande judiciaire.

### Base légale
- **Intérêt légitime** (RGPD art. 6.1.f) — sécurité du service et lutte contre la fraude (RGPD art. 32 sécurité du traitement)
- **Obligation légale** (RGPD art. 6.1.c) — conservation pendant 1 an des logs de connexion (recommandation CNIL)

### Catégories de personnes concernées
Tout utilisateur ayant interagi avec une route sensible (auth, paiement, admin invite, etc.).

### Catégories de données
- `user_id` (nullable post-cascade RGPD — anonymisation post-deletion)
- `event_type` (énum strictement contrôlée côté code)
- `metadata` JSONB structuré (jamais de PII libre — emails masqués via `maskEmail`, pas d'IP en clair)
- `ip_address` : **masquée systématiquement** via `maskIp()` (/24 IPv4, /64 IPv6) avant INSERT — doctrine T-200 r1, F-010 audit P0-TT
- `user_agent`
- Horodatage

### Destinataires
- **Interne** : admin TerrOir uniquement (`/admin/audit-logs`, RLS admin-only en lecture)
- **Sous-traitants** : Supabase (Postgres)

### Transferts hors UE
Néant.

### Durée de conservation
**1 an** (recommandation CNIL pour les logs de sécurité authentification). Au-delà, purge automatique à planifier (cron à mettre en place — TODO post-launch).

### Mesures de sécurité
- Table `audit_logs` append-only — INSERT exclusif via `service_role` bypass RLS, aucune policy INSERT pour les rôles utilisateurs
- Helper `logAuthEvent` fail-safe (swallow + console.warn, jamais re-throw côté flow métier)
- IP toujours masquée via `maskIp` (audit P0-TT F-010)
- Email toujours masqué via `maskEmail` dans `metadata`
- FK `audit_logs.user_id → ON DELETE SET NULL` (cohérent RGPD art. 17 droit à l'oubli — la traçabilité forensique survit à la suppression du compte, mais sans identité directe)

---

## T-07 — Mesure d'audience (futur, non actif)

### Finalité (future)
Comprendre comment les utilisateurs interagissent avec le site (parcours, points de friction, conversion) pour améliorer l'expérience produit. Pas de revente à des tiers, pas de profilage publicitaire.

### Statut au 10 mai 2026
**Non activé**. Aucun outil de mesure d'audience (Google Analytics, Plausible, PostHog, etc.) n'est branché en production. Le composant `<CookieBanner />` est posé code-side (F-012 audit P0-TT) mais pas activé dans le layout — il sera mounté au moment du chantier T-201 (intégration PostHog).

### Base légale (future)
- **Consentement** (RGPD art. 6.1.a) — opt-in explicite via la bannière cookies (deny-by-default)

### Catégories de personnes concernées (futur)
Visiteurs du site ayant donné un consent explicite via la bannière `terroir-cookie-consent`.

### Catégories de données (futur)
- Identifiant pseudonyme PostHog (cookie tiers, à configurer en mode privacy-friendly)
- Pages visitées, événements UI agrégés
- **AUCUNE PII** captée dans les events (CP, lat/lng, email, phone, consumer_id, adresse → interdits par doctrine T-200 r1 + helper anti-PII `lib/analytics/track.ts` à créer)

### Destinataires (futur)
- **Sous-traitants** : PostHog (à confirmer — UE ou self-host)

### Transferts hors UE (futur)
À arbitrer selon hébergement PostHog choisi (PostHog Cloud EU vs US vs self-host).

### Durée de conservation (futur)
13 mois pour le cookie de consentement (recommandation CNIL), durée des events PostHog selon plan choisi (à configurer).

### Mesures de sécurité (futur)
- Bannière cookies bloquante avant tout chargement du script PostHog
- Helper `hasConsent('analytics')` consulté côté server ET client avant injection du script
- Helper anti-PII `lib/analytics/track.ts` avec assertion runtime + throw en dev pour repérer les leaks

---

## 10. Sous-traitants

| Sous-traitant | Service                                | Localisation données | Cadre transfert hors UE |
| ------------- | -------------------------------------- | -------------------- | ----------------------- |
| Supabase      | Hébergement Postgres + Auth + Storage  | UE (région configurée — à confirmer) | N/A si UE confirmée |
| Vercel        | Hébergement applicatif Next.js         | Edge mondial, data en UE (à confirmer) | SCC en vigueur (Vercel DPA) |
| Stripe        | Encaissement + Connect + payouts       | France (Stripe Payments France SAS) + USA (Stripe Inc.) | SCC + DPA signé |
| Resend        | Emails transactionnels                 | USA (via Amazon SES) | SCC en vigueur |
| Twilio        | SMS transactionnels (à confirmer actif)| USA                  | SCC en vigueur |
| Upstash       | Rate-limit Redis                       | UE (région configurée — à confirmer) | N/A si UE confirmée |
| OVH           | DNS + zone mail                        | France               | N/A |
| Mapbox        | Cartographie côté client (token public)| USA                  | Pas de PII traitée — uniquement coordonnées de producteurs floutées |
| PostHog       | Mesure d'audience (futur, non actif)   | À déterminer         | À cadrer avant activation |

---

## 11. Points à valider avec l'avocat

Le présent registre est un **draft technique** rédigé à partir de ce que le code et la documentation interne permettent d'inférer. Plusieurs points juridiques nécessitent un arbitrage avec l'avocat externe avant validation finale :

### Durées de conservation
- **Compte inactif** : 3 ans avant anonymisation ou suppression — pratique courante mais à confirmer pour TerrOir
- **Données comptables** : 10 ans (Code de commerce L123-22) — confirmer scope exact (montants, références Stripe, métadonnées d'order)
- **Données opérationnelles non-comptables** (notes client, slot info) : pratique courante 3 ans après dernière interaction — à confirmer
- **Producer interests** : 3 ans avant purge — à confirmer
- **Audit logs sécurité** : 1 an CNIL — à confirmer
- **Cookies analytics** : 13 mois CNIL — à confirmer post-activation T-201

### Bases légales
- Notifications transactionnelles : combinaison contrat + intérêt légitime + consentement (SMS) — à valider
- Audit forensique : intérêt légitime + obligation légale (logs auth 1 an) — à valider
- Producer interests source `invitation_directe` (admin a créé le lead pour un prospect) : qualification base légale — consentement implicite ou intérêt légitime ?

### Transferts hors UE
- **Confirmer la région data Supabase** (UE explicite ou multi-région ?)
- **Confirmer la région edge Vercel** pour la data sensible
- **Stripe SCC + DPA** : déjà signés via Dashboard, à archiver
- **Resend / Twilio** : SCC à vérifier et archiver
- **PostHog** : décision région à prendre avant T-201

### Désignation DPO
- Volume utilisateurs cible et nature des traitements (paiement, géolocalisation, opt-out producteur) — seuil obligatoire ? Recommandé ?
- Si pas de DPO formel, désigner un référent RGPD interne (Romain Lubin par défaut)

### Sous-traitants
- **DPA / Sub-Processing Agreement** à signer / archiver avec : Supabase, Vercel, Stripe, Resend, Twilio (si actif), Upstash, OVH, Mapbox
- **Liste des sous-traitants** à publier dans la politique de confidentialité (transparence art. 13/14)

### Droits des personnes
- **Droit d'accès** (art. 15) : couvert par l'export portabilité F-011 + accès profil compte
- **Droit de rectification** (art. 16) : couvert par `/compte/profil`
- **Droit à l'effacement** (art. 17) : couvert par `/compte/profil` suppression (hard delete sans orders, sinon anonymisation soft)
- **Droit à la portabilité** (art. 20) : couvert par `/compte/exporter-mes-donnees` (F-011) — format JSON + CSV
- **Droit d'opposition** (art. 21) : à expliciter dans la politique de confidentialité pour les notifications et le tracking analytics
- **Droit de limitation** (art. 18) : workflow à définir (suspension du compte sur demande user vs suppression)

### Mineurs
- TerrOir limite l'inscription à 18+ (à valider dans les CGU / CGV) — pas de captation de données mineures

### Transparence (art. 13/14)
- Politique de confidentialité publique (`/politique-confidentialite`) à mettre à jour pour refléter ce registre — alignement avec l'avocat sur le wording exact (notamment §2 sur les sous-traitants et §5 sur les durées)

---

## 12. Mises à jour

| Date       | Version | Auteur              | Nature                                     |
| ---------- | ------- | ------------------- | ------------------------------------------ |
| 2026-05-10 | 1.0 draft | Chantier P0-TT F-013 | Rédaction initiale à partir du code + audit |

Toute modification de ce registre doit faire l'objet d'un commit git tracé.
