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

### Règle `git add` explicite (working tree partagé)

Les 3 terminaux CC travaillent sur le même working tree local. Un terminal peut donc embarquer par accident des modifications en cours d'un autre terminal si le staging est imprécis.

- **Toujours `git add <fichier-précis-1> <fichier-précis-2>`** avec des chemins explicites. **JAMAIS `git add .` ni `git add -A`.**
- **`git status` systématique AVANT chaque `git push`** pour confirmer que seuls les fichiers attendus du chantier en cours sont stagés.
- Si un fichier inattendu apparaît dans `git status` : ne pas l'inclure dans le commit, investiguer (probablement WIP d'un autre terminal ou modification système comme `tsconfig.tsbuildinfo`).

### Incidents documentés

- **Nuit 22→23/04/2026** : TA (page admin leads) et TC (toggle `showAll`) ont tous les deux modifié `/gestion-producteurs/page.tsx`. Le commit TA a embarqué les modifs TC en cours → commit label « impur » (logique TC livrée sous message TA). Code final correct, historique git confus. Mitigation : planifier les périmètres en amont et fractionner si collision possible.
- **23/04/2026 soir** (commit `5e1a48a docs(todo)`) : le commit docs a embarqué par accident 3 migrations SQL WIP de TC (chantier conseil éleveur) parce que le terminal docs a staged large au lieu de cibler. Mitigation : règle `git add <fichier précis>` systématique + vérif `git status` avant push.

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

- Dettes identifiées pendant un chantier hors scope → **note en TODO**, pas de fix immédiat.
- Fix uniquement si :
  - C'est un bug bloquant le chantier en cours.
  - Le fix est vraiment trivial (< 5 min, pas de risque de régression).
- Priorisation dans `docs/TODO.md` :
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
