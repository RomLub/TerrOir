# Vérification absence outils session-replay — T-274

> **Cluster** : T-261 (RGPD pré-Live consolidé) / T-200 r1 (doctrine privacy).
> **Scope** : confirmer qu'aucun outil de session-replay / monitoring
> front (Sentry, Datadog, LogRocket, FullStory, Hotjar, Microsoft Clarity,
> Smartlook, Mouseflow, Inspectlet) n'est intégré au repo TerrOir, et
> donc qu'aucune capture DOM / sessionStorage / localStorage n'est
> envoyée vers un serveur tiers.
> **Méthode** : grep `package.json` + `package-lock.json` + grep code
> applicatif (`app/`, `components/`, `lib/`).
> **Date** : 2026-05-06.

---

## TL;DR

**Vérification ✅ conforme.**
- **Aucune dépendance** de session-replay / RUM tiers installée
  (`package.json` + `package-lock.json`).
- **Aucun call site** des SDK correspondants dans le code applicatif
  (grep `Sentry|Datadog|LogRocket|FullStory|Hotjar|Clarity|Smartlook|
  Mouseflow|Inspectlet` → 0 résultat dans `app/`, `components/`, `lib/`).
- Vercel Analytics + Speed Insights actifs (cf. T-265) ne capturent
  PAS le DOM ni les snapshots storage : ils captent uniquement les
  pageviews et Core Web Vitals (métriques techniques agrégées).

→ **T-274 peut être marqué ✅ dans la checklist pré-Live.** Doctrine
opposable R1 recommandée pour empêcher l'introduction silencieuse d'un
de ces outils sans audit privacy préalable.

---

## Méthodologie

### Outils audités
- **Error tracking + session replay** : Sentry (`@sentry/*`).
- **APM + RUM** : Datadog (`@datadog/browser-rum`,
  `@datadog/browser-logs`).
- **Session replay pur** : LogRocket (`logrocket`), FullStory
  (`@fullstory/*`).
- **Heatmap + replay** : Hotjar (`@hotjar/*`), Microsoft Clarity
  (`@microsoft/clarity`, `clarity-js`).
- **Replay alternatives** : Smartlook (`@smartlook/*`), Mouseflow
  (`@mouseflow/*`), Inspectlet (`@inspectlet/*`).

### Patterns grepés
1. Dépendances NPM dans `package.json` :
   ```
   "@sentry|"@datadog|"logrocket|"@logrocket|"fullstory|"@fullstory|
   "hotjar|"@hotjar|"@microsoft/clarity|"clarity-js|"@smartlook|
   "smartlook|"@mouseflow|"mouseflow|"@inspectlet
   ```
2. Inclusion transitives dans `package-lock.json` (mêmes patterns).
3. Initialisation runtime dans le code applicatif :
   ```
   Sentry|Datadog|LogRocket|FullStory|Hotjar|Clarity|Smartlook|
   Mouseflow|Inspectlet
   ```
   (case-insensitive, sur `app/`, `components/`).

### Périmètre
- `package.json` (dépendances directes).
- `package-lock.json` (dépendances transitives).
- `app/**/*.{ts,tsx,js,jsx}` (call sites applicatifs).
- `components/**/*.{ts,tsx,js,jsx}` (composants partagés).
- `lib/**/*.{ts,tsx}` (utilitaires).

### Hors scope (couverts par d'autres tasks)
- Vercel Analytics + Speed Insights → audités T-265 (analytics minimal,
  pas de DOM capture).
- Outils analytics non-replay → T-265.
- CSP anti-exfiltration en cas d'XSS futur → T-264.

---

## Résultats grep

### `package.json` (dépendances directes)
```
$ grep -i '"@sentry|"@datadog|"logrocket|"@logrocket|"fullstory|"@fullstory|
   "hotjar|"@hotjar|"@microsoft/clarity|"clarity-js|"@smartlook|
   "smartlook|"@mouseflow|"mouseflow|"@inspectlet' package.json
(0 résultats)
```

### `package-lock.json` (dépendances transitives)
```
$ grep -i '"sentry|"datadog|"logrocket|"fullstory|"hotjar|"clarity|
   "smartlook|"mouseflow' package-lock.json
(0 résultats)
```

### Code applicatif
```
$ grep -rn 'Sentry|Datadog|LogRocket|FullStory|Hotjar|Clarity|
   Smartlook|Mouseflow|Inspectlet' app/ components/ lib/
(0 résultats applicatifs)
```

→ **Zéro intégration dans tout le repo.** Aucun import, aucune init,
aucune dépendance NPM (directe ni transitive).

---

## Outils analytics actuellement actifs (rappel scope)

Hors session-replay strict, 2 SDK sont actifs (cf. T-265) :
- `@vercel/analytics@^2.0.1` — pageviews + Core Web Vitals (URL +
  Referer + métriques agrégées). **Pas de capture DOM ni storage.**
- `@vercel/speed-insights@^2.0.0` — métriques perf (LCP / FID / INP /
  CLS / TTFB). **Pas de capture DOM ni storage.**

Ces SDK ne sont **pas des outils de session-replay** — ils ne
reproduisent pas une session, ne capturent pas les inputs, ne snapshotent
pas le storage. Leur surface privacy est minimale (URL pathname + Referer
seulement), couverte par T-265.

---

## Findings

### F1. Conformité absolue absence session-replay
Aucun risque de capture indirecte de `terroir_geo_session`
(sessionStorage) via un outil RUM tiers. La doctrine T-200 r1 +
T-253 + T-274 forme un trio cohérent : la donnée géo consumer ne
quitte jamais le navigateur, ni par voie applicative directe (T-253),
ni par voie d'instrumentation tierce (T-274).

### F2. Pas de SDK installé "in case" / unused
Aucune dépendance "endormie" qui pourrait être activée par un futur dev
sans audit. La barrière à l'introduction est explicite : un futur
chantier doit passer par `npm install <outil>` + import + init, ce qui
sera visible dans une PR review.

---

## Recommandations

### R1. Doctrine opposable « pas de session-replay sans audit privacy »
**Priorité** : moyenne (formalise une absence, opposable PR review).

Ajouter à `docs/conventions/` (ou compléter
`docs/conventions/security-headers.md`) une ligne explicite :

> **Outils de session-replay interdits par défaut.** L'introduction d'un
> SDK Sentry / Datadog RUM / LogRocket / FullStory / Hotjar / Clarity /
> Smartlook / Mouseflow / Inspectlet (ou équivalent) requiert un audit
> privacy préalable dédié : confirmation de la non-capture de
> `sessionStorage.terroir_geo_session`, des inputs `<input id="cp-input">`,
> et de tout autre champ géo / PII consumer. Référence T-274.

Bénéfice : opposable face à un futur chantier "ajouter Sentry pour les
errors prod" qui pourrait, par défaut, capturer `sessionStorage` (Sentry
le fait par défaut depuis v6 avec replay integration).

### R2. Pré-config `excludeStorage` si Sentry est introduit
**Priorité** : faible (prospective).

Si Sentry est introduit pour error tracking serveur uniquement, vérifier
que la conf `Sentry.init({...})` :
- n'inclut PAS `Sentry.replayIntegration()` (qui capture DOM + storage).
- n'inclut PAS `Sentry.feedbackIntegration()` (qui capture form inputs).
- inclut `beforeBreadcrumb: (b) => b.category === "console" ? null : b`
  (filtre les console.log, surtout côté serveur où le helper
  `geocode-cache.ts` log le CP en cas d'erreur DB — cf. T-249 R1).

→ Recommandation prospective, à ré-évaluer si décision Sentry est prise.

---

## Cross-références

- `docs/security/audit-logs-serveur-non-capture-cp-coords-2026-05-06.md`
  (T-249).
- `docs/security/audit-sessionstorage-non-fuite-tiers-2026-05-06.md`
  (T-253).
- `docs/security/audit-trackers-front-exclusion-cp-2026-05-06.md` (T-265).
- `docs/security/csp-audit-t-264-2026-05-06.md` (T-264).
- **Tasks liées** :
  - T-265 (trackers front exclusion CP) — couvre Vercel Analytics.
  - T-275 (garde-fou doctrinal autocomplétion CP futur) — partage la
    logique R1 doctrine opposable.

---

## Conclusion

T-274 ✅ — aucun outil de session-replay / RUM tiers n'est installé
dans TerrOir, ni en dépendance directe, ni en dépendance transitive,
ni en call site applicatif. La doctrine R1 (opposable PR review) est
recommandée pour pérenniser cette absence dans le temps.
