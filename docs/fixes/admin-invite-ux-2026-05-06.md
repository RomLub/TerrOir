# UX messages clairs lors invitation producer email déjà connu — T-105

> Date : 2026-05-06
> Branche : master
> Tickets : T-105

---

## Contexte

La route `POST /api/admin/producers/invite` gérait déjà 4 cas 409 distincts côté backend :
1. **Admin existant** (`admin_invite_blocked_admin`) — `error: "Impossible d'inviter un administrateur comme producteur"`.
2. **Producteur existant** non-draft (`admin_invite_blocked_producer`) — `error: "Ce producteur est déjà inscrit"`.
3. **Producteur draft** (onboarding abandonné) — déjà géré via `kind: "draft_resend_confirm_required"` (encadré orange + bouton "Confirmer la relance").
4. **Compte consumer existant** — pas un blocage : 200 OK avec `existing_account: "consumer"` dans le body, encadré bleu "rôle producteur sera ajouté".

L'UX admin était donc déjà bien fournie pour les cas 3 et 4 (encadrés différenciés dans `InviteModal`). Mais les cas 1 et 2 retombaient sur une simple `<p className="text-[13px] text-red-700">{error}</p>` sous le form — perdaient en clarté visuelle vs les 2 encadrés voisins, et ne suggéraient aucune action.

## Décision

Aligner les 2 cas restants sur le pattern d'encadrés différenciés.

### Backend — ajout de `kind` aux 2 cas 409

Le frontend ne devait pas regex le message texte pour discriminer (fragile, casse au moindre changement de wording). On ajoute un champ `kind` au body de la 409, comme déjà fait pour `draft_resend_confirm_required` :

```jsonc
// 409 admin existant
{ "error": "Impossible d'inviter un administrateur comme producteur", "kind": "blocked_admin" }

// 409 producteur existant
{
  "error": "Ce producteur est déjà inscrit",
  "kind": "blocked_producer",
  "statut": "active"  // ou "pending" / "suspended" / "deleted" / "public"
}
```

Champ `error` (legacy) conservé pour rétrocompat consumers tiers / logs Vercel. `statut` exposé pour producteur — l'admin a saisi l'email volontairement, ce n'est pas du leak.

### Frontend — encadrés différenciés

**InviteModal** (`app/(admin)/gestion-producteurs/page.tsx`) reçoit un nouveau state :

```ts
const [blocked, setBlocked] = useState<
  | { kind: 'blocked_admin' }
  | { kind: 'blocked_producer'; statut: string | null }
  | null
>(null);
```

- **`blocked_admin`** → encadré gris/neutre (pas un bug, blocage légitime) : *« Cet email est déjà rattaché à un compte administrateur. Un administrateur ne peut pas être invité comme producteur. Utilisez une autre adresse email. »*
- **`blocked_producer`** → encadré rouge avec mention contextuelle du statut FR (« Suspendu » / « Validé » / etc. via `getProducerStatusLabel`) + lien actionnable « Aller à la liste des producteurs → » qui ferme le modal et navigue vers `/gestion-producteurs`. Pas de pré-filtre par email côté router (scope T-105 minimal — la liste actuelle filtre par `user_id` UUID via deep-link `/audit-logs`, pas par email ; l'admin retrouve le producteur visuellement).

L'encadré orange `confirmDraftResend` et l'encadré bleu `existingAccount === 'consumer'` (sent view) restent inchangés. Le state `blocked` se reset au changement d'email pour permettre une retry sur une autre adresse sans fermer le modal.

### Helper `getProducerStatusLabel` ré-exposé

Le mapping FR `producers.statut → libellé` vivait dans `META` (interne à `ProducerStatusBadge`). T-105 l'expose via `getProducerStatusLabel(status: string)` réutilisé pour afficher « Statut actuel : Suspendu. » dans l'encadré sans dupliquer la table.

## Fichiers touchés

### Modifiés

- **`app/api/admin/producers/invite/route.tsx`** — ajout `kind` (et `statut` pour producer) aux 2 réponses 409.
- **`app/(admin)/gestion-producteurs/page.tsx`** — InviteModal : state `blocked`, 2 encadrés JSX, reset au changement d'email, import `getProducerStatusLabel`.
- **`components/ui/producer-status-badge.tsx`** — nouvelle export `getProducerStatusLabel`.
- **`components/ui/index.ts`** — re-export de `getProducerStatusLabel`.
- **`tests/app/api/admin/producers/invite/route.test.ts`** — B1 + C1-C5 mis à jour pour matcher le nouveau body avec `kind` + `statut`.

### Nouveaux

- **`tests/components/ui/producer-status-badge.test.ts`** — 7 tests pour `getProducerStatusLabel` (6 valeurs canoniques + fallback).
- **`docs/fixes/admin-invite-ux-2026-05-06.md`** — ce document.

## Vérifications

- `npx tsc --noEmit` → exit 0.
- `npx vitest run` → 1940 tests passés (vs 1930 baseline T-220).
- `npx next lint` → 0 nouvelle erreur introduite (le warning existant `react-hooks/exhaustive-deps` sur `user-provider.tsx` est hors scope).

## Évolutions possibles

- **Pré-filtre par email côté `/admin/gestion-producteurs`** : actuellement la page accepte `?user_id=<uuid>` (deep-link audit-logs). Ajouter un `?email=<email>` permettrait au lien "Aller à la liste des producteurs" d'arriver directement sur la fiche concernée. Hors scope T-105 (pas de modification du router admin sans nouveau ticket).
- **Encadré pour cas 5xx** : aujourd'hui un 500 (DB down) tombe sur `<p text-red-700>` générique — pourrait avoir son propre encadré avec icône et suggestion "Réessayer dans quelques instants". Hors scope T-105 (cas marginal, log Vercel suffit).
