# Registre des traitements RGPD — Widget distance — T-208

> **Cluster** : T-261 (RGPD pré-Live consolidé) / T-200 r1 (doctrine privacy).
> **Source** : RGPD article 30 (registre des activités de traitement).
> **Statut** : entrée du registre TerrOir, à intégrer dans le registre
> central au moment de sa formalisation (chantier juridique post-Live).
> **Audience** : juriste / DPO / autorité de contrôle (CNIL).
> **Date** : 2026-05-06.

---

## Note préalable

Le **widget distance** affiche au consumer la distance « à vol d'oiseau »
entre sa position et l'adresse d'un producteur. La donnée traitée ne
quitte pas le navigateur (sauf le code postal saisi, transmis via
TerrOir au géocodeur public `api-adresse.data.gouv.fr`).

Bien que la donnée ne sorte pas du navigateur, **l'inscription au
registre RGPD est obligatoire** pour tout traitement de données
personnelles, indépendamment de leur localisation technique (art. 30
RGPD).

---

## Fiche registre

### 1. Identité du responsable de traitement
- **Raison sociale** : TerrOir (à compléter — forme juridique à
  finaliser pré-Live).
- **Représentant légal** : Romain Lubin.
- **Adresse postale** : (à compléter — siège social).
- **Coordonnées contact RGPD** : (à compléter — adresse mail dédiée
  privacy@terroir-local.fr ou similaire).
- **Sous-traitant éventuel mandaté** : (à compléter — DPO externe ou
  responsable interne).

### 2. Nom du traitement
**Calcul de distance « à vol d'oiseau » consumer ↔ producteur**
(widget distance fiche producteur publique).

### 3. Finalités
- **Finalité principale** : informer le consumer de la distance
  approximative entre sa position et l'adresse d'un producteur, pour
  l'aider à apprécier le caractère "circuit court" de la fiche
  consultée.
- **Finalité accessoire** : fournir une comparaison visuelle avec la
  distance moyenne en circuit long (~1500 km, source ADEME) à des
  fins pédagogiques.

### 4. Base légale du traitement
**Intérêt légitime** (art. 6.1.f RGPD).

**Justification** :
- Finalité non intrusive (information utilisateur, pas de profilage).
- Donnée non transmise au serveur (sessionStorage navigateur seul).
- Pas de croisement avec d'autres traitements TerrOir (pas de
  jointure consumer_id ↔ géoloc).
- Bénéfice utilisateur direct (aide à la décision d'achat short-circuit).
- Consumer peut choisir de ne pas saisir (saisie facultative,
  formulée explicitement dans le wording in-situ).

**Pour la sous-fonctionnalité "géolocalisation navigateur"** : double
opt-in matérialisé par (a) clic CTA "Utiliser ma position" + (b) prompt
navigateur natif. Le prompt navigateur est un consentement RGPD au sens
strict (art. 6.1.a + art. 7), géré par le système d'exploitation /
navigateur de l'utilisateur.

### 5. Catégories de personnes concernées
- **Visiteurs anonymes** de la fiche producteur publique
  (`/producteurs/[slug]`).
- **Consumers authentifiés** consultant la même fiche.

Aucun lien systématique n'est fait entre la donnée traitée et l'identité
du visiteur authentifié — la donnée géo reste strictement dans le
sessionStorage du navigateur, jamais associée au compte côté serveur.

### 6. Catégories de données collectées
- **Code postal saisi** (5 chiffres, format `^\d{5}$`) — donnée
  publique INSEE, fournie volontairement par l'utilisateur.
- **Coordonnées géographiques (latitude, longitude)** — soit issues de
  la géolocalisation du navigateur (consentement OS), soit calculées par
  résolution du CP saisi (centre INSEE de la commune principale).
- **Distance calculée** — résultat du calcul Haversine côté navigateur.

**Aucune autre donnée** : pas d'IP loggée par-utilisateur, pas
d'identifiant utilisateur joint, pas d'adresse postale consumer, pas
de téléphone, pas d'email.

**Catégorisation** :
- CP saisi : donnée à caractère public (référentiel INSEE), pondération
  faible.
- Coordonnées : données de géolocalisation (catégorie sensible si
  joint à un identifiant — ici elles ne le sont pas).
- Distance : donnée dérivée non personnelle (résultat de calcul).

### 7. Destinataires des données
- **Aucun** pour les coordonnées calculées (géoloc OS) — la donnée ne
  quitte pas le navigateur de l'utilisateur.
- **TerrOir (responsable de traitement)** pour le CP saisi qui transite
  via le serveur TerrOir avant d'être éventuellement transmis au
  géocodeur public.
- **`api-adresse.data.gouv.fr`** (sous-traitant) pour le CP saisi en
  cas de cache miss côté TerrOir. Service public open data, pas de
  contrat de sous-traitance dédié (réquisition open data).

### 8. Transferts hors UE
**Aucun**. Tous les services impliqués sont européens :
- Serveur TerrOir : Vercel France (PAR1) / Supabase EU (Frankfurt).
- `api-adresse.data.gouv.fr` : service public français hébergé en France.
- Pas de tracker analytics tiers extra-UE (cf. T-265).

### 9. Durée de conservation
- **Côté navigateur** : sessionStorage, **purge à la fermeture de
  l'onglet** (durée typique : quelques minutes à quelques heures).
- **Côté serveur TerrOir** : pas de conservation per-user. Cache
  géocodage (`geocode_cache`) stocke uniquement la résolution
  CP→coords sans lien utilisateur, conservation indéfinie (donnée
  publique INSEE).
- **Côté `api-adresse.data.gouv.fr`** : selon la politique du service
  public (cf.
  [https://adresse.data.gouv.fr/donnees-personnelles](https://adresse.data.gouv.fr/donnees-personnelles)).

### 10. Mesures de sécurité techniques

#### Protection des données en transit
- **HTTPS obligatoire** (HSTS + `upgrade-insecure-requests` CSP).
- **CSP `connect-src` restrictif** (cf. T-264 :
  `docs/security/csp-audit-t-264-2026-05-06.md`) — empêche
  l'exfiltration des données géo vers un serveur attacker-controllé en
  cas d'XSS futur.

#### Protection des données stockées
- **sessionStorage scopé par origine** (T-276) — isolation cross-
  subdomain garantie par le navigateur.
- **Validation défensive lecture sessionStorage** (T-239+T-240 r3)
  — rejet des données corrompues / hors plages WGS84.
- **Préfixe lint `terroir_` opposable** (T-266) — auditabilité des clés
  storage.

#### Protection contre le profilage server-side
- **Aucun log applicatif du CP saisi** (T-249) — `audit_logs`,
  `notifications`, Resend metadata, Stripe metadata exempts.
- **Pas de jointure user→cp** côté DB (cluster T-200 r1).
- **hit_count agrégé anonyme** dans `geocode_cache` — pas de table
  jointure user↔CP.

#### Anti-trilatération inverse
- **Coords producteur floutées 2 décimales (~1 km)** (cf.
  `lib/producers/coords.ts`).
- **Rate-limit 30/min/IP** sur `/api/producers/search` (T-236) et
  `/api/geocode` (T-219).

### 11. Mesures de sécurité organisationnelles
- **Doctrine T-200 r1** consolidée dans `CLAUDE.md` § Doctrine privacy.
- **Doctrine opposable T-275** sur tout futur endpoint manipulant un CP
  (`docs/conventions/garde-fou-autocompletion-cp.md`).
- **Process audit T-261** (cluster RGPD pré-Live) — 12 items P0 en
  checklist.
- **Audit externe T-003** programmé pré-ouverture publique (1-2
  semaines, ~2-4 k€).

### 12. Information des personnes concernées
**Information au point de collecte** (art. 13 RGPD) — composant
`PrivacyNote` du DistanceWidget, visible immédiatement à l'expansion
du panneau (avant toute action de collecte).

**Wording in-situ actuel** (cf.
`app/(public)/producteurs/[slug]/_components/DistanceWidget.tsx:410-420`) :

> Saisie facultative — la fiche du producteur reste consultable sans. Ta
> position (géoloc ou résolue depuis ton code postal) reste dans ton
> navigateur (stockage de session, effacé à la fermeture de l'onglet)
> pour calculer la distance ; elle n'est jamais associée à ton compte
> ni à ta visite côté serveur. La saisie d'un code postal transite via
> TerrOir (cache anonyme du couple code postal → coordonnées commune)
> vers le service public api-adresse.data.gouv.fr.

**Articulation T-263** (revue wording) : 4 améliorations recommandées
non bloquantes (cf.
`docs/security/revue-wording-distancewidget-2026-05-06.md`).

**Articulation T-272** (validation pattern disclosure) : ordre
d'apparition mention RGPD → action de collecte vérifié conforme art. 13
(cf. `docs/security/validation-pattern-disclosure-rgpd-2026-05-06.md`).

**Information complémentaire** (à compléter post-livraison T-207) :
section dédiée "Widget distance" dans la politique de confidentialité
globale `/politique-confidentialite#widget-distance`.

### 13. Droits des personnes concernées
- **Droit d'opposition** : ne pas saisir = ne pas être traité.
  Saisie facultative.
- **Droit à l'effacement** : automatique à la fermeture de l'onglet
  (sessionStorage). Bouton "Changer ma position" déclenche un
  effacement immédiat (`removeItem`).
- **Droit d'accès / rectification / portabilité** : non applicable —
  pas de donnée nominative stockée par TerrOir côté serveur. La donnée
  reste sur le navigateur de l'utilisateur lui-même.
- **Droit à la limitation** : non applicable.
- **Droit de réclamation auprès de la CNIL** : possible, contact
  CNIL standard.

### 14. Existence d'une décision automatisée
**Non** (pas de profilage, pas de scoring, pas de décision
algorithmique au sens art. 22 RGPD).

### 15. Analyses d'impact (DPIA / AIPD)
**Non requise**. Critères CNIL (au moins 2/9) :
- ❌ Évaluation / scoring : non.
- ❌ Décision automatique avec effet juridique : non.
- ❌ Surveillance systématique : non.
- ❌ Données sensibles ou hautement personnelles : non (CP est public).
- ❌ Données traitées à grande échelle : oui (potentiellement, si
  audience croît).
- ❌ Croisement de données : non.
- ❌ Personnes vulnérables : non.
- ❌ Usage innovant ou nouveau : non (calcul distance standard).
- ❌ Empêchement d'exercer un droit / contrat : non.

→ Un seul critère potentiellement applicable (échelle), pas de DPIA
requise. À ré-évaluer si TerrOir scale au-delà de la Sarthe.

---

## Articulation avec autres entrées du registre

### Cohérence avec entrée "Compte consumer"
Le widget distance ne crée **aucun lien** avec l'entrée "Compte
consumer" (qui couvre `users`, `consumers`, `auth.users`). Pas de
colonne `last_known_cp`, pas d'historique recherche. Cf. règle 3 du
garde-fou T-275.

### Cohérence avec entrée "Compte producteur"
Le widget distance utilise les coords floutées du producteur (champ
`producers.latitude` / `producers.longitude` arrondi à 2 décimales).
L'entrée "Compte producteur" doit elle-même documenter le caractère
public floué de cette donnée (vs adresse personnelle saisie à
l'onboarding qui reste interne sauf publication consciente sur fiche
produit, cf. T-254 R1).

### Cohérence avec entrée "Cache géocodage"
La table `geocode_cache` est documentée comme table technique de
cache, sans donnée personnelle (CP = public INSEE, hit_count agrégé
anonyme). Pas de jointure user→cp. Cohérent avec T-200 r1.

### Cohérence avec entrée "Trackers analytics"
Vercel Analytics + Speed Insights captent uniquement métriques
techniques agrégées. Pas de capture du widget. Cf. T-265.

---

## Maintenance de cette fiche

- À ré-éditer si :
  - Le wording in-situ change (Cf. T-263 améliorations).
  - Le sous-traitant géocodeur change (T-204 / T-226 backlog scaling).
  - Une nouvelle catégorie de donnée est introduite (ex. autocomplétion
    CP → cf. garde-fou T-275).
  - L'audience scale au-delà de la Sarthe (DPIA à ré-évaluer).
- Validation initiale par juriste / DPO requise avant Live.
- Articulation T-248 (cohérence registre ↔ mention in-situ) : tout
  changement à l'une doit déclencher revue de l'autre.

---

## Cross-références

- `docs/security/audit-logs-serveur-non-capture-cp-coords-2026-05-06.md`
  (T-249) — sécurité technique côté serveur.
- `docs/security/audit-sessionstorage-non-fuite-tiers-2026-05-06.md`
  (T-253) — sécurité technique côté navigateur.
- `docs/security/csp-audit-t-264-2026-05-06.md` (T-264) — anti-
  exfiltration via CSP.
- `docs/security/audit-trackers-front-exclusion-cp-2026-05-06.md`
  (T-265) — non-capture trackers front.
- `docs/security/scoping-terroir-geo-session-2026-05-06.md` (T-276)
  — isolation cross-subdomain.
- `docs/security/validation-pattern-disclosure-rgpd-2026-05-06.md`
  (T-272) — validation pattern UX art. 13.
- `docs/security/revue-wording-distancewidget-2026-05-06.md` (T-263)
  — revue wording in-situ.
- `docs/conventions/methodologie-distance-haversine.md` (T-242) —
  méthodologie technique.
- `docs/conventions/garde-fou-autocompletion-cp.md` (T-275) — doctrine
  opposable futurs endpoints CP.
- **Tasks liées** :
  - T-248 (cohérence registre ↔ mention in-situ).
  - T-207 (politique conf — section dédiée à publier).
  - T-262 (CGU/CGV pré-Live — articulation).
- **Standards externes** : RGPD art. 30 — registre des activités de
  traitement.
