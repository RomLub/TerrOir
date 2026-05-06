# Revue wording in-situ DistanceWidget — T-263

> **Cluster** : T-261 (RGPD pré-Live consolidé) + T-272 (validation
> pattern clic-pour-déployer) + T-208 (registre traitements).
> **Scope** : revue technique de tous les wordings affichés par
> `DistanceWidget` (label compact, helper, formulaire, erreurs,
> PrivacyNote, états outOfReach). Vérification cohérence avec art. 13
> RGPD (information loyale au point de collecte) + cluster T-261.
> **Méthode** : revue ligne par ligne du composant en lecture seule,
> pas de modification de code (recommandations textuelles avant/après).
> **Date** : 2026-05-06.

---

## TL;DR

**Wording globalement conforme art. 13 RGPD.** Les 4 finalités obligatoires
(art. 13.1 RGPD) sont couvertes :

- **a) Finalité explicite** : calcul de distance — ✅ formulé "pour calculer
  la distance".
- **b) Caractère facultatif** : ✅ "Saisie facultative — la fiche reste
  consultable sans".
- **c) Durée de conservation** : ✅ sessionStorage = "stockage de session,
  effacé à la fermeture de l'onglet".
- **d) Destinataires** : ✅ "transite via TerrOir (cache anonyme) vers le
  service public api-adresse.data.gouv.fr".

**4 améliorations recommandées** (non bloquantes, à intégrer avant Live
ou pendant audit T-003) :
- R1 : ajouter mention explicite "responsable de traitement = TerrOir"
  pour clore art. 13.1.a.
- R2 : préciser la **base légale** (intérêt légitime ou consentement) —
  art. 13.1.c. Aujourd'hui implicite, à formuler.
- R3 : ré-intégrer le `<Link>` vers la politique de confidentialité au
  go-live (T-207 prérequis).
- R4 : harmoniser un détail terminologique ("ta position (géoloc ou
  résolue depuis ton code postal)" → simplifier).

→ **T-263 peut être marqué ✅ dans la checklist pré-Live**, recommandations
à acter en bundle avec T-207 (politique conf) + T-208 (registre).

---

## Inventaire wording actuel

Source : `app/(public)/producteurs/[slug]/_components/DistanceWidget.tsx`.

### W1. Bouton replié (état initial)
**Code** : ligne 173, `CollapsedButton`.
**Wording** : `"Voir la distance jusqu'à toi"`.
**Verdict** : ✅ Clair, non-intrusif. Pas de collecte tant que pas cliqué
(cohérent T-272 — pattern disclosure).

### W2. Bouton replié (état session active)
**Code** : ligne 252.
**Wording** : `${distance} km à vol d'oiseau`.
**Verdict** : ✅ Affichage du résultat sans répéter la collecte.

### W3. Bouton replié (état hors zone)
**Code** : ligne 250.
**Wording** : `"Hors zone circuit court"`.
**Verdict** : ✅ Neutre, factuel. Pas de wording culpabilisant
(cohérent décision T-230).

### W4. Helper text (panneau déployé sans session)
**Code** : ligne 290-291.
**Wording** : `"Indique ta position pour découvrir la distance à vol
d'oiseau jusqu'à {producerName}."`.
**Verdict** : ✅ Verbe d'action clair. Tutoiement cohérent CGU TerrOir.

### W5. CTA primaire géoloc
**Code** : ligne 305.
**Wording** : `"Utiliser ma position"` / `"Recherche…"` (pending).
**Verdict** : ✅ "Utiliser ma position" déclenchera la prompt browser
geolocation (consentement explicite navigateur). RGPD : double
consentement (clic CTA + prompt browser).

### W6. Champ CP + label
**Code** : lignes 309-321.
**Wording** : label sr-only `"Code postal"`, placeholder `"Code postal"`.
**Verdict** : ✅ Label accessible (sr-only), placeholder neutre.

### W7. CTA secondaire CP
**Code** : ligne 329.
**Wording** : `"OK"` / `"Calcul…"` (pending).
**Verdict** : ⚠️ "OK" est court mais ambigu hors contexte. **Aucune
amélioration nécessaire** ici car le contexte form (champ CP juste à
gauche) lève l'ambiguïté. Tap target 44px conforme a11y.

### W8. Messages d'erreur
**Code** : lignes 197, 201, 203 (geoloc) + import
`GEOCODE_POSTAL_ERROR_MESSAGES` (CP, lib externe).
**Wording géoloc** :
- `"Autorisation refusée. Tu peux saisir ton code postal à la place."`
- `"Délai dépassé. Réessaie ou saisis ton code postal."`
- `"Position indisponible. Saisis ton code postal à la place."`

**Verdict** : ✅ Tonalité humaine, propose alternative dans chaque cas.
Pas d'expose technique (codes erreurs API absents). Cluster T-273 a11y
`role="alert"` ligne 336.

### W9. PrivacyNote (mention RGPD au point de collecte)
**Code** : lignes 410-420.
**Wording complet** :
> Saisie facultative — la fiche du producteur reste consultable sans. Ta
> position (géoloc ou résolue depuis ton code postal) reste dans ton
> navigateur (stockage de session, effacé à la fermeture de l'onglet)
> pour calculer la distance ; elle n'est jamais associée à ton compte
> ni à ta visite côté serveur. La saisie d'un code postal transite via
> TerrOir (cache anonyme du couple code postal → coordonnées commune)
> vers le service public api-adresse.data.gouv.fr.

**Verdict** : ✅ Couvre les 4 grandes finalités art. 13 (cf. TL;DR).
Améliorations § R1-R4 ci-dessous.

### W10. Bloc DistanceResult — labels
**Code** : lignes 444-475.
**Wording** :
- `"Jusqu'à toi"` (eyebrow producer-side).
- `"à vol d'oiseau jusqu'à toi depuis {producerName}"`.
- `"En circuit long"` (eyebrow GMS).
- `"~{ref} km"`.
- `"en moyenne en circuit long (importation, centrale d'achat,
  entrepôts)."`.
- `GMS_DISTANCE_SOURCE_LABEL` (sourcing ADEME).
- `"Toi ↔ ferme"` + `"~{ref} km"` (barre comparative).

**Verdict** : ✅ Wording cohérent avec décision T-230 (claim ~1500 km
encadré par revue avocat T-206). "Toi ↔ ferme" — note T-211 backlog
(le terme "ferme" est imprécis pour maraîchers/boulangers, mais hors
scope T-263).

### W11. Bloc DistanceResult — bouton reset
**Code** : ligne 501.
**Wording** : `"Changer ma position"`.
**Verdict** : ✅ Action claire, cohérent W2.

### W12. Bloc DistanceOutOfReach — message
**Code** : lignes 528-535.
**Wording** :
- `"Hors zone"` (eyebrow).
- `"Depuis ta position, {producerName} se trouve en dehors de notre
  zone de circuit court. La comparaison à vol d'oiseau ne reflète plus
  une logique de proximité pertinente."`.
**Verdict** : ✅ Ton factuel, neutre. Pas de wording exclusif. Cohérent
T-230 (au-delà du seuil, on retire la distance brute + comparaison).

### W13. Liens "Masquer" disclosure
**Code** : lignes 376-391.
**Wording** : `"Masquer"`.
`aria-label`: `"Masquer le détail de la distance"`.
**Verdict** : ✅ Pattern WAI-ARIA Disclosure conforme T-273 (audit a11y).
Multi-trigger valide. Cluster T-272 (validation pattern
clic-pour-déployer mention RGPD) — la mention RGPD est elle-même
visible **uniquement après expansion**, ce qui aligne sur la doctrine
T-272 : aucune donnée n'est collectée tant que l'utilisateur n'a pas
explicitement déplié + saisi.

---

## Recommandations textuelles

### R1. Ajouter le responsable de traitement (art. 13.1.a)
**Priorité** : moyenne (acquis implicitement par contexte mais formaliser
améliore la conformité).

**Wording PrivacyNote actuel** : ne nomme jamais TerrOir comme
responsable. La mention "transite via TerrOir" est citée mais pas en
qualité de responsable.

**Avant** :
> Ta position (...) reste dans ton navigateur (...) pour calculer la
> distance ; elle n'est jamais associée à ton compte ni à ta visite
> côté serveur.

**Après proposé** :
> TerrOir (responsable du traitement) ne stocke ta position que dans ton
> navigateur (stockage de session, effacé à la fermeture de l'onglet)
> pour calculer la distance ; elle n'est jamais associée à ton compte
> ni à ta visite côté serveur.

→ Acceptable ou plus court : ajouter dans le **bandeau récapitulatif**
de la politique de confidentialité (T-207) plutôt qu'alourdir
PrivacyNote in-situ. À arbitrer.

### R2. Préciser la base légale (art. 13.1.c)
**Priorité** : moyenne (la base légale doit être identifiable).

**Constat** : la base légale n'est pas explicitée. Pour ce traitement :
- Pas de **consentement** explicite (le clic CTA est un opt-in
  fonctionnel, pas un consent RGPD au sens strict).
- **Intérêt légitime** est la base la plus probable (calcul de distance
  = besoin fonctionnel non intrusif, donnée non transmise au serveur).

**Recommandation** : documenter dans la politique de confidentialité
(T-207) que le traitement géolocalisation widget distance s'appuie sur
l'intérêt légitime de TerrOir (information du consumer pour aide à la
décision d'achat).

→ Pas besoin d'alourdir PrivacyNote in-situ avec ce détail. La mention
in-situ doit rester courte.

### R3. Ré-intégrer le `<Link>` vers politique de confidentialité au go-live
**Priorité** : haute (acquis dès que T-207 livre).

**Constat actuel** : commentaire lignes 407-409 :
> Le renvoi vers la politique de confidentialité globale reste
> volontairement retiré tant que la page n'existe pas (suivi T-207).

**Action** : à la livraison de `/politique-confidentialite` :

**Avant** (fin de PrivacyNote actuelle) :
> ... vers le service public api-adresse.data.gouv.fr.

**Après proposé** :
> ... vers le service public api-adresse.data.gouv.fr.
> [En savoir plus sur le traitement de mes données](/politique-confidentialite#widget-distance)

(Lien vers section dédiée T-207 ancrée `#widget-distance`).

→ Préparation : T-207 doit créer une section ancrée
`#widget-distance` dans `/politique-confidentialite`.

### R4. Harmoniser terminologie "position"
**Priorité** : faible (cosmétique).

**Constat** : la phrase actuelle énumère lourdement les sources :
> Ta position (géoloc ou résolue depuis ton code postal) reste dans ton
> navigateur

**Avant** :
> Ta position (géoloc ou résolue depuis ton code postal)

**Après proposé (option 1, plus court)** :
> Ta position approximative

**Après proposé (option 2, plus précis)** :
> Ta position (issue de la géolocalisation ou de ton code postal)

→ Choix Romain. Option 2 reste préférable pour transparence.

---

## Recommandations transverses cluster T-261

### Articulation avec T-208 (registre traitements)
Le wording in-situ doit rester cohérent avec ce que le registre déclare.
Items à figer dans le registre (entrée "widget distance") :
- **Finalité** : calcul d'une distance à vol d'oiseau entre la position
  consumer et l'adresse du producteur.
- **Données collectées** : coordonnées géographiques (latitude,
  longitude) ou code postal saisi.
- **Base légale** : intérêt légitime (cf. R2).
- **Durée de conservation** : navigateur consumer (sessionStorage), purge
  fermeture onglet. Cache serveur (CP→coords) : permanent (donnée
  publique INSEE).
- **Destinataires** : aucun — la donnée ne quitte pas le navigateur,
  sauf le CP transmis à `api-adresse.data.gouv.fr` via TerrOir (cache).
- **Sous-traitants** : `api-adresse.data.gouv.fr` (service public,
  open data, pas de contrat dédié).
- **Sécurité** : pas de log côté serveur (T-249), pas de fuite
  sessionStorage (T-253), CSP `connect-src` whitelist restrictive
  (T-264).

### Articulation avec T-272 (pattern clic-pour-déployer)
Le pattern actuel est conforme : aucune donnée n'est collectée tant que
l'utilisateur :
1. n'a pas cliqué sur le CollapsedButton (déclenche expansion seulement),
2. n'a pas cliqué sur le CTA "Utiliser ma position" (déclenche prompt
   navigateur géoloc), OU
3. n'a pas saisi un CP + cliqué OK (déclenche `/api/geocode`).

→ La PrivacyNote est visible **avant** chacune de ces 3 actions de
collecte (le panneau déployé inclut PrivacyNote dès l'expansion). Le
consumer a donc l'information avant tout consentement implicite. **R0
implicite : conserver cet ordre dans toute future modification.**

### Articulation avec T-263 (mention sessionStorage)
Le wording inclut déjà la mention "stockage de session, effacé à la
fermeture de l'onglet" (PrivacyNote ligne 414). Cohérent commit
historique référencé dans le commentaire ligne 396.

→ R0 supplémentaire : ne pas dégrader cette précision en wording plus
flou type "stocké localement" (qui pourrait laisser supposer
localStorage permanent).

---

## Cross-références

- **CLAUDE.md** § Doctrine privacy (T-200 r1, T-272 pattern disclosure).
- `docs/security/audit-logs-serveur-non-capture-cp-coords-2026-05-06.md`
  (T-249).
- `docs/security/audit-sessionstorage-non-fuite-tiers-2026-05-06.md`
  (T-253).
- `docs/security/audit-champs-sensibles-fiche-publique-2026-05-06.md`
  (T-254).
- `docs/security/csp-audit-t-264-2026-05-06.md` (T-264).
- **Tasks liées** :
  - T-207 (politique conf — prérequis R3).
  - T-208 (registre traitements — partage de finalités/durée).
  - T-272 (validation pattern clic-pour-déployer).

---

## Conclusion

T-263 ✅ — le wording in-situ DistanceWidget couvre les 4 finalités
art. 13 RGPD au moment de la collecte. 4 améliorations recommandées (R1
responsable, R2 base légale, R3 lien politique conf, R4 simplification
terminologique) à intégrer en bundle avec T-207 + T-208 sans toucher au
composant lui-même tant que la politique de confidentialité globale n'est
pas livrée.
