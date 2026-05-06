# Incident — Race condition staging multi-terminaux Claude Code

> Date : 2026-05-06
> Branche : master
> Commits concernés : `132b469` (mauvaise attribution), `1c41862` (correction T-219), commit attribution actuel.
> Sévérité : faible (aucune perte de données, pas de breakage runtime). Historique git pollué par 1 commit au message trompeur.

---

## TL;DR

3 sessions Claude Code (TA / TB / TC) tournaient en parallèle sur **le même working tree + le même `.git`**. Pendant que TA finalisait son commit T-219, TB ou TC a modifié des fichiers de leur chantier T-110 dans la même working tree. Ces fichiers ont été embarqués sous le message T-219 par erreur (commit `132b469`), avant que TA ne s'en aperçoive et recommit proprement (`1c41862`).

Aucun fichier perdu, aucune régression runtime. Le commit `132b469` reste dans master avec un message faux (« T-219 ») mais contenant les fichiers T-110.

---

## Cause directe

La heredoc bash `<<'EOF'` utilisée pour le message de commit T-219 par TA contenait des backticks autour d'identifiants de code (`` `public.geocode_cache` ``, `` `bump_geocode_cache` ``, etc.). Sur Windows Git Bash, les backticks ont été partiellement interprétés comme command substitution malgré le single-quote censé les protéger. Cela a probablement déclenché des évaluations bash inattendues entre le `git add` et le `git commit`.

---

## Cause structurelle

Aucun mutex, aucun verrouillage, aucune coordination entre les 3 sessions Claude Code parallèles :

- TA, TB, TC partagent le même working tree (`C:\Users\lubin\documents\github\terroir`).
- TA, TB, TC partagent le même `.git` (donc même HEAD, même reflog, même index).
- Quand TA fait `git add monfichier`, l'index global est modifié. Si entre temps TB fait `git add -A` ou modifie d'autres fichiers, leur state se mélange dans l'index.
- Quand TA fait `git commit`, le contenu de l'index au moment exact du commit est figé — peu importe ce que TA pensait avoir staged 5 secondes avant.
- Idem pour `git pull --rebase` lancé par TB : il a réécrit l'historique de TA sans préavis (commit `96d8a84` rebasé en `1c41862`).

C'est une race condition classique sur ressource partagée non-mutex'ée.

---

## Chronologie reconstituée (depuis le reflog)

1. TA crée son commit T-219 propre (`96d8a84`) avec 13 fichiers vrais.
2. TA fait `git push` — rejected non-fast-forward (TB/TC ont pushé d'autres commits T-130 entre temps).
3. TA `git fetch` — découvre 3 commits TB/TC dont un autre commit `132b469` qu'il n'a jamais lui-même fait apparaître localement.
4. **`132b469` était le commit "monstre"** créé plus tôt par TA mais probablement lors d'une seconde fenêtre de race où TB/TC avaient ajouté leurs fichiers à l'index avant que TA ne fasse `git commit`. Quand TA a fait `git commit -m`, c'est l'index global (avec les fichiers TB/TC) qui a été figé sous le message T-219.
5. TA fait `git reset --soft HEAD~1` pour annuler le mauvais commit local — mais entre temps TB/TC l'avaient déjà pushé sur le remote.
6. TA recommit proprement (`96d8a84`) avec ses vrais fichiers, push toujours refusé.
7. TB lance `git pull --rebase origin master` dans son terminal — l'opération s'applique au repo partagé, rebasant le `96d8a84` de TA en `1c41862` (mêmes fichiers, parent différent).
8. Push réussi à un moment (par TB ou TA, pas clair). Master remote contient maintenant 132b469 ET 1c41862 dans cet ordre — l'historique stable.

Le contenu effectif sur master est correct : T-219 (vrais fichiers) sous `1c41862`, T-110 (vrais fichiers TB) sous `132b469` mais avec un message trompeur.

---

## Conséquence sur l'historique git

| Commit | Message | Contenu réel |
|---|---|---|
| `132b469` | « feat(geo): cache serveur géocodage CP→lat/lng + route /api/geocode (T-219) » | **9 fichiers T-110** (casse email normalisée ilike) — chantier TB. |
| `1c41862` | « feat(geo): cache serveur geocodage CP->lat/lng + route /api/geocode (T-219) » | **13 fichiers T-219** — vrai chantier TA (DistanceWidget, route /api/geocode, helpers, migration, doc, tests). |

Pas de perte de fichier. Juste un commit `132b469` mal-attribué.

---

## Mitigations

### Court terme (ce commit)

Ce commit `chore(repo)` formalise l'attribution réelle pour qu'un audit futur (`git log lib/audit-logs/email-lookup.ts`, `git blame`, etc.) trouve le pointeur vers cette doc et comprenne pourquoi `132b469` a un message trompeur. **Pas de réécriture historique** (rejeté car 3 commits dérivés depuis : `2bc4770`, `9ea69ca`, `3091ebb`, qui ont été buildés/testés sur la base incluant `132b469`).

### Moyen terme — décision méthodologie Romain à venir

Plusieurs options pour éliminer la race condition :

1. **Working trees séparés** : chaque session Claude Code travaille dans un clone distinct du repo, push vers le même remote. Coût : ~500 MB de duplication par session. Bénéfice : zéro race condition.
2. **`git worktree`** : 1 clone, plusieurs working trees, chacun sa branche. Plus économique en espace. Nécessite que TA/TB/TC ne soient pas sur la même branche simultanément.
3. **Centralisation git sur 1 terminal** : TA/TB/TC font des modifs dans des dossiers/branches isolés, mais un seul "terminal coordinateur" lance les `git add`/`commit`/`push`. Plus complexe à orchestrer.
4. **Mutex applicatif** : un fichier de lock dans le repo (`.git-mutex`) que chaque session prend avant ses ops git. Fragile, casse en cas de crash session.

### Règle durcie immédiatement applicable (à respecter par TA/TB/TC)

Pour limiter les futures races sans attendre la décision méthodo :

- **AVANT tout `git add`** : faire un `git status` complet pour vérifier ce qui est modifié dans la working tree (et identifier les fichiers étrangers à mon scope).
- **`git diff --cached --stat` AVANT le commit obligatoire** : vérifier que la liste cached correspond exactement à mon scope.
- **Si fichiers inattendus dans cached** : STOP + diagnostic. NE PAS forcer le commit en pensant « ça passera ».
- **Pas de heredoc bash multiligne pour les messages de commit**. Utiliser `-m` avec escape simple, ou fichier message via `-F`.
- **Pas de backtick dans les messages de commit** quand on passe par un shell. Les backticks (sans échappement) sont du command substitution même dans certains heredoc selon le shell.

---

## Annexes

### Fichiers réellement embarqués dans `132b469`

```
docs/fixes/email-lookup-ilike-2026-05-06.md (nouveau)
lib/audit-logs/email-lookup.ts
lib/resend/suppressions.ts
scripts/seed-producers.ts
scripts/seed.ts
tests/e2e/email-webhook-h3.spec.ts
tests/e2e/legal/inscription-cgu.spec.ts
tests/lib/audit-logs/email-lookup.test.ts
tests/lib/resend/suppressions.test.ts
```

Ces 9 fichiers correspondent au chantier T-110 (casse email normalisée `ilike`) attribué à TB dans la session 2026-05-06.

### Fichiers réellement embarqués dans `1c41862` (T-219 réel)

```
app/(public)/producteurs/[slug]/_components/DistanceWidget.tsx
app/api/geocode/route.ts
docs/CHANGELOG.md
docs/TODO.md
docs/fixes/geocode-cache-2026-05-06.md
lib/geo/geocode-cache.ts
lib/geo/geocode-postal-client.ts
lib/geo/geocode-postal.ts
lib/rate-limit.ts
supabase/migrations/20260506181153_t219_geocode_cache.sql
tests/app/api/geocode/route.test.ts
tests/app/producteurs/distance-widget.test.tsx
tests/lib/geo/geocode-cache.test.ts
```

13 fichiers T-219 (chantier TA, voir `docs/fixes/geocode-cache-2026-05-06.md`).

---

## Action TB

TB est encore en cours sur T-110 (« Casse email normalisée ilike ») dans son prompt actuel. Au moment où il découvrira que les fichiers T-110 sont déjà dans master sous `132b469` + ce commit d'attribution :

- Son audit READ-ONLY confirmera que les modifs `eq` → `ilike` sont déjà en place dans master.
- Si tout est déjà fait : son LOT 3 devient un commit empty + doc formelle T-110, puis suppression de T-110 de la TODO.
- Si trous résiduels : TB les complète et commit en T-110 standard.

Communication transverse à coordonner par Romain.
