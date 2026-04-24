# Documentation TerrOir

Routeur de la documentation projet. Pour les guidelines de contribution git/PR, voir `CONTRIBUTING.md` à la racine du repo (hors scope doc produit).

| Fichier                            | Contenu                                                 | Quand lire                    |
|------------------------------------|---------------------------------------------------------|-------------------------------|
| [HANDOFF.md](./HANDOFF.md)         | Snapshot projet (stack, schema, config externes, dettes)| Reprise de projet à froid     |
| [METHODOLOGY.md](./METHODOLOGY.md) | Méthode collaboration Romain ↔ Claude (chat + CC)      | Avant de lancer un chantier   |
| [TODO.md](./TODO.md)               | Priorités actuelles (forward-looking uniquement)        | Début de session              |
| [CHANGELOG.md](./CHANGELOG.md)     | Historique chantiers + ops (antichronologique)          | Besoin de contexte historique |
| [LESSONS.md](./LESSONS.md)         | Leçons apprises / pitfalls thématiques                  | Bug qui rappelle un pattern   |

## Pour un Claude frais qui reprend le projet

Ordre de lecture recommandé :

1. **`HANDOFF.md`** — le quoi (stack, état, dettes techniques, configurations externes).
2. **`METHODOLOGY.md`** — le comment (rôles, pattern chantier, auto-QA, guardrails).
3. **`TODO.md`** — les priorités forward-looking (bloquants, non-bloquants, roadmap, idées).
4. **`CHANGELOG.md`** + **`LESSONS.md`** — à consulter à la demande (lookup d'un commit passé, pattern de bug déjà rencontré).
5. `git log --oneline -20` — pour le contexte chaud des derniers commits.
