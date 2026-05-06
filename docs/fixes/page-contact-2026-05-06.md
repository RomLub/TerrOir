# Page /contact + politique de confidentialité — 2026-05-06

P0 légales/conversion : première des 6 pages publiques restant à créer
avant launch. Périmètre : page /contact (avec form), API route POST,
template email Resend, page placeholder /politique-confidentialite,
mise à jour footer.

## Lots livrés

### Lot 1 — Page /contact (Server Component + sub-client)

- `app/(public)/contact/page.tsx` : Server Component coquille (metadata
  SEO `alternates.canonical` + `robots: index/follow`, hero, bloc « Avant
  de nous contacter » avec 4 liens FAQ/comment-ça-marche/livraison/
  devenir-producteur, bloc coordonnées avec mailto + adresse postale
  placeholder + 3 réseaux sociaux placeholder).
- `app/(public)/contact/ContactClient.tsx` : Client Component avec form
  contrôlé `useState`, 6 champs (sujet select + nom + email + tel
  optionnel + message ≥ 20 chars + checkbox consent RGPD), validation
  client (regex email + min 20 chars + consent), états idle / submitting
  / success / error, success state remplace le form (pas de retry
  accidentel), error state autorise retry. Utilise `Button`, `Input`,
  `Select`, `Textarea` du DS.

Pattern aligné audit Vercel React perf 2026-05-05 : la coquille statique
reste server-rendered, seul le formulaire interactif est côté client →
JS bundle public minimisé.

### Lot 2 — Page /politique-confidentialite

- `app/(public)/politique-confidentialite/page.tsx` : Server Component
  pure (pas de form). 8 sections RGPD : responsable du traitement,
  données collectées (formulaire / compte acheteur / compte producteur /
  logs), finalités, durée de conservation, droits RGPD (accès,
  rectification, suppression, portabilité, opposition + lien CNIL),
  cookies (mention « strictement nécessaires »), sous-traitants
  (Supabase, Vercel, Stripe, Resend, Twilio), DPO. Lien retour vers
  /contact en pied de page.

### Lot 3 — API route POST /api/contact

- `app/api/contact/route.tsx`. Sécurité défense en profondeur :
  - **Validation Zod** stricte : sujet enum (5 valeurs), nom 1-120,
    email RFC, téléphone optionnel `1-40` ou string vide → undefined,
    message 20-5000, `consent: literal(true)`.
  - **Honeypot** champ `website` : présence d'une valeur → 200
    silencieux + `console.warn`, pas d'envoi, pas d'audit log
    (anti-pollution).
  - **Rate-limit** Upstash sliding window 3/h/IP via nouveau helper
    `getContactFormRateLimit()` dans `lib/rate-limit.ts` (prefix
    `contact_form`). Cap volontairement bas car spam form public à fort
    coût (envoi email + bruit boîte support).
  - **Envoi Resend direct** (pas de `sendTemplate`) : email destiné à la
    boîte interne `contact@terroir-local.fr`, pas un user — la
    suppression list / table `notifications` est conçue pour les
    sortants vers consumers/producers, pas pour l'équipe interne.
  - **Reply-To** = email du visiteur → un clic « Répondre » dans la
    boîte support répond directement au visiteur.
  - **Audit log** best-effort : INSERT dans `public.audit_logs` avec
    `event_type='contact_form_submitted'`. La table `audit_logs` accepte
    `event_type text not null` (pas de CHECK), donc pas de migration
    nécessaire. Échec audit n'empêche pas le 200 (l'email est déjà
    parti).

Codes retour : 200 ok / 400 validation ou body invalide / 429
rate-limit / 502 Resend down. Tests couvrent les 5 cas + variations.

### Lot 4 — Template email Resend

- `lib/resend/templates/contact-form-submission.tsx` : pattern aligné
  `stock-alert-confirm.tsx` (props camelCase typés, `subject()` exporté,
  `EmailLayout` wrapper, `emailTheme` tokens). Subject : `[TerrOir
  Contact] {sujetLabel} — {nom}`. Body : tableau récap (sujet, nom,
  email mailto, téléphone tel: si présent, IP origine), bloc message en
  whitespace-pre-wrap, footer rappelant la fonctionnalité Reply-To.

### Lot 5 — Footer global

- `components/ui/footer.tsx` : la colonne « TerrOir » contenait avant un
  mailto + une ligne italique « Mentions légales · CGU · CGV · Politique
  de confidentialité — à venir ». Remplacé par 3 entrées : `Link
  href="/contact"`, `Link href="/politique-confidentialite"`, ligne
  italique restante pour Mentions légales · CGU · CGV (pages P0
  suivantes à créer).

### Lot 6 — Tests vitest (16 tests)

- `tests/app/api/contact/route.test.ts` : mocks `resend.emails.send` +
  `consumeRateLimit` + `getContactFormRateLimit` +
  `createSupabaseAdminClient`. Couverture :
  - Happy path (200 + Resend args complets : from/to/replyTo/subject/
    html non vide).
  - Audit log INSERT vérifié (event_type, ip_address, metadata).
  - Validation Zod : body non JSON, sujet inconnu, email invalide, nom
    vide, message court, consent absent, consent=false.
  - Téléphone vide string → transform undefined accepté.
  - Rate-limit : 429 + warn quand `success=false`, identifier =
    `x-forwarded-for` extrait.
  - Honeypot : `website` rempli → 200 silent sans envoi sans audit ;
    `website=''` → flow normal.
  - Erreurs Resend : `error` retourné → 502 + console.error ; throw →
    502 + console.error.

Évolution suite : **1732 → 1748 tests** (149 fichiers, +16).

### Lot 7 — Doc

- Ce fichier.
- Pas de `app/sitemap.ts` dans le repo (non créé), donc rien à mettre à
  jour côté sitemap. À envisager dans un PR sitemap dédié quand les 6
  pages P0 seront livrées.

## Placeholders violets restants à compléter avant production

```
$ grep -rn "PLACEHOLDER" app/(public)/contact app/(public)/politique-confidentialite
```

- `app/(public)/contact/page.tsx`
  - L.134 — Adresse postale TerrOir (raison sociale, rue, CP, ville
    Sarthe).
  - L.152 — URL Facebook TerrOir.
  - L.163 — URL Instagram TerrOir.
  - L.174 — URL LinkedIn TerrOir.
- `app/(public)/politique-confidentialite/page.tsx`
  - L.57 — Responsable du traitement (raison sociale + forme juridique
    + SIRET + adresse + email RGPD).
  - L.143 — Durées de conservation par catégorie (à valider DPO).
  - L.226 — Tableau détaillé des cookies (si ajout cookies analytiques
    ultérieur).
  - L.257 — Coordonnées DPO ou mention « non désigné ».

Tous visuellement identifiables à l'écran (`text-violet-500` ou
`bg-violet-500/20`) + grep `PLACEHOLDER` les liste tous.

## Trade-offs et décisions autonomes

- **Resend direct vs sendTemplate** : `sendTemplate` insère dans
  `notifications` + check `email_suppressions`. Pour un email interne
  équipe, ces deux mécanismes sont hors scope (notifications tracke les
  envois vers users, suppressions = bounce/complaint outbound). Choix :
  appel direct `resend.emails.send` + audit log dédié dans `audit_logs`.
- **Rate-limit 3/h/IP via Upstash** : aligné cap audit T-305 magic_link
  (3/120s) en plus restrictif côté volume car la form publique est
  scrapée massivement. Honeypot reste la 1re ligne, le rate-limit
  absorbe les spammers qui contournent.
- **event_type='contact_form_submitted'** : pas de migration ajoutée.
  La table `audit_logs` accepte `text` libre en `event_type`. Le helper
  `logAuthEvent` typé en `AuthEventType` n'est volontairement pas
  étendu — le contact form n'est pas un event auth, l'élargir
  diluerait le sens du type. INSERT direct via admin client.
- **Pas de double opt-in** sur le contact form (vs stock-alerts où c'est
  obligatoire) : l'email part vers une mailbox interne, pas vers un
  user qu'il faudrait protéger contre la spam injection. Le honeypot +
  rate-limit suffisent.
- **Liens FAQ + Livraison rel="nofollow"** : les pages n'existent pas
  encore (P0 légales en cours). Le `nofollow` évite que Google indexe
  un lien mort jusqu'à la création.
- **Footer mailto remplacé par /contact** : on privilégie le flow form
  + tracking audit_logs vs le mailto qui dépend du client mail du
  visiteur (téléphone mobile sans Outlook, etc.).
- **Sitemap.ts** : volontairement laissé hors scope. La création d'un
  sitemap sera traitée dans un PR dédié couvrant l'ensemble des routes
  publiques (P0 légales × 6 + pages catalogue), pas par incrément ad-hoc.
