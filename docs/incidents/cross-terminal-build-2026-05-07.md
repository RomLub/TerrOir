# Incident build Vercel cascade — 07/05/2026

## Résumé

Cascade de 3 builds Vercel ERROR sur master entre commits `6748390` et `24fa326` due à apostrophes courbes U+2019 non échappées dans `app/(producer)/comptabilite/page.tsx` ligne 104. Master rouge ~5 min avant fix.

## Chronologie

- **22:25** — Spawn 6 teammates Agent Teams cycle scope élargi (db-state, audit-cron, audits-docs, demarche, ux-edit, design-system)
- **~22:50** — ux-edit push `6748390 feat(exports): comptabilite CSV consumer + producer (period selector + masque email)` (nouvelle page `app/(producer)/comptabilite/page.tsx`)
- **~22:55** — Vercel build `BFDfNsxEy` sur `cec479c` (bump next 14.2.35) : ERROR (cascade apostrophe `6748390`)
- **22:55-23:00** — ux-edit push `712baa4` (T-205 search), `9315af9` (T-105 invitation), `02a2d22` (T-232 follow-up). Aucun `npm run build` local validé entre les push.
- **~22:58** — audits-docs lance `npm run build` + `npx vitest run` locaux post-bump npm next/eslint-config-next 14.2.35 (vérification pré-push obligatoire imposée par Romain) → ESLint `react/no-unescaped-entities` bloque sur 2 apostrophes courbes U+2019 ligne 104 `comptabilite/page.tsx` (cause orthogonale au bump, fichier WIP introduit par ux-edit en `6748390`) → flag via SendMessage à ux-edit (relayé par lead)
- **~23:00** — Vercel build `F7vXbFQdR` sur `9315af9` : ERROR (apostrophe)
- **~23:00** — Vercel build `FyUGZNHxn` sur `712baa4` : ERROR (cascade)
- **23:02:45** — ux-edit fix apostrophes + push `24fa326 fix(comptabilite): T-105/Export apostrophes JSX echappees`
- **~23:03** — Build Vercel sur `24fa326` : Ready ✅
- **~23:05** — Romain notifie incident, lead diagnostique et constate fix déjà en place

## Cause racine

1. ux-edit a créé une nouvelle page App Router (`app/(producer)/comptabilite/page.tsx`) contenant 2 apostrophes courbes U+2019 dans JSX texte ligne 104 (`CSV ',' / UTF-8 BOM`).
2. ux-edit a pushé `6748390` sans `npm run build` local de validation.
3. Doctrine CLAUDE.md "npm run build avant push JSX" (ligne 185, apprentissage T-130 du cycle précédent) non appliquée.
4. Aggravation : 3 commits subséquents pushés sans détection ni fix de l'apostrophe entre-temps. Chaque push a buildé sur Vercel et fait grossir la fenêtre rouge.

## Doctrine concernée

CLAUDE.md ligne 185-190 — "Doctrine `npm run build` avant push JSX". Règle ESLint `react/no-unescaped-entities` stricte sur ce repo, ne pardonne pas les apostrophes courbes U+2019 dans JSX texte. Issue de l'incident T-130 du cycle 06/05/2026 (catégorisation produits).

## Fix appliqué

Commit `24fa326` : remplacement des 2 apostrophes courbes U+2019 par `&apos;` (HTML entity) ligne 104 `comptabilite/page.tsx`. `npm run build` local vert post-fix.

## Renforcement proposé (backlog)

1. **Hook git pre-push** : `npm run build` automatique sur fichiers JSX touchés (`.tsx`, `.jsx`, `page.tsx`, `layout.tsx`). Bloquer le push si build échoue. Implémentation Husky ou équivalent.
2. **Doctrine fin-de-cycle Agent Teams renforcée** : le lead DOIT vérifier état builds Vercel sur HEAD master post-shutdown teammates avant de produire le rapport final "items livrés". "Working tree clean + push OK" est insuffisant — "build prod vert sur HEAD" est le critère de complétion réel.
3. **ESLint pre-commit hook strict** sur règle `react/no-unescaped-entities` pour catch les apostrophes U+2019 avant même le push.

## Manquements méthodologiques à documenter pour cycle suivant

- **ux-edit** n'a pas appliqué doctrine "`npm run build` avant push JSX" malgré CLAUDE.md ligne 185 explicite. À investiguer pourquoi (lecture incomplète CLAUDE.md ? Confiance excessive dans tests vitest qui ne couvrent pas le build production ? Pression débit ?).
- **Lead** a clos rapport final avec "✅ 35/35 livrés, working tree clean" sans vérifier état builds Vercel post-push. Critère de complétion incomplet.
