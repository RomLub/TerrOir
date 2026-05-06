# Cohérence registre traitements ↔ mention in-situ widget distance — T-248

> **Cluster** : T-261 (RGPD pré-Live consolidé) / T-200 r1 (doctrine privacy).
> **Scope** : vérifier la cohérence sémantique entre l'entrée registre
> RGPD (T-208) et la mention in-situ `PrivacyNote` rendue par
> `DistanceWidget` dans la fiche producteur publique.
> **Méthode** : cross-check colonne par colonne des 4 finalités
> art. 13.1 RGPD + champs registre art. 30.
> **Date** : 2026-05-06.

---

## TL;DR

**Cohérence ✅ globalement bonne, 3 écarts mineurs identifiés à acter
en bundle pré-Live.**

Le registre (T-208) et le wording in-situ couvrent les mêmes finalités,
les mêmes destinataires, et la même durée de conservation. Les écarts
relèvent de précisions formelles non critiques :

- **E1 — Base légale** : registre = "intérêt légitime" explicite. Mention
  in-situ = base légale implicite (pas formulée). Acceptable in-situ
  (pas obligatoire art. 13 si l'info est dans la politique conf
  globale), mais à formaliser dans `/politique-confidentialite` (T-207).
- **E2 — Responsable de traitement** : registre = "TerrOir" identifié.
  Mention in-situ = responsable mentionné indirectement ("transite via
  TerrOir") mais pas qualifié comme responsable. Recommandation T-263
  R1 déjà émise.
- **E3 — Lien vers info complète** : registre prévoit un lien vers la
  politique conf globale (T-207). Mention in-situ a volontairement
  retiré le lien tant que la page n'existe pas. Articulation T-263 R3 :
  réintégrer le lien à la livraison de T-207.

→ **T-248 peut être marqué ✅ dans la checklist pré-Live**, sous réserve
des recommandations T-263 R1 + R3 acceptées en bundle.

---

## Méthodologie

### Référentiels comparés
- **Registre RGPD** : `docs/security/registre-traitements-widget-
  distance-2026-05-06.md` (T-208).
- **Mention in-situ** : composant `PrivacyNote` dans
  `app/(public)/producteurs/[slug]/_components/DistanceWidget.tsx:410-420`.
- **Audit wording préalable** : `docs/security/revue-wording-
  distancewidget-2026-05-06.md` (T-263).
- **Validation pattern** : `docs/security/validation-pattern-
  disclosure-rgpd-2026-05-06.md` (T-272).

### Critères de cohérence (art. 13.1 RGPD + art. 30 RGPD)
1. **Identité du responsable** (art. 13.1.a + art. 30.1.a).
2. **Finalités** (art. 13.1.c + art. 30.1.b).
3. **Base légale** (art. 13.1.c).
4. **Destinataires / sous-traitants** (art. 13.1.e + art. 30.1.d).
5. **Transferts hors UE** (art. 13.1.f + art. 30.1.e).
6. **Durée de conservation** (art. 13.2.a + art. 30.1.f).
7. **Droits des personnes** (art. 13.2.b à d).
8. **Existence de décision automatisée** (art. 13.2.f).

---

## Cross-check critère par critère

### Critère 1 — Identité du responsable

| Source | Contenu |
|---|---|
| **Registre T-208 § 1** | TerrOir, représentant légal Romain Lubin. |
| **Mention in-situ** | `transite via TerrOir (cache anonyme du couple code postal → coordonnées commune) vers le service public api-adresse.data.gouv.fr` — TerrOir mentionné mais pas qualifié comme responsable. |

**Verdict** : ⚠️ **Écart mineur (E2)**. Le registre identifie TerrOir
comme responsable formel ; la mention in-situ ne le qualifie pas
explicitement. Acceptable car une mention in-situ courte n'est pas le
canal idéal pour formaliser cette précision (qui appartient à la
politique conf globale T-207).

**Recommandation** : déjà couvert par T-263 R1 (alourdir la mention
in-situ ou compléter via la politique conf — arbitrage Romain).

### Critère 2 — Finalités

| Source | Contenu |
|---|---|
| **Registre T-208 § 3** | Calcul de distance "à vol d'oiseau" consumer↔producteur ; comparaison pédagogique avec circuit long ~1500 km. |
| **Mention in-situ** | `pour calculer la distance` — formulation courte mais explicite. |

**Verdict** : ✅ **Cohérent**. La mention in-situ couvre la finalité
principale. La finalité accessoire (comparaison ~1500 km) est exposée
visuellement par le widget lui-même (DistanceResult), sans nécessiter
une mention textuelle dédiée dans la PrivacyNote.

### Critère 3 — Base légale

| Source | Contenu |
|---|---|
| **Registre T-208 § 4** | Intérêt légitime (art. 6.1.f) + double opt-in pour la géoloc (consentement OS/navigateur). Justification détaillée. |
| **Mention in-situ** | Aucune mention explicite de la base légale. |

**Verdict** : ⚠️ **Écart mineur (E1)**. Art. 13.1.c RGPD impose la
mention de la base légale. Toutefois, la pratique communément admise
en France (CNIL) est que cette précision peut figurer dans la politique
de confidentialité globale plutôt que dans chaque mention in-situ.

**Recommandation** : déjà couvert par T-263 R2 (formaliser dans
`/politique-confidentialite` lors de la livraison T-207). Pas
d'alourdissement de la mention in-situ recommandé.

### Critère 4 — Destinataires / sous-traitants

| Source | Contenu |
|---|---|
| **Registre T-208 § 7** | Aucun destinataire pour les coords (géoloc OS) ; TerrOir + `api-adresse.data.gouv.fr` pour le CP. |
| **Mention in-situ** | `[ta position] reste dans ton navigateur […] elle n'est jamais associée à ton compte ni à ta visite côté serveur. La saisie d'un code postal transite via TerrOir (cache anonyme du couple code postal → coordonnées commune) vers le service public api-adresse.data.gouv.fr.` |

**Verdict** : ✅ **Cohérent**. Les 2 destinataires distincts sont
correctement énumérés in-situ (TerrOir + api-adresse.data.gouv.fr). La
qualification "service public" pour `api-adresse.data.gouv.fr` est
conforme registre (sous-traitant open data, pas de contrat dédié).

### Critère 5 — Transferts hors UE

| Source | Contenu |
|---|---|
| **Registre T-208 § 8** | Aucun (Vercel France, Supabase EU Frankfurt, api-adresse.data.gouv.fr France). |
| **Mention in-situ** | Pas de mention explicite "tout reste en UE" mais aucune mention non plus de transfert hors UE. |

**Verdict** : ✅ **Cohérent**. L'absence de transfert hors UE n'a pas
besoin d'être mentionnée explicitement (par défaut). Un transfert hors
UE FUTUR (ex. PostHog Cloud US si décidé sans self-host) déclencherait
une obligation d'information explicite — articulation
`docs/conventions/garde-fou-autocompletion-cp.md` (T-275).

### Critère 6 — Durée de conservation

| Source | Contenu |
|---|---|
| **Registre T-208 § 9** | Navigateur consumer = sessionStorage purge fermeture onglet ; serveur TerrOir = pas de conservation per-user (cache geocode_cache anonyme indéfini) ; api-adresse.data.gouv.fr = selon politique du service public. |
| **Mention in-situ** | `[ta position] reste dans ton navigateur (stockage de session, effacé à la fermeture de l'onglet)` ; `cache anonyme du couple code postal → coordonnées commune` (côté TerrOir). |

**Verdict** : ✅ **Cohérent**. Les 2 durées (navigateur + cache TerrOir
anonyme) sont fidèlement décrites in-situ. La durée côté
api-adresse.data.gouv.fr n'est pas mentionnée — acceptable car c'est
hors scope TerrOir (responsabilité du service public).

### Critère 7 — Droits des personnes

| Source | Contenu |
|---|---|
| **Registre T-208 § 13** | Opposition (ne pas saisir), effacement automatique (fermeture onglet ou bouton "Changer ma position"), accès/rectification/portabilité non applicable (pas de donnée nominative serveur), réclamation CNIL standard. |
| **Mention in-situ** | `Saisie facultative` couvre droit d'opposition. Bouton "Changer ma position" sur DistanceResult couvre droit à l'effacement. Pas de mention explicite des autres droits. |

**Verdict** : ✅ **Cohérent**. Les 2 droits applicables (opposition +
effacement) sont matérialisés in-situ via le pattern UX. Les autres
droits (accès, rectification, portabilité, limitation) sont non
applicables (pas de donnée nominative côté serveur — registre § 13).
Pas besoin de les mentionner in-situ.

→ Recommandation : à la livraison T-207, la politique conf globale
mentionnera tous les droits transverses (compte consumer, etc.) — la
mention in-situ widget peut alors lier vers la section dédiée.

### Critère 8 — Existence de décision automatisée

| Source | Contenu |
|---|---|
| **Registre T-208 § 14** | Non. |
| **Mention in-situ** | Pas de mention. |

**Verdict** : ✅ **Cohérent**. Si décision automatisée → mention
obligatoire art. 13.2.f. Comme il n'y en a pas, pas de mention requise.

---

## Tableau récap

| Critère | Registre T-208 | Mention in-situ | Verdict |
|---|---|---|---|
| 1. Responsable | TerrOir explicite | Mentionné indirectement | ⚠️ E2 |
| 2. Finalités | Calcul distance + comparaison | Calcul distance | ✅ |
| 3. Base légale | Intérêt légitime + consentement OS géoloc | Implicite | ⚠️ E1 |
| 4. Destinataires | TerrOir + api-adresse.data.gouv.fr | TerrOir + api-adresse.data.gouv.fr | ✅ |
| 5. Transferts hors UE | Aucun | Implicite | ✅ |
| 6. Durée conservation | sessionStorage + cache anonyme | sessionStorage + cache anonyme | ✅ |
| 7. Droits personnes | Opposition + effacement applicables | Opposition + effacement matérialisés | ✅ |
| 8. Décision automatisée | Non | Non | ✅ |

→ **6/8 critères ✅ cohérents** ; 2/8 critères ⚠️ écarts mineurs E1 + E2.

---

## Findings

### F1. Pas de contradiction sémantique
Aucun écart où le registre dirait une chose et la mention in-situ
dirait l'inverse. Les écarts identifiés sont uniquement des
**précisions formelles** présentes dans le registre mais absentes (ou
implicites) in-situ.

### F2. Pas d'omission grave
Les 4 grandes finalités obligatoires art. 13 (a, b, c, d cf. T-263 § W9
verdict) sont couvertes par la mention in-situ.

### F3. La pratique "info détaillée dans politique conf, mention courte
in-situ" est conforme CNIL
La CNIL accepte (et recommande même) que la mention in-situ reste
courte / lisible, à condition qu'un lien vers la politique conf
globale soit accessible. Le commentaire `DistanceWidget.tsx:407-409`
documente que ce lien est volontairement retiré tant que T-207 n'est
pas livré.

→ La cohérence opérationnelle nécessite la livraison conjointe
T-207 + T-208 + T-263 R3.

---

## Recommandations

### R1. Acter le bundle T-207 + T-263 R1+R2+R3 + T-208 en pré-Live
**Priorité** : haute (clôt les écarts E1 + E2 + E3 d'un coup).

Bundle minimal pour fermeture définitive de T-248 :
- **T-207** : livraison politique conf avec section dédiée
  `#widget-distance` (formalise responsable, base légale, durées,
  droits transverses).
- **T-263 R1** : ajouter responsable de traitement explicite (in-situ
  ou via lien politique conf — arbitrage Romain).
- **T-263 R2** : préciser base légale (intérêt légitime) dans
  politique conf.
- **T-263 R3** : ré-intégrer `<Link>` vers `/politique-confidentialite#
  widget-distance` dans `PrivacyNote`.
- **T-208** : valider entrée registre par juriste / DPO (livré ce
  cycle, validation externe à venir).

→ **Bloquant Live** au sens du checklist pré-Live (cluster T-261).

### R2. Procédure de synchronisation registre ↔ mention in-situ
**Priorité** : moyenne (post-Live, pour pérenniser la cohérence).

Toute future modification de :
- Wording `PrivacyNote` (composant `DistanceWidget`),
- ou entrée registre T-208,
- ou politique conf section `#widget-distance`,

doit déclencher une revue de la cohérence des 3 sources. À documenter
dans le process de revue PR :

> **Process** : modification d'un wording RGPD widget = checkbox
> "Cohérence T-208 ↔ T-263 ↔ T-207 vérifiée" dans le PR description.

→ Non bloquant pré-Live. Convention organisationnelle.

### R3. Test contractuel cross-doc (optionnel)
**Priorité** : faible (sur-engineering possible).

Possibilité d'écrire un test qui parse les 3 fichiers (registre +
DistanceWidget.tsx + politique conf future) et vérifie la présence de
mots-clés cohérents (ex. "sessionStorage", "api-adresse.data.gouv.fr").
Coût/bénéfice discutable pour un repo de cette taille — recommandation
optionnelle.

---

## Cross-références

- `docs/security/registre-traitements-widget-distance-2026-05-06.md`
  (T-208) — registre source.
- `docs/security/revue-wording-distancewidget-2026-05-06.md` (T-263) —
  revue wording in-situ + recommandations R1+R2+R3.
- `docs/security/validation-pattern-disclosure-rgpd-2026-05-06.md`
  (T-272) — validation pattern UX art. 13.
- `app/(public)/producteurs/[slug]/_components/DistanceWidget.tsx:410-420`
  — composant `PrivacyNote`.
- **Tasks liées** :
  - T-207 (politique conf — prérequis bundle R1).
  - T-208 (registre — co-validation juriste).
  - T-263 (revue wording — recommandations alignées).
  - T-272 (pattern UX — déjà clos).

---

## Conclusion

T-248 ✅ — la cohérence sémantique entre le registre RGPD T-208 et la
mention in-situ `PrivacyNote` est globalement bonne (6/8 critères
parfaitement alignés). Les 2 écarts mineurs (E1 base légale implicite,
E2 responsable mentionné indirectement) sont acceptables in-situ et
seront formellement clôturés à la livraison du bundle T-207 + T-263
R1+R2+R3 (bloquants Live cluster T-261).
