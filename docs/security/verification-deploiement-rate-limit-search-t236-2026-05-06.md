# Vérification déploiement rate-limit `/api/producers/search` — T-236 (2026-05-06)

**Périmètre** : confirmer que le commit `11a8bc9 feat(security): rate-limit
/api/producers/search anti-trilateration (T-236)` est mergé `master` et
déployé en prod via Vercel.

**Pourquoi cette vérif** : sans rate-limit, un attaquant peut énumérer
des CP voisins du CP cible pour reconstruire l'adresse réelle d'un
producteur, malgré le `roundCoord` 2 décimales (~1.1 km). Le rate-limit
+ flou rend l'attaque économiquement non rentable (cluster T-227
ré-identification croisement données publiques).

---

## Vérifications

### 1. Commit présent dans master

```
$ git log master --oneline | grep 11a8bc9
11a8bc9 feat(security): rate-limit /api/producers/search anti-trilateration (T-236)
```

✅ Commit présent + ancestor de `HEAD`.

Date du commit : 2026-05-06 19:42:51 +0200. Mergé direct master (pas
de PR — workflow pré-launch acceptable cf. doctrine CLAUDE.md).

### 2. Code en place dans la route

`app/api/producers/search/route.ts:11-39` :

```typescript
const { ipAddress } = extractRequestContext(request.headers);
const limiter = getProducersSearchRateLimit();
const rateResult = await consumeRateLimit(
  limiter,
  ipAddress ?? "anon-no-ip",
);
if (!rateResult.success) {
  console.warn(
    `[PRODUCERS_SEARCH_RATE_LIMIT] ip=${ipAddress ?? "(none)"}`,
  );
  return NextResponse.json(
    { error: "Trop de requêtes" },
    {
      status: 429,
      headers: {
        "Retry-After": String(
          Math.max(1, Math.ceil((rateResult.reset - Date.now()) / 1000)),
        ),
      },
    },
  );
}
```

✅ Pattern conforme :
- Key = IP (endpoint anonyme public, pas de userId disponible).
- 429 + body `{ error }` + header `Retry-After`.
- Fail-open via `consumeRateLimit` (cf. `lib/rate-limit.ts`).
- `console.warn` forensique sans audit log applicatif (cohérent
  doctrine T-200 r1 : pas de log par-IP côté DB).

### 3. Helper en place dans `lib/rate-limit.ts`

`lib/rate-limit.ts:241-250` :

```typescript
export function getProducersSearchRateLimit(): Ratelimit | null {
  if (_producersSearchLimiter === undefined) {
    _producersSearchLimiter = createRateLimiter(
      30,
      "60 s",
      "producers_search",
    );
  }
  return _producersSearchLimiter;
}
```

✅ Cap 30/60s (généreux car endpoint lecture/cache, mais bloque le
volume requis pour énumération exhaustive de CP). Prefix Redis
`producers_search` unique.

### 4. Test unitaire

Cf. `tests/app/api/producers/search/route.test.ts` (98 lignes ajoutées
par le commit `11a8bc9`). Couvre cas nominal + 429.

### 5. Doc convention rate-limiting à jour

✅ Tableau « Endpoints rate-limités actuels » mis à jour ce cycle pour
inclure la ligne :

| Search | `getProducersSearchRateLimit` (T-236) | 30/60s | `app/api/producers/search/route.ts` | IP | 429 + Retry-After |

(Voir `docs/conventions/rate-limiting.md`.)

### 6. Déploiement Vercel

Pas de vérif technique directe via MCP (pas de tool Vercel). Confiance
dans le déploiement automatique master → Vercel prod, conformément au
pattern continuous deployment du repo (cf. checklist `setup-deploy`).

À reconfirmer **manuellement** par Romain :
- Connecter à `terroir-local.fr` et faire 35+ requêtes `/api/producers/search`
  successives → la 31ᵉ doit retourner `429`.
- Tester depuis 2 IP différentes pour vérifier le keying par IP.

---

## Verdict T-236

**Bloquant pré-Live levé côté code** (commit présent, code en place,
helper en place, test unitaire, doc à jour).

**À confirmer manuellement** : déploiement effectif Vercel prod via
test 31 requêtes (pas de tool MCP Vercel disponible côté agent).

Item P0 checklist pré-Live → ✅ côté technique. Cocher 🔲 → ✅ après
test manuel Romain.

---

## Articulation menaces résiduelles

- **T-227** (ré-identification croisement données publiques) reste
  ouvert : rate-limit + flou rendent la trilatération inverse non
  rentable, mais n'empêchent pas le croisement nom ferme + commune +
  photos. Mitigation = UX onboarding + CGU producteur.
- **T-204** (scaling géocodeur public) : si on passe à un cap plus
  large pour absorber la charge consumer, vérifier que le rate-limit
  reste serré pour ne pas réouvrir T-236.

---

## Références

- Commit : `11a8bc9 feat(security): rate-limit /api/producers/search
  anti-trilateration (T-236)`
- Source code : `app/api/producers/search/route.ts`
- Helper : `lib/rate-limit.ts:241`
- Tests : `tests/app/api/producers/search/route.test.ts`
- Convention : `docs/conventions/rate-limiting.md`
- Threat model : `docs/security/threat-model-reidentification-producer-2026-05-06.md`
- Floutage coords : `lib/producers/coords.ts` (T-217)
