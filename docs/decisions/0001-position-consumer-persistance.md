# ADR-0001 — Position consumer : choix de persistance

- **Statut** : Deferred
- **Date** : 2026-05-13
- **Décideurs** : Romain

## Contexte

Le DistanceWidget (fiche producteur publique) demande au consumer sa
position pour calculer la distance à vol d'oiseau jusqu'au producteur.
Aujourd'hui cette position est stockée en `sessionStorage`
(`terroir_geo_session`), donc purgée à la fermeture d'onglet. Trois
choix d'architecture s'offrent pour étendre la persistance :

1. **`sessionStorage` (actuel)** — pas de persistance cross-onglet, pas
   de profilage user possible. RGPD-friendly par construction.
2. **Cookie httpOnly opt-in** — persistance cross-onglet, durée
   configurable, requiert consent banner conformité ePrivacy.
3. **Champ profil DB (`users.code_postal` ou `users.lat/lng`)** —
   persistance cross-device pour les users connectés, ouvre la voie à
   des features serveur (tri « proche de chez moi », notifications de
   proximité), implique modifications RLS + registre RGPD Art 30.

## Question (non tranchée)

Quelle persistance retenir au moment où TerrOir voudra :
- pré-remplir la position au niveau global (header / compte) au lieu de
  demander à chaque fiche producteur ;
- offrir un tri « producteurs proches de chez moi » en page liste ;
- envoyer des notifications de proximité (push, email) sur nouveau
  producteur dans une zone.

## Conséquences (selon l'option retenue)

**Option 1 (statu quo `sessionStorage`)** :
- ✅ Aucune action RGPD additionnelle, aucune décision juridique
  bloquante.
- ❌ Friction UX : redemande à chaque session, peut décourager les
  utilisateurs occasionnels.
- ❌ Bloque les features serveur (tri, notifications).

**Option 2 (cookie opt-in)** :
- ✅ Persistance cross-onglet, contrôle user via consent banner.
- ❌ Implique bandeau cookies conformité ePrivacy (pas encore en place
  pré-Live).
- ❌ Toujours pas exploitable serveur (cookie côté client uniquement
  pour les non-connectés).

**Option 3 (profil DB)** :
- ✅ Persistance cross-device, exploitable côté serveur.
- ❌ Décision produit : stocker un CP nominatif est un signal géo, à
  ajouter au registre RGPD Art 30 + politique de confidentialité.
- ❌ Nécessite policy RLS + migration DB.

## Critère de déblocage

Cette décision peut être tranchée quand :
- (a) une feature serveur explicite a besoin de la position consumer
  persistée (tri, notifications, recommandations),
- OU (b) la friction UX devient mesurable (taux de non-saisie position
  > seuil défini par instrumentation PostHog — cf. instrumentation
  conditionnée à compte PostHog provisionné).

Tant qu'aucun de ces deux signaux n'est observé, statu quo `sessionStorage`.

## Liens

- Code actuel : `components/consumer/DistanceWidget.tsx`
- Helper Haversine : `lib/geo/haversine.ts`
