# Post-launch checklist — TerrOir

Actions conditionnées à un **événement externe identifiable**. Ce
document n'est **pas un backlog vivant** : chaque item porte une
condition de déblocage explicite. Quand la condition est levée,
l'item devient exécutable — pas avant.

Si tu lis un item dont la condition de déblocage n'est plus claire
ou plus pertinente, supprime l'item au lieu de le laisser traîner.

---

## Bloquants Live initial

### Onboarder Julien (GAEC du Rheu)

- **Condition de déblocage** : KYC Stripe Live réel validé sur le
  compte Connect de Julien (flow end-to-end testé avec un vrai
  producer, pas Stripe Test).
- **Action** : valider le flow onboarding consumer → producer → KYC
  Stripe Connect → premier dépôt produit → première commande consumer.
- Les pages `/connect/done` + `/connect/refresh` sont en place
  (commit `e93043e`), mais le bout-en-bout Stripe Live n'a jamais
  tourné en condition réelle.

### Bascule Stripe Live

- **Condition de déblocage** : `T-003` audit avocat livré + Julien
  onboardé (item précédent) + audit externe sécurité OK.
- **Action** :
  1. Toggle `STRIPE_SECRET_KEY` Vercel de `sk_test_*` à `sk_live_*`.
  2. Créer un nouveau webhook endpoint dans Stripe Dashboard pointant
     sur `https://www.terroir-local.fr/api/stripe/webhook` en mode
     **Live** (le webhook actuel est en mode Test).
  3. Mettre à jour `STRIPE_WEBHOOK_SECRET` Vercel avec le nouveau
     secret du webhook Live.
  4. Optionnel : poser `STRIPE_EXPECTED_MODE=live` pour fail-fast au
     boot si la clé bascule par accident.

---

## Audit externe pré-launch

### T-003 — Audit tech + juridique pré-launch

- **Condition de déblocage** : engagement avocat (droit
  concurrence/conso + DGCCRF) + pentester + budget alloué
  (~2-4 k€, 1-2 semaines).
- **Scope** :
  - Pentest complet de l'application.
  - Review des policies RLS Supabase (toutes les tables).
  - Review des server actions sensibles (checkout Stripe, paiements,
    RGPD, invitation admin).
  - Review du webhook Stripe et flows de paiement.
  - Audit Stripe Customer + Connect (commission, payouts).
  - Conformité RGPD (registre Art. 30, consentements, droits).
  - Tests de charge sur endpoints critiques
    (`create-payment-intent`, RPC `create-order-with-items`,
    `search_producers`).
  - Vérification absence d'injections SQL latentes.
  - Validation juridique page `/notre-demarche` (loi Climat &
    Résilience, DGCCRF).
  - Validation wording « ~1500 km circuit long » DistanceWidget
    (allégation environnementale comparative).
  - Validation enums `plein_air` / `semi_plein_air` vs mentions
    réglementées (CE 543/2008, Label Rouge, AB).
- **Cascade** : débloque T-041 (pages légales), `T-261-bis` (bundle
  RGPD), `T-209-bis` (clause CGV email_suppressions),
  `T-262-bis` (CGU/CGV mention distance + sessionStorage),
  `T-284/T-285/T-290` (politique rétention `declaration_indicateurs_*`).

---

## Conditionné à action UI tierce Romain

Actions qui n'ont pas d'équivalent API/CLI/MCP. Procédure CC :
pas-à-pas avec validation interactive (cf. CLAUDE.md règle 1).

### Twilio numéro FR

- **Condition de déblocage** : provisioning Twilio + KYC opérateur FR.
- **Action UI** : Twilio Console > Phone Numbers > Buy a number > FR
  > acheter un numéro mobile FR (~5€/mois). Puis poser
  `TWILIO_PHONE_NUMBER` sur Vercel.

### SMTP custom Supabase (Resend en sous-traitance)

- **Condition de déblocage** : compte Resend ✅ déjà actif, action
  UI Supabase à faire.
- **Pourquoi** : rate limit Supabase Auth built-in (~3-4 emails/h)
  n'est pas dimensionné production. Observations récentes : mails
  Auth Supabase atterrissent en spam (DKIM Supabase domain pas
  whitelisté).
- **Action UI** : Supabase Dashboard > Project Settings > Auth >
  SMTP Settings > Enable Custom SMTP > saisir credentials Resend
  (host `smtp.resend.com`, port `465`, user `resend`, password =
  `RESEND_API_KEY`, sender `auth@send.terroir-local.fr`).
- **Test post-config** : déclencher un signup test, vérifier que
  l'email arrive bien depuis `auth@send.terroir-local.fr` (et pas
  `noreply@mail.app.supabase.io`).

### Templates Supabase Auth (Magic Link, Reset, Confirm, Change, Invite)

- **Condition de déblocage** : SMTP custom Supabase activé (item
  précédent).
- **Action UI** : Supabase Dashboard > Auth > Email Templates.
- **Magic Link** : remplacer URL token par `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=magiclink`.
- **Reset Password** : remplacer par `${SITE_URL}/reinitialiser-mot-de-passe?token_hash={{ .TokenHash }}&type=recovery`.
- **Confirm Signup / Change Email / Invite User** : valider visuellement
  + flow E2E une fois SMTP custom actif.

### Branding Stripe Connect

- **Condition de déblocage** : doc Stripe à jour consultée + créneau
  Romain (~1-2 h).
- **Action UI** : Stripe Dashboard > Settings > Branding (logo,
  couleurs, accent color). Personnaliser les pages `/connect/*`
  (onboarding KYC) avec l'identité TerrOir.

### HIBP password protection (Have I Been Pwned)

- **Condition de déblocage** : upgrade Supabase Pro plan (25 $/mois).
- **Action UI** : Supabase Dashboard > Settings > Auth > Password
  Strength > Enable HIBP password check.
- **Bénéfice secondaire** : Pro plan débloque aussi read replicas +
  point-in-time recovery.

### Sentry env vars Vercel

- **Condition de déblocage** : compte Sentry créé + projet TerrOir
  provisionné sur sentry.io.
- **Action UI** : Vercel > Project Settings > Environment Variables
  (Production + Preview + Development) :
  - `NEXT_PUBLIC_SENTRY_DSN`
  - `SENTRY_AUTH_TOKEN` (scope `project:write`)
  - `SENTRY_ORG`
  - `SENTRY_PROJECT`
  - `OPS_EMAIL` (inbox technique recevant les alertes ops critiques)
- **Critique pré-Live** : sans DSN, le SDK Sentry est no-op (build
  OK), donc aucune alerte capturée en prod.

### PostHog (compte + projet)

- **Condition de déblocage** : compte PostHog cloud créé (ou
  self-hosted) + projet TerrOir provisionné.
- **Action UI** : posthog.com > Sign up > créer projet > récupérer
  Project API Key + Host URL.
- **Cascade** : débloque T-201 (mesure widget distance),
  T-245 (scroll-depth + clic produit fiche producteur),
  T-246 (taux expansion widget replié).

---

## Conditionné à T-003 audit avocat livré

Items juridiquement engageants. Le wording exact, les disclaimers
et la conformité RGPD doivent être validés par l'avocat avant
production.

### Pages légales

- **Condition de déblocage** : avocat fournit le contenu juridique
  validé (T-003).
- **Action** :
  - Pages Next.js `/mentions-legales`, `/cgu`, `/cgv`,
    `/politique-confidentialite` (templates en place, contenu
    juridique à brancher).
  - Footer enrichi liens (consumer + producer).
  - Checkbox signup acceptation CGU/RGPD.
  - Bandeau cookies basique conformité ePrivacy.
- **Sous-items à couvrir explicitement par l'avocat** :
  - Wording « ~1500 km circuit long » du DistanceWidget
    (allégation comparative, loi Climat & Résilience).
  - Wording page `/notre-demarche` (comparatif GMS, marges
    intermédiaires).
  - Mode « retrait à la ferme uniquement » : nettoyer CGV article 6
    expédition postale (lignes 480-481, 489, 357, 204), recadrer
    `app/(public)/livraison/page.tsx` ou rediriger vers `/retrait`,
    auditer `cgu`, `mentions-legales`, `contact`, `faq`,
    `comment-ca-marche` pour cohérence (cf. ADR-0003).
  - Mention `sessionStorage` + géocodage tiers
    `api-adresse.data.gouv.fr` + calcul distance Haversine dans la
    politique de confidentialité.
  - Clause CGU producteur sur la véracité des allégations
    score-carbone déclaratives (`mode_elevage`, `alimentation`,
    `densite_animale`).
  - Clause CGU producteur sur l'horodatage de la déclaration sur
    l'honneur (traçabilité probatoire DGCCRF).
  - Clause CGV email_suppressions : conservation table malgré
    suppression compte RGPD Art 17 (intérêt légitime Art 6.1.f
    pour reputation anti-spam Resend).
  - Registre des traitements Art. 30 RGPD : ajouter les 3 colonnes
    `declaration_indicateurs_*` avec finalité (preuve engagement
    déclaratif producteur sur indicateurs score-carbone publics)
    + base légale (intérêt légitime loyauté info consumer +
    obligation légale DGCCRF) + durée de conservation
    (prescription DGCCRF, typiquement 2 ans après fin relation
    commerciale).
  - Politique de purge/anonymisation des `declaration_indicateurs_*`
    à la suppression d'un compte producteur : archive intermédiaire
    pendant délai DGCCRF puis purge, OU anonymisation des colonnes
    (suppression lien `user_id` mais conservation snapshot pour
    stats agrégées). À intégrer à la RPC `delete_user_account`.

---

## Conditionné à passage Live activé

### Test rate-limit `/api/producers/search` en prod

- **Condition de déblocage** : prod TerrOir live (passage Stripe Live
  effectué, domaine `www.terroir-local.fr` servi par Vercel prod).
- **Action** : 31 requêtes successives via `curl` sur
  `https://www.terroir-local.fr/api/producers/search` pour confirmer
  que le rate-limit déployé répond bien `429 Too Many Requests`
  au-delà de 30 req/60s/IP. Test contractuel local OK ; cette
  vérification valide le déploiement effectif Vercel + Upstash.

### Re-soumission flow onboarding producteurs existants

- **Condition de déblocage** : passage Live imminent (avant
  ouverture publique consumer).
- **Action** : les producteurs créés avant T-241 ont les 3 colonnes
  `declaration_indicateurs_*` à `NULL` (pas de backfill). Avant
  ouverture publique, s'assurer qu'aucun producteur visible n'est
  dans cet état. Trois options :
  1. Forcer re-coche via flow `/onboarding` dédié reprise.
  2. Masquer le producteur du listing public tant que
     `declaration_indicateurs_veracite_at IS NULL`.
  3. Bloquer le passage Live tant que tous producteurs visibles
     sont certifiés.

### OPT_OUT_TOKEN_SECRET en `.env.local`

- **Condition de déblocage** : Romain copie la valeur Vercel dans son
  `.env.local` local.
- **Action** : `OPT_OUT_TOKEN_SECRET=<même-valeur-que-Vercel>` dans
  `.env.local`. Active 1 test admin skip conditionnel
  (`tests/e2e/admin/producers-list.spec.ts:139`).

---

## Conditionné à PostHog provisionné

### T-201 — Instrumentation widget distance fiche producteur

- **Condition de déblocage** : compte PostHog + projet TerrOir
  provisionné (cf. section UI tierce).
- **Action** : instrumenter le `DistanceWidget` :
  - Taux de clic « Utiliser ma position » vs saisie CP.
  - Taux de finalisation.
  - Distance médiane affichée.
- **Contrainte privacy stricte** : aucun event ne doit capturer CP,
  lat/lng, email, phone, ni `producer_id` joint à l'event widget
  distance (créerait un signal géo dérivé de profilage user). Cf.
  doctrine anti-PII tracking — helper centralisé
  `lib/analytics/track.ts` avec filtrage runtime + assertion +
  throw mode dev.

### T-245 — Instrumentation scroll-depth + clic produit fiche producteur

- **Condition de déblocage** : PostHog provisionné.
- **Action** : event scroll-depth (25/50/75/100 %) + event « clic
  produit » sur la fiche producteur. Valide en prod le placement
  du bloc « Notre démarche » sous Avis (déplacement décidé sur un
  test utilisateur unique, sans télémétrie).
- **`producer_id` autorisé** pour cet event (vs interdit pour T-201
  widget distance — cf. doctrine anti-PII tracking).

### T-246 — Instrumentation taux d'expansion widget replié

- **Condition de déblocage** : PostHog provisionné.
- **Action** : event sur le clic « Voir la distance jusqu'à toi »
  (état compact → état déplié). Permet de doser plus tard la
  visibilité du bloc Démarche au moment du scaling Sarthe → Pays
  de la Loire.
- **Contrainte privacy** : pas de `producer_id` (idem T-201).

---

## Conditionné à Sentry provisionné

### Sentry capture sur erreurs FK forensiques `log-auth-event.ts`

- **Condition de déblocage** : Sentry env vars Vercel posées (cf.
  section UI tierce).
- **Action** : remplacer `console.warn` silencieux par
  `Sentry.captureException` sur les erreurs FK forensiques de
  `lib/audit-logs/log-auth-event.ts` (signal qu'un user a été
  supprimé entre deux actions).

---

## Conditionné à évolution du wording véracité (v1.0 → v1.1)

Le wording certifié `DECLARATION_VERACITE_WORDINGS` est immuable
historiquement (cf. ADR-0002). Quand un bump de version sera
décidé (clarification juridique, ajout indicateur, etc.), enchaîner :

### Runbook bump wording v1.x

- **Condition de déblocage** : décision Romain (souvent juriste) de
  bumper le wording certifié.
- **Action** :
  1. Ajouter `DECLARATION_VERACITE_WORDINGS["v1.X"]` dans
     `lib/producers/declaration-veracite.ts` (NE JAMAIS toucher les
     versions précédentes).
  2. Bumper `DECLARATION_VERACITE_WORDING_VERSION = "v1.X"` dans
     le même fichier.
  3. Migration SQL : `DROP CONSTRAINT producers_declaration_indicateurs_wording_version_check`
     + `ADD CONSTRAINT ... CHECK (... IN ('v1.0', ..., 'v1.X'))`.
  4. Appliquer la politique re-coche définie ci-dessous.

### Politique re-coche producteurs déjà certifiés

- **Condition de déblocage** : bump wording effectué (item précédent).
- **Action** : trancher entre 3 options :
  - Re-coche explicite mise en avant + notification email.
  - Bandeau d'information persistant dashboard producteur sans
    blocage.
  - Blocage soft dashboard tant que pas re-coché.
- L'absence de mécanisme rend la version courante artefactuelle
  (les producteurs anciens restent en v1.0 indéfiniment).

---

## Conditionné à élargissement géographique (Sarthe → Pays de la Loire → France)

### Adaptation widget distance + référence ADEME

- **Condition de déblocage** : décision produit d'ouvrir hors Sarthe.
- **Action** : la pertinence du widget change radicalement à
  l'échelle nationale (consumer parisien à 200 km d'un producteur
  sarthois fait un arbitrage différent d'un consumer manceau à
  12 km). Re-évaluer :
  - Palette de seuils de distance.
  - Libellés / accroches (« au plus près de chez toi » perd son sens
    à 250 km).
  - Référence comparative `~1500 km circuit long` (ADEME française)
    si extension hors France.
  - Source `api-adresse.data.gouv.fr` (service public français) à
    généraliser hors France.

### Conditionner le bloc score-carbone à une distance seuil

- **Condition de déblocage** : élargissement géo activé.
- **Action** : décider si le bloc score-carbone reste affiché
  inconditionnellement (faible visibilité, OK), ou s'il est
  conditionné à une distance seuil (« en-dessous de X km, le bloc
  est affiché ; au-dessus, il est masqué »).

---

## Conditionné à mesures télémétrie atteignant un seuil

### KPI cible widget distance déplié (T-258 + T-270)

- **Condition de déblocage** : PostHog provisionné + T-246 (taux
  d'expansion) instrumenté + 3-6 mois de données.
- **Action** : définir le seuil sous lequel on considère le widget
  mort-né et on simplifie ou on retire la fonctionnalité. Sans ce
  seuil défini, on porte indéfiniment du code RGPD-sensible
  (lecture sessionStorage défensive, mention RGPD, validation CP,
  audit pré-Live) pour rien.

### Lecture du bloc « Démarche » descendu en bas (T-259)

- **Condition de déblocage** : T-245 (scroll-depth) instrumenté +
  data de référence (3-6 mois).
- **Règle d'arbitrage** : si < 20 % des consumers atteignent le bloc
  Démarche d'après le scroll-depth, l'argument circuit court /
  bien-être animal perd son rôle de réassurance. Trois options à
  évaluer :
  1. Repositionnement intermédiaire (entre Histoire et Produits).
  2. Teaser plus haut dans la fiche.
  3. Abandon du bloc en l'état.

---

## Bug latent (à reprendre en investigation dédiée)

### C-CHECKOUT-IDEMPO — flake test e2e checkout-idempotency

- **Condition de déblocage** : 2-4 h d'investigation dédiée + idéalement
  un cas reproductible hors sandbox Stripe.
- **Statut** : fix défensif appliqué prod
  (`app/api/stripe/create-payment-intent/route.ts:247-273`,
  commit `e46833c`). Le test continue de fail post-fix sur
  l'assertion `winningPi.status !== 'canceled'` ligne 169 — un autre
  code path cancel (cron timeout sandbox ? Stripe webhook
  sandbox ?) OU race spec Stripe sandbox local non reproductible
  en prod.
- **Workaround actuel** : body vidé pass-through, suite reste verte
  (cf. CLAUDE.md piège connu Playwright `test.skip` Windows).
- **Priorité** : moyenne (pattern atomicité prod protégé par le fix
  défensif).

---

## Conformité a11y française marchand grand public

### `<label htmlFor>` manquant StepInfos producer onboarding

- **Condition de déblocage** : conformité loi française a11y
  obligatoire marchand grand public (entrée en vigueur à confirmer
  juridiquement).
- **Statut** : `<label htmlFor=...>` manquant sur StepInfos producer.
  Workaround tests : `page.locator('input[name="..."]')` au lieu de
  `getByLabel(...)`.
- **Action** : refactor pour rendre `getByLabel()` opérationnel +
  conformité screen-readers.
- **Dépendance** : à inclure dans le scope T-003 audit avocat
  (vérification conformité a11y RGAA / loi française).
