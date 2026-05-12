# Documentation TerrOir

Routeur de la documentation projet. Pour les guidelines de contribution git/PR + setup local, voir `CONTRIBUTING.md` à la racine du repo. Pour la doctrine d'exécution Claude Code (règles d'or + workflow + pièges connus), voir `CLAUDE.md` à la racine.

| Fichier                                                | Contenu                                                                                          | Quand lire                                            |
|--------------------------------------------------------|--------------------------------------------------------------------------------------------------|-------------------------------------------------------|
| [HANDOFF.md](./HANDOFF.md)                             | Snapshot projet (stack, schema, config externes)                                                 | Reprise de projet à froid                             |
| [post-launch-checklist.md](./post-launch-checklist.md) | Actions conditionnées à un événement externe identifiable (passage Live, KYC Stripe, etc.)        | Début de session, ou avant d'agir sur un item bloqué  |
| [decisions/](./decisions/)                             | ADRs (Architecture Decision Records) — rationale des décisions structurantes                     | Avant de revisiter une décision passée                |
| [CHANGELOG.md](./CHANGELOG.md)                         | Historique chantiers + ops (antichronologique)                                                   | Besoin de contexte historique                         |
| [LESSONS.md](./LESSONS.md)                             | Leçons apprises / pitfalls thématiques                                                           | Bug qui rappelle un pattern                           |

Pas de `TODO.md`, pas de `backlog/`, pas de `METHODOLOGY.md` : règle d'or 3 du `CLAUDE.md` à la racine (zéro backlog vivant — la doctrine de collaboration vit dans `CLAUDE.md`, les actions en attente vivent dans `post-launch-checklist.md` avec leur condition de déblocage).

## Pour un Claude frais qui reprend le projet

Ordre de lecture recommandé :

1. **`CLAUDE.md`** (à la racine) — règles d'or + doctrine d'exécution + pièges connus.
2. **`HANDOFF.md`** — le quoi (stack, état, configurations externes).
3. **`post-launch-checklist.md`** — actions conditionnées, en attente de leur événement de déblocage.
4. **`decisions/`** — ADRs pour comprendre le pourquoi des choix structurants.
5. **`CHANGELOG.md`** + **`LESSONS.md`** — à consulter à la demande (lookup d'un commit passé, pattern de bug déjà rencontré).
6. `git log --oneline -20` — pour le contexte chaud des derniers commits.
