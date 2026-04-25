# TODO TerrOir

Priorités forward-looking uniquement. Pour l'historique complet des commits / chantiers clos, voir [`CHANGELOG.md`](./CHANGELOG.md). Pour les leçons apprises / pitfalls thématiques, voir [`LESSONS.md`](./LESSONS.md).

## 🟠 En cours

_(rien en cours)_

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
- **Extraction helper `useLogoutFlow()`** si un 3e bouton logout apparaît (DRY prévention). Aujourd'hui 2 call sites : `navbar-public.tsx` + `AdminHeader.tsx` appliquent le pattern double signOut manuellement.
- **Tests supplémentaires sur `lib/producers/fetch-public.ts` + `promote-to-public.ts`** (nécessite mocks Supabase non-triviaux). Non prioritaire — les 77 tests existants couvrent les helpers critiques (slots, HMAC, cookie-domain, formatters).
- **Webhook Stripe `account.updated` manquant** — conséquence : `producers.stripe_account_id` est set AVANT onboarding complété côté Stripe → faux positif badge « ✓ Compte Stripe connecté » sur `/parametres` si le producer abandonne le flux Stripe à mi-course. Chantier : handler webhook `account.updated` qui synchronise `producers.stripe_onboarding_completed` (ou équivalent) avec `charges_enabled` / `details_submitted` côté Stripe. **Bloquant avant go-live public** si on veut un statut Connect fiable.
- **Logging email en clair RGPD** — `[EMAIL_SEND_FAIL]` + `[LEAD_BUMP_WARN]` + `notifications.metadata` contiennent des emails en clair. Incohérence RGPD à trancher globalement (masquage partiel `u***@domain.tld`, hash, ou conservation assumée selon finalité). Chantier RGPD logs dédié à prévoir avant go-live.
- **Fail-fast env vars `NEXT_PUBLIC_APP_URL` + `NEXT_PUBLIC_PRODUCER_URL`** — même pattern que l'ex-fallback silencieux `RESEND_FROM_EMAIL` corrigé dans le commit `ef7f10b`. Ces 2 env vars sont critiques pour la navigation cross-subdomain (role-switcher, redirects post-auth, liens emails). Un fallback silencieux ou une absence non-détectée peut produire des bugs visuels difficiles à diagnostiquer. Candidat chantier avant bascule Stripe Live.
- **Bug cosmétique reprise onboarding `prenom_affichage`** — le fichier `app/(producer)/onboarding/page.tsx` affiche `"À compléter"` au lieu du placeholder pour `prenom_affichage` lors d'une reprise mid-wizard. Le fichier `app/(producer)/invitation/page.tsx` a déjà été corrigé dans le hotfix `95d0572` (pattern aligné sur `nom_exploitation`). Il reste à dupliquer le même pattern dans `onboarding/page.tsx`. Bug bénin car le Zod `min(1)` côté server bloque la finalisation tant que le user n'a pas saisi une vraie valeur.
- **Transition auto lead `'contacted'` → `'onboarded'`** quand le wizard est finalisé (Étape 3 soumise). Aujourd'hui la transition n'existe pas, les leads restent bloqués en `'contacted'` même après onboarding complet. À implémenter dans `complete-onboarding.ts` (server action Étape 3) : `UPDATE producer_interests SET statut='onboarded' WHERE email = session.email AND statut='contacted'` (no-op si pas de match, cohérent avec le bump auto de `dbe6360`).
- **Taux d'erreur 13% webhook Stripe Test** — observé le 2026-04-24 sur Stripe Dashboard (Webhooks > endpoint `https://www.terroir-local.fr/api/stripe/webhook`). Causes probables : signature invalide suite à rotation de `STRIPE_WEBHOOK_SECRET`, 500 applicatif dans un handler, ou timeout Stripe. Investigation : consulter « Recent deliveries » du Dashboard pour identifier les events en erreur, leur code HTTP et leur cause. Fix selon diagnostic. À traiter avant bascule Stripe Live.

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

## 🗺️ Vision funnel producteur (chantier à scoper)

> Refonte cohérence admin leads / producteurs décidée 2026-04-24 après analyse de la confusion entre les 2 espaces admin (`/producer-interests` et `/gestion-producteurs`).

### Parcours cible

1. Formulaire `/devenir-producteur` → lead `statut='new'` (**Nouveau**).
2. Admin clique « Inviter » → lead `statut='contacted'` (**Contacté**) + email envoyé.
3. Producteur remplit wizard (simplifié à 2 étapes : compte + infos exploitation, avec champs du lead pré-remplis) → lead passe `'onboarded'` + producer apparaît dans Gestion `statut="En attente de validation"`.
4. Admin valide dans Gestion → producer `statut="Inactif"` (peut accéder à son espace, pas encore visible publique).
5. 3 conditions remplies → producer passe `"Public"` automatique :
   - Au moins 1 produit publié
   - Stripe Connect actif (`charges_enabled=true` via webhook `account.updated`)
   - Au moins 1 créneau configuré
6. Statuts ultérieurs : `"Suspendu"` / `"Supprimé"`.

### Décisions subsidiaires

- **Simplifier formulaire public `/devenir-producteur`** : champs essentiels uniquement (prénom, nom, email, téléphone, nom exploitation, commune, message libre).
- **Wizard simplifié à 2 étapes** au lieu de 3 : compte (mdp uniquement, email en lecture seule) + exploitation (forme juridique, SIRET, adresse, code postal, type production). Tout ce qui est dans le lead est pré-rempli sans ressaisie.
- **Supprimer le champ `prenom_affichage`** : réutiliser `users.prenom` directement pour signer le post-it « Conseil de [prenom] ». Évite un doublon sémantique (et supprime la dette du bug cosmétique reprise onboarding).
- **Invitation admin directe** : créer automatiquement un lead `statut='contacted'` si l'email n'existe pas déjà dans `producer_interests`, pour que l'onglet Leads soit le journal d'acquisition complet.
- **Ajouter champ `source` sur le lead** (`formulaire_public` / `invitation_directe`) pour tracer l'origine.

### Ordonnancement

Chantier à scoper en session dédiée (estimation : 1-2 jours de travail CC parallélisé). À traiter avant go-live public si possible pour avoir un admin cohérent. **Prioriser après les bloquants lancement restants** (bascule Stripe Live, webhook `account.updated`, onboarder Julien).

## 🔵 Idées / améliorations

- Pages d'accueil dédiées pour `pro.terroir-local.fr/` et `admin.terroir-local.fr/` (actuellement fallback vers layout public côté pro ; côté admin, redirect middleware en place depuis le 22/04 mais pas de vraie landing).
- MiniMap Mapbox sur fiche produit (non câblée).
- Régionaliser le fallback géoloc (actuellement Le Mans en dur).
- Notation/reviews producteurs (cadre existant via reviews mais flow à valider).
- Export comptable consommateurs + producteurs.
- Gestion des litiges (retrait non effectué, marchandise abîmée).
- Stats publiques sur la home (nb commandes, nb producteurs actifs).
- **Post-it « Conseil éleveur » en icône cliquable avec popover** (décision Romain 2026-04-24) : au lieu d'un post-it permanent sur la fiche produit, icône discrète à côté du nom produit (ex: petite épingle ou bulle dialogue). Hover desktop → tooltip « Le conseil de [prenom] ». Tap mobile → popover avec le texte complet. Découvrabilité cross-device, fiche plus épurée en permanence.
