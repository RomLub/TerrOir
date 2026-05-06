# Validation pattern « clic-pour-déployer » mention RGPD — T-272

> **Cluster** : T-261 (RGPD pré-Live consolidé) / T-200 r1 (doctrine privacy).
> **Scope** : valider explicitement le pattern UX du DistanceWidget où la
> mention RGPD `PrivacyNote` est visible **après** clic d'expansion
> (pattern WAI-ARIA Disclosure), et non immédiatement à la première
> visite de la fiche producteur. Argumentaire RGPD art. 13 : le clic
> est-il un consentement implicite informé acceptable ?
> **Méthode** : analyse du flow de collecte + cross-réf T-208 (registre
> traitements) + T-248 (cohérence registre↔mention) + T-263 (revue
> wording).
> **Date** : 2026-05-06.

---

## TL;DR

**Pattern validé ✅ comme conforme art. 13 RGPD + acceptable
ergonomiquement.**

Le DistanceWidget pose le pattern WAI-ARIA Disclosure (CollapsedButton
1 ligne → Panel déployé sur clic). La mention `PrivacyNote` (information
RGPD au point de collecte) n'est visible qu'**après expansion**, mais
**avant toute action de collecte effective** :

1. **État compact (replié)** = `<button>` avec label
   "Voir la distance jusqu'à toi". **Aucune donnée n'est collectée à
   ce stade** (pas de geocode, pas d'écriture sessionStorage, pas
   d'appel browser geolocation).
2. **Clic CollapsedButton** = bascule vers le Panel déployé. **Toujours
   aucune collecte** : seul un `setExpanded(true)` côté React state.
3. **Panel déployé** affiche systématiquement la `PrivacyNote` (cf. JSX
   `DistanceWidget.tsx:343, 504, 548`). L'utilisateur LIT la mention
   RGPD **avant** d'agir.
4. **Action de collecte** = clic CTA "Utiliser ma position" (déclenche
   prompt browser geoloc, double opt-in) OU saisie CP + clic OK
   (déclenche `/api/geocode`).

→ Le pattern respecte l'esprit de l'art. 13.1 RGPD : information loyale
au point de collecte, **avant** toute capture. Pas de "dark pattern".
**T-272 peut être marqué ✅ dans la checklist pré-Live.**

---

## Argumentaire détaillé

### Argument A — Aucune collecte avant interaction explicite

**Constat code** : `DistanceWidget.tsx:155-158` (useEffect mount-time) :
```tsx
useEffect(() => {
  setMounted(true);
  setSession(readSession());  // LECTURE sessionStorage existante
}, []);
```
- `readSession()` LIT le sessionStorage local (pas une collecte — la
  donnée existe déjà dans le navigateur si l'utilisateur a saisi sa
  position sur une autre fiche).
- **Aucune écriture** sessionStorage avant action utilisateur.
- **Aucun appel** `/api/geocode` ni `navigator.geolocation` avant
  action utilisateur.

**Constat code** : `DistanceWidget.tsx:140` (état initial) :
```tsx
const [expanded, setExpanded] = useState(false);
```
- Le composant démarre **replié** (`expanded = false`). Cohérent
  T-240 (décision UX placement compact).

**Conclusion A** : la première visite d'une fiche producteur n'entraîne
**aucune collecte** tant que l'utilisateur ne clique pas. Pas de
"navigateur empreinte" généré. Pas de prompt browser geoloc auto-déclenché.

### Argument B — `PrivacyNote` visible AVANT toute action de collecte

**Constat code** : la `PrivacyNote` est rendue dans **3 emplacements
JSX** distincts du Panel déployé :
- `DistanceWidget.tsx:343` — Panel "déployé sans session" (avant 1ère
  collecte). `PrivacyNote` affichée sous les CTA "Utiliser ma position"
  + champ CP.
- `DistanceWidget.tsx:504` — `DistanceResult` (après 1ère collecte +
  recharge fiche avec session existante). `PrivacyNote` affichée sous
  le bouton "Changer ma position".
- `DistanceWidget.tsx:548` — `DistanceOutOfReach` (cas hors zone).
  Idem.

→ Dans chacun des 3 états déployés, `PrivacyNote` est rendue. Donc
**impossible d'agir sur le widget sans avoir vu la mention RGPD au moins
une fois**.

**Constat séquence temporelle** sur le 1er usage :
1. `t=0` : visite fiche → CollapsedButton replié, **pas de PrivacyNote**.
2. `t=1` : clic CollapsedButton → Panel déployé, **PrivacyNote rendue**.
3. `t=2` : utilisateur lit / scanne la PrivacyNote.
4. `t=3` : clic CTA "Utiliser ma position" OU saisie CP + clic OK →
   **première collecte effective**.

→ La mention RGPD apparaît à `t=1`, la collecte démarre à `t=3`. Ordre
strict. **L'utilisateur a la possibilité d'arrêter avant de collecter**
(reclick "Masquer", quitter la page, etc.).

**Conclusion B** : `PrivacyNote` précède strictement chaque action de
collecte. Conforme art. 13.1 RGPD (information loyale **avant**
collecte).

### Argument C — Le clic CTA = consentement implicite informé

**Cadre RGPD applicable** : pour une donnée géolocalisation utilisée à
des fins fonctionnelles (calcul distance), 2 bases légales possibles :
- **Intérêt légitime (art. 6.1.f)** — le plus probable pour
  TerrOir, donnée non transmise au serveur, finalité non intrusive.
- **Consentement (art. 6.1.a + art. 7)** — strict, requiert opt-in
  explicite pour la géoloc.

**Pour la géoloc browser** : le navigateur lui-même (Chrome, Firefox,
Safari, Edge) implémente un opt-in explicite via le **prompt
`navigator.geolocation`** (« Ce site veut connaître votre position »).
Ce prompt est un **vrai consentement RGPD** (utilisateur informé,
choix libre, granularité par site, révocable).

**Pour la saisie CP** : pas de prompt browser (le CP n'est pas une
donnée géoloc capturée par l'OS). Le **clic CTA "OK"** sur le formulaire
matérialise le consentement de l'utilisateur à transmettre son CP au
serveur TerrOir pour résolution.

**Conclusion C** : la double action (clic expansion → lecture
PrivacyNote → clic CTA) constitue un consentement implicite informé.
Pour la géoloc, double opt-in (CTA TerrOir + prompt browser). Pour le
CP, le clic CTA seul suffit (donnée non OS-protégée).

### Argument D — Pas de "dark pattern" identifié

**Vérification anti-dark-patterns** (`Deceptive Design Patterns` —
checklist EU EDPB) :
- **Pas de pré-cocher** : aucun toggle pré-coché favorisant la
  collecte. État initial = replié.
- **Pas de "consent fatigue"** : 1 seule action de consentement par
  visite (le clic CTA), pas de bandeau récurrent.
- **Pas de wording manipulatoire** : le label CollapsedButton
  ("Voir la distance jusqu'à toi") est neutre, pas culpabilisant.
- **Pas de dissymétrie boutons** : les CTA "Utiliser ma position" et
  "OK" CP ont des styles de tailles raisonnables ; pas de "Refuser"
  caché vs "Accepter" surdimensionné — il n'y a pas de bouton
  "Refuser" car il n'y a pas de collecte si on ne clique pas.
- **Pas de scroll-trap** : la PrivacyNote est rendue dans le panneau
  visible immédiatement au clic, pas masquée derrière un scroll.

**Conclusion D** : le pattern n'est pas un dark pattern. Le widget ne
manipule pas l'utilisateur pour collecter — il propose une fonction et
ne l'active qu'à la demande.

---

## Articulation cluster RGPD

### Cohérence T-208 (registre traitements)
La fiche du registre RGPD pour le widget distance (à inscrire — cf.
T-208) doit refléter le pattern :
- **Étapes du traitement** :
  1. Affichage du widget replié (pas de traitement).
  2. Clic expansion (pas de traitement, juste UI).
  3. Saisie consumer (CP ou autorisation géoloc).
  4. Calcul distance Haversine local (traitement automatisé).
- **Bases légales** : intérêt légitime (calcul) + consentement
  navigateur (géoloc OS).
- **Durée** : sessionStorage navigateur (purge fermeture onglet).

### Cohérence T-248 (mention in-situ ↔ registre)
La PrivacyNote doit décrire les mêmes étapes / finalités que le
registre. Cf. T-263 (revue wording) — le wording actuel couvre les
4 finalités art. 13.

### Cohérence T-263 (revue wording)
Le contenu de PrivacyNote couvre :
- (a) finalité explicite : calcul de distance.
- (b) caractère facultatif : la fiche reste consultable sans.
- (c) durée de conservation côté navigateur : sessionStorage.
- (d) chaîne CP→coords + sous-traitant `api-adresse.data.gouv.fr`.

→ Aligné avec ce que ce doc T-272 valide côté pattern UX.

---

## Recommandations

### R1. Conserver l'ordre temporel du pattern
**Priorité** : haute (régression évitable).

Toute future modification du DistanceWidget doit respecter l'ordre :
**expansion → PrivacyNote visible → action de collecte**. Ne pas
introduire un pattern de type :
- "Auto-prompt geoloc" au mount de la fiche (violerait la doctrine).
- "Affichage de la distance pré-calculée sans avoir vu PrivacyNote
  pour ce producer" (semble être déjà bordé par le re-render via
  `useMemo`, mais la PrivacyNote doit rester rendue dans
  CollapsedButton + Panel à chaque variante).

→ Doctrine opposable PR review : à inscrire dans
`docs/conventions/` lors de la consolidation finale.

### R2. Validation A11y du pattern Disclosure
**Priorité** : faible (déjà couvert T-273).

Le pattern WAI-ARIA Disclosure utilisé (cf. lignes 35-46 commentaires
DistanceWidget) est conforme à l'audit a11y T-273. Pas d'action
supplémentaire requise pour T-272.

### R3. Documenter dans politique conf
**Priorité** : moyenne (acquis dès T-207).

À la livraison de `/politique-confidentialite`, inclure une section
"Comment fonctionne le widget distance" qui décrit le pattern de
disclosure progressive (cf. R3 du doc T-263). Bénéfice : utilisateur
qui découvre la mention RGPD trouve ensuite la documentation détaillée
sur la politique conf.

---

## Cross-références

- `docs/security/revue-wording-distancewidget-2026-05-06.md` (T-263).
- `docs/security/audit-sessionstorage-non-fuite-tiers-2026-05-06.md`
  (T-253) — confirme côté technique que rien n'est collecté avant
  action utilisateur.
- `docs/security/audit-logs-serveur-non-capture-cp-coords-2026-05-06.md`
  (T-249) — confirme côté serveur que rien n'est loggé.
- **Tasks liées** :
  - T-208 (registre traitements — partage la sémantique de pattern).
  - T-248 (cohérence mention ↔ registre).
  - T-263 (revue wording).
  - T-273 (audit a11y Disclosure — déjà clos).

### Standards externes
- [WAI-ARIA Authoring Practices — Disclosure pattern](https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/)
- [EDPB Guidelines 03/2022 — Dark Patterns](https://edpb.europa.eu/system/files/2023-02/edpb_03-2022_guidelines_on_deceptive_design_patterns_in_social_media_platform_interfaces_v2_en_0.pdf)
  — checklist anti-manipulation utilisée § Argument D.

---

## Conclusion

T-272 ✅ — le pattern « clic-pour-déployer la mention RGPD » du
DistanceWidget est conforme art. 13 RGPD : aucune collecte avant
interaction explicite (Argument A), `PrivacyNote` rendue avant chaque
action de collecte (Argument B), clic CTA = consentement implicite
informé (Argument C), pas de dark pattern (Argument D). Pattern à
préserver dans toute future modification (R1).
