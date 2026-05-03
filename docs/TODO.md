# TODO TerrOir

Priorités forward-looking uniquement. Pour l'historique complet des commits / chantiers clos, voir [`CHANGELOG.md`](./CHANGELOG.md). Pour les leçons apprises / pitfalls thématiques, voir [`LESSONS.md`](./LESSONS.md).

> **Convention numérotation T-XXX** (instaurée 28/04/2026) — chaque item porte un identifiant stable permettant le référencement (« supprime T-005 », « reflag T-010 »). Numérotation par catégorie avec espaces réservés pour insertion future :
> - `T-001` → `T-009` : Bloquants lancement
> - `T-010` → `T-019` : Bugs et incidents identifiés
> - `T-040` → `T-079` : Externes / config
> - `T-080` → `T-099` : Audit logs (chantier dédié futur)
> - `T-100` → `T-149` : Chantiers code futurs
> - `T-150` → `T-179` : Investigations produit à trancher
> - `T-200` → `T-299` : Roadmap produit (HAUTE / MOYENNE / BASSE)
> - `T-300` → `T-399` : Vision funnel producteur Phase 3

## 🟠 En cours

- **Chantier "Notre démarche" — page pédagogique GMS** (refonte item roadmap "Prix GMS sur chaque fiche produit" décidée session 28/04 après-midi).
  - ✅ **Phase A livrée 28/04** (PR #2 + extension dotenv PR #6) — DB tables `gms_prices` + `gms_prices_history` + RLS public read + 10 références seed initial (4 bovin + 3 porcin + 3 ovin) + helper `lib/gms-prices/fetch-active.ts` + 9 tests vitest. Migration `20260428000000_gms_prices` apply confirmée prod, seed apply confirmée prod (10 références actives, breakdown filière OK).
  - 🔲 **Phase B à venir** — Interface admin `/admin/gms-prices` (CRUD références + workflow update mensuel via RPC INSERT history + UPDATE live en transaction).
  - 🔲 **Phase C à venir** — Page publique `/notre-demarche` (graphique circuit interactif `<CircuitVisualizer>` 8 maillons GMS / 5 maillons TerrOir avec désactivation maillon par maillon + redistribution éleveur + tooltip sources, tableau comparaison 10 références, hero chiffre choc, encart home teaser, navbar primaire). **Full Claude Code** (Claude Design indispo cette session — itération visuelle CD repassera plus tard pour polish). Décisions tranchées : slug `/notre-demarche`, données graphique placeholder à calibrer plus tard sur sources OFPM/Idele/CGAAER, item navbar primaire, encart home entre Steps et Products grid.

## 🔴 Bugs ouverts
- **T-011 Bug intermittent navbar « Connexion » affiché loggé** — fix sync `useEffect` `UserProvider` PR #14 résout la majorité des cas, mais signalé comme parfois intermittent en prod. Mitigation préparée : bonus défensif `INITIAL_SESSION` protect dans `UserProvider` (snippet rédigé en PR #14 comme réserve, à activer si re-flag persistant).


## 🔴 À faire (bloquants lancement)

- **T-001 Onboarder Julien (GAEC du Rheu)** — pages landing Stripe Connect `/connect/done` + `/connect/refresh` désormais en place (commit `e93043e`), mais onboarding end-to-end Stripe Live pas encore testé en situation réelle. À garder bloquant tant que le flow n'est pas validé avec un vrai producer.
- **T-002 Basculer Stripe en mode Live** (aujourd'hui en Test). Au moment de la bascule, créer un nouveau webhook endpoint dans Stripe Dashboard pointant sur `https://www.terroir-local.fr/api/stripe/webhook` en mode Live (le webhook actuel est en mode Test).

## 🔐 Avant lancement public

**T-003 Audit tech externe pré-lancement** (~2-4 k€, 1-2 semaines) :

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

- **T-040 Twilio SMS** : numéro FR à régler.
- **T-041 Pages légales (Mentions légales / CGU / CGV / Politique de confidentialité) — bloqueur lancement public** — fusion T-041 (mentions légales footer pro href mort) + T-046 (mentions légales footer consumer affichées « à venir » italique muted, refonte 27/04 Claude Design) + finding audit Auth #1 séance 29/04. Action externe Romain (rédaction + validation juridique avocat avant go-live public, risque CNIL + DGCCRF si pages bidon). Templates Next.js pages `/mentions-legales` + `/cgu` + `/cgv` + `/politique-confidentialite` + footer enrichi liens (consumer + producer) + checkbox signup acceptation CGU/RGPD + bandeau cookies basique conformité ePrivacy. Une fois contenus juridiques disponibles, chantier code dédié.
- **T-042 SMTP custom Supabase Resend à configurer (recommandé avant lancement)** — observation récente : mails Auth atterrissant en spam. Configurer Resend en SMTP custom (rate limit Supabase built-in ~3-4/h, non destiné à la production) serait propre. Action externe Romain via Dashboard.
- **T-043 Templates Supabase Auth Email — validation visuelle complète** — Magic Link template à mettre à jour avec `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=magiclink` (action Romain post-PKCE Option B, commit `09c219d`). Reset Password template à mettre à jour avec `${SITE_URL}/reinitialiser-mot-de-passe?token_hash={{ .TokenHash }}&type=recovery` (action Romain post-`5ff9394`). Confirm Signup, Change Email, Invite User pas testés visuellement (rendus mais flow end-to-end non validé). Action externe Romain via Dashboard.
- **T-044 Branding Stripe Connect** — flag pendant la session 27/04 pour ne pas mélanger avec les bugs critiques. Investigation dédiée future avec accès doc Stripe à jour (logo, couleurs, pages `/connect/*`, branding marketplace).
- **T-045 Webhook Stripe mode Live** — créer un nouveau webhook endpoint dans Stripe Dashboard pointant sur `https://www.terroir-local.fr/api/stripe/webhook` au moment de la bascule Test → Live. Mode Test confirmé déjà OK (validation 27/04 matin).
- **T-046 HIBP password protection (Have I Been Pwned) — bloqueur lancement** — finding audit Auth #1 séance 29/04, bloqué Pro plan Supabase. Action externe Romain : upgrade Supabase Pro plan (25$/mois) puis toggle Dashboard Settings → Auth → Password Strength → « Enable HIBP password check » (vérifie passwords signup/reset contre bases breach connues, bloque passwords compromis même si fort en complexité). Pas de chantier code TerrOir nécessaire. À traiter au moment de l'upgrade Pro plan pour autres features (read replicas, point-in-time recovery).

### Audit logs

- **T-080 UI admin pour `audit_logs`** — créer une page back-office `/admin/audit-logs` avec filtres par `event_type`, `user_id`, date range, pagination. La table est alimentée par 13 event types (5 auth Phase 1 + 6 payment Phase 2 + 2 retry refund Phase 2bis 28/04) — voir `CHANGELOG.md`.
- **T-081 Events audit Phase 3 — `[ADMIN_INVITE_*]` structuré** ✅ **LIVRÉE 2026-05-03** — Phase 3 finale câble les 5 events restants : cluster `admin_invite_*` (`admin_invite_sent`, `admin_invite_draft_resend`, `admin_invite_blocked_admin`, `admin_invite_blocked_producer`, `admin_invite_expired` sur 4 server actions de claim). Voir `CHANGELOG.md`. Phases 1 (auth, 5 events), 2 (payment, 6 events), 2bis (retry refund, 2 events) et 3 PR-A (T-081 PR-A + T-307/T-309/T-310, 6 events) déjà livrées antérieurement.
- **T-082 [Conformité] Documenter durée de rétention `audit_logs` cluster `admin_invite_*`** (issu rapport conformité comité T-081 round 2, 03/05/2026) — les events `admin_invite_*` (sent, draft_resend, blocked_admin, blocked_producer, expired) contiennent l'email du destinataire, donnée personnelle même en contexte B2B producteur. Base légale plausible : intérêt légitime (sécurité plateforme + traçabilité actions admin). Durée de conservation à fixer (typique 12-36 mois pour logs admin marketplace) et à inscrire dans le registre des traitements + politique de confidentialité producer avant le passage en Live. Non-bloquant T-081, prérequis go-live public. Chantier d'origine : T-081.
- **T-083 [Sécurité] Rate-limit ou masquage si l'UI admin `/audit-logs` expose un filtre par email saisi côté client** (issu rapport sécurité comité T-081 round 2, 03/05/2026) — risque d'oracle d'énumération de comptes : un admin (ou un compte admin compromis) pourrait scanner si un email est connu de la plateforme via les events `admin_invite_blocked_*`. À cadrer au moment du chantier T-080 (UI admin audit_logs) : soit rate-limit sur la recherche par email, soit masquage partiel des emails dans les events `admin_invite_*` côté UI, soit RLS stricte revérifiée + journalisation des accès au journal lui-même. Chantier d'origine : T-081.
- **T-084 [Produit] Vérifier libellés humains UI `/audit-logs` pour les 5 nouveaux events `admin_invite_*`** (issu rapport produit comité T-081 round 2, 03/05/2026) — ex. « Invitation envoyée », « Relance d'invitation », « Blocage : email déjà admin », « Blocage : producteur déjà inscrit », « Lien expiré cliqué » plutôt que les identifiants techniques bruts. Si la traduction est centralisée (map côté UI) et déjà en place pour les 13 events antérieurs, rien à faire — sinon, passe de wording à prévoir au moment du chantier T-080. Chantier d'origine : T-081.
- **T-085 [Business / NICE-TO-HAVE] Dashboard « taux de conversion invitation → onboarding complet »** (issu rapport business comité T-081 round 2, 03/05/2026) — exploiter les events `admin_invite_*` désormais captés par T-081 pour produire une métrique B2B utile au pilotage du recrutement producteurs au moment de l'ouverture Pays de la Loire. La donnée est en base, aucun dashboard prévu côté admin. Pas un blocage, à reprendre au moment de scaler le recrutement producteur. Chantier d'origine : T-081.

### Chantiers code futurs

- **T-104 Anomalie traçabilité migration `webhook_events_processed`** — la table existe en base (créée 29/04/2026 dans le cadre du chantier dédup webhooks T-103) mais l'historique `supabase_migrations.schema_migrations` ne contient pas l'entrée correspondante au timestamp `20260429000000`. La migration a été appliquée hors workflow standard MCP. Pas de bug fonctionnel, juste un trou de traçabilité côté Supabase. À régler par un INSERT ciblé dans `schema_migrations` (ou re-application idempotente) lors d'une prochaine session de maintenance DB. Pas critique.
- **T-105 Flux invitation : cas « email déjà en base » à détecter proprement côté UX** (au-delà de la correction fonctionnelle du Chantier 2).
- **T-107 Instrumentation `*_refund_failed` audit_logs sur paths refund admin manuel + cron order-timeout** (pré-requis avant extension du cron retry-failed-refunds aux 3 paths). Aujourd'hui seul le path résurrection bloquée P1 robuste pose `order_revival_refund_failed` (chantier P1 robuste 27/04). Les 2 autres paths refund (`/api/stripe/refund` admin manuel, cron `order-timeout`) ne posent aucun event audit `*_refund_failed` exploitable. Pré-requis avant extension du cron retry-failed-refunds (PR #5 mergée 28/04, scope minimal résurrection bloquée only). Chantier dédié futur.
- **T-109 Invalidation auto des invitations actives à chaque nouvel envoi** (R4 du rapport TB invite session 28/04). Migration SQL : à chaque INSERT `producer_invitations`, faire un UPDATE `producer_invitations SET expires_at=now() WHERE email=$1 AND used_at IS NULL AND expires_at > now()`. Optionnellement : ajouter un UNIQUE partial index `(email) WHERE used_at IS NULL AND expires_at > now()`. Inclure migration SQL + adapter route + tests.
- **T-110 Casse email normalisée `ilike` sur tous les lookups admin_users / users / producers / producer_interests** (chantier transversal détecté pendant inspection TB invite 28/04). Aujourd'hui certaines routes font `eq("email", input.email)` (case-sensitive) alors que `producer_interests` utilise déjà `ilike`. Si l'admin saisit `Bob@example.fr` mais `users.email='bob@example.fr'`, les pré-checks foirent silencieusement. À normaliser : soit `ilike` partout, soit `lower` au save côté DB via trigger. Audit nécessaire de tous les call sites email-keyed dans le repo.
- **T-111 Design system — Phase 2 (extension)** — une fois la home consumer refondue stabilisée (Phase 1 livrée par session 27/04), étendre la migration design system terra-primary au reste du repo : refonte fiche produit (`/producteurs/[slug]/produits/[id]`), refonte panier + checkout (`/panier`, `/checkout`), refonte UI kit producer (`pro.terroir-local.fr`), refonte UI kit admin (`admin.terroir-local.fr`). Migration variant `accent` (transitionnel green sur call sites admin/producer) → `primary` terra ou `success` green selon sémantique métier. Bundle Claude Design contient des références preview pour ces écrans (cards `metric-tile.html`, `product-card.html`, `dayslots.html`) déjà alignés sur le DS.

#### Follow-ups comité review T-200 (round 1, 03/05/2026)

- **T-201 [Business] Mesure d'usage du widget distance fiche producteur** (issu rapport business comité T-200 round 1, 03/05/2026) — instrumenter le DistanceWidget (taux de clic « Utiliser ma position » vs saisie CP, taux de finalisation, distance médiane affichée). Sans ces métriques, impossible de savoir si l'investissement améliore la conversion ou la perception « circuit court ». Reprendre via l'event tracking déjà en place sur les autres surfaces consumer. Chantier d'origine : T-200.
- **T-202 [Business] Backfill lat/lng des 5 producteurs sans coordonnées avant ouverture publique** (issu rapport business comité T-200 round 1, 03/05/2026) — la moitié des producteurs en prod (5/10) n'ont pas de `latitude`/`longitude` ; sur leurs fiches, le widget distance ne s'affiche pas (early-return ScoreCarbonBlock + DistanceWidget). Bloquant avant ouverture publique : sinon la moitié des fiches perdent leur principal argument différenciant. À faire via géocodage de l'adresse postale existante. Chantier d'origine : T-200.
- **T-203 [Business] Process de relance producteurs déjà onboardés sur les 3 enums score carbone** (issu rapport business comité T-200 round 1, 03/05/2026) — les 3 nouveaux champs `mode_elevage`, `alimentation`, `densite_animale` ne sont alimentés que via l'onboarding (formulaire StepInfos). Les producteurs déjà inscrits avant la livraison T-200 ont leurs colonnes à `null` → bloc « Notre démarche » vide sur leur fiche. Prévoir un email de relance + UI dédiée dans `/ma-page` producteur (édition post-onboarding). Chantier d'origine : T-200.
- **T-204 [Business] Anticiper scaling géocodeur public au-delà de la Sarthe** (issu rapport business comité T-200 round 1, 03/05/2026) — `api-adresse.data.gouv.fr` est un service public sans SLA contractuel. À 1500+ producteurs sur Pays de la Loire puis France, l'API peut devenir un goulot ou rate-limiter TerrOir. Prévoir bascule vers un géocodeur avec SLA OU cache côté serveur des CP les plus fréquents. À cadrer au moment du scaling. Chantier d'origine : T-200.
- **T-205 [Business] Filtres de recherche basés sur les 3 enums score carbone** (issu rapport business comité T-200 round 1, 03/05/2026) — les données collectées (mode élevage, alimentation, densité) sont une mine pour la roadmap produit post-lancement : « voir uniquement les éleveurs plein air », « filtrer par alimentation à l'herbe ». À inscrire dans la roadmap moyen terme. Chantier d'origine : T-200.
- **T-206 [Conformité] Review avocat T-003 — formulation comparative « ~1500 km » et page `/notre-demarche`** (issu rapport conformité comité T-200 round 1, 03/05/2026) — la mention « ~1500 km en moyenne en circuit long » sur DistanceWidget est sur le même terrain juridique que la page `/notre-demarche` (loi Climat & Résilience : encadrement renforcé des allégations environnementales et de la neutralité carbone, sanctions DGCCRF). Source ADEME affichée à côté du chiffre comme garantie d'ancrage factuel. À faire valider par l'avocat dans le cadre de T-003 avant ouverture publique. Chantier d'origine : T-200.
- **T-207 [Conformité] Mise à jour politique de confidentialité avant Live — widget distance et géocodage tiers** (issu rapport conformité comité T-200 round 1, 03/05/2026) — avant le passage en Live, mentionner dans la politique de confidentialité : (a) collecte ponctuelle de géolocalisation côté client (Geolocation API, après action explicite utilisateur), (b) recours à `api-adresse.data.gouv.fr` comme service tiers (sous-traitant de fait, même service public), (c) conservation `sessionStorage` uniquement, jamais persistée côté serveur. Chantier d'origine : T-200.
- **T-208 [Conformité] Inscription du widget distance au registre des traitements RGPD** (issu rapport conformité comité T-200 round 1, 03/05/2026) — registre à constituer avant Live. Ajouter une entrée pour le widget distance même si la donnée ne quitte pas le navigateur (obligation d'inventaire des traitements art. 30 RGPD). Chantier d'origine : T-200.
- **T-209 [Conformité] CGU producteur — clause de véracité sur les 3 enums score carbone déclaratifs** (issu rapport conformité comité T-200 round 1, 03/05/2026) — `mode_elevage`, `alimentation`, `densite_animale` sont des allégations producteur (non vérifiées par TerrOir). Prévoir dans les CGU producteur : (a) clause d'engagement sur la véracité des informations saisies, (b) mécanisme de mise à jour / contestation (signalement consumer ?). À cadrer avec les CGU marketplace globales. Chantier d'origine : T-200.
- **T-210 [Conformité] Vérifier non-confusion entre nomenclature T-200 et mentions réglementées** (issu rapport conformité comité T-200 round 1, 03/05/2026) — `plein_air`, `semi_plein_air` peuvent créer une confusion avec des mentions réglementées (Label Rouge, AB, « plein air » au sens du règlement européen CE 543/2008 sur les œufs/volailles), où le terme a une définition légale stricte (densité, accès, etc.). Risque d'allégation trompeuse si un producteur coche `plein_air` sans respecter le cahier des charges réglementaire associé. À arbitrer avec l'avocat dans le cadre de T-003 : disclaimer in situ, renommage des enums (« libre parcours » au lieu de `plein_air` ?), ou intégration des labels réglementés au formulaire. Chantier d'origine : T-200.
- **T-211 [Produit] Repenser le bloc « Notre démarche » modulaire selon le métier producteur** (issu rapport produit comité T-200 round 1, 03/05/2026) — les 3 enums sont taillés pour l'élevage. Pour maraîchers, boulangers, apiculteurs, arboriculteurs : prévoir des indicateurs adaptés au métier (rotation des cultures, traitements phyto, type de levain, traitement varroase, etc.). Aujourd'hui la fiche maraîcher montre uniquement le widget distance + titre adaptatif « Au plus près de chez toi ». À cadrer avec les déclinaisons par `type_production`. Chantier d'origine : T-200.
- **T-212 [Produit] Aperçu visuel temps réel dans l'onboarding « voici comment ça apparaîtra »** (issu rapport produit comité T-200 round 1, 03/05/2026) — aider le producteur à choisir parmi les 3 enums en lui montrant en direct le rendu de la pill colorée + tooltip côté fiche publique. Évite les saisies par défaut ou erronées. À implémenter dans `StepInfos.tsx` + `/ma-page` producteur (édition post-onboarding). Chantier d'origine : T-200.
- **T-213 [Produit] Pré-remplissage global de la position consumer (header / compte)** (issu rapport produit comité T-200 round 1, 03/05/2026) — actuellement la saisie position est demandée sur chaque fiche producteur. Évolution UX : pré-remplir une fois au niveau global (header ou compte consumer), réutiliser sur toutes les fiches. Implique potentiellement de stocker un CP côté `users` (cf. discussion option B vs A pendant le brief T-200) — décision produit à reprendre. Chantier d'origine : T-200.
- **T-214 [Produit] Comparatif GMS visuel post-review juridique T-003** (issu rapport produit comité T-200 round 1, 03/05/2026) — une fois la review avocat T-003/T-206 passée, envisager une version visuelle plus parlante du comparatif 1500 km (silhouette de camion qui parcourt la distance, carte France stylisée, animation au scroll). Ne pas démarrer avant validation juridique de la formulation comparative. Chantier d'origine : T-200.
- **T-215 [Produit] Audit a11y dédié sur les pills colorées du bloc score carbone** (issu rapport produit comité T-200 round 1, 03/05/2026) — vérifier contraste WCAG AA sur les 3 pills (vert/terra/orange), comportement lecteurs d'écran (le `title` natif est annoncé), et que l'information n'est pas portée uniquement par la couleur (typique sur le rouge/orange « intensif »). Le hint est déjà affiché en texte sous la pill — defense in depth a11y. Chantier d'origine : T-200.
- **T-216 [Produit] Internationalisation future — adapter « ~1500 km » et `api-adresse.data.gouv.fr` hors France** (issu rapport produit comité T-200 round 1, 03/05/2026) — si TerrOir s'étend hors Sarthe puis hors France, la référence 1500 km (ADEME française) et l'API code postal `data.gouv.fr` (service public français) devront être généralisés. À reprendre au moment de la décision d'expansion. Chantier d'origine : T-200.
- **T-217 [Sécurité] Politique d'arrondi/floutage des coordonnées producteur étendue à toute l'API publique** (issu rapport sécurité comité T-200 round 1, 03/05/2026) — T-200 a introduit `roundCoord` (2 décimales = ~1 km) dans `lib/producers/fetch-public.ts`. À étendre à toutes les autres routes publiques exposant des coords producteur (carte `/carte` notamment, RPC `search_producers`). Décider d'un floutage uniforme (centroïde de la commune ? grille 1 km ?) avant ouverture publique. Chantier d'origine : T-200.
- **T-218 [Sécurité] Audit RLS global table `producers` au prochain chantier touchant la table** (issu rapport sécurité comité T-200 round 1, 03/05/2026) — la table accumule les colonnes (T-200 ajoute 3 enums, plusieurs chantiers passés ont ajouté abonnement, badges, score). Revérifier toutes les policies RLS après plusieurs migrations cumulées : `producers admin all`, `producers owner read/insert/update`, `producers public read when public` couvrent toujours l'usage attendu, pas de fuite par jointure ou colonne nouvelle ? Chantier d'origine : T-200.
- **T-219 [Technique] Cache serveur géocodage CP→lat/lng** (issu rapport technique comité T-200 round 1, 03/05/2026) — si le widget distance devient un point chaud, cacher le résultat géocodage côté serveur (table `geocode_cache` ou KV) pour éviter de taper `api-adresse.data.gouv.fr` à chaque visiteur. Aujourd'hui : appel direct navigateur → gouv.fr, pas de cache. Pas urgent (pas de scaling immédiat), prérequis pour T-204. Chantier d'origine : T-200.
- **T-220 [Technique] Codegen TS depuis migration SQL pour les enums** (issu rapport technique comité T-200 round 1, 03/05/2026) — au-delà du test Vitest de parité TS↔SQL ajouté en T-200, mettre en place un script de codegen qui génère `*_VALUES` depuis la dernière migration (ou inversement). Évite la dérive structurelle au prochain ajout d'enum (T-300 et au-delà). Chantier d'origine : T-200.
- **T-225 [Technique] Workflow staging→prod pour les migrations Supabase** (issu rapport technique comité T-200 round 1, 03/05/2026) — la pratique actuelle d'appliquer les migrations directement en prod via MCP Supabase est acceptable en pré-lancement (TerrOir n'est pas Live). À reconsidérer avant ouverture publique : monter un projet Supabase staging, workflow standard apply migration → staging → tests → apply prod. Chantier d'origine : T-200.

### Investigations produit (à trancher)

- **T-150 Consumer cancel route** — la route `/api/orders/[id]/cancel/route.tsx` interdit aujourd'hui au consumer d'annuler sa propre commande (403). Voulu (philosophie anti-abus) ou trou (oubli) ? Si décision = autoriser, ajouter check `session.id === order.consumer_id`. Le test D1 (commit `280ff69`) deviendra un FAIL volontaire qui guidera le fix. Cf rapport TC inspection cancel route 27/04.
- **T-151 Transition `ready → refunded` illégale** — fallback à `cancelled` via `canTransition()` dans cancel route (lignes 97-99). Décision produit à prendre : doit-elle être légale ? Cas concret : un client demande remboursement après que le producer a marqué la commande prête à retirer mais avant le retrait effectif. Implique modif `lib/orders/stateMachine.ts` + tests + handler. Cf rapport TC commit `f57d5ad`.
- **T-152 Aligner guards `canTransition` vs `isTerminal`** — asymétrie API state machine : `canTransition` tolère statut invalide via `?.` (ligne 27), `isTerminal` accès direct (ligne 47, crasherait sur statut invalide). Soit garder l'asymétrie volontaire avec commentaire JSDoc explicatif, soit ajouter un guard. Cf rapport TC commit `f57d5ad`.
- **T-153 Confirm route sans garde rôle explicite** — asymétrie vs cancel route : un admin non-owner d'aucun producer ne peut pas confirmer au nom d'un producer absent. Voulu (philosophie séparation des rôles) ou trou ? Cf rapport TB commit `81b3c1a`.

## 🗺️ Roadmap produit (vision Avril 2026)

> Feuille de route définie le 22/04/2026. 3 niveaux de priorité. Chaque item = une fonctionnalité produit à scoper techniquement le moment venu.

### Priorité HAUTE (prochaines semaines)

> Item original « Prix GMS sur chaque fiche produit » recadré en chantier "Notre démarche" (page pédagogique GMS). Voir section 🟠 En cours en haut. Item retiré de la roadmap.

- **T-200 Score carbone & bien-être animal**
  Sur la page producteur : km parcourus vs moyenne GMS (~1500 km), mode d'élevage (plein air/bâtiment), alimentation, densité. Remplis par le producteur à l'onboarding.
  *Impact : transparence concrète, argument écologique mesurable sans jargon de label.*
  (Onboarding producteur · Page producteur publique)

### Priorité MOYENNE (prochain trimestre)


- **T-221 Schéma interactif circuit court vs GMS**
  Infographie animée sur `/comment-ca-marche` montrant parcours d'un morceau GMS (éleveur → abattoir → transporteur → centrale → GMS → consommateur) vs TerrOir (éleveur → TerrOir → consommateur). Impact sur prix et rémunération éleveur.
  *Impact : argument de conversion puissant, rend concret l'avantage du circuit court.*
  *Articulation : réutilise le composant `<CircuitVisualizer>` produit par Phase C du chantier "Notre démarche". Une fois Phase C livrée, ce schéma `/comment-ca-marche` peut être un montage allégé du visualizer principal.*
  (Page `comment-ca-marche` · Marketing)

- **T-222 D'où vient ma viande**
  Page confirmation + historique commandes : mini-carte du trajet exploitation → point de retrait avec km. Comparaison avec moyenne GMS (1500 km).
  *Impact : moment émotionnel fort après achat, renforce satisfaction et fidélisation, potentiel partage social.*
  (Page confirmation · Historique commandes · Carte)

- **T-223 Calculateur d'impact à la confirmation**
  Sur page confirmation : « Merci. Grâce à vous, Julien a gagné X€ de plus qu'en circuit classique. » Calculé depuis montant commande et taux moyen rémunération éleveur en circuit long (~30%).
  *Impact : crée sentiment de participation et de sens, fidélise au-delà du simple achat.*
  *Articulation : réutilise les ratios de marge fixés dans Phase C du chantier "Notre démarche" (référence chiffrée commune).*
  (Page confirmation · Impact social)

### Priorité BASSE (second semestre 2026)

- **T-240 Compteur impact global plateforme**
  Home + `/a-propos` : « Depuis le lancement, les éleveurs TerrOir ont gagné X€ de plus qu'en circuit classique. » Calcul automatique depuis commandes en base.
  *Impact : argument de marque fort, dimension collective et militante à chaque achat.*
  *Articulation : réutilise les ratios de marge fixés dans Phase C du chantier "Notre démarche".*
  (Home · Page à-propos · Marketing)

- **T-241 Abonnement panier mensuel**
  Commande récurrente chez un éleveur. Paiement auto, notification avant débit, pause/annulation. Producteur voit ses abonnés.
  *Impact : revenus récurrents, fidélisation max. Nécessite travail juridique CGV.*
  (Stripe recurring · Dashboard producteur · CGV)

- **T-242 Carte cadeau & fidélité**
  Carte cadeau TerrOir (crédit en euros, utilisable chez n'importe quel éleveur). Dans un 2e temps : système points de fidélité (X points/€ dépensé, convertibles en réduction).
  *Impact : levier d'acquisition et de rétention.*
  (Stripe · Système de points · Acquisition)

- **T-243 Glossaire du terroir**
  Pages expliquant labels (Label Rouge, AB, AOC…), races (Charolais, Maine-Anjou…), modes d'élevage. Contenu evergreen SEO.
  *Impact : SEO long terme, éducation consumer, autorité éditoriale terroir sarthois.*
  (SEO · Contenu · Pages statiques)

## 🗺️ Vision funnel producteur — Phase 3 (DROP COLUMN `prenom_affichage`)

> Phase 3 finale du chantier "vision funnel producteur" (refonte cohérence admin leads / producteurs décidée 24/04). Phases 1, 2, 2bis et sous-chantier `reads` déjà livrés — voir `CHANGELOG.md`.
>
> Décision : réutiliser `users.prenom` directement pour signer le post-it « Conseil de [prenom] » au lieu d'un champ dédié `producers.prenom_affichage`.

### T-300 Plan de migration finale

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
