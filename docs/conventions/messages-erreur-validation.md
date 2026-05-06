# Messages erreur validation client — T-234

> Date : 2026-05-07
> Issue : homogénéité ton/longueur/emplacement des messages d'erreur dans les formulaires consumer.
> Référence canonique : T-200 r2 — `"Code postal invalide (5 chiffres attendus)."` (court, factuel, format en parenthèse).

---

## Règles

### Ton

- **Tutoiement systématique** (cohérent avec doctrine produit TerrOir).
- **Court, factuel, neutre** — évite "Désolé...", "Oups", "Une erreur s'est produite".
- **Pas de jargon technique** dans le message visible — pas de `flow_invalid`, `db_error`, `slot_invalid`.
- Si pertinent, **mention du format attendu en parenthèses** : `"Code postal invalide (5 chiffres attendus)."`, `"Mot de passe trop court (8 caractères minimum)."`.

### Longueur

- **1 phrase courte** (idéalement < 80 caractères, max 120).
- **Pas de double phrase** sauf si une action utilisateur est nécessaire : `"Trop de tentatives. Réessaie dans 60s."`.
- Termine par un point.

### Emplacement

- **Validation par champ** → message **sous le champ** dans un `<p class="text-red-700 text-[12px]">` ou équivalent. Pas de `role="alert"` (le navigateur signale via `aria-invalid` sur l'input lui-même).
- **Erreur globale soumission** (réseau down, rate-limit, permission) → bannière en haut/bas de form avec `role="alert"`, focus auto si possible.
- **Erreur asynchrone post-action** (ex: server error après submit) → idem `role="alert"`, bannière distincte, ne polluer pas les hints sous-champ.

### Wording de référence par catégorie

| Catégorie                   | Wording recommandé                                              |
|-----------------------------|-----------------------------------------------------------------|
| CP invalide                 | `"Code postal invalide (5 chiffres attendus)."`                 |
| Email invalide              | `"Email invalide."`                                             |
| Champ vide obligatoire      | `"Champ obligatoire."` ou `"Renseigne ton {nom du champ}."`     |
| Mot de passe trop court     | `"Mot de passe trop court (8 caractères minimum)."`             |
| Message trop court          | `"Message trop court ({N} caractères minimum)."`                |
| OTP invalide                | `"Code invalide."`                                              |
| Action non autorisée        | `"Action non autorisée."`                                       |
| Rate-limit applicatif       | `"Trop de tentatives. Réessaie dans {N}s."`                     |
| Service externe down        | `"Service indisponible. Réessaie dans un instant."`             |
| Erreur serveur générique    | `"Une erreur s'est produite. Réessaie ou contacte-nous."`       |

## Audit call sites consumer

| Form / surface                                              | Statut    | Wording actuel                                           | Verdict / Action                  |
|-------------------------------------------------------------|-----------|----------------------------------------------------------|-----------------------------------|
| `lib/geo/geocode-postal.ts::GEOCODE_POSTAL_ERROR_MESSAGES`  | OK        | `"Code postal invalide (5 chiffres attendus)."` etc.    | Référence canonique. Aucune modif.|
| `app/(public)/contact/ContactClient.tsx`                    | OK        | `"Le message doit contenir au moins 20 caractères"`     | Côté serveur seulement (Zod). Côté client = compteur live "Encore N caractères…" — pas un message d'erreur, c'est un hint. |
| `app/(consumer)/auth/inscription/actions.ts:35`             | OK        | `"Saisie invalide"` (fallback Zod)                      | Acceptable comme fallback. Préférer le message Zod issu de chaque champ. |
| `app/(consumer)/compte/profil/_actions/complete-email-change.tsx:56` | OK | `"Email invalide"`                                       | Conforme. Manque le point final → préférer `"Email invalide."`. |
| `app/(consumer)/compte/profil/_actions/request-otp.tsx:54`  | OK        | `"Email invalide"`                                       | Conforme. Manque le point final. |
| `app/(consumer)/compte/profil/delete-account-action.ts:81`  | OK        | `"Mot de passe requis"`                                  | Conforme. Manque le point final. |
| `app/(consumer)/compte/profil/_components/ChangeEmailCompletedStep.tsx:77` | OK | `"Email invalide."`                                | Conforme.                         |
| `app/(public)/producteurs/[slug]/_components/DistanceWidget.tsx:179,201,203` | OK | `"La géolocalisation n'est pas disponible..."`, `"Délai dépassé. Réessaie ou saisis ton code postal."`, `"Position indisponible. Saisis ton code postal à la place."` | Conformes. Court, factuel, action suggérée. |
| `app/api/producer/reviews/[id]/respond/route.ts:25`         | Limite    | `"Réponse vide"`, `"Max 500 caractères"`                | Acceptable (côté producteur, hors scope strict consumer). |
| `app/api/contact/route.tsx:70`                              | OK        | `"Le message doit contenir au moins 20 caractères"`     | Conforme. Pas le ton tutoiement direct mais wording impersonnel cohérent avec validation Zod. |

### Inconsistances mineures à harmoniser (non bloquantes)

- **Point final manquant** sur certains messages Zod amont : `"Email invalide"`, `"Mot de passe requis"`. Ajouter le point final pour cohérence avec `"Code postal invalide (5 chiffres attendus)."`.
- Cette dette est non bloquante pour Live — l'utilisateur ne perçoit pas la différence à l'œil. À traiter en chantier de polish UX dédié post-Live.

### Cas signalés mais non corrigés (rationale)

- `"Réponse vide"` (route producer respond) : surface admin/producer, hors scope strict T-234 (consumer). Si extension scope, à tutoyer en `"Réponse trop courte (1 caractère minimum)."`.

## Test pattern recommandé

Pour les formulaires critiques, asserter le wording exact dans les tests Vitest :

```ts
it("affiche le message d'erreur CP invalide", async () => {
  // arrange + act
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Code postal invalide (5 chiffres attendus).",
  );
});
```

Cela protège contre la dérive accidentelle du wording lors de refactors futurs. Pattern déjà appliqué dans `tests/components/distance-widget.test.tsx` (à vérifier au prochain pickup T-234 si correction wording nécessaire).

## Évolutions possibles

- **i18n** : si extension multi-langue, externaliser tous les messages dans `lib/i18n/validation.fr.ts` puis pluggable. Hors scope pré-Live.
- **Accessibility audit** : valider que tous les messages d'erreur sous-champ sont liés à l'input via `aria-describedby`, pas seulement `role="alert"` global. Pattern à formaliser dans une convention a11y séparée.

## Références

- Règle ESLint apostrophe (T-255 + T-266) : utiliser `&apos;` ou ASCII `'` dans les strings.
- Tutoiement par convention TerrOir.
- Doctrine wording certifié DGCCRF (CLAUDE.md) : NE S'APPLIQUE PAS aux messages d'erreur de validation (ce ne sont pas des indicateurs producteur certifiés).
