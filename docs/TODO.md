# TODO TerrOir

Priorités forward-looking uniquement. Pour l'historique complet des commits / chantiers clos, voir [`CHANGELOG.md`](./CHANGELOG.md). Pour les leçons apprises / pitfalls thématiques, voir [`LESSONS.md`](./LESSONS.md).

## 🟠 En cours

- **Refonte homepage consumer (Phase 1)** — implémentation Next.js de la maquette livrée par Claude Design (session 27/04). Branche `feature/home-refonte`, terminal CC en Phase C (PUSH 1-7). Inputs : bundle `~/Downloads/design_handoff_terroir/` (19 cards design system + screens desktop/mobile + tokens) + fichier source `~/Desktop/Logo.svg` (8 paths vectoriels propres + calque JPEG modèle masqué à nettoyer). Migration Button.primary green-700 → terra-700 + ajout variants `success` (green-700, validations métier) et `accent` (green-700, transitional pour call sites admin/producer). 14 fichiers consommateurs à auditer. Phase 2 (fiches produit, panier, checkout, refonte UI kits producer/admin) reportée à sessions dédiées ultérieures.

## 🔴 Bugs ouverts

_(rien d'ouvert)_

## 🔴 À faire (bloquants lancement)

- **Onboarder Julien (GAEC du Rheu)** — pages landing Stripe Connect `/connect/done` + `/connect/refresh` désormais en place (commit `e93043e`), mais onboarding end-to-end Stripe Live pas encore testé en situation réelle. À garder bloquant tant que le flow n'est pas validé avec un vrai producer.
- **Basculer Stripe en mode Live** (aujourd'hui en Test). Au moment de la bascule, créer un nouveau webhook endpoint dans Stripe Dashboard pointant sur `https://www.terroir-local.fr/api/stripe/webhook` en mode Live (le webhook actuel est en mode Test).

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

- **Twilio SMS** : numéro FR à régler.
- **Mentions légales footer pro** — page absente, le footer pro pointe sur un href mort. À créer une fois le contenu juridique disponible (action externe Romain).
- **SMTP custom Supabase Resend à configurer (recommandé avant lancement)** — observation récente : mails Auth atterrissant en spam. Configurer Resend en SMTP custom (rate limit Supabase built-in ~3-4/h, non destiné à la production) serait propre. Action externe Romain via Dashboard.
- **Templates Supabase Auth Email — validation visuelle complète** — Magic Link template à mettre à jour avec `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=magiclink` (action Romain post-PKCE Option B, commit `09c219d`). Reset Password template à mettre à jour avec `${SITE_URL}/reinitialiser-mot-de-passe?token_hash={{ .TokenHash }}&type=recovery` (action Romain post-`5ff9394`). Confirm Signup, Change Email, Invite User pas testés visuellement (rendus mais flow end-to-end non validé). Action externe Romain via Dashboard.
- **Branding Stripe Connect** — flag pendant la session 27/04 pour ne pas mélanger avec les bugs critiques. Investigation dédiée future avec accès doc Stripe à jour (logo, couleurs, pages `/connect/*`, branding marketplace).
- **Webhook Stripe mode Live** — créer un nouveau webhook endpoint dans Stripe Dashboard pointant sur `https://www.terroir-local.fr/api/stripe/webhook` au moment de la bascule Test → Live. Mode Test confirmé déjà OK (validation 27/04 matin).
- **Mentions légales / CGU / CGV / Politique de confidentialité — pages publiques** — affichées « à venir » en italique muted dans le footer consumer refondu (session 27/04 design Claude Design). Action externe Romain (juridique) avant go-live public. Le footer pointera vers les vraies pages une fois rédigées.

### Chantiers code futurs

- **Cron retry-failed-refunds** (chantier dédié futur) — détecter via `audit_logs.event_type` les `*_refund_failed` non réconciliés (refund admin manuel route `/api/stripe/refund`, refund cron `order-timeout`, refund résurrection P1 robuste) et retenter automatiquement, ou alerter admin pour intervention. Couverture forensique `logPaymentEvent` posée par chantier P1 robuste 27/04 sert de base de détection (`order_revival_refund_failed` event type).
- **Dédup webhook notifications** (chantier dédié futur) — table `webhook_events_processed(event_id, processed_at)` avec INSERT ON CONFLICT pour bloquer le rejouage Stripe côté code applicatif. Couvre tous les webhook handlers Stripe (`succeeded`, `payment_failed`, `account.updated`, `payout.paid`). Pertinent à instrumenter avant volume significatif (rejouage Stripe rare aujourd'hui, mais double email producer possible si ça arrive).
- **Migration `transformWithEsbuild` deprecated → `transformWithOxc`** (warning vitest 4 / rolldown-vite, commit `f32d083`) — non bloquant, à migrer quand l'API `transformWithOxc` est stable.
- **Flux invitation : cas "email déjà en base"** à détecter proprement côté UX (au-delà de la correction fonctionnelle du Chantier 2).
- **Backfill producers `count = 0`** — réévaluer avant chaque lancement. Aujourd'hui négligeable (faible volume), à garder en tête si le funnel monte.
- **Design system — Phase 2 (extension)** — une fois la home consumer refondue stabilisée (Phase 1 livrée par session 27/04), étendre la migration design system terra-primary au reste du repo : refonte fiche produit (`/producteurs/[slug]/produits/[id]`), refonte panier + checkout (`/panier`, `/checkout`), refonte UI kit producer (`pro.terroir-local.fr`), refonte UI kit admin (`admin.terroir-local.fr`). Migration variant `accent` (transitionnel green sur call sites admin/producer) → `primary` terra ou `success` green selon sémantique métier. Bundle Claude Design contient des références preview pour ces écrans (cards `metric-tile.html`, `product-card.html`, `dayslots.html`) déjà alignés sur le DS.
- **Logo SVG vectoriel — vrais variants pour usages externes** — fichier source `~/Desktop/Logo.svg` officiel intégré dans le repo via la session refonte home (`public/logo/logo-source.svg`, ~10KB après nettoyage du calque JPEG modèle). Pour usages externes futurs : générer favicon `.ico` (haute-res depuis le SVG), OG image (1200x630 PNG dérivé du wordmark), version email (PNG fond crème actuel maintenu en `public/email-assets/logo-email.png`). Variants dark BG / icon-only sont en SVG inline dans le composant `Logo.tsx`, pas en fichiers `.svg` séparés.

### Investigations produit (à trancher)

- **Consumer cancel route** — la route `/api/orders/[id]/cancel/route.tsx` interdit aujourd'hui au consumer d'annuler sa propre commande (403). Voulu (philosophie anti-abus) ou trou (oubli) ? Si décision = autoriser, ajouter check `session.id === order.consumer_id`. Le test D1 (commit `280ff69`) deviendra un FAIL volontaire qui guidera le fix. Cf rapport TC inspection cancel route 27/04.
- **Transition `ready → refunded` illégale** — fallback à `cancelled` via `canTransition()` dans cancel route (lignes 97-99). Décision produit à prendre : doit-elle être légale ? Cas concret : un client demande remboursement après que le producer a marqué la commande prête à retirer mais avant le retrait effectif. Implique modif `lib/orders/stateMachine.ts` + tests + handler. Cf rapport TC commit `f57d5ad`.
- **Aligner guards `canTransition` vs `isTerminal`** — asymétrie API state machine : `canTransition` tolère statut invalide via `?.` (ligne 27), `isTerminal` accès direct (ligne 47, crasherait sur statut invalide). Soit garder l'asymétrie volontaire avec commentaire JSDoc explicatif, soit ajouter un guard. Cf rapport TC commit `f57d5ad`.
- **Confirm route sans garde rôle explicite** — asymétrie vs cancel route : un admin non-owner d'aucun producer ne peut pas confirmer au nom d'un producer absent. Voulu (philosophie séparation des rôles) ou trou ? Cf rapport TB commit `81b3c1a`.

### Audit logs

- **UI admin pour `audit_logs`** — créer une page back-office `/admin/audit-logs` avec filtres par `event_type`, `user_id`, date range, pagination. La table est alimentée par 11 event types (5 auth + 6 payment) — voir `CHANGELOG.md`.
- **Events audit Phase 3** — instrumenter : `account_signup`, `email_change`, `account_deletion` (RGPD), `admin_login` (event distinct du password login pour traçabilité forensique admin spéciale), `role_change` (promotion consumer→producer, suspend/reactivate, etc.), Stripe events spécifiques (charge, dispute, payout completed/failed). Phases 1 (auth) et 2 (payment) déjà livrées — voir `CHANGELOG.md`.

### Auth / cleanup

- **Suppression page legacy `/reset-password` (~1 semaine post-deploy)** — la nouvelle page dédiée `/reinitialiser-mot-de-passe` (commit `5ff9394`) la remplace. Garder la legacy ~1 semaine pour absorber les emails reset password en transit avec l'ancien template, puis supprimer.
- **Code mort résiduel commit `d4088d5` (~1-2 semaines fenêtre rétro-compat PKCE)** — depuis la bascule OTP `token_hash` (commit `09c219d`), le flow PKCE magic link n'est plus utilisé. Code de gestion `?code=` côté `/auth/callback` devient mort à expiration de la fenêtre de rétro-compat (~1-2 semaines pour absorber les anciens emails magic link en transit). Purge prévue post-fenêtre.
- **Phase 3 finale vision funnel — DROP COLUMN `prenom_affichage`** — retirer les écritures `prenom_affichage = 'À compléter'` dans les 3 INSERT runtime (`create-account.ts`, `login-and-upgrade.ts`, `invitation/page.tsx` SSR), retirer le champ du wizard + édition onboarding, retirer côté seed/cleanup, migration DROP NOT NULL puis DROP COLUMN. Chantier dédié (~10-15 fichiers). Sous-chantier `reads` déjà livré (commits `894fa5e` + `1110816`) — voir `CHANGELOG.md`.

## 🗺️ Roadmap produit (vision Avril 2026)

> Feuille de route définie le 22/04/2026. 3 niveaux de priorité. Chaque item = une fonctionnalité produit à scoper techniquement le moment venu.

### Priorité HAUTE (prochaines semaines)

1. **Prix GMS sur chaque fiche produit**
   Prix moyen constaté en grande surface (source RNM FranceAgriMer) affiché à côté du prix éleveur. Mis à jour manuellement chaque mois via interface admin.
   *Impact : justifie le prix, montre que circuit direct = moins cher pour qualité supérieure.*
   (Base de données · Interface admin · Fiche produit)

2. **Score carbone & bien-être animal**
   Sur la page producteur : km parcourus vs moyenne GMS (~1500 km), mode d'élevage (plein air/bâtiment), alimentation, densité. Remplis par le producteur à l'onboarding.
   *Impact : transparence concrète, argument écologique mesurable sans jargon de label.*
   (Onboarding producteur · Page producteur publique)

### Priorité MOYENNE (prochain trimestre)

3. **Carte interactive des morceaux**
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

## 🗺️ Vision funnel producteur — Phase 3 (DROP COLUMN `prenom_affichage`)

> Phase 3 finale du chantier "vision funnel producteur" (refonte cohérence admin leads / producteurs décidée 24/04). Phases 1, 2, 2bis et sous-chantier `reads` déjà livrés — voir `CHANGELOG.md`.
>
> Décision : réutiliser `users.prenom` directement pour signer le post-it « Conseil de [prenom] » au lieu d'un champ dédié `producers.prenom_affichage`.

### Plan de migration finale

1. Retirer les écritures `prenom_affichage = 'À compléter'` dans les 3 INSERT runtime : `create-account.ts`, `login-and-upgrade.ts`, `invitation/page.tsx` SSR.
2. Adapter `StepInfos` (ex-`StepEntreprise`) : retirer le champ + validation.
3. Adapter `app/(producer)/onboarding/page.tsx` : retirer le champ d'édition.
4. Mettre à jour les seeds + cleanup-seed (retirer les writes `prenom_affichage`).
5. Migration SQL : DROP NOT NULL puis DROP COLUMN `producers.prenom_affichage`.
6. Purger le fallback `producer.prenom_affichage` dans `getProducerDisplayName` (le helper devient un simple read sur `users.prenom`).
7. Tests à refresh.

### Ordonnancement

**Prioriser après les bloquants lancement restants** (bascule Stripe Live, onboarder Julien).

## 🔵 Idées / améliorations

- Notation/reviews producteurs (cadre existant via reviews mais flow à valider).
- Export comptable consommateurs + producteurs.
- Gestion des litiges (retrait non effectué, marchandise abîmée).
