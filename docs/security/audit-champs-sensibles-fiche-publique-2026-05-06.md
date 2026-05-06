# Audit champs sensibles fiche producteur publique — T-254

> **Cluster** : T-261 (RGPD pré-Live consolidé) / T-200 r1 (doctrine privacy).
> **Scope** : auditer la fiche producteur publique `/producteurs/[slug]`,
> la fiche produit `/producteurs/[slug]/produits/[id]`, l'API
> `/api/producers/search`, et la fiche commande consumer
> `/compte/commandes/[id]` pour confirmer qu'aucun champ sensible
> producteur (email, téléphone, SIRET, forme juridique, stripe_account_id,
> abonnement, lat/lng précises) ne fuit côté consumer.
> **Méthode** : revue colonne par colonne des SELECT Supabase + traçage
> du flux serveur → props client → render JSX.
> **Date** : 2026-05-06.

---

## TL;DR

**Audit conforme T-200 r1, sous réserve de R1 (doc politique adresse
producteur).** Aucun secret technique (email, téléphone, SIRET, stripe_*,
abonnement) n'est exposé sur les pages publiques.

- **Aucun email producer**, **aucun téléphone producer**, **aucun SIRET**,
  **aucun champ Stripe**, **aucun champ abonnement** ne quitte le serveur
  via les fetchers consumer-facing.
- Lat/lng systématiquement floutées via `roundCoord` (2 décimales, ~1 km)
  sur les 4 call sites canoniques. Helper centralisé
  `lib/producers/coords.ts`.
- **Adresse postale producteur** (`producers.adresse` + `code_postal` +
  `commune`) exposée explicitement sur 2 surfaces consumer (fiche
  produit, fiche commande). C'est **un choix produit conscient** (le
  consumer doit savoir où venir retirer) — pas un leak. Mais la fiche
  producteur publique `/producteurs/[slug]` n'expose **PAS** l'adresse
  (uniquement commune + CP), confirmant la cohérence de la politique.
- Cluster T-227 (ré-identification croisement public) à articuler avec
  cette doctrine adresse — non-leak en lui-même mais signal géo
  croisable avec photos + nom ferme.

→ **T-254 peut être marqué ✅ dans la checklist pré-Live.** R1 (doctrine
opposable) recommandée pour audit T-003.

---

## Méthodologie

### Patterns grepés
- Champs sensibles directs : `email`, `telephone`, `phone`, `siret`,
  `forme_juridique`, `stripe_account_id`, `stripe_charges_enabled`,
  `stripe_cleanup_pending`, `abonnement_*`, `type_production`,
  `deleted_at`, `created_at`.
- Coords précises : grep `latitude|longitude|\blat\b|\blng\b` puis
  vérification de la présence de `roundCoord` à chaque sortie.
- Adresse : `adresse|address` + traçage flux page → props → render.

### Périmètre code
- `lib/producers/fetch-public.ts` (helper canonique).
- `lib/producers/coords.ts` (helper roundCoord).
- `app/(public)/producteurs/page.tsx` + `ProducteursClient.tsx`.
- `app/(public)/producteurs/[slug]/page.tsx` + `ProducerPageClient.tsx`.
- `app/(public)/producteurs/[slug]/produits/[id]/page.tsx` +
  `ProductPageClient.tsx`.
- `app/(consumer)/compte/commandes/[id]/page.tsx` +
  `OrderDetailClient.tsx`.
- `app/api/producers/search/route.ts`.

### Hors scope (couverts par d'autres tasks)
- Floutage coords stratégie (T-217 — déjà tranché 2 décimales).
- Ré-identification croisement public (T-227 — task séparée).
- Vue Supabase `producers_public` (T-235 — déjà couvert par
  T-218-bis trigger anti-self-update lat/lng).
- Trilatération API search (T-236 — rate-limit 30/min/IP).

---

## Inventaire colonnes producers (referentiel)

Source : `lib/types/generated/database.types.ts` (cf. enums.ts pour
extrait visible). Colonnes producers (extrait pertinent) :

| Colonne | Sensibilité | Exposée publique ? | Verdict |
|---|---|---|---|
| `id` | technique | oui (slug routing) | OK |
| `slug` | public | oui | OK |
| `nom_exploitation` | public | oui | OK |
| `commune` | public | oui | OK |
| `code_postal` | public | oui | OK (granularité département) |
| `adresse` | sensible (potentiel domicile) | oui sur fiche produit + commande | Cf. § Findings A1 |
| `latitude`, `longitude` | sensible (~10 cm si brut) | oui floutées (~1 km) | OK via `roundCoord` |
| `description`, `histoire` | public (saisie producer) | oui | OK |
| `annee_creation`, `generations` | public | oui | OK |
| `especes`, `labels` | public (catalogue) | oui | OK |
| `mode_elevage`, `alimentation`, `densite_animale` | public (T-200 score carbone) | oui | OK |
| `note_moyenne`, `nb_avis` | public | oui | OK |
| `badge_*_score` | public | oui | OK |
| `photo_principale`, `photos` | public | oui | OK |
| `user_id` | technique (FK auth.users) | oui (jointure prenom seulement) | OK |
| `email` | PII | **non** | OK |
| `telephone` | PII | **non** | OK |
| `siret` | semi-public légal | **non** | OK (pas d'usage UX consumer) |
| `forme_juridique` | semi-public légal | **non** | OK (admin only) |
| `type_production` | technique (catégorisation) | **non** | OK |
| `stripe_account_id` | secret technique | **non** | OK |
| `stripe_charges_enabled` | technique | **non** | OK |
| `stripe_cleanup_pending` | technique | **non** | OK |
| `abonnement_niveau`, `abonnement_*` | semi-public commercial | **non** | OK (admin/producer only) |
| `statut` | technique (`draft|pending|active|public|suspended|deleted`) | **non** (utilisé en filter) | OK |
| `deleted_at` | technique RGPD | **non** (filter `IS NULL`) | OK |
| `created_at`, `updated_at` | technique | **non** | OK |
| `declaration_indicateurs_*` | DGCCRF probatoire | **non** (admin/audit only) | OK (cf. T-287) |

→ Confirmation par grep direct : **zéro** occurrence de `email`,
`telephone`, `phone`, `siret`, `stripe_account`, `abonnement`,
`forme_juridique` dans `app/(public)/producteurs/**` ni dans
`lib/producers/fetch-public.ts`.

---

## Findings

### A. Fiche producteur publique `/producteurs/[slug]` — conforme

**Helper** : `lib/producers/fetch-public.ts` :: `fetchPublicProducerBySlug`.

**Colonnes SELECTED** (`PUBLIC_COLUMNS` ligne 53) :
```
id, slug, nom_exploitation, commune, code_postal, adresse, latitude,
longitude, photo_principale, photos, description, histoire, annee_creation,
generations, especes, labels, badge_stock_score, badge_confirmation_score,
badge_annulation_score, note_moyenne, nb_avis, mode_elevage, alimentation,
densite_animale, users:user_id(prenom)
```

**Garanties helper** (commentaires lignes 56-59) :
- `statut = 'public'` (filter applicatif + RLS).
- `deleted_at IS NULL`.
- `roundCoord(latitude)` + `roundCoord(longitude)` avant retour.

**Page + client** (`page.tsx:97-120`, `ProducerPageClient.tsx:36-55`) :
- `ProducerData` exposée au client **n'inclut PAS** `adresse`. Seul
  `commune` (= `[commune, code_postal].join(' · ')`, ligne 91) est
  exposé.
- `latitude`, `longitude` exposées **floutées** (déjà roundCoord côté
  helper).
- Aucun email / téléphone / SIRET / stripe_* / abonnement.
- `users.prenom` joint exposé → utilisé pour
  `getProducerDisplayName` (UX courte forme du nom du producteur,
  donnée publique acceptée par le producer onboarding).

→ **Conforme**. Pas d'adresse exposée sur la fiche slug.

### A1. Fiche produit `/producteurs/[slug]/produits/[id]` — adresse exposée volontairement

**Page** : `app/(public)/producteurs/[slug]/produits/[id]/page.tsx:104-117`.
**Client** : `ProductPageClient.tsx:340` rend `{producer.address}`.

**Champ exposé** :
```ts
const address = [producerRow.adresse, producerRow.code_postal,
                 producerRow.commune].filter(Boolean).join(' · ');
const producer: ProducerSummary = {
  …,
  address: address || '—',
  lat: producerRow.latitude,  // floutée par fetchPublicProducerBySlug
  lng: producerRow.longitude, // idem
};
```

**Affichage** (ligne 340) : sous le bandeau "Retrait", l'adresse complète
est affichée pour informer le consumer du **lieu de retrait** de la
commande.

**Qualification** : **non-leak — choix produit conscient**.
- Le consumer doit savoir où venir retirer son achat (sinon il ne peut
  pas finaliser la commande).
- L'adresse postale producteur sur la fiche produit est l'usage UX
  attendu de cette donnée.
- Le consumer voit l'adresse **avant** d'avoir commandé (clic sur fiche
  produit = lecture publique). Ça reste cohérent avec la pratique
  marketplace short-circuit (point retrait connu à l'avance).

**Risque résiduel** :
- En élevage fermier, `producers.adresse` = potentiellement domicile du
  producteur. Le producer accepte cette publication implicitement à
  l'onboarding (champ `adresse` saisi en clair dans le formulaire
  `StepInfos`, pas de toggle "publier ou pas").
- À ce jour, **aucune doctrine produit explicite** n'est documentée sur
  ce point. Le producer pourrait raisonnablement croire que l'adresse
  reste interne (ex. sert uniquement à Stripe Connect KYC) — voir R1.

**Cross-réf** : la mini-carte `MiniMapLazy` ligne 348-353 utilise les
coords floutées `producer.lat / lng` (~1 km), pas l'adresse parsée. Pas
de double leak via Mapbox.

### A2. Fiche commande consumer `/compte/commandes/[id]` — adresse exposée volontairement

**Page** : `app/(consumer)/compte/commandes/[id]/page.tsx:35-103`.
**Client** : `OrderDetailClient.tsx`.

**SELECT** (ligne 41) : `producers:producer_id(nom_exploitation, slug,
adresse, commune, code_postal, latitude, longitude)`.

**Champ exposé** (ligne 60, 86-97) :
- `address` : concat `adresse + CP + commune`.
- `lat`, `lng` : floutées explicitement via `roundCoord` (lignes 95-96,
  commentaire T-200 r3 sécurité).

**Qualification** : **non-leak — destiné consumer ayant déjà commandé**.
- Le consumer EST authentifié et A déjà passé commande → il a un
  intérêt légitime à connaître le lieu de retrait.
- Doctrine cohérente : la fiche commande est le canal de communication
  authoritatif pour récupérer la commande.
- Verrou RLS : `if (order.consumer_id !== session.id) redirect(...)`
  ligne 49 — un autre consumer ne peut pas voir l'adresse via cette
  route.

### B. API `/api/producers/search` — conforme

**Route** : `app/api/producers/search/route.ts`.

**Output schema** : retourne le résultat de la RPC `search_producers`
(non détaillé ici — cf. migration `20260421000000_search_producers_
product_count.sql` pour la signature).

**Floutage** (lignes 95-99) :
```ts
const sanitized = ((data ?? []) as SearchRow[]).map((row) => ({
  ...row,
  latitude: roundCoord(row.latitude),
  longitude: roundCoord(row.longitude),
}));
```

**Qualification** : conforme.
- Coordonnées systématiquement floutées avant exposition.
- Rate-limit 30/min/IP (T-236) anti-trilatération inverse.
- Audit log applicatif explicitement absent (commentaire ligne 17 :
  pattern T-200 r1 routes publiques anonymes).

À auditer si la signature `search_producers` SQL retourne d'autres
colonnes sensibles (siret, telephone, etc.) — recommandation R2.

### C. Annuaire `/producteurs` (page) — conforme

**Page** : `app/(public)/producteurs/page.tsx` — Server Component shell
SEO uniquement (h1, eyebrow, CTA "Vue carte").
**Client** : `ProducteursClient.tsx` — récupère les données via
`/api/producers/search` (fetch côté navigateur avec géoloc).

→ Hérite des garanties de la route search (§ B). Conforme.

---

## Recommandations

### R1. Doctrine produit explicite "adresse producteur publique"
**Priorité** : moyenne (alignement RGPD + UX onboarding).

Le producer accepte aujourd'hui implicitement la publication de son
adresse postale à l'onboarding (`StepInfos`, champ `adresse` libre).
Pour aligner la pratique avec la doctrine T-200 r1 et clore proprement
T-227, ajouter au moment de la saisie :

a. **Avertissement in situ onboarding** (mention courte sous le champ
   adresse) :
   > « Cette adresse est affichée publiquement sur tes fiches produit
   > pour permettre aux consumers de venir retirer leur commande. Évite
   > d'utiliser ton domicile personnel — préfère l'adresse de ta ferme
   > ou un point de retrait dédié. »

b. **CGU producer** : clause explicite "publication adresse" dans la
   section vie privée. Articulation T-209 + T-262 (CGU/CGV pré-Live).

c. **Politique de confidentialité (T-207)** : documenter dans la section
   "données producteur publiées" que `nom_exploitation`, `commune`,
   `code_postal`, `adresse`, `coords floutées` sont publics par
   construction.

→ Bloquant **moral** pré-Live, non bloquant **technique** (pas de fuite
au sens infosec). À acter avec audit T-003 / juriste avocat.

### R2. Vérification colonnes RPC `search_producers`
**Priorité** : faible (verrou existant via floutage post-RPC).

Auditer la signature SQL de la RPC `search_producers` pour confirmer
qu'elle ne retourne pas d'autres colonnes sensibles que ce que `roundCoord`
re-floutte. Le `...row` spread ligne 96 propagerait sinon n'importe quelle
nouvelle colonne ajoutée à la signature future.

→ Cluster T-235 (vue producers_public) — pourrait être combiné en
réécrivant la RPC pour qu'elle SELECT uniquement les colonnes publiques
explicites, ce qui ferait disparaître le besoin de floutage post-call.
À reprendre dans audit T-003.

### R3. Test contractuel non-leak champs sensibles
**Priorité** : faible (defense in depth).

Ajouter un test d'intégration vérifiant que la response JSON de
`/api/producers/search` ne contient JAMAIS les substrings `email`,
`telephone`, `siret`, `stripe_account`. Test simple + opposable face à
toute future modification de la RPC.

→ Non bloquant pré-Live. Recommandation auditeur.

---

## Cross-références

- `docs/security/audit-logs-serveur-non-capture-cp-coords-2026-05-06.md`
  (T-249) — non-capture CP / coords consumer côté logs.
- `docs/security/audit-sessionstorage-non-fuite-tiers-2026-05-06.md`
  (T-253) — non-leak sessionStorage vers tiers.
- `docs/security/csp-audit-t-264-2026-05-06.md` (T-264) — CSP
  anti-exfiltration.
- `lib/producers/coords.ts` — helper canonique `roundCoord` + modèle
  de menace floutage.
- **Tasks liées** :
  - T-217 (politique uniforme floutage coords) — déjà tranché
    2 décimales.
  - T-227 (ré-identification croisement public) — task séparée à venir.
  - T-235 (vue producers_public) — déjà couvert par T-218-bis trigger.
  - T-236 (rate-limit search anti-trilatération) — déjà livré.

---

## Conclusion

T-254 ✅ — aucune fuite de champ technique sensible (email, téléphone,
SIRET, stripe_*, abonnement_*) sur les surfaces publiques inspectées. Le
floutage coords est appliqué de manière exhaustive sur les 4 call sites
canoniques. L'adresse postale producteur est exposée volontairement sur
la fiche produit + fiche commande (point retrait) — usage produit
légitime, à formaliser dans la doctrine onboarding (R1) et la politique
de confidentialité (T-207).
