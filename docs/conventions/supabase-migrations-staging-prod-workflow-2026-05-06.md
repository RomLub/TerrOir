# Convention — workflow staging → prod migrations Supabase

> **Statut actuel (2026-05-06)** : workflow apply-direct-prod accepté en pré-launch (TerrOir n'est pas Live, pas d'utilisateurs externes en production). Le workflow staging décrit ci-dessous est à **activer avant l'ouverture publique**, dans le cadre de l'audit pré-Live T-003.
>
> Session de création : 2026-05-06 (T-225). Articulation T-003 (audit pré-Live), T-296 (infra tests intégration SQL contre Supabase, complémentaire), T-297 (idempotence migrations).

---

## Workflow actuel — apply direct prod

Toutes les migrations livrées depuis le démarrage du projet (avril 2026 → ce jour) ont été appliquées **directement en prod** via le MCP Supabase. Pas d'environnement staging ni de smoke tests pré-deploy automatisés.

**Procédure type observée pendant les sessions** :

1. Romain (ou un terminal CC en session) rédige la migration SQL dans `supabase/migrations/<timestamp>_<slug>.sql`.
2. Migration commitée + pushée sur master (commit dédié, séparé du code applicatif qui en dépend pour permettre rollback indépendant).
3. Apply en prod via `mcp__supabase__apply_migration` (Romain ou CC autorisé).
4. Smoke tests post-apply ad hoc (requêtes de validation manuelle, parfois automatisées via vitest contre la prod).
5. Renommage du fichier migration si Postgres a appliqué un timestamp différent du nom de fichier (cf. commits `chore(db): rename T-XXX migration file to match DB timestamp post-apply`).
6. Code applicatif qui consomme la migration commité dans un commit séparé.

---

## Risques acceptés en pré-launch

- **Aucune validation préalable** sur des données réalistes avant prod. Si une migration cassait des données existantes, on le découvrirait en prod. Mitigation : le repo garde un seed (`scripts/seed.ts`) qu'on peut rejouer après reset, et la prod est régulièrement re-seedée pour les tests.
- **Pas de rollback testé** sur des migrations destructives. Mitigation : on évite les migrations destructives (DROP COLUMN, DROP TABLE non whitelist) ; quand nécessaire, audit manuel préalable.
- **Pas de smoke test pré-deploy automatisé**. Mitigation : la validation post-apply est faite par humain dans la session de la migration, parfois doublée de tests vitest qui ciblent les RPC.
- **Pas de fenêtre d'observation** entre apply et utilisation. Mitigation : pré-launch = aucun trafic externe, le seul utilisateur est Romain en validation.

Ces risques deviennent inacceptables le jour où TerrOir reçoit du trafic externe (premiers consumers, premiers producteurs onboardés en prod).

---

## Workflow cible post-Live

> À activer dans le cadre de l'audit pré-Live T-003, avant les premiers consumers/producteurs externes. Préfigurer les décisions ouvertes (cf. § « Décisions à prendre » plus bas).

### Étape 1 — Création projet Supabase staging

1. Créer un second projet Supabase (`terroir-staging` ou similaire) en parallèle de la prod.
2. Cloner le schéma actuel via `supabase db dump` + `supabase db push` (ou re-jouer toutes les migrations historiques sur le projet vide).
3. Définir une stratégie données seed (cf. § décisions ouvertes).

### Étape 2 — Apply migration sur staging

Via MCP Supabase (`mcp__supabase__apply_migration`) ciblant le projet staging, OU via Supabase CLI :

```bash
supabase link --project-ref <staging-ref>
supabase db push
```

### Étape 3 — Smoke tests sur staging

Suite vitest + e2e Playwright pointée sur staging (env vars `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` du projet staging).

Suites à exécuter au minimum :
- `npm run test` (vitest) — tests unitaires + intégration mocked (déjà OK contre n'importe quel backend).
- `npm run test:e2e` (Playwright) — flows critiques E2E, désormais pointés sur staging.
- Checks SQL post-apply manuels selon la migration (ex. comptage de rows pour vérifier qu'un trigger n'a pas effacé de données).

### Étape 4 — Validation Romain

Lecture du diff DB (via `supabase db diff` ou MCP), confirmation absence de surprise, GO.

### Étape 5 — Apply identique sur prod

Via `mcp__supabase__apply_migration` ciblant la prod cette fois. Le SQL est identique au byte près à celui appliqué en staging (la migration a déjà fait ses preuves).

### Étape 6 — Re-run smoke tests sur prod (sanity check)

Mêmes suites qu'en staging mais pointées sur prod. Détecte les divergences environnementales (env vars, secrets, DNS, etc.).

---

## Décisions à prendre avant d'activer

### Coût Supabase staging

- **Free tier** : limites pause auto après 7j sans activité, 500 MB storage, 2 GB egress / mois. Suffisant pour tests CI ponctuels mais risque pause au moment d'un push critique.
- **Pro plan** : 25 USD / mois, pas de pause auto, 8 GB storage, 50 GB egress. Plus confortable mais coût récurrent.

**Décision pré-arbitrage** : Free tier suffit en démarrage, Pro plan à reconsidérer si la fréquence d'apply justifie l'investissement (>5 migrations / semaine en post-Live ?).

### Stratégie données seed staging

Trois options :

1. **Copie partielle anonymisée de prod** — `pg_dump` filtré + script d'anonymisation (e-mails, noms, prénoms, adresses, lat/lng précises). Le plus réaliste mais le plus de travail à mettre en place. Conformité RGPD à valider (anonymisation = pseudonymisation ?).
2. **Données fixtures dédiées** — Romain rédige un seed staging avec ~10-20 producteurs fictifs représentatifs des cas (élevage, maraîchage, boulangerie, multi-rôle, etc.). Plus simple mais moins représentatif.
3. **Mix** — base seed `scripts/seed.ts` actuelle (déjà existante) + ajustements ad hoc selon les migrations.

**Décision pré-arbitrage** : Option 3 pour démarrer (réutilise l'existant), Option 1 à étudier post-Live si T-003 le recommande.

### Outillage CI

- **npm script local** `npm run db:apply-staging` qui orchestre apply + tests + report. Simple, exécuté manuellement par Romain.
- **GitHub Actions** déclenché sur PR labelisée `migration` qui apply en staging + tests, attend le GO Romain pour appliquer en prod. Plus solide mais demande secrets staging dans GitHub secrets + workflow YAML.

**Décision pré-arbitrage** : npm script local en démarrage post-Live, GitHub Actions à étudier quand T-003 le recommande.

---

## Audit migrations livrées sans staging (pour rétrofit éventuel post-staging)

Total **76 migrations** dans `supabase/migrations/` au 2026-05-06. Toutes appliquées direct prod via MCP Supabase.

Liste chronologique synthétique (par groupes thématiques) :

| Période | Nb migrations | Thématiques principales |
|---|---|---|
| 19/04 – 28/04 | ~30 | Schema initial + RGPD account deletion + GMS prices + storage policies + slots/orders RPC |
| 29/04 – 30/04 | ~10 | Webhook events processed + payouts + disputes + cancellation_reason → closure_reason |
| 01/05 – 03/05 | ~5 | T-220 categories animals/cuts + refund incidents + score carbone T-200 |
| 04/05 – 05/05 | ~20 | T-241 declaration veracite + audit RLS lots 1-8 + perf optimisations + RPC search_path lock |
| 06/05 | ~11 | T-013 email change + legal acceptance + producer responses + T-109 invitations + T-218 producers admin-only + T-219 geocode_cache |

Audit rétrospectif : aucune migration n'a été apply en staging, par construction. Quand staging sera en place, faire un re-jeu complet du `supabase/migrations/` directory contre staging vide pour valider la cohérence schema → prod (smoke test global). Pas de rétrofit individuel des migrations historiques nécessaire (elles sont déjà en prod, immutables).

---

## Articulation autres chantiers

- **T-003** — audit pré-Live transverse. C'est cet audit qui doit valider l'activation effective du workflow staging avant ouverture publique.
- **T-296** (backlog) — infra de tests d'intégration SQL contre Supabase (parser SQL identique JS ↔ SQL). Complémentaire au workflow staging : permet de tester la sémantique SQL des RPC avant même l'apply.
- **T-297** (livré dans la même session) — convention idempotence migrations. **Indispensable pour le workflow staging** : les migrations seront ré-appliquées potentiellement plusieurs fois (init staging from scratch, reset staging entre PR), elles doivent être idempotentes.
- **T-225** (cette doc).

---

## Liens

- `supabase/migrations/` — répertoire des migrations historiques.
- `docs/conventions/migrations-idempotence-2026-05-06.md` (T-297) — convention idempotence (5 règles).
- Supabase docs — [Local development workflow](https://supabase.com/docs/guides/local-development).
- Supabase docs — [Migrations](https://supabase.com/docs/guides/cli/local-development#database-migrations).
