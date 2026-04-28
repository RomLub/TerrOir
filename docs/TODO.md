# TODO TerrOir

Priorités forward-looking uniquement. Pour l'historique complet des commits / chantiers clos, voir [`CHANGELOG.md`](./CHANGELOG.md). Pour les leçons apprises / pitfalls thématiques, voir [`LESSONS.md`](./LESSONS.md).

## 🟠 En cours

- **Chantier "Notre démarche" — page pédagogique GMS** (refonte item roadmap "Prix GMS sur chaque fiche produit" décidée session 28/04 après-midi).
  - ✅ **Phase A livrée 28/04** (PR #2 + extension dotenv PR #6) — DB tables `gms_prices` + `gms_prices_history` + RLS public read + 10 références seed initial (4 bovin + 3 porcin + 3 ovin) + helper `lib/gms-prices/fetch-active.ts` + 9 tests vitest. Migration `20260428000000_gms_prices` apply confirmée prod, seed apply confirmée prod (10 références actives, breakdown filière OK).
  - 🔲 **Phase B à venir** — Interface admin `/admin/gms-prices` (CRUD références + workflow update mensuel via RPC INSERT history + UPDATE live en transaction).
  - 🔲 **Phase C à venir** — Page publique `/notre-demarche` (graphique circuit interactif `<CircuitVisualizer>` 8 maillons GMS / 5 maillons TerrOir avec désactivation maillon par maillon + redistribution éleveur + tooltip sources, tableau comparaison 10 références, hero chiffre choc, encart home teaser, navbar primaire). **Full Claude Code** (Claude Design indispo cette session — itération visuelle CD repassera plus tard pour polish). Décisions tranchées : slug `/notre-demarche`, données graphique placeholder à calibrer plus tard sur sources OFPM/Idele/CGAAER, item navbar primaire, encart home entre Steps et Products grid.

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
- **Audit npm vulnérabilités pré-existantes** (5 vulnerabilities détectées 28/04 sur le repo : 1 critical + 3 high + 1 moderate, indépendantes de tout chantier session). Lancer `npm audit` détaillé puis traiter en chantier dédié + revue manuelle des breaking changes potentiels avant `npm audit fix --force`.
- **Validation juridique page `/notre-demarche`** (livraison Phase C ultérieure) — avocat spécialisé droit de la concurrence/conso à embarquer pour wording exact + disclaimers + représentation visuelle des marges intermédiaires (risque dénigrement implicite). Pattern défensif déjà cadré (pas de mention nominale concurrent, source FranceAgriMer/OFPM citée systématiquement, mise en contexte qualité, pas de "Économisez X€"), à valider en audit.

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

- **Instrumentation `*_refund_failed` audit_logs sur paths refund admin manuel + cron order-timeout** (pré-requis avant extension du cron retry-failed-refunds aux 3 paths). Aujourd'hui seul le path résurrection bloquée P1 robuste pose `order_revival_refund_failed` (chantier P1 robuste 27/04). Les 2 autres paths refund (`/api/stripe/refund` admin manuel, cron `order-timeout`) ne posent aucun event audit `*_refund_failed` exploitable. Pré-requis avant extension du cron retry-failed-refunds (PR #5 mergée 28/04, scope minimal résurrection bloquée only). Chantier dédié futur.
- **Dédup webhook notifications** (chantier dédié futur) — table `webhook_events_processed(event_id, processed_at)` avec INSERT ON CONFLICT pour bloquer le rejouage Stripe côté code applicatif. Couvre tous les webhook handlers Stripe (`succeeded`, `payment_failed`, `account.updated`, `payout.paid`). Pertinent à instrumenter avant volume significatif (rejouage Stripe rare aujourd'hui, mais double email producer possible si ça arrive).
- **Migration `transformWithEsbuild` deprecated → `transformWithOxc`** (warning vitest 4 / rolldown-vite, commit `f32d083`) — non bloquant, à migrer quand l'API `transformWithOxc` est stable.
- **UX admin invite — réponse enrichie + toasts distincts par cas** (R2 du rapport TB invite session 28/04). Aujourd'hui la réponse 200 ne signale pas si l'email correspondait à un consumer existant (qui va être upgrade) vs un prospect direct. Enrichir route avec `existing_account: 'consumer' | null` dans la réponse 200, et ajouter dans `InviteModal` un toast info distinct (« Cet email existe déjà comme consumer — l'invitation va déclencher un upgrade rôles ») vs un toast succès classique. Améliore prévisibilité côté admin.
- **Invalidation auto des invitations actives à chaque nouvel envoi** (R4 du rapport TB invite session 28/04). Migration SQL : à chaque INSERT `producer_invitations`, faire un UPDATE `producer_invitations SET expires_at=now() WHERE email=$1 AND used_at IS NULL AND expires_at > now()`. Optionnellement : ajouter un UNIQUE partial index `(email) WHERE used_at IS NULL AND expires_at > now()`. Inclure migration SQL + adapter route + tests.
- **Casse email normalisée `ilike` sur tous les lookups admin_users / users / producers / producer_interests** (chantier transversal détecté pendant inspection TB invite 28/04). Aujourd'hui certaines routes font `eq("email", input.email)` (case-sensitive) alors que `producer_interests` utilise déjà `ilike`. Si l'admin saisit `Bob@example.fr` mais `users.email='bob@example.fr'`, les pré-checks foirent silencieusement. À normaliser : soit `ilike` partout, soit `lower` au save côté DB via trigger. Audit nécessaire de tous les call sites email-keyed dans le repo.
- **Backfill producers `count = 0`** — réévaluer avant chaque lancement. Aujourd'hui négligeable (faible volume), à garder en tête si le funnel monte.
- **Design system — Phase 2 (extension)** — une fois la home consumer refondue stabilisée (Phase 1 livrée par session 27/04), étendre la migration design system terra-primary au reste du repo : refonte fiche produit (`/producteurs/[slug]/produits/[id]`), refonte panier + checkout (`/panier`, `/checkout`), refonte UI kit producer (`pro.terroir-local.fr`), refonte UI kit admin (`admin.terroir-local.fr`). Migration variant `accent` (transitionnel green sur call sites admin/producer) → `primary` terra ou `success` green selon sémantique métier. Bundle Claude Design contient des références preview pour ces écrans (cards `metric-tile.html`, `product-card.html`, `dayslots.html`) déjà alignés sur le DS.

### Investigations produit (à trancher)

- **Consumer cancel route** — la route `/api/orders/[id]/cancel/route.tsx` interdit aujourd'hui au consumer d'annuler sa propre commande (403). Voulu (philosophie anti-abus) ou trou (oubli) ? Si décision = autoriser, ajouter check `session.id === order.consumer_id`. Le test D1 (commit `280ff69`) deviendra un FAIL volontaire qui guidera le fix. Cf rapport TC inspection cancel route 27/04.
- **Transition `ready → refunded` illégale** — fallback à `cancelled` via `canTransition()` dans cancel route (lignes 97-99). Décision produit à prendre : doit-elle être légale ? Cas concret : un client demande remboursement après que le producer a marqué la commande prête à retirer mais avant le retrait effectif. Implique modif `lib/orders/stateMachine.ts` + tests + handler. Cf rapport TC commit `f57d5ad`.
- **Aligner guards `canTransition` vs `isTerminal`** — asymétrie API state machine : `canTransition` tolère statut invalide via `?.` (ligne 27), `isTerminal` accès direct (ligne 47, crasherait sur statut invalide). Soit garder l'asymétrie volontaire avec commentaire JSDoc explicatif, soit ajouter un guard. Cf rapport TC commit `f57d5ad`.
- **Confirm route sans garde rôle explicite** — asymétrie vs cancel route : un admin non-owner d'aucun producer ne peut pas confirmer au nom d'un producer absent. Voulu (philosophie séparation des rôles) ou trou ? Cf rapport TB commit `81b3c1a`.

### Audit logs

- **UI admin pour `audit_logs`** — créer une page back-office `/admin/audit-logs` avec filtres par `event_type`, `user_id`, date range, pagination. La table est alimentée par 13 event types (5 auth Phase 1 + 6 payment Phase 2 + 2 retry refund Phase 2bis 28/04) — voir `CHANGELOG.md`.
- **Events audit Phase 3 — incluant `[ADMIN_INVITE_*]` structuré** — instrumenter : `account_signup`, `email_change`, `account_deletion` (RGPD), `admin_login` (event distinct du password login pour traçabilité forensique admin spéciale), `role_change` (promotion consumer→producer, suspend/reactivate, etc.), Stripe events spécifiques (charge, dispute, payout completed/failed), **`[ADMIN_INVITE_*]`** (R4 inspection TB invite 28/04 — `admin_invite_sent`, `admin_invite_draft_resend`, `admin_invite_blocked_admin`, `admin_invite_blocked_producer`). Phases 1 (auth, 5 events), 2 (payment, 6 events) et 2bis (retry refund, 2 events) déjà livrées — voir `CHANGELOG.md`.

### Auth / cleanup

- **Suppression page legacy `/reset-password` (~1 semaine post-deploy)** — la nouvelle page dédiée `/reinitialiser-mot-de-passe` (commit `5ff9394`) la remplace. Garder la legacy ~1 semaine pour absorber les emails reset password en transit avec l'ancien template, puis supprimer.
- **Code mort résiduel commit `d4088d5` (~1-2 semaines fenêtre rétro-compat PKCE)** — depuis la bascule OTP `token_hash` (commit `09c219d`), le flow PKCE magic link n'est plus utilisé. Code de gestion `?code=` côté `/auth/callback` devient mort à expiration de la fenêtre de rétro-compat (~1-2 semaines pour absorber les anciens emails magic link en transit). Purge prévue post-fenêtre.
- **Phase 3 finale vision funnel — DROP COLUMN `prenom_affichage`** — retirer les écritures `prenom_affichage = 'À compléter'` dans les 3 INSERT runtime (`create-account.ts`, `login-and-upgrade.ts`, `invitation/page.tsx` SSR), retirer le champ du wizard + édition onboarding, retirer côté seed/cleanup, migration DROP NOT NULL puis DROP COLUMN. Chantier dédié (~10-15 fichiers). Sous-chantier `reads` déjà livré (commits `894fa5e` + `1110816`) — voir `CHANGELOG.md`.

## 🗺️ Roadmap produit (vision Avril 2026)

> Feuille de route définie le 22/04/2026. 3 niveaux de priorité. Chaque item = une fonctionnalité produit à scoper techniquement le moment venu.

### Priorité HAUTE (prochaines semaines)

> Item 1 "Prix GMS sur chaque fiche produit" recadré en chantier "Notre démarche" (page pédagogique GMS). Voir section 🟠 En cours en haut. Item original retiré de la roadmap.

1. **Score carbone & bien-être animal**
   Sur la page producteur : km parcourus vs moyenne GMS (~1500 km), mode d'élevage (plein air/bâtiment), alimentation, densité. Remplis par le producteur à l'onboarding.
   *Impact : transparence concrète, argument écologique mesurable sans jargon de label.*
   (Onboarding producteur · Page producteur publique)

### Priorité MOYENNE (prochain trimestre)

2. **Carte interactive des morceaux**
   Schéma SVG interactif (vache, puis porc, agneau). Clic sur un morceau → nom + conseils cuisson + redirection produits disponibles chez les éleveurs TerrOir.
   *Impact : éducatif, unique sur le marché. Aide à découvrir des morceaux moins connus, augmente le panier moyen.*
   (Page publique · Catalogue · UX éducatif)

3. **Schéma interactif circuit court vs GMS**
   Infographie animée sur `/comment-ca-marche` montrant parcours d'un morceau GMS (éleveur → abattoir → transporteur → centrale → GMS → consommateur) vs TerrOir (éleveur → TerrOir → consommateur). Impact sur prix et rémunération éleveur.
   *Impact : argument de conversion puissant, rend concret l'avantage du circuit court.*
   *Articulation : réutilise le composant `<CircuitVisualizer>` produit par Phase C du chantier "Notre démarche". Une fois Phase C livrée, ce schéma `/comment-ca-marche` peut être un montage allégé du visualizer principal.*
   (Page `comment-ca-marche` · Marketing)

4. **D'où vient ma viande**
   Page confirmation + historique commandes : mini-carte du trajet exploitation → point de retrait avec km. Comparaison avec moyenne GMS (1500 km).
   *Impact : moment émotionnel fort après achat, renforce satisfaction et fidélisation, potentiel partage social.*
   (Page confirmation · Historique commandes · Carte)

5. **Alerte disponibilité produit**
   Produit indisponible → consumer laisse email → prévenu au retour en stock. Producteur voit dans dashboard combien de personnes attendent chaque produit.
   *Impact : réduit perte de clients, donne visibilité sur la demande réelle au producteur.*
   (Fiche produit · Dashboard producteur · Email)

6. **Calculateur d'impact à la confirmation**
   Sur page confirmation : « Merci. Grâce à vous, Julien a gagné X€ de plus qu'en circuit classique. » Calculé depuis montant commande et taux moyen rémunération éleveur en circuit long (~30%).
   *Impact : crée sentiment de participation et de sens, fidélise au-delà du simple achat.*
   *Articulation : réutilise les ratios de marge fixés dans Phase C du chantier "Notre démarche" (référence chiffrée commune).*
   (Page confirmation · Impact social)

### Priorité BASSE (second semestre 2026)

7. **Compteur impact global plateforme**
   Home + `/a-propos` : « Depuis le lancement, les éleveurs TerrOir ont gagné X€ de plus qu'en circuit classique. » Calcul automatique depuis commandes en base.
   *Impact : argument de marque fort, dimension collective et militante à chaque achat.*
   *Articulation : réutilise les ratios de marge fixés dans Phase C du chantier "Notre démarche".*
   (Home · Page à-propos · Marketing)

8. **Abonnement panier mensuel**
   Commande récurrente chez un éleveur. Paiement auto, notification avant débit, pause/annulation. Producteur voit ses abonnés.
   *Impact : revenus récurrents, fidélisation max. Nécessite travail juridique CGV.*
   (Stripe recurring · Dashboard producteur · CGV)

9. **Carte cadeau & fidélité**
   Carte cadeau TerrOir (crédit en euros, utilisable chez n'importe quel éleveur). Dans un 2e temps : système points de fidélité (X points/€ dépensé, convertibles en réduction).
   *Impact : levier d'acquisition et de rétention.*
   (Stripe · Système de points · Acquisition)

10. **Glossaire du terroir**
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
