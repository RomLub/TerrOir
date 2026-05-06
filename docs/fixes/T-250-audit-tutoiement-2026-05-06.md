# T-250 — Audit tutoiement parcours consumer + corrections

Date : 2026-05-06
Status : 8 clusters livrés. Zones grises 1+2 (devenir-producteur,
a-propos éleveur) arbitrées TUTOYER par le lead et appliquées.
Mails post-CGU producer + admin (Option C Romain) appliqués
cluster 8. Pages légales SKIP (cohérence avec T-041 avocat).
`producer-invitation` + `opt-out-link` MAINTENUS en vouvoiement
(cibles pré-CGU).

## Doctrine TerrOir (CLAUDE.md)

> TUTOIEMENT consumer partout par convention de produit.

L'audit a révélé ~163 occurrences `vous/votre/vos/veuillez` côté
`app/(public)` et 55 côté `app/(consumer)`. Beaucoup de vouvoiement
consumer flagrant : Hero, Steps, CtaBand, Reassurance, SarthemapPostit,
fiche produit, panier, checkout, profil, mails Auth.

## Stratégie de segmentation

Découpage en 8 commits atomiques par cluster pour respecter la doctrine
git stricte (pas de mass commit fourre-tout) :

| Commit | Cluster | Fichiers | Lignes touchées |
|--------|---------|----------|-----------------|
| `aea2492` | Home + composants home | 6 | 16/-16 |
| `d92f264` | Fiche produit (ProductPageClient + StockAlertForm) | 2 | 10/-10 |
| `1a108d9` | app/(consumer)/* (compte, panier, checkout, profil, auth) | 20 | 62/-62 |
| `d8fb30c` | Funnel public (faq, comment-ca-marche, livraison) | 3 | 64/-64 |
| `0197fc5` | Public consumer-facing (contact, carte, alertes-stock, auth pages, notre-demarche, producteurs) | 10 | 33/-33 |
| `87b2fb6` | Mails Resend consumer (8 templates + 3 tests snapshot) | 11 | 49/-49 |
| `5ed9ce1` | Zones grises arbitrées TUTOYER (devenir-producteur + a-propos éleveur) | 2 | 20/-20 |
| `d5b826b` | Mails Resend post-CGU (3 producer + 3 consumer mal-classés + 1 admin Romain + 1 test) | 7 | 23/-23 |

**Total : 61 fichiers modifiés en 8 commits, 277 substitutions
vouvoiement → tutoiement. Tests snapshot Resend mis à jour
(29/29 passent). Build OK à chaque commit.**

**Doctrine git renforcée mid-cycle (cf. décision lead 2026-05-06)** :
clusters 5, 6, 7 et 8 commités via `git commit -o <fichier1> <fichier2> ...`
strict (index temporaire scopé aux fichiers nommés, immune aux race
conditions multi-terminaux observées au commit T-241 r4 / T-243).
Race confirmée empiriquement au cluster 8 : un autre teammate avait
modifié `app/(public)/comment-ca-marche/page.tsx` pendant mon work,
le `-o` strict l'a bien exclu de mon commit (vérifié post-push via
`git show --stat HEAD`).

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

## Zones grises — décisions lead 2026-05-06

Le lead a tranché 3 zones (décision technique) et a remonté la 4e à
Romain (décision relationnelle business) :

1. **`/devenir-producteur`** → **TUTOYER** (livré cluster 7).
   Rationale lead : page web publique, com produit, doctrine CLAUDE.md
   "TerrOir tutoie partout" s'applique. Cohérence > formalisme.
2. **`/a-propos` section éleveur** → **TUTOYER** (livré cluster 7).
   Même rationale — page web com produit.
3. **Pages légales** (`/cgu`, `/cgv`, `/mentions-legales`,
   `/politique-confidentialite`, `/charte-qualite`) → **NE PAS
   TOUCHER**. Rationale lead : T-041 (rédaction + validation avocat)
   est hors scope. Vouvoiement juridique habituel = standard. Tutoyer
   maintenant créerait un mismatch quand l'avocat livrera ses pages
   en vouvoiement. Statu quo. Inclut `/cgu` ligne 681 (« Indiquez vos
   coordonnées pour suivi »).
4. **Mails admin/back-office producer** → **Option C arbitrée par
   Romain** (livré cluster 8) avec rationale verbatim à conserver
   pour traçabilité décision en cas de feedback Julien post-Live :

   > `producer-invitation` est le SEUL mail dont le destinataire n'a
   > pas encore signé les CGU ni accepté la convention TerrOir.
   > Tutoyer = imposer le ton plateforme avant acceptation.
   > **Vouvoyer dans l'invitation = laisser le choix d'embarquer le
   > ton TerrOir en signant**. Tous les autres mails producer sont
   > post-onboarding (post-acceptation CGU = acceptation convention
   > TerrOir = tutoiement standard appliqué).

   Application :

   | Mail | Décision | Audience réelle (post-inspection) |
   |------|----------|-----------------------------------|
   | `producer-invitation` | **VOUVOYER** maintenu | lead pré-CGU |
   | `opt-out-link` | **VOUVOYER** maintenu | lead pré-CGU (base leads producteurs) |
   | `payout-summary` | TUTOYER (cluster 8) | producer post-CGU |
   | `order-confirmed-producer` | TUTOYER déjà OK (impératif) | producer post-CGU |
   | `producer-page-approved` | TUTOYER (cluster 8) | producer post-CGU |
   | `contact-form-submission` | TUTOYER (cluster 8) | admin Romain |
   | `order-timeout-cancelled` | TUTOYER (cluster 8) | **consumer** (mal classé brief lead) |
   | `order-revival-blocked` | TUTOYER (cluster 8) | **consumer** (mal classé brief lead) |
   | `review-response-notification` | TUTOYER (cluster 8) | **consumer** (mal classé brief lead) |
   | `admin-*` (8 templates) | aucun vouvoiement détecté | déjà conformes |

   Note : 3 templates listés "producer" dans le brief lead se sont
   révélés à l'inspection être des mails CONSUMER
   (`order-timeout-cancelled`, `order-revival-blocked`,
   `review-response-notification`) — auraient dû appartenir au
   cluster 6. Traités selon leur audience réelle, pas selon le brief.
   Cohérent avec décision lead "Si destinataire = Romain admin →
   tutoiement absolu, sinon règle post-CGU".

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

### Cluster 7 — Zones grises arbitrées TUTOYER (commit `5ed9ce1`, 2 fichiers)

Suite à la décision lead 2026-05-06 (cf. section "Zones grises") :

- `app/(public)/devenir-producteur/page.tsx` — héro, ADVANTAGES,
  formulaire candidature, success state, CTA "Trois engagements
  pour toi", "Parle-nous de ton exploitation", textarea "Ton
  message", consent footer.
- `app/(public)/a-propos/page.tsx` — section VALUES "Transparence"/
  "Lien humain", CTA contact, bandeau "Tu es éleveur ?" + "Rejoins
  la première marketplace dédiée à la Sarthe".

Cluster 7 commité avec doctrine `-o` strict.

### Cluster 8 — Mails post-CGU (commit `d5b826b`, 7 fichiers)

Application de l'arbitrage Romain "Option C" (cf. section "Zones
grises", point 4). Mails producer post-CGU + admin Romain + 3 mails
consumer mal-classés dans le brief lead :

- `lib/resend/templates/payout-summary.tsx` — virement hebdo
  ("Selon ta banque, compte 1 à 3 jours").
- `lib/resend/templates/producer-page-approved.tsx` — subject "Ta
  page X est en ligne", h1, partage clients/réseaux.
- `lib/resend/templates/contact-form-submission.tsx` — admin Romain
  (footer "utilise la fonction Répondre de ton client mail").
- `lib/resend/templates/order-revival-blocked.tsx` — **consumer**
  refund post-3DS race (re-classifié à l'inspection).
- `lib/resend/templates/order-timeout-cancelled.tsx` — **consumer**
  commande non confirmée 24h (re-classifié).
- `lib/resend/templates/review-response-notification.tsx` —
  **consumer** notif réponse producteur (re-classifié, le
  `responseText` prop laissé tel quel car voix producer reportée).
- `tests/lib/resend/templates/review-response-notification.test.tsx`
  — assertion subject mise à jour ("a répondu à ton avis").

`order-confirmed-producer` inspecté : pas de "vous/votre" — wording
déjà à l'impératif neutre ("Merci de la confirmer sous 24h"), aucune
modif requise.

Mails `admin-*` (8 templates) inspectés via grep : aucun vouvoiement
détecté, déjà conformes (style notification impersonnel).

Race git multi-terminal détectée pendant le commit (un autre
teammate avait modifié `app/(public)/comment-ca-marche/page.tsx`).
Doctrine `-o` strict a bien exclu ce fichier — vérification
post-push via `git show --stat HEAD`.

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
  aux clusters 5, 6 et 7 (immune aux race conditions multi-terminaux).
  Les clusters 1-4 utilisaient `git add <fichier précis>` puis
  `git commit` classique — fonctionnait ici car aucune race observée
  sur ces commits,
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
