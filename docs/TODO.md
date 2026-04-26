# TODO TerrOir

Priorités forward-looking uniquement. Pour l'historique complet des commits / chantiers clos, voir [`CHANGELOG.md`](./CHANGELOG.md). Pour les leçons apprises / pitfalls thématiques, voir [`LESSONS.md`](./LESSONS.md).

## 🟠 En cours

_(rien en cours)_

## 🔴 Bugs ouverts

- **Magic link PKCE — `code_challenge does not match`** (ouvert 26/04 fin de session) :
  - **Symptôme** : l'utilisateur clique le bouton « Se connecter » dans l'email magic link et arrive sur `https://www.terroir-local.fr/connexion?error=auth_callback&reason=code+challenge+does+not+match` au lieu d'être loggé.
  - **Workaround** : le login mdp classique reste fonctionnel.
  - **Hypothèse principale** : le cookie `code_verifier` posé par `signInWithOtp` côté server n'est pas retrouvé par le callback. Causes plausibles : (1) email ouvert dans un client mail web qui lance un autre navigateur (cookies de session pas partagés), (2) cookies cross-subdomain bloqués si Supabase pose le cookie sur `<ref>.supabase.co` au lieu de `.terroir-local.fr`, (3) attribute `SameSite=Lax/Strict` qui bloque la lecture du cookie sur la requête initiale du callback.
  - **Plan d'investigation** :
    1. Inspecter `app/connexion/actions.ts:requestMagicLinkAction` + `app/auth/callback/route.ts` pour confirmer où est posé le `code_verifier`.
    2. Vérifier les attributes du cookie `code_verifier` (Domain, SameSite, HttpOnly, Path) via DevTools Application > Cookies sur la requête `/auth/v1/otp` et la requête callback.
    3. Tester scénarios : ouvrir mail dans même navigateur (Chrome desktop) vs autre navigateur (Firefox) vs mobile (client iOS Mail) vs client desktop (Outlook/Thunderbolt).
    4. Si confirmé cross-context : envisager le flow OTP `?token_hash=&type=magiclink` (pas de PKCE, pas de cookie côté server) — le callback `app/auth/callback/route.ts:87-91` le supporte déjà via `verifyOtp`. Nécessite changer le template Supabase pour utiliser `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=magiclink&next={{ .RedirectTo }}` (et adapter `emailRedirectTo` côté `actions.ts` pour ne pas embarquer de query string — cf bug `Missing+code+or+token_hash` documenté dans `LESSONS.md`).
  - **Référence** : URL exemple `https://www.terroir-local.fr/connexion?error=auth_callback&reason=code+challenge+does+not+match`.

## 🔴 À faire (bloquants lancement)

- **Onboarder Julien (GAEC du Rheu)** — pages landing Stripe Connect `/connect/done` + `/connect/refresh` désormais en place (commit `e93043e`), mais onboarding end-to-end Stripe Live pas encore testé en situation réelle. À garder bloquant tant que le flow n'est pas validé avec un vrai producer.
- **Basculer Stripe en mode Live** (aujourd'hui en Test) + tester scénario 3DS (SCA).
- **Webhook Stripe vers `www.terroir-local.fr`** : à confirmer pointer sur la bonne URL (actuellement potentiellement `terr-oir-21cl.vercel.app`). À valider avant go-live.

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

- **Mapbox** : en attente retour CB.
- **Twilio SMS** : numéro FR à régler.
- **Vectormagic logo SVG** (8,99€).
- **Remplacer images Unsplash** provisoires par vraies photos producteurs.
- **Flux invitation : cas "email déjà en base"** à détecter proprement côté UX (au-delà de la correction fonctionnelle du Chantier 2).
- **Désactiver Stripe Link account-wide** dans le Dashboard Stripe (Settings > Payment methods > Link toggle off) — action externe. Nécessaire si Link persiste à apparaître malgré `payment_method_types: ['card']` côté intents.
- **Webhook Stripe `account.updated` manquant** — conséquence : `producers.stripe_account_id` est set AVANT onboarding complété côté Stripe → faux positif badge « ✓ Compte Stripe connecté » sur `/parametres` si le producer abandonne le flux Stripe à mi-course. Chantier : handler webhook `account.updated` qui synchronise `producers.stripe_onboarding_completed` (ou équivalent) avec `charges_enabled` / `details_submitted` côté Stripe. **Bloquant avant go-live public** si on veut un statut Connect fiable.
- **Transition auto lead `'contacted'` → `'onboarded'`** quand le wizard est finalisé (Étape 3 soumise). Aujourd'hui la transition n'existe pas, les leads restent bloqués en `'contacted'` même après onboarding complet. À implémenter dans `complete-onboarding.ts` (server action Étape 3) : `UPDATE producer_interests SET statut='onboarded' WHERE email = session.email AND statut='contacted'` (no-op si pas de match, cohérent avec le bump auto de `dbe6360`).
- **Mentions légales footer pro** — page absente, le footer pro pointe sur un href mort. À créer une fois le contenu juridique disponible (action externe Romain).
- **Renommer `StepEntreprise.tsx` → `StepInfos.tsx`** — depuis la fusion `StepPersonnel` + `StepEntreprise` (commit `49b45d8`), le composant gère désormais perso ET entreprise. Le nom n'est plus aligné. Cosmétique trivial mais déféré pour ne pas mélanger refactor et delivery.
- **Tests unitaires `isValidRedirectPath` + `resolvePostLoginPath`** — helpers ajoutés à `lib/auth/post-login-redirect.ts` aux commits `53f8f6a` + `d4088d5`, pas encore couverts par vitest. Critiques pour la sécurité (anti open-redirect) — à ajouter avant lancement public.
- **UI `/producer-interests` afficher colonne `source`** (Phase 2bis funnel) — la colonne DB existe (commit `87bfff9`) et est alimentée correctement, mais le `LeadsTable` admin ne la montre pas encore. Petit chantier UX pour distinguer `formulaire_public` vs `invitation_directe`.
- **Backfill producers `count = 0`** — réévaluer avant chaque lancement. Aujourd'hui négligeable (faible volume), à garder en tête si le funnel monte.
- **SMTP custom Supabase à confirmer** — la doc HANDOFF mentionne le custom SMTP Resend configuré (23/04). Observation récente : mails Auth atterrissant en spam (peut-être lié au bug magic link PKCE ci-dessus). À vérifier dans Supabase Dashboard > Auth > SMTP que la config Resend est toujours active et la clé valide. Si pas configuré, configurer Resend en SMTP custom serait propre (rate limit Supabase built-in ~3-4/h).
- **Templates Supabase Auth Email — passage `{{ .ConfirmationURL }}`** — à appliquer aux 5 templates customisés (Magic Link, Confirm Signup, Reset Password, Change Email, Invite User) suite au bug `Missing+code+or+token_hash` debug 26/04. Le pattern `{{ .RedirectTo }}?token_hash={{ .TokenHash }}` casse dès que `emailRedirectTo` contient une query string (cf `LESSONS.md` Auth & sessions). Action externe Romain via Dashboard.

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

### Phase 3 — DROP `prenom_affichage` (reportée)

> Décision 24/04 : réutiliser `users.prenom` directement pour signer le post-it « Conseil de [prenom] » au lieu d'un champ dédié. Reportée 26/04 — chantier transversal ~19 fichiers (3 INSERT runtime, seed, wizard, édition onboarding, components consumer, tests). À traiter en session dédiée pour éviter une livraison half-baked.

Plan de migration :

1. Migration SQL : DROP NOT NULL puis DROP COLUMN `producers.prenom_affichage`.
2. Adapter les 3 INSERT runtime : `create-account.ts`, `login-and-upgrade.ts`, `invitation/page.tsx` SSR (retirer le placeholder `'À compléter'`).
3. Adapter `StepEntreprise` (ex-Personnel/Entreprise) : retirer le champ + validation.
4. Adapter `app/(producer)/onboarding/page.tsx` : retirer le champ d'édition.
5. Adapter les components consumer qui affichent le post-it : remplacer `producer.prenom_affichage` par `producer.users?.prenom` (via join) ou pré-fetch.
6. Mettre à jour les seeds + cleanup-seed.
7. Tests à refresh.

### Phase 2bis — UI `/producer-interests` colonne `source` (à faire)

La colonne DB existe et est alimentée correctement, mais le `LeadsTable` admin ne la montre pas encore. Cf 🟡 dettes ci-dessus.

### Ordonnancement

**Reste à scoper** : Phase 3 + Phase 2bis. **Prioriser après les bloquants lancement restants** (bascule Stripe Live, webhook `account.updated`, onboarder Julien) et le bug magic link PKCE.

## 🔵 Idées / améliorations

- Notation/reviews producteurs (cadre existant via reviews mais flow à valider).
- Export comptable consommateurs + producteurs.
- Gestion des litiges (retrait non effectué, marchandise abîmée).
