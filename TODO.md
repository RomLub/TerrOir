# TODO TerrOir

## ✅ Fait (session 21/04/2026)

- Domaine `terroir-local.fr` branché (Vercel + OVH)
- Sous-domaines : `www`, `pro`, `admin` — tous en Valid Configuration
- Zone DNS OVH nettoyée (page parking OVH supprimée, emails MX/SPF OVH préservés)
- Rename `terroir.fr` → `terroir-local.fr` dans le code (commit 444b2cb)
- Env vars Vercel à jour (`NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_PRODUCER_URL`, `RESEND_FROM_EMAIL`)
- Resend vérifié pour `terroir-local.fr` (DKIM + SPF + MX + DMARC posés)
- Nettoyage `STRIPE_CONNECT_CLIENT_ID` (code mort, flux Express + Account Links n'en a pas besoin)
- Lien "Explorer les produits" corrigé sur la home (pointe vers `/carte`)

## 🟠 En cours

- Test end-to-end du flux d'onboarding producteur (cobaye : lubin.rom.ad@gmail.com)
  - Attente reset mot de passe admin via Supabase → Resend
  - Puis : envoi invitation → création compte → Stripe Connect → retour onboarded

## 🔴 À faire (bloquants lancement)

- Onboarder Julien (GAEC du Rheu) — après validation du test end-to-end
- Basculer Stripe en mode Live (aujourd'hui en Test)
- Mettre à jour le webhook Stripe vers `www.terroir-local.fr` (actuellement pointe sur `terr-oir-21cl.vercel.app`)

## 🟡 À faire (non bloquants)

- Mapbox : en attente retour CB
- Twilio SMS : numéro FR à régler
- Vectormagic logo SVG (8,99€)
- Ajouter un lien "Mot de passe oublié" sur la page de connexion
- Supprimer `/api/stripe/payouts` legacy (remplacé par `/api/cron/weekly-payout`)
- Nettoyer les `.tsx` résiduels dans `/api/cron/` (route.tsx → route.ts)
- Remplacer images Unsplash provisoires par vraies photos producteurs

## 🔵 Idées / améliorations

- Pages d'accueil dédiées pour `pro.terroir-local.fr/` et `admin.terroir-local.fr/` (actuellement fallback vers layout public)
- MiniMap Mapbox sur fiche produit (non câblée)
- Régionaliser le fallback géoloc (actuellement Le Mans en dur)
