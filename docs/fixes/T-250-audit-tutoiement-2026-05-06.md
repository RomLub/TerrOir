# T-250 — Audit tutoiement parcours consumer + corrections

Date : 2026-05-06
Status : Reliquat consumer-facing + mails Resend consumer LIVRÉS
(6 commits, suite cycle). Zones grises (cgu/cgv/légales,
devenir-producteur, mails admin/producer Resend) en attente
arbitrage lead.

## Doctrine TerrOir (CLAUDE.md)

> TUTOIEMENT consumer partout par convention de produit.

L'audit a révélé ~163 occurrences `vous/votre/vos/veuillez` côté
`app/(public)` et 55 côté `app/(consumer)`. Beaucoup de vouvoiement
consumer flagrant : Hero, Steps, CtaBand, Reassurance, SarthemapPostit,
fiche produit, panier, checkout, profil, mails Auth.

## Stratégie de segmentation

Découpage en 6 commits atomiques par cluster pour respecter la doctrine
git stricte (pas de mass commit fourre-tout) :

| Commit | Cluster | Fichiers | Lignes touchées |
|--------|---------|----------|-----------------|
| `aea2492` | Home + composants home | 6 | 16/-16 |
| `d92f264` | Fiche produit (ProductPageClient + StockAlertForm) | 2 | 10/-10 |
| `1a108d9` | app/(consumer)/* (compte, panier, checkout, profil, auth) | 20 | 62/-62 |
| `d8fb30c` | Funnel public (faq, comment-ca-marche, livraison) | 3 | 64/-64 |
| `0197fc5` | Public consumer-facing (contact, carte, alertes-stock, auth pages, notre-demarche, producteurs) | 10 | 33/-33 |
| `87b2fb6` | Mails Resend consumer (8 templates + 3 tests snapshot) | 11 | 49/-49 |

**Total : 52 fichiers modifiés en 6 commits, 234 substitutions
vouvoiement → tutoiement. Tests snapshot Resend mis à jour
(29/29 passent). Build OK à chaque commit.**

**Doctrine git renforcée mid-cycle (cf. décision lead 2026-05-06)** :
clusters 5 et 6 commités via `git commit -o <fichier1> <fichier2> ...`
strict (index temporaire scopé aux fichiers nommés, immune aux race
conditions multi-terminaux observées au commit T-241 r4 / T-243).

## Détail des clusters

### Cluster 1 — Home (commit `aea2492`)

- `app/(public)/page.tsx` — description SEO Metadata
- `app/(public)/_components/home/Hero.tsx` — slogan principal
- `app/(public)/_components/home/Steps.tsx` — 3 étapes consumer +
  titre "Du pré à ta table"
- `app/(public)/_components/home/Reassurance.tsx` — 4 cards
  réassurance
- `app/(public)/_components/home/SarthemapPostit.tsx` — intro carte +
  intro post-it (la citation Marie en post-it conservée — voix du
  producteur reportée, pas du copy TerrOir)
- `app/(public)/_components/home/CtaBand.tsx` — bandeau CTA fin

### Cluster 2 — Fiche produit (commit `d92f264`)

- `app/(public)/producteurs/[slug]/produits/[id]/ProductPageClient.tsx`
  — boutons CTA, microcopy
- `app/(public)/producteurs/[slug]/produits/[id]/_components/StockAlertForm.tsx`
  — wordings d'inscription alerte stock + placeholder email
  (`vous@exemple.com` → `toi@exemple.com`)

### Cluster 3 — app/(consumer) (commit `1a108d9`, 20 fichiers)

- `app/(consumer)/error.tsx`
- `app/(consumer)/auth/inscription/page.tsx`
- `app/(consumer)/compte/page.tsx`, `password/page.tsx`,
  `paiements/page.tsx`, `panier/page.tsx`,
  `notifications/NotificationsClient.tsx`,
  `panier/PanierClient.tsx`,
  `panier/_components/StaleItemsBanner.tsx`,
  `paiements/_components/AddCardModal.tsx`,
  `paiements/_components/PaymentMethodsList.tsx`,
  `checkout/page.tsx`,
  `confirmation/[id]/ConfirmationClient.tsx`,
  `commandes/[id]/OrderDetailClient.tsx`
- `app/(consumer)/compte/profil/page.tsx`,
  `_actions/request-otp.tsx`,
  `_components/ChangeEmailSection.tsx`,
  `_components/ChangeEmailVerifyOtpStep.tsx`,
  `_components/ChangeEmailCompletedStep.tsx`,
  `_components/DeleteAccountSection.tsx`

### Cluster 4 — Funnel public (commit `d8fb30c`)

- `app/(public)/faq/page.tsx` — Q/R + CTA fin (Q "Comment devenir
  producteur" laissée en vouvoiement, audience producteur)
- `app/(public)/comment-ca-marche/page.tsx` — STEPS_CONSO + FAQ
  (STEPS_PROD laissé en vouvoiement, audience producteur)
- `app/(public)/livraison/page.tsx` — description, RETRAIT_BENEFITS,
  bloc retrait + envoi postal + CTA + FAQ

**Note bonus livré** : la `STEPS_CONSO` étape 03 disait « Tu paies sur
place, en direct » — incorrect côté modèle Stripe Connect (paiement
en ligne, cf. règle copywriting Steps homepage). Reformulé en « Le
paiement a déjà été effectué en ligne au moment de la commande ».

**Erreur factuelle restante hors scope T-250 (à flagger lead)** :
`comment-ca-marche` FAQ Q1 "Comment fonctionne le paiement" dit
encore « TerrOir ne prend aucune commission sur le paiement » et
« paiement en espèces ou par carte selon les moyens de l'éleveur » —
contradictoire avec le modèle Stripe Connect 6 % commission.

## Zones grises non touchées (arbitrage lead pendant)

Ping envoyé au team-lead pour décision sur :

1. **`/devenir-producteur`** — audience producteur potentiel.
   Vouvoiement actuel (« Trois engagements, pour vous », « Parlez-nous
   de votre exploitation »). Convention TerrOir tutoie partout, mais
   l'audience est différente.
2. **`/a-propos` section éleveur** — « Vous êtes éleveur ? »
3. **Pages légales** : `/cgu`, `/cgv`, `/mentions-legales`,
   `/politique-confidentialite`, `/charte-qualite`. Vouvoiement
   habituel juridique. Non touchées par défaut.
4. **Mails admin/back-office Resend** :
   `lib/resend/templates/admin-*`, `producer-invitation`,
   `producer-page-approved`, `payout-summary`,
   `order-confirmed-producer`, `order-timeout-cancelled`,
   `order-revival-blocked`, `contact-form-submission`,
   `review-response-notification`, `opt-out-link`. Audience
   producer/admin. Non touchées par défaut.
5. **`/cgu` ligne 681** — `<li>Indiquez vos coordonnées pour suivi</li>`
   dans bloc support contact, ambigu (légal vs operational).

### Cluster 5 — Public consumer-facing (commit `0197fc5`, 10 fichiers)

- `app/(public)/notre-demarche/_components/CircuitSection.tsx` —
  H2 "Voici comment se répartit ce que tu payes"
- `app/(public)/contact/page.tsx`, `ContactClient.tsx` — formulaire
  contact, validations, CTA, success state
- `app/(public)/carte/CarteClient.tsx`, `_components/CarteClientLazy.tsx`
  — légende "Ta position", loading
- `app/(public)/producteurs/page.tsx` — H1, description SEO
- `app/(public)/alertes-stock/confirm/page.tsx`,
  `unsubscribe/page.tsx` — pages d'atterrissage email
- `app/(public)/mot-de-passe-oublie/page.tsx` — étapes flow reset
- `app/(public)/reinitialiser-mot-de-passe/page.tsx` — descriptif
  + erreurs lien

Note : `app/(public)/desabonnement/*` adresse les **leads producteurs**
(« base leads producteurs TerrOir ») — laissé en vouvoiement (zone
audience, pas consumer).

### Cluster 6 — Mails Resend consumer (commit `87b2fb6`, 11 fichiers)

8 templates emails consumer + 3 tests snapshot mis à jour :

- `order-confirmed-consumer.tsx` — subject + corps confirmation
  commande
- `order-reminder-consumer.tsx` — rappel J-1 retrait
- `review-request.tsx` — 3 variantes J0/J+2/J+7 (subject + intro)
- `stock-alert-back-in-stock.tsx` — notification retour stock
- `stock-alert-confirm.tsx` — double opt-in inscription alerte
- `account-deleted.tsx` — confirmation suppression compte RGPD
- `email-change-otp-current.tsx` — code OTP changement email étape 1
- `email-change-otp-new.tsx` — code OTP changement email étape 2

Tests snapshot mis à jour : `email-change-otp-current.test.tsx`
(subject + disclaimer string), `email-change-otp-new.test.tsx` (id),
`stock-alert-confirm.test.tsx` (subject). Suite Resend complète
**29/29 OK**.

## Reliquat — items déjà non-touchés volontairement

Tous les fichiers identifiés au reliquat initial ont été traités
sauf les zones grises explicites :

- `app/(public)/_components/home/NotreDemarcheTeaser.tsx` et
  `FeaturedProducts.tsx` : pas de vouvoiement détecté (faux positifs
  grep large initial).
- `app/(public)/notre-demarche/page.tsx` et autres composants
  (`ComparisonSection`, `CtaSection`, `Disclaimer`, `Hero`) : pas
  de vouvoiement (déjà rédigés en tutoiement ou neutre).
- `app/(public)/produits/page.tsx`, `morceaux/boeuf/page.tsx`,
  `CutsMap.tsx`, `ProducteursClient.tsx`, `ResetPasswordForm.tsx` :
  pas de vouvoiement détecté.
- `app/(public)/desabonnement/*` : audience leads producteur,
  laissé en vouvoiement.

## Validation

- Tous les commits ont été précédés de `npm run build` local =
  **Compiled successfully**, 105/105 pages statiques générées.
- Doctrine git stricte respectée : `git add <fichier précis>` ou
  `git add app/(consumer)` (path), pas de `git add .`. Stage
  inspecté via `git diff --cached --stat` avant chaque commit.
- Tutoiement appliqué avec contraction grammaticale propre (`tu
  reçois` non `tu recevras` quand le présent suffit, `t'expédie` avec
  élision, etc.). Apostrophe `&apos;`/`&rsquo;` dans JSX text, ASCII `'`
  dans strings JS.
- Suite test Resend templates **29/29 verts** après mise à jour des
  3 snapshots impactés par les nouveaux wordings.
- Doctrine `git commit -o <fichier1> <fichier2> ...` strict appliquée
  aux clusters 5+6 (immune aux race conditions multi-terminaux). Les
  clusters 1-4 utilisaient `git add <fichier précis>` puis `git commit`
  classique — fonctionnait ici car aucune race observée sur ces commits,
  mais doctrine `-o` désormais standard pour la suite.

## Garde-fou

- Si on ouvre une nouvelle page consumer-facing, vérifier qu'elle
  est en tutoiement par défaut (pas de copy-paste depuis pages
  vouvoyées historiques).
- Si on ajoute un test snapshot incluant du copy consumer, vérifier
  que la string attendue est en tutoiement (cohérence anti-régression).
- Pour les zones audience producteur (onboarding, ma-page,
  invitation), garder le vouvoiement actuel sauf décision lead
  explicite.
