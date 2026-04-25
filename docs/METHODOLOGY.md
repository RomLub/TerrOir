# METHODOLOGY — TerrOir

> Document vivant qui décrit la méthodologie de travail entre Romain, Claude (chat web) et Claude Code (CC).
> À mettre à jour quand une règle change ou qu'une leçon récurrente mérite d'être codifiée.

## Objectif

Permettre à toute nouvelle instance Claude (chat web ou CC) de reprendre le travail sans perdre le tempo de collaboration établi. Ce document fixe **comment** on travaille ; `docs/HANDOFF.md` fixe **sur quoi**. Voir `docs/README.md` pour l'index complet de la documentation.

## Rôles

| Acteur | Périmètre | Outils |
|---|---|---|
| **Romain** | Décisions produit, validation finale, tests prod, arbitrages business, apply des migrations DB | Navigateur, Supabase Studio, Stripe Dashboard, Vercel Dashboard, Mailinator |
| **Claude (chat web)** | Décomposition des chantiers, rédaction des prompts CC, arbitrages architecturaux, coordination parallélisation, review de rapports | Chat Claude.ai |
| **Claude Code (CC, terminaux TA/TB/TC)** | Exécution du code, inspection préalable, tests, commits, push | CLI locale avec accès repo + MCP |

## Parallélisation 3 terminaux (TA / TB / TC)

- Jusqu'à **3 terminaux CC en parallèle** (TA, TB, TC).
- **Règle critique** : éviter que 2 terminaux touchent le même fichier en même temps.
- Si overlap possible → **séquencer** ou **fractionner** les prompts pour que chaque terminal ait son périmètre strict.
- Avant de lancer un prompt en parallèle, Claude doit vérifier que les fichiers cibles sont disjoints des autres prompts en vol.

### Bonnes pratiques git en working tree partagé (consolidé 25/04)

Les 3 terminaux CC travaillent sur le même working tree local. Un terminal peut donc embarquer par accident des modifications en cours d'un autre terminal si le staging est imprécis. **5 règles à respecter dans l'ordre, sans en sauter** :

1. **`git add <fichier précis>` systématique.** JAMAIS `git add .` ni `git add -A`. Lister chaque chemin explicitement à la commande.
2. **`git status` AVANT chaque `git add`** pour observer l'état de l'index global. Pas après — *avant*, pour anticiper ce que tu vas trouver.
3. **Si fichiers staged qui ne sont pas les tiens** → `git reset HEAD <files>` préventif pour nettoyer l'index avant de stager les tiens. OU stop, signale, et attends que l'autre terminal commit.
4. **`git diff HEAD --name-only` AVANT commit** pour confirmer que le diff correspond aux modifs que tu as **vraiment** faites. Comparer avec `git status` pour repérer ce qui ne t'appartient pas.
5. **Si tu détectes un working tree avec WIP d'un autre terminal pré-staged** → STOP, signale, attends. Ne pas tenter de « commiter autour ».

**Piège QA local** : `npx tsc --noEmit` et `npm run build` peuvent **passer localement** parce que le working tree inclut les modifs incomplètes des autres terminaux qui se complètent mutuellement (rename + update d'imports postés par 2 terminaux différents). **Vercel rejoue chaque commit ISOLÉMENT** — un commit qui n'embarque pas l'ensemble cohérent fera échouer le deploy de ce commit-là, même si HEAD master final est OK. Bisect-unfriendly.

### Incidents documentés

- **Nuit 22→23/04/2026** : TA (page admin leads) et TC (toggle `showAll`) ont tous les deux modifié `/gestion-producteurs/page.tsx`. Le commit TA a embarqué les modifs TC en cours → commit label « impur » (logique TC livrée sous message TA). Code final correct, historique git confus. Mitigation : planifier les périmètres en amont et fractionner si collision possible.
- **23/04/2026 soir** (commit `5e1a48a docs(todo)`) : le commit docs a embarqué par accident 3 migrations SQL WIP de TC (chantier conseil éleveur) parce que le terminal docs a staged large au lieu de cibler. Mitigation : règle `git add <fichier précis>` systématique + vérif `git status` avant push.
- **25/04/2026 fin d'après-midi** (commit `11b914e fix(carte)`) : TT a embarqué par accident 3 renames du chantier connexion TA en cours (`app/(public)/connexion/*` → `app/connexion/*`) via working tree partagé. Build Vercel ko sur ce commit isolément à cause des imports périmés non encore fixés (TA finissait en parallèle). HEAD master final `2652e4d` OK, mais 2 commits intermédiaires bisect-unfriendly. **C'est cet incident qui a motivé la consolidation des 5 règles ci-dessus** (vs la règle initiale « `git add` précis » seule, jugée nécessaire mais non suffisante). Bonne pratique observée le même jour : TC a fait `git reset HEAD <files>` préventif après détection d'un staging inattendu — pattern à répliquer.

## Pattern de chantier CC

Chaque chantier non-trivial suit ce cycle, sans sauter d'étape :

1. **Inspection préalable** — CC lit les fichiers concernés, produit un rapport avec :
   - Structure actuelle (quel fichier fait quoi)
   - Structure proposée
   - Questions ouvertes ou arbitrages nécessaires
   - Risques identifiés (migrations, ruptures de contrat, impacts cross-fichier)
2. **Validation du plan** — Romain ou Claude (chat) valide / ajuste les décisions. Aucun code n'est écrit tant que le plan n'est pas validé, sauf tâche triviale.
3. **Code** — CC implémente strictement dans le périmètre validé.
4. **Auto-QA obligatoire** (cf section dédiée).
5. **Commit normé + push** (cf commits conventionnels).
6. **Rapport de résultat** — CC renvoie :
   - Hash du commit
   - Fichiers touchés
   - Notes importantes (migrations à apply, tests à faire côté Romain, dettes créées)

Pour les tâches triviales (fix typo, rename évident, etc.) les étapes 1 et 2 peuvent être fusionnées en une inspection-courte + implémentation directe.

## Commits conventionnels

Format : `type(scope): message`

Types utilisés :

| Type | Usage |
|---|---|
| `feat` | Nouvelle feature |
| `fix` | Correction de bug |
| `refactor` | Restructuration sans changer le comportement observable |
| `chore` | Cleanup, suppressions, réorganisation fichiers |
| `docs` | Documentation projet (voir `docs/README.md` pour l'index) |
| `test` | Ajout ou modification de tests |
| `style` | Formatting, indentation (jamais de logique) |

Exemples réels :
- `feat(rgpd): standalone opt-out link request form`
- `refactor(admin): extract shared MetricCard component (Phase C.2)`
- `fix(stripe): prevent duplicate payment methods via fingerprint check`

Le message reste concis (< 72 caractères idéalement sur la 1re ligne). Body optionnel pour les refactos complexes.

## Auto-QA obligatoire avant push

Avant chaque `git push`, CC doit lancer **dans cet ordre** :

1. `npx tsc --noEmit` — type-check strict.
2. `npm run build` — build production Next.js.

Ne **pas** se contenter de `npx tsc --noEmit` quand un refactor supprime, déplace ou renomme un fichier : `tsc` ne reproduit pas la résolution de modules webpack et laisse passer des imports morts. `npm run build` est le seul garant.

Si erreur → fix puis re-run, OU rapport à Romain/Claude si blocage de conception.

## Tests prod

- **Un test à la fois**, pas tous d'un coup.
- Tests manuels par Romain (pas d'automation E2E aujourd'hui).
- Validation incrémentale : on ne passe à la feature suivante qu'après validation de la précédente.
- Pour les flows multi-étapes (checkout, RGPD suppression, invitation onboarding), lister les cas à tester **avant** de pousser, pour que Romain les valide un par un.

## Migrations DB

- Fichiers dans `supabase/migrations/` avec préfixe timestamp `YYYYMMDDHHMMSS_description.sql`.
- **Apply manuelle** par Romain via Supabase Studio SQL Editor (pas de CLI Supabase configurée aujourd'hui).
- Dans le rapport de chantier qui inclut une migration, CC **doit rappeler à Romain en fin de message** : « Migration `X.sql` à apply en prod via SQL Editor. ».
- Toujours inclure les GRANT sur `supabase_auth_admin` quand une migration touche une FK vers `auth.users` (USAGE schema + ALL PRIVILEGES sur `public.*`). Sinon GoTrue renvoie « Database error querying schema » sur `/token` et `/recover`.

## Gestion de la dette technique

### Pendant un chantier en cours

- Dettes identifiées pendant un chantier hors scope → **note en TODO ou en dette HANDOFF**, pas de fix immédiat dans le commit en cours (pollution de scope).
- Fix immédiat uniquement si :
  - C'est un bug bloquant le chantier en cours.
  - Le fix est vraiment trivial (< 5 min, pas de risque de régression).

### Traitement systématique entre chantiers (décision Romain 2026-04-25)

**Principe** : toute dette technique identifiée se traite **dès qu'un terminal CC est libre**, même si l'impact utilisateur est nul ou minime. Pas de « ça attendra » ni de classement « non prioritaire » qui s'éternise.

**Raisons** :

- La dette qui s'accumule devient une dette qui ne se traite jamais — l'inertie l'emporte.
- Le coût marginal de fix immédiat est faible (terminal libre = ressource déjà allouée).
- Le coût de revisite plus tard est élevé (re-charger le contexte, re-comprendre le pourquoi, re-tester).
- L'objectif lancement = code aussi propre que possible le Day 1, pas de dette mentale qui pèse en background.

**Application** :

- Les dettes notées dans `HANDOFF.md` « Dettes techniques connues » → à traiter avant lancement.
- Les dettes flaggées par les terminaux dans leurs rapports → à traiter dès que le terminal libre devient dispo.
- Les pages/features incomplètes pour cause de pré-requis externe (ex: Mentions légales si la page n'existe pas) → exception : skip jusqu'à ce que le pré-requis soit prêt.
- Si un chantier semble être « skip-justifié » (cas Phase C.4 `SuccessConfirmation`) : **faire l'inspection, prendre la décision argumentée, la tracer dans `CHANGELOG.md`, retirer du TODO**. C'est aussi traiter — clore une dette par décision YAGNI vaut autant que la fixer.

### Priorisation dans `docs/TODO.md`

- 🔴 Bloquants lancement
- 🟠 En cours
- 🟡 Non bloquants
- 🔐 Avant lancement public (audit, sécurité, conformité)
- 🔵 Idées / améliorations
- 🗺️ Roadmap produit

## Communication

- Romain communique en français, ton casual, direct, **pas de hedging**.
- Claude répond sobrement, pas de flattering, pas de compliments gratuits.
- **Pas de suggestion de pause** (Romain décide de son rythme).
- Décisions rapides : présenter **3 options maximum** par question, avec pour chaque option un trade-off en 1 ligne.
- Quand Romain tranche, Claude exécute sans revenir sur la décision sauf information nouvelle.

## Secrets et sécurité

### Règle critique : jamais de secrets dans le chat

Les secrets (API keys, tokens, mots de passe, clés privées, service role keys) ne doivent **JAMAIS** être partagés dans le chat avec Claude, même dans un exemple `curl` ou pour du debugging. Un secret collé dans le chat est **instantanément compromis** et doit être roté sans délai.

**Bonnes pratiques :**

- **Tests `curl` / PowerShell** : stocker la clé dans une variable locale, ne coller que la commande qui la référence par la variable — jamais la valeur en clair.
  - PowerShell : `$key = "<paste-in-your-terminal-only>"; curl.exe -u "resend:$key" …`
  - Bash : `export KEY=<paste>; curl -u "resend:$KEY" …`
- **Screenshots** : masquer les tokens visibles avant d'envoyer. Au moindre doute, ne pas envoyer.
- **Si un secret est leaké par accident** :
  1. Révocation immédiate côté provider (Stripe, Supabase, Resend, OVH…).
  2. Génération d'une nouvelle clé.
  3. Audit des logs d'utilisation côté provider pour détecter un usage frauduleux avant rotation.
  4. Mise à jour des env vars Vercel / configs externes avec la nouvelle clé.

### Autres règles secrets

- **Env vars** gérées via **Vercel Dashboard** (pas de `.env.local` commité).
- Pas de hardcoding d'IDs de test ni de credentials dans le code livré en prod.
- Les logs doivent redacter les valeurs sensibles (pas de `console.log` brut d'un objet de réponse qui contient un token).

## Configurations externes critiques

Certaines configurations critiques vivent **hors du repo** et ne peuvent pas être versionnées. Elles doivent être documentées dans `docs/HANDOFF.md` (section « Configurations externes critiques ») pour reproduction et audit.

Périmètre typique :

- **Supabase Dashboard** : SMTP custom, email templates, Redirect URLs, Site URL, webhook hooks.
- **OVH Zone DNS** : enregistrements SPF, DKIM, DMARC, MX, CNAME Vercel.
- **Stripe Dashboard** : mode Test/Live, webhook endpoints, payment methods account-wide (Link).
- **Resend Dashboard** : domaines vérifiés, clés API.
- **Vercel** : env vars, domaines.

**Règle** : toute modification d'une de ces configs par Romain doit être reportée dans `docs/HANDOFF.md` dans la session où elle a été faite. Sinon un Claude frais (ou Romain dans 3 mois) ne pourra pas reproduire l'environnement.

## Principes de code

- TypeScript strict mode obligatoire.
- Fail-fast : ne jamais silencer une erreur, toujours la raise ou la handle explicitement.
- Tests unitaires pour la logique critique (slot generation, formatters, validators) — pattern vitest en place dans `lib/slots/__tests__/`.
- Logging minimal mais structuré : erreurs + étapes d'exécution clés. Préfixes `[SCOPE_LEVEL]` pour filtrer (`[PROMOTE_PRODUCER_WARN]`, etc.).
- Code explicite > code clever. Pas d'abstraction spéculative.

## Guardrails

- Pas de modification de fichiers critiques ou sensibles sans justification explicite.
- Pas de suppression de code sans raison claire et nécessaire.
- Pas de refacto sans objectif explicite (pas de « tant qu'on y est… »).
- Rester strictement dans le scope de la tâche demandée.
- Jamais exposer ou hardcoder secrets, API keys ou credentials.

## Gestion du contexte CC

- **Clear régulier des terminaux CC** : les terminaux CC accumulent du contexte qui consomme des tokens à chaque interaction. Claude (chat web) identifie les moments opportuns pour faire `/clear` dans les terminaux et le signale à Romain. Typiquement après la fin d'un chantier bien délimité, ou quand CC lui-même suggère `/clear to save X tokens`. Le clear ne perd que le contexte conversationnel, le repo et l'état git sont intacts.

## Quand s'arrêter et flagger

CC (ou Claude chat) doit stopper et demander confirmation si :

- Ambiguïté critique sur l'intention produit.
- Information manquante (schema DB, contrat API, décision produit non tranchée).
- Décision à fort impact : migration destructive, rename de table / colonne publique, refonte de flow payment ou RGPD.
- Détection de code sensible (auth, RLS, webhooks Stripe) qui n'était pas dans le scope annoncé.

## Structure de la documentation

La doc projet vit dans `/docs/`. Voir `docs/README.md` pour l'index complet. Les 5 fichiers :

- **`docs/README.md`** : routeur + ordre de lecture recommandé.
- **`docs/HANDOFF.md`** : snapshot projet (stack, schema, config externes, dettes techniques).
- **`docs/METHODOLOGY.md`** : ce fichier — méthode de collaboration.
- **`docs/TODO.md`** : priorités forward-looking (bloquants, non-bloquants, roadmap, idées).
- **`docs/CHANGELOG.md`** : historique antichronologique des chantiers + commits structurants.
- **`docs/LESSONS.md`** : leçons apprises / pitfalls organisés par thème.

`CONTRIBUTING.md` reste à la racine du repo (guidelines PR, hors scope doc produit).
