# Architecture Decision Records (ADR)

Trace écrite des décisions techniques / produit structurantes prises sur
TerrOir, avec leur **rationale** — pas juste le « quoi » (le code est la
source de vérité du quoi), mais le **pourquoi** : alternatives écartées,
contraintes, conséquences acceptées.

## À quoi sert un ADR

Un ADR existe quand une décision a un **cadre de réflexion réutilisable**.
Pas une todo, pas un suivi de chantier, pas un journal. Une trace de
**pourquoi** on a tranché comme ça, lisible à froid dans 6 mois sans avoir
besoin du contexte de session.

Si en lisant un ADR à froid tu peux extraire une décision claire ou un
cadre de réflexion, l'ADR a sa place. Sinon, il n'aurait pas dû être
écrit.

## Statuts

- `Proposed` — décision envisagée, pas encore tranchée
- `Accepted` — décision actée et appliquée (le code reflète la décision)
- `Deferred` — décision identifiée mais reportée (alternatives connues,
  arbitrage non fait par manque d'information ou parce que pas urgent)
- `Rejected` — décision envisagée puis explicitement écartée
- `Superseded by ADR-XXX` — décision remplacée par une autre

## Format

```
# ADR-XXXX — Titre

- **Statut** : Proposed | Accepted | Deferred | Rejected | Superseded by ADR-YYYY
- **Date** : YYYY-MM-DD
- **Décideurs** : Romain (+ CC si pertinent)

## Contexte

Pourquoi cette décision se pose. Quelles forces, quelles contraintes,
quelles alternatives sur la table.

## Décision

(Ou question si Deferred.) Ce qu'on retient et pourquoi cette option
plutôt qu'une autre.

## Conséquences

Effets positifs, effets négatifs, dettes ou contraintes acceptées,
points d'attention pour l'implémentation.

## Liens

(Optionnel.) ADRs liés, code source pertinent, issues, runbooks.
```

## Numérotation

ADRs numérotés `0001`, `0002`, ... dans l'ordre de création. Ne JAMAIS
renuméroter un ADR existant (les liens externes se briseraient). Un ADR
superseded n'est jamais supprimé — on crée un nouvel ADR qui le remplace
et on met à jour le statut de l'ancien.
