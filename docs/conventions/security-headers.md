# Convention — headers de sécurité Next.js

> Source : `next.config.js` `async headers()`. Audit PCI SAQ-A W-1 (Session H, 2026-05-05).
>
> Cible : tout chemin servi par Next.js (`source: "/:path*"`).

---

## Headers en place

| Header                                    | Valeur posée par TerrOir                                                                                              | Posé par                  |
|-------------------------------------------|-----------------------------------------------------------------------------------------------------------------------|---------------------------|
| `Strict-Transport-Security`               | `max-age=63072000; includeSubDomains` (2 ans)                                                                         | Vercel (auto, edge level) |
| `X-Frame-Options`                         | `DENY`                                                                                                                | TerrOir (`next.config.js`)|
| `X-Content-Type-Options`                  | `nosniff`                                                                                                             | TerrOir                   |
| `Referrer-Policy`                         | `strict-origin-when-cross-origin`                                                                                     | TerrOir                   |
| `Permissions-Policy`                      | `camera=(), microphone=(), geolocation=(self), payment=(self), interest-cohort=()`                                    | TerrOir                   |
| `Content-Security-Policy-Report-Only`     | (cf. CSP whitelist ci-dessous)                                                                                        | TerrOir                   |

`X-Frame-Options: DENY` plutôt que `SAMEORIGIN` car aucune feature TerrOir ne nécessite l'auto-embed iframe. Stripe Elements et Stripe 3DS sont SOURCED depuis `js.stripe.com` / `hooks.stripe.com` (TerrOir n'est pas embed dans une iframe Stripe — c'est l'inverse), donc `DENY` ne casse pas le checkout.

`Permissions-Policy` :
- `camera=()` / `microphone=()` : aucune feature TerrOir, deny explicite.
- `geolocation=(self)` : `/carte` `DistanceWidget` utilise `navigator.geolocation`.
- `payment=(self)` : Stripe `PaymentRequest API` (Apple Pay / Google Pay) côté checkout.
- `interest-cohort=()` : opt-out FLoC / Topics (Privacy Sandbox).

---

## CSP — whitelist par directive

| Directive                  | Sources whitelistées                                                                                                                                     | Pourquoi                                                                                       |
|----------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------|
| `default-src`              | `'self'`                                                                                                                                                 | Tout ce qui n'est pas listé tombe sur self.                                                    |
| `script-src`               | `'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com https://m.stripe.network https://va.vercel-scripts.com blob:`                                 | Next.js bootstrap (hydratation, RSC payload), Stripe.js, Vercel Analytics, Mapbox-gl workers.  |
| `style-src`                | `'self' 'unsafe-inline'`                                                                                                                                 | Tailwind + next/font + mapbox-gl posent du style inline dynamique.                             |
| `img-src`                  | `'self' data: blob: https:`                                                                                                                              | Photos Supabase Storage / Unsplash / picsum, tiles Mapbox, data URIs SVG.                      |
| `font-src`                 | `'self' data:`                                                                                                                                           | next/font local + fallback data URI.                                                           |
| `connect-src`              | `'self' https://api.stripe.com https://api.mapbox.com https://*.tiles.mapbox.com https://events.mapbox.com https://va.vercel-scripts.com https://vitals.vercel-analytics.com {SUPABASE_URL} wss://{SUPABASE_HOSTNAME}` | XHR/fetch Stripe, Mapbox tiles + telemetry, Vercel Analytics, Supabase REST + Realtime wss.    |
| `frame-src`                | `'self' https://js.stripe.com https://hooks.stripe.com https://m.stripe.network`                                                                         | Iframes Stripe Elements + 3DS challenge.                                                        |
| `worker-src`               | `'self' blob:`                                                                                                                                           | Mapbox-gl spawn un worker en blob: URL.                                                        |
| `object-src`               | `'none'`                                                                                                                                                 | Pas de `<object>`/`<embed>`/`<applet>`, anti-Flash.                                            |
| `base-uri`                 | `'self'`                                                                                                                                                 | Interdit injection `<base href="...">` qui détournerait les liens relatifs.                    |
| `form-action`              | `'self'`                                                                                                                                                 | Interdit POST cross-origin sortant (anti-form hijacking).                                      |
| `frame-ancestors`          | `'none'`                                                                                                                                                 | Équivalent `X-Frame-Options: DENY` pour CSP-aware browsers (anti-clickjacking).                |
| `upgrade-insecure-requests`| —                                                                                                                                                        | Auto-upgrade http→https sur sous-ressources (Mapbox tiles legacy ?).                           |

`{SUPABASE_URL}` est résolu dynamiquement au build depuis `process.env.NEXT_PUBLIC_SUPABASE_URL`. Fallback wildcard `*.supabase.co` si l'env var est absente (édition de docs locale, build sans `.env.local`).

### Trade-offs `'unsafe-inline'` + `'unsafe-eval'`

- `'unsafe-inline'` script : Next.js injecte des `<script>` inline pour la hydratation + le RSC payload. Sans `'unsafe-inline'`, l'app crash en CSP enforce. Migration vers nonce-based CSP (Next 14 middleware nonces) = chantier V1.2+.
- `'unsafe-eval'` script : Stripe.js utilise `eval` interne sur certains chemins (PaymentElement init), et le runtime Next dev en a besoin.
- `'unsafe-inline'` style : Tailwind + next/font + mapbox-gl posent du style inline. Sans `'unsafe-inline'`, breakage UI massif.

Ces concessions sont acceptées tant qu'on reste sur le scope SAQ-A (TerrOir n'a aucune donnée carte en mémoire/storage côté front, donc l'XSS qui exploiterait `unsafe-inline` ne peut pas voler de PAN — c'est précisément l'argument SAQ-A).

---

## Mode Report-Only — observation initiale

CSP démarrée 2026-05-05 (Session H) en `Content-Security-Policy-Report-Only`. **Le browser logue les violations dans la console DevTools (et dans les network logs `csp-violation` si un `report-uri` était configuré — pas le cas ici), mais ne bloque pas le chargement.**

### Pourquoi Report-Only

Une CSP enforce avec un trou (oubli d'un sous-domaine, mauvais directive) casse silencieusement la prod : Mapbox tiles ne charge plus, ou pire, Stripe Elements crash et personne ne peut payer. Le mode Report-Only permet d'observer 7 jours en live, sur le trafic réel, ce qui violerait la policy si elle était enforce — sans risque.

### Procédure d'observation

Pendant 7 jours après deploy (date cible : **2026-05-12**) :

1. **Vercel logs** : pas de `report-uri` configuré côté TerrOir, donc pas de POST violation côté serveur. Les violations restent côté browser.
2. **Browser console (`console.error` CSP)** : ouvrir DevTools sur les pages clés (homepage, `/carte`, `/compte/checkout`, `/compte/panier`) en Chrome/Firefox/Safari. Chercher les messages préfixés `Content-Security-Policy:` indiquant une ressource bloquée par directive.
3. **Cas attendus à monitorer** :
   - `/compte/checkout` : Stripe Elements (js + iframe + api) doit loader sans warning.
   - `/carte` : Mapbox-gl tiles + telemetry, geolocation API.
   - Toutes pages : Vercel Analytics beacon.
   - Photos producteurs (`https:` whitelisté large dans `img-src`).
4. **Si une violation critique est observée** : amender la directive concernée dans `next.config.js` `buildCSPReportOnly()` puis redeploy. Re-démarrer la fenêtre 7j.

### Migration Report-Only → enforce

Quand 7j sans violation critique :

1. Dans `next.config.js`, swap la clé du header `Content-Security-Policy-Report-Only` → `Content-Security-Policy` (voir code source — c'est la dernière entrée de `SECURITY_HEADERS`).
2. Garder la même valeur (la string `directives.join("; ")` ne change pas).
3. Commit + deploy. Continuer à monitorer 24-48h supplémentaires en mode enforce pour s'assurer qu'aucune feature edge-case n'est cassée.
4. Si rollback nécessaire (un cas edge-case casse) : revert au header Report-Only le temps d'amender la policy.

---

## Validation post-deploy

Smoke test manuel via curl (pattern existant `docs/audits/audit-stripe-pci-saq-a-2026-05-05.md` §3) :

```bash
curl -sI https://www.terroir-local.fr/ | grep -iE \
  '(strict-transport|x-frame|x-content|referrer|permissions|content-security)'
```

Doit retourner les 6 headers :
- `Strict-Transport-Security: max-age=63072000; includeSubDomains` (Vercel)
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=(self), payment=(self), interest-cohort=()`
- `Content-Security-Policy-Report-Only: ...` (puis `Content-Security-Policy: ...` après migration enforce)

---

## Quand mettre à jour cette doc

- Ajout d'une nouvelle dépendance front qui charge un script externe (autre PSP, nouvelle lib analytics, autre carto…) → ajouter le domaine en `script-src` / `connect-src` / `img-src` selon usage.
- Migration vers nonce-based CSP (V1.2+) → réécrire la section "Trade-offs `'unsafe-inline'` + `'unsafe-eval'`".
- Ajout d'un report-uri (si on veut centraliser les violations CSP côté Sentry / endpoint custom) → documenter la route `/api/csp-report` et le `report-to` group.

---

## Liens

- Audit PCI SAQ-A : `docs/audits/audit-stripe-pci-saq-a-2026-05-05.md` §W-1.
- MDN — [Content-Security-Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy)
- MDN — [Permissions-Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Permissions-Policy)
- Stripe — [CSP requirements](https://docs.stripe.com/security/guide#content-security-policy)
- Mapbox-gl — [CSP directives](https://docs.mapbox.com/mapbox-gl-js/guides/install/#csp-directives)
