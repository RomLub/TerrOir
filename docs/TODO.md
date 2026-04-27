# TODO TerrOir

Priorités forward-looking uniquement. Pour l'historique complet des commits / chantiers clos, voir [`CHANGELOG.md`](./CHANGELOG.md). Pour les leçons apprises / pitfalls thématiques, voir [`LESSONS.md`](./LESSONS.md).

## 🟠 En cours

_(rien en cours)_

## 🔴 Bugs ouverts

_(rien d'ouvert)_

> **Bug magic link PKCE** (ouvert 26/04 → résolu 26/04) — Option B retenue : bascule au flow OTP `token_hash` + cookie deep-link cross-subdomain HttpOnly (commit `09c219d`). Plan d'investigation initial devenu obsolète. Workarounds UX (commits `92bbff7` messages erreur + `6c2b5ef` bouton « demander nouveau lien magique ») conservés comme filet de sécurité pour autres causes possibles (lien expiré, lien invalide). Cf `CHANGELOG.md` section « Bug magic link PKCE — RÉSOLU » et `LESSONS.md` section « Auth & sessions ».
>
> **Bug navbar CTA disparition au hard refresh** (ouvert 26/04 → résolu 26/04) — Fix immédiat : retrait du branch `loading ?` (commit `209ce83`). Fix robuste : `initialUser` SSR passé du root layout au `UserProvider` (commit `6a9ebd3`) — élimine totalement le flash hydration côté visiteur anonyme. Pattern étendu ensuite à `isAdmin` (commit `404bb0d`) puis `isProducer` (commit `20304e9`).
>
> **Bug stock non restauré à l'annulation (P0)** (ouvert 26/04 → résolu 26/04) — RPC `create_order_with_items` décrémentait le stock à l'INSERT mais aucun chemin ne ré-incrémentait à l'annulation (3DS-fail webhook, cron timeout, cancel route, refund route). Fix via trigger DB `orders_restore_stock_after_cancel` (commit `4584139` + migration `20260427200000`). Apply prod 26/04. Validation prod end-to-end OK (Salade mesclun stock 50→47→50 sur 3DS-fail).
>
> **Bug commande fantôme à l'échec 3DS (P2)** (ouvert 26/04 → résolu 26/04) — webhook `payment_intent.payment_failed` ne posait pas `cancellation_reason`, bypassait `assertTransition`, n'invalidait pas `public-stats`, et pouvait rétrograder une commande `confirmed` si Stripe émettait `failed` après `succeeded`. Fix via extraction `lib/stripe/handle-payment-failed.ts` (return enum 5 valeurs + 7 tests vitest, commit `9482e5b`) + UI exclusion consumer `payment_failed` + badge admin "Tentative échouée" distinct (commit `56ab733`). Backfill TRR-AM2UN apply 26/04. Validation prod end-to-end OK.
>
> **Bug idempotence retentative paiement (P1)** (ouvert 26/04 → résolu 26/04) — webhook `payment_intent.succeeded` rejetait la transition `cancelled → confirmed` en `webhook_anomaly`, laissant l'order figée alors que Stripe avait encaissé le 2e paiement. Fix via résurrection conditionnelle `cancelled+payment_failed → pending` dans `lib/stripe/handle-payment-succeeded.ts` (commit `49c0f1b`, return enum 6 valeurs + 8 tests vitest). Cible `pending` (pas `confirmed`) — corrige le brief initial après push back terminal CC. Reset `cancellation_reason` et `cancelled_at` à NULL pour préserver l'invariant projet. Validation prod end-to-end OK (commande TRR-7235E).
>
> **Bug stock non re-décrémenté à la résurrection (P1 résiduel)** (ouvert 27/04 matin → résolu 27/04 matin) — détecté en validation prod end-to-end après commit `49c0f1b` : la résurrection `cancelled → pending` ne re-décrémentait pas le stock (UPDATE direct sans toucher products, et le trigger DB de restauration ne couvre pas le sens inverse intentionnellement). État pathologique : order TRR-7235E pending avec quantité 3 mais stock affiché 50 au lieu de 47. Fix via chantier P1 robuste 3 commits successifs (`6b4a835` RPC SQL atomique + `9d6cb13` webhook handler avec refund Stripe automatique sur paths bloqués + `5a572b2` UI consumer revival_blocked + extension filtre). Validation prod end-to-end OK (commande TRR-KKKDL : stock Salade mesclun 50→47, audit_logs `order_payment_failed` + `order_revival_succeeded` 5s d'écart).

## 🔴 À faire (bloquants lancement)

- **Onboarder Julien (GAEC du Rheu)** — pages landing Stripe Connect `/connect/done` + `/connect/refresh` désormais en place (commit `e93043e`), mais onboarding end-to-end Stripe Live pas encore testé en situation réelle. À garder bloquant tant que le flow n'est pas validé avec un vrai producer.
- **Basculer Stripe en mode Live** (aujourd'hui en Test). Mode Test entièrement validé 26-27/04 : webhook URL ✅, désactivation Link account-wide ✅, scénarios 3DS complete + fail ✅, retentative paiement après 3DS-fail ✅. Au moment de la bascule Live, créer un nouveau webhook endpoint dans Stripe Dashboard pointant sur `https://www.terroir-local.fr/api/stripe/webhook` en mode Live (le webhook actuel est en mode Test).

## 🔐 Avant lancement public

**Audit tech externe pré-lancement** (~2-4 k€, 1-2 semaines) :

- Pentest complet de l'application
- Review des policies RLS Supabase (toutes les tables)
- Review des server actions sensibles : checkout Stripe, paiements, RGPD, invitation admin
- Review du webhook Stripe et flows de paiement
- Audit des flows Stripe Customer + Connect (commission, payouts)
- Review de la conformité RGPD (registre, consentements, droits)
- Tests de charge sur endpoints critiques (`create-payment-intent`, `create-order-with-items` RPC, `search_producers`)
- Vérification absence d'injections SQL latentes

À déclencher avant le go-live public (avant premiers clients payants). Prévoir avant la bascule Stripe Test → Live.

## 🟡 À faire (non bloquants)

### Externes / config

- **Mapbox** : en attente retour CB.
- **Twilio SMS** : numéro FR à régler.
- **Vectormagic logo SVG** (8,99€).
- **Remplacer images Unsplash** provisoires par vraies photos producteurs.
- **Mentions légales footer pro** — page absente, le footer pro pointe sur un href mort. À créer une fois le contenu juridique disponible (action externe Romain).
- **SMTP custom Supabase Resend à configurer (recommandé avant lancement)** — observation récente : mails Auth atterrissant en spam. Configurer Resend en SMTP custom (rate limit Supabase built-in ~3-4/h, non destiné à la production) serait propre. Action externe Romain via Dashboard.
- **Templates Supabase Auth Email — validation visuelle complète** — Magic Link template à mettre à jour avec `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=magiclink` (action Romain post-PKCE Option B, commit `09c219d`). Reset Password template à mettre à jour avec `${SITE_URL}/reinitialiser-mot-de-passe?token_hash={{ .TokenHash }}&type=recovery` (action Romain post-`5ff9394`). Confirm Signup, Change Email, Invite User pas testés visuellement (rendus mais flow end-to-end non validé). Action externe Romain via Dashboard.
- **Branding Stripe Connect** — flag pendant la session 27/04 pour ne pas mélanger avec les bugs critiques. Investigation dédiée future avec accès doc Stripe à jour (logo, couleurs, pages `/connect/*`, branding marketplace).
- **Webhook Stripe mode Live** — créer un nouveau webhook endpoint dans Stripe Dashboard pointant sur `https://www.terroir-local.fr/api/stripe/webhook` au moment de la bascule Test → Live. Mode Test confirmé déjà OK (validation 27/04 matin).

### Chantiers code futurs

- **Chantier "alignement routes orders"** — recoller 3 dettes liées sur les routes d'annulation/refund (flag par rapports TB `799bf71` et `f32d083`) :
  - `app/api/stripe/refund/route.ts` : `assertTransition` + `revalidateTag('public-stats')` + suite vitest manquantes.
  - `app/api/cron/order-timeout/route.tsx` : check d'erreur UPDATE silencieuse (B1+B2 documentés via `it.todo` dans tests `f32d083`) + `revalidateTag` (B3 absent vs webhook payment_failed).
  - 3 routes d'annulation à harmoniser avec les mêmes patterns (state machine + stats invalidation + error handling).
- **Pré-fetch SSR `ProducerLite` pour éliminer flash placeholder ProducerLayout** — flag boolean `isProducer` SSR (commit `20304e9`) résout le flash CTA mais `ProducerLayout` dépend de l'objet producer complet (`nom_exploitation`, `slug`, `statut`). Pré-fetch d'un objet allégé `ProducerLite` côté SSR éliminerait aussi ce flash. Pattern réplicable. Non bloquant — flash très court.
- **Cron retry-failed-refunds** (chantier dédié futur) — détecter via `audit_logs.event_type` les `*_refund_failed` non réconciliés (refund admin manuel route `/api/stripe/refund`, refund cron `order-timeout`, refund résurrection P1 robuste) et retenter automatiquement, ou alerter admin pour intervention. Couverture forensique `logPaymentEvent` posée par chantier P1 robuste 27/04 sert de base de détection (`order_revival_refund_failed` event type).
- **Dédup webhook notifications** (chantier dédié futur) — table `webhook_events_processed(event_id, processed_at)` avec INSERT ON CONFLICT pour bloquer le rejouage Stripe côté code applicatif. Couvre tous les webhook handlers Stripe (`succeeded`, `payment_failed`, `account.updated`, `payout.paid`). Pertinent à instrumenter avant volume significatif (rejouage Stripe rare aujourd'hui, mais double email producer possible si ça arrive).
- **Migration `transformWithEsbuild` deprecated → `transformWithOxc`** (warning vitest 4 / rolldown-vite, commit `f32d083`) — non bloquant, à migrer quand l'API `transformWithOxc` est stable.
- **Transition auto lead `'contacted'` → `'onboarded'`** quand le wizard est finalisé (Étape 3 soumise). Aujourd'hui la transition n'existe pas, les leads restent bloqués en `'contacted'` même après onboarding complet. À implémenter dans `complete-onboarding.ts` (server action Étape 3) : `UPDATE producer_interests SET statut='onboarded' WHERE email = session.email AND statut='contacted'` (no-op si pas de match, cohérent avec le bump auto de `dbe6360`).
- **Flux invitation : cas "email déjà en base"** à détecter proprement côté UX (au-delà de la correction fonctionnelle du Chantier 2).
- **Backfill producers `count = 0`** — réévaluer avant chaque lancement. Aujourd'hui négligeable (faible volume), à garder en tête si le funnel monte.

### Investigations produit (à trancher)

- **Consumer cancel route** — la route `/api/orders/[id]/cancel/route.tsx` interdit aujourd'hui au consumer d'annuler sa propre commande (403). Voulu (philosophie anti-abus) ou trou (oubli) ? Si décision = autoriser, ajouter check `session.id === order.consumer_id`. Le test D1 (commit `280ff69`) deviendra un FAIL volontaire qui guidera le fix. Cf rapport TC inspection cancel route 27/04.
- **Transition `ready → refunded` illégale** — fallback à `cancelled` via `canTransition()` dans cancel route (lignes 97-99). Décision produit à prendre : doit-elle être légale ? Cas concret : un client demande remboursement après que le producer a marqué la commande prête à retirer mais avant le retrait effectif. Implique modif `lib/orders/stateMachine.ts` + tests + handler. Cf rapport TC commit `f57d5ad`.
- **Aligner guards `canTransition` vs `isTerminal`** — asymétrie API state machine : `canTransition` tolère statut invalide via `?.` (ligne 27), `isTerminal` accès direct (ligne 47, crasherait sur statut invalide). Soit garder l'asymétrie volontaire avec commentaire JSDoc explicatif, soit ajouter un guard. Cf rapport TC commit `f57d5ad`.
- **Confirm route sans garde rôle explicite** — asymétrie vs cancel route : un admin non-owner d'aucun producer ne peut pas confirmer au nom d'un producer absent. Voulu (philosophie séparation des rôles) ou trou ? Cf rapport TB commit `81b3c1a`.

### Audit logs

- **UI admin pour `audit_logs`** — la table existe et est alimentée (5 events auth Phase 1 instrumentés post-`acd8c03` + 6 events payment Phase 2 instrumentés post-chantier P1 robuste 27/04), mais aucune page back-office pour consulter les logs côté admin. Chantier futur : page `/admin/audit-logs` avec filtres par event_type, user_id, date range, pagination. D'autant plus utile maintenant que la table contient aussi les events payment forensiques (refunds, résurrections, blocages).
- **Events audit additionnels Phase 3** — Phase 1 (auth, 5 events) ✅ + Phase 2 (payment, 6 events : `order_payment_succeeded` / `order_payment_failed` / `order_revival_succeeded` / `order_revival_blocked_stock` / `order_revival_blocked_slot` / `order_revival_refund_failed`) ✅. Restent à instrumenter en Phase 3 : `account_signup`, `email_change`, `account_deletion` (RGPD), `admin_login` (event distinct du password login pour traçabilité forensique admin spéciale), `role_change` (promotion consumer→producer, suspend/reactivate, etc.), Stripe events spécifiques (charge, dispute, payout completed/failed). Chantier futur dédié.

### Auth / cleanup

- **Suppression page legacy `/reset-password` (~1 semaine post-deploy)** — la nouvelle page dédiée `/reinitialiser-mot-de-passe` (commit `5ff9394`) la remplace. Garder la legacy ~1 semaine pour absorber les emails reset password en transit avec l'ancien template, puis supprimer.
- **Code mort résiduel commit `d4088d5` (~1-2 semaines fenêtre rétro-compat PKCE)** — depuis la bascule OTP `token_hash` (commit `09c219d`), le flow PKCE magic link n'est plus utilisé. Code de gestion `?code=` côté `/auth/callback` devient mort à expiration de la fenêtre de rétro-compat (~1-2 semaines pour absorber les anciens emails magic link en transit). Purge prévue post-fenêtre.
- **Phase 3 finale vision funnel — DROP COLUMN `prenom_affichage`** — sous-chantier `reads` livré post-marathon (commits `894fa5e` + `1110816`) : toutes les lectures publiques migrées vers `users.prenom`. Restent à faire : retirer les écritures `prenom_affichage = 'À compléter'` dans les 3 INSERT runtime (`create-account.ts`, `login-and-upgrade.ts`, `invitation/page.tsx` SSR), retirer le champ `prenom_affichage` du wizard + édition onboarding, retirer `producers.prenom_affichage` côté seed/cleanup, migration DROP NOT NULL puis DROP COLUMN. Chantier dédié (~10-15 fichiers).

## 🗺️ Roadmap produit (vision Avril 2026)

> Feuille de route définie le 22/04/2026. 3 niveaux de priorité. Chaque item = une fonctionnalité produit à scoper techniquement le moment venu.

### Priorité HAUTE (prochaines semaines)

1. **Prix GMS sur chaque fiche produit**
   Prix moyen constaté en grande surface (source RNM FranceAgriMer) affiché à côté du prix éleveur. Mis à jour manuellement chaque mois via interface admin.
   *Impact : justifie le prix, montre que circuit direct = moins cher pour qualité supérieure.*
   (Base de données · Interface admin · Fiche produit)

2. **Le conseil de l'éleveur** ✅ livré (commits `ffea6b2` + `07a65d4`, 23/04). Voir `CHANGELOG.md`.
   *Reste l'évolution UI cliquable popover (cf section 🔵 Idées).*

3. **Score carbone & bien-être animal**
   Sur la page producteur : km parcourus vs moyenne GMS (~1500 km), mode d'élevage (plein air/bâtiment), alimentation, densité. Remplis par le producteur à l'onboarding.
   *Impact : transparence concrète, argument écologique mesurable sans jargon de label.*
   (Onboarding producteur · Page producteur publique)

### Priorité MOYENNE (prochain trimestre)

4. **Carte interactive des morceaux**
   Schéma SVG interactif (vache, puis porc, agneau). Clic sur un morceau → nom + conseils cuisson + redirection produits disponibles chez les éleveurs TerrOir.
   *Impact : éducatif, unique sur le marché. Aide à découvrir des morceaux moins connus, augmente le panier moyen.*
   (Page publique · Catalogue · UX éducatif)

5. **Schéma interactif circuit court vs GMS**
   Infographie animée sur `/comment-ca-marche` montrant parcours d'un morceau GMS (éleveur → abattoir → transporteur → centrale → GMS → consommateur) vs TerrOir (éleveur → TerrOir → consommateur). Impact sur prix et rémunération éleveur.
   *Impact : argument de conversion puissant, rend concret l'avantage du circuit court.*
   (Page `comment-ca-marche` · Marketing)

6. **D'où vient ma viande**
   Page confirmation + historique commandes : mini-carte du trajet exploitation → point de retrait avec km. Comparaison avec moyenne GMS (1500 km).
   *Impact : moment émotionnel fort après achat, renforce satisfaction et fidélisation, potentiel partage social.*
   (Page confirmation · Historique commandes · Carte)

7. **Alerte disponibilité produit**
   Produit indisponible → consumer laisse email → prévenu au retour en stock. Producteur voit dans dashboard combien de personnes attendent chaque produit.
   *Impact : réduit perte de clients, donne visibilité sur la demande réelle au producteur.*
   (Fiche produit · Dashboard producteur · Email)

8. **Calculateur d'impact à la confirmation**
   Sur page confirmation : « Merci. Grâce à vous, Julien a gagné X€ de plus qu'en circuit classique. » Calculé depuis montant commande et taux moyen rémunération éleveur en circuit long (~30%).
   *Impact : crée sentiment de participation et de sens, fidélise au-delà du simple achat.*
   (Page confirmation · Impact social)

### Priorité BASSE (second semestre 2026)

9. **Compteur impact global plateforme**
   Home + `/a-propos` : « Depuis le lancement, les éleveurs TerrOir ont gagné X€ de plus qu'en circuit classique. » Calcul automatique depuis commandes en base.
   *Impact : argument de marque fort, dimension collective et militante à chaque achat.*
   (Home · Page à-propos · Marketing)

10. **Abonnement panier mensuel**
    Commande récurrente chez un éleveur. Paiement auto, notification avant débit, pause/annulation. Producteur voit ses abonnés.
    *Impact : revenus récurrents, fidélisation max. Nécessite travail juridique CGV.*
    (Stripe recurring · Dashboard producteur · CGV)

11. **Carte cadeau & fidélité**
    Carte cadeau TerrOir (crédit en euros, utilisable chez n'importe quel éleveur). Dans un 2e temps : système points de fidélité (X points/€ dépensé, convertibles en réduction).
    *Impact : levier d'acquisition et de rétention.*
    (Stripe · Système de points · Acquisition)

12. **Glossaire du terroir**
    Pages expliquant labels (Label Rouge, AB, AOC…), races (Charolais, Maine-Anjou…), modes d'élevage. Contenu evergreen SEO.
    *Impact : SEO long terme, éducation consumer, autorité éditoriale terroir sarthois.*
    (SEO · Contenu · Pages statiques)

## 🗺️ Vision funnel producteur (Phase 1 + 2 livrées, Phase 3 reportée)

> Refonte cohérence admin leads / producteurs décidée 2026-04-24 après analyse de la confusion entre les 2 espaces admin (`/producer-interests` et `/gestion-producteurs`). Phase 1 + 2 livrées 26/04 (cf `CHANGELOG.md` 2026-04-26). Phase 3 (DROP `prenom_affichage`) reportée à une session dédiée.

### Parcours cible

1. Formulaire `/devenir-producteur` → lead `statut='new'` `source='formulaire_public'` (**Nouveau**). ✅ livré (Phase 2)
2. Admin clique « Inviter » → lead `statut='contacted'` (**Contacté**) + email envoyé. Si l'email n'est pas déjà en base, création auto d'un lead `source='invitation_directe' statut='contacted'`. ✅ livré (Phase 1)
3. Producteur remplit wizard (2 étapes : compte + infos exploitation, avec champs du lead pré-remplis) → lead passe `'onboarded'` + producer apparaît dans Gestion `statut="En attente de validation"`. ✅ livré (Phase 2 — wizard 2 étapes + pre-fill via `pick-initial-infos`)
4. Admin valide dans Gestion → producer `statut="Inactif"` (peut accéder à son espace, pas encore visible publique).
5. 3 conditions remplies → producer passe `"Public"` automatique : ✅ livré (commit `4911401` 26/04 — 3 conditions cumulatives auditées + 21 tests)
   - Au moins 1 produit publié
   - Stripe Connect actif (`charges_enabled=true` via webhook `account.updated`)
   - Au moins 1 créneau configuré
6. Statuts ultérieurs : `"Suspendu"` / `"Supprimé"`.

### Phase 3 — DROP `prenom_affichage` (sous-chantier reads ✅, finale en attente)

> Décision 24/04 : réutiliser `users.prenom` directement pour signer le post-it « Conseil de [prenom] » au lieu d'un champ dédié.
>
> **Sous-chantier `reads` ✅ livré post-marathon** (commits `894fa5e` helper + `1110816` lectures, 26/04) : helper `getProducerDisplayName(producer)` créé, toutes les lectures publiques + pré-fill wizard migrées vers `users.prenom`. `fetch-public` joint `users(prenom)` via la FK `user_id`. Les écritures restent conservées (placeholder `'À compléter'`) pour éviter une fenêtre rétro-incompat.
>
> **Phase 3 finale (DROP COLUMN) en attente** — chantier dédié futur (~10-15 fichiers).

Plan de migration finale :

1. Retirer les écritures `prenom_affichage = 'À compléter'` dans les 3 INSERT runtime : `create-account.ts`, `login-and-upgrade.ts`, `invitation/page.tsx` SSR.
2. Adapter `StepInfos` (ex-`StepEntreprise`, renommé commit `acc080b`) : retirer le champ + validation.
3. Adapter `app/(producer)/onboarding/page.tsx` : retirer le champ d'édition.
4. Mettre à jour les seeds + cleanup-seed (retirer les writes `prenom_affichage`).
5. Migration SQL : DROP NOT NULL puis DROP COLUMN `producers.prenom_affichage`.
6. Purger le fallback `producer.prenom_affichage` dans `getProducerDisplayName` (le helper devient un simple read sur `users.prenom`).
7. Tests à refresh.

### Phase 2bis — UI `/producer-interests` colonne `source` ✅ livré

Livré post-marathon (commit `e5c4234`) : badge vert « Public » / orange « Invité » à côté du nom de chaque lead pour distinguer `formulaire_public` vs `invitation_directe`. Composant `LeadSourceBadge` réutilise `StatusDotBadge`. Voir aussi note d'incident traçabilité commit `894fa5e` (CHANGELOG).

### Ordonnancement

**Reste à scoper** : Phase 3 finale (DROP COLUMN `prenom_affichage`). **Prioriser après les bloquants lancement restants** (bascule Stripe Live, onboarder Julien). Le bug magic link PKCE est résolu (Option B retenue, commit `09c219d`).

## 🔵 Idées / améliorations

- Notation/reviews producteurs (cadre existant via reviews mais flow à valider).
- Export comptable consommateurs + producteurs.
- Gestion des litiges (retrait non effectué, marchandise abîmée).
