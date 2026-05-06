# Rétention audit_logs — politique TerrOir

> **Source** : `lib/audit-logs/log-*.ts` (clusters helpers) + table `public.audit_logs` (migration `20260427100000_create_audit_logs.sql`).
> **Statut** : T-082 livré 2026-05-07.
> **Articulation** : à inscrire au registre des traitements RGPD (article 30) et à mentionner dans la politique de confidentialité producer (T-207 / T-261 pré-Live).

Ce document fixe la durée de conservation, la base légale et les modalités de purge des events de la table `public.audit_logs`. Il est volontairement court : la table n'a qu'un schéma et une politique de rétention par cluster d'event_type.

---

## TL;DR

- Rétention par défaut **24 mois** glissants pour tous les clusters d'audit_logs.
- Base légale : **intérêt légitime** (RGPD article 6.1.f) — sécurité plateforme + traçabilité actions admin + obligations probatoires (litiges Stripe, DGCCRF, RGPD).
- Cluster `admin_invite_*` (5 events) contient l'email du destinataire d'une invitation B2B producteur — donnée personnelle même en contexte professionnel.
- Purge à mettre en place via job batch SQL (cron Vercel ou pg_cron) post-Live, non bloquant pour l'ouverture publique.

---

## Schéma de la table

```sql
public.audit_logs (
  id           uuid PRIMARY KEY,
  user_id      uuid NULL,
  event_type   text NOT NULL,
  metadata     jsonb NOT NULL DEFAULT '{}',
  ip_address   text NULL,
  user_agent   text NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
)
```

Chaque event_type est un identifiant technique snake_case (`account_login_password`, `admin_invite_sent`, `order_payment_succeeded`, etc.). Les libellés humains FR sont mappés dans `lib/audit-logs/labels.ts`.

---

## Données personnelles présentes

Inventaire des events qui transportent une PII identifiable, par cluster.

### Cluster `admin_invite_*` (5 events) — emails B2B producteur

| event_type | PII présente |
|---|---|
| `admin_invite_sent` | `metadata.invitation_email` |
| `admin_invite_draft_resend` | `metadata.invitation_email` |
| `admin_invite_blocked_admin` | `metadata.invitation_email` |
| `admin_invite_blocked_producer` | `metadata.invitation_email` |
| `admin_invite_expired` | `metadata.token_prefix` (8 premiers car. du token, non-PII) + user_id si session |

L'email du destinataire d'une invitation est une donnée personnelle au sens RGPD même en contexte B2B (article 4.1 — toute information se rapportant à une personne physique identifiée ou identifiable). La forme `prenom.nom@ferme.fr` est typiquement nominative.

### Cluster `auth_*` — emails login/signup

- `account_signup`, `account_login_password`, `account_login_magic_link`, `account_logout`, `password_reset_request`, `password_changed`, `email_change`, `account_email_change_completed`
- PII : `user_id` (FK auth.users), parfois `metadata.email` ou `metadata.email_target_masked` selon event.
- `metadata.ip_address` / `metadata.user_agent` posés par `extractRequestContext` → traçabilité réseau.

### Cluster `order_*` / `stripe_*` / `payment_*` — orders + Stripe

- `metadata.order_id`, `metadata.payment_intent_id`, `metadata.refund_id`, `metadata.stripe_account_id`, `metadata.amount`.
- PII indirecte via `user_id` (FK consumer) + `metadata.consumer_id` / `metadata.producer_id` parfois.
- Pas d'email/téléphone/adresse en clair.

### Cluster `pickup_*`, `producer_response_*`, `notification_*`, `admin_*` (categories/animals/cuts/legal)

- Pas de PII directe en metadata (UUIDs, texte rédactionnel, codes commande hashés).

### IP et User-Agent

- `audit_logs.ip_address` et `audit_logs.user_agent` sont posés par les helpers `logAuthEvent` (et descendants via `logAdminInviteEvent`).
- Doctrine T-200 r1 : pas de log par-IP côté serveur en dehors de cette table audit forensique. Les IPs ici sont nécessaires pour la détection brute-force / forensique, pas pour du profilage.

---

## Durée de conservation

### Choix retenu : **24 mois glissants** (durée unique tous clusters)

Rationale :

1. **Médiane standard secteur** marketplace : 12-36 mois pour les logs admin/auth/payment. 24 mois = milieu de fourchette.
2. **Contraintes probatoires**
   - Litige Stripe / chargeback : Stripe permet le dispute jusqu'à ~120 jours après transaction (Visa/MC), retraitement possible 540 jours. 24 mois couvre largement.
   - Réquisition DGCCRF (déclaration véracité T-241) : demande typique sur 24 mois.
   - Obligation RGPD article 5.1.e : conservation limitée à la durée nécessaire — 24 mois est défendable face à la CNIL pour des logs de sécurité plateforme.
3. **Volume DB** : audit_logs croît linéairement avec le trafic. 24 mois sur volume estimé pré-Live (quelques centaines d'events/jour) reste sous le seuil de friction performance — pas de TimescaleDB ni partitionnement nécessaires.
4. **Cohérence inter-clusters** : une rétention unique simplifie le job de purge (un seul cron, un seul WHERE created_at < now() - interval '24 months'). Différencier par cluster ajouterait de la dette opérationnelle sans bénéfice juridique mesurable.

### Pas de rétention infinie

Stocker indéfiniment des emails B2B + IP utilisateurs irait contre l'article 5.1.e RGPD (limitation conservation). Aucun cluster n'exige une rétention supérieure à 24 mois côté probatoire — au-delà, les preuves perdent leur fraîcheur opérationnelle.

### Cas particuliers — rétention prolongée ad-hoc

Si une investigation forensique active (intrusion, dispute en cours, réquisition judiciaire) requiert la conservation d'events au-delà de 24 mois, l'admin extrait les rows concernés via la page `/admin/audit-logs` (export CSV) ou un script SQL ad-hoc. La table audit_logs reste immuable côté applicatif (pas d'INSERT user-side, pas d'UPDATE/DELETE applicatif), seul un job de purge service_role peut DELETE par batch.

---

## Base légale RGPD

**Intérêt légitime** (RGPD article 6.1.f). Rationale du test de mise en balance (test des 3 étapes CNIL) :

1. **Finalité légitime**
   - Sécurité plateforme : détection brute-force, énumération comptes, abus admin.
   - Traçabilité actions admin : qui a fait quoi quand (cluster `admin_*`, `producer_response_removed_by_admin`, etc.).
   - Probatoire métier : reconstitution chronologie commande/refund pour litige Stripe ou réclamation consumer/producer.
   - Obligation DGCCRF (déclaration véracité T-241) : preuve forensique du wording validé par le producer à un instant T.

2. **Nécessité**
   - Pas d'alternative moins intrusive : sans table audit centralisée, pas de forensique post-incident possible. Les Vercel function logs sont éphémères (~24h-7j selon plan), Supabase logs auth ne couvrent pas les events métier.
   - Rétention 24 mois calibrée sur cycle de litige Stripe + cycle réquisition DGCCRF + cycle audit RGPD interne.

3. **Mise en balance droits / intérêts**
   - Les PII présentes (email B2B, IP) sont déjà connues de l'admin via d'autres canaux (table `users`, table `producer_invitations`, dashboard Stripe). Le risque incrémental d'avoir aussi l'email dans `audit_logs.metadata` est faible.
   - Accès restreint : page `/admin/audit-logs` derrière `requireAdmin` (RLS policy + check session.isAdmin), rate-limit lookup email 30/min/admin (T-083), audit log meta `admin_audit_logs_email_lookup` posé à chaque recherche par email pour détecter abus d'un admin compromis.
   - Masquage automatique : la fonction `maskEmail` dans `lib/audit-logs/email-lookup.ts` masque les emails dans le metadata d'audit log de lookup (`l***@d***.fr`) — l'email full ne sort jamais des cellules `metadata` originales sans clic explicite admin.

L'utilisateur producteur peut exercer son droit d'opposition (article 21 RGPD) en demandant la purge anticipée de ses events `admin_invite_*` post-désinscription. Procédure manuelle via support contact@terroir-local.fr (pas d'UI self-service à cette échelle).

---

## Articulation avec autres traitements

- **Registre des traitements RGPD (T-208 + T-284)** : ajouter une fiche « Journal d'audit » avec finalités ci-dessus, base légale intérêt légitime, durée 24 mois, destinataires (admins TerrOir uniquement), transferts hors UE = aucun (Supabase eu-west-3).
- **Politique de confidentialité producer (T-207)** : mention claire de l'existence du journal d'audit, de la durée 24 mois et des droits d'accès/opposition.
- **CGU producteur (T-286)** : clause de transparence — le producteur est informé que ses interactions admin (invitation, onboarding, déclaration véracité) sont tracées en `audit_logs` avec timestamp + metadata.
- **Doctrine déclaration véracité (T-241)** : les colonnes `producers.declaration_indicateurs_*` ont leur propre rétention (cf. T-285/T-290). Pas confondre avec audit_logs.

---

## Mécanisme de purge — backlog post-Live

Pas implémenté pré-Live (volume négligeable les 3 premiers mois). À mettre en place une fois le trafic stabilisé :

```sql
-- Job mensuel (via Vercel cron ou pg_cron)
DELETE FROM public.audit_logs
WHERE created_at < (now() - interval '24 months');
```

Précautions :

1. Run en service_role (RLS bypass nécessaire — il n'existe pas de policy DELETE pour les admins par design).
2. Batch DELETE par tranches de 10 000 rows pour éviter un long lock.
3. Smoke test post-purge : count restant + timestamps min/max.
4. Avant chaque purge mensuelle : vérifier qu'aucune investigation active n'est en cours (procédure manuelle, à formaliser dans `docs/runbooks/`).

Cf. backlog `docs/TODO.md` pour la création du chantier dédié post-Live.

---

## Liens

- Code : `lib/audit-logs/log-*.ts` (8 helpers cluster), `lib/audit-logs/labels.ts`, `lib/audit-logs/email-lookup.ts`.
- Migration : `supabase/migrations/20260427100000_create_audit_logs.sql`.
- UI admin : `app/(admin)/audit-logs/page.tsx`.
- Convention RGPD widget distance (parallèle) : `docs/security/registre-traitements-widget-distance-2026-05-06.md`.
- Checklist pré-Live : `docs/runbooks/checklist-pre-live-2026-05-06.md` (T-082 P1).
