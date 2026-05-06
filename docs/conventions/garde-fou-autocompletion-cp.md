# Garde-fou doctrinal — autocomplétion CP futur — T-275

> **Cluster** : T-261 (RGPD pré-Live consolidé) / T-200 r1 (doctrine privacy).
> **Statut** : doctrine opposable en code review.
> **Audience** : tout dev TerrOir qui ajoute / modifie un endpoint
> manipulant un code postal saisi par un utilisateur (consumer ou
> producteur).
> **Date de fixation** : 2026-05-06.

---

## TL;DR

**Tout endpoint manipulant un CP utilisateur DOIT respecter ces 4 règles
opposables** :

1. **Pas de log serveur du CP saisi** — `console.*`, `audit_logs`,
   `notifications.metadata`, `Resend metadata`, `Stripe metadata` ne
   doivent jamais embarquer le CP en clair.
2. **Pas de CP en query string GET visible à un tracker / proxy** — pour
   tout futur endpoint d'autocomplétion / suggestion / recherche par CP,
   préférer un payload POST body. Exception unique : `/api/geocode`
   (déjà exposé en GET, dérogation documentée § Exceptions).
3. **Pas de persistance CP↔user** — pas de table jointure CP↔consumer_id,
   pas de profilage géo basé sur historique CP saisis.
4. **Traitement éphémère** — le CP saisi est consumé au moment du calcul
   (résolution → coords) puis libéré. Pas de cache du CP saisi côté
   client (state React déjà reset, cf. DistanceWidget.tsx:229), pas de
   cache CP↔user_id côté serveur.

---

## Contexte

Le CP français est **donnée publique INSEE** (cf. doctrine T-200 r1)
mais devient PII contextuelle dès qu'il est joint à un user_id ou à
une session identifiable. La doctrine TerrOir est de **traiter le CP
comme une donnée éphémère et anonyme**, jamais corrélée à un utilisateur
identifiable.

À date, un seul endpoint manipule des CP saisis utilisateur :
- `/api/geocode?cp=XXXXX` (T-219) — résolution CP → lat/lng pour
  DistanceWidget. Cf. exception § Exceptions ci-dessous.

Cette doctrine existe pour borner le risque sur **les futurs endpoints**
qui pourraient être tentés par :
- Autocomplétion CP (suggestion type "saisis 2 chiffres → liste les CPs
  du département").
- Recherche full-text « ferme près de 72000 ».
- Newsletter géo-targetée (« producers proches de ton CP »).
- Stats internes par bassin de chalandise (« combien de visites depuis
  CP X »).

Ces use cases sont **acceptables** sous réserve du respect strict des
4 règles ci-dessous.

---

## Règles opposables (avec rationale)

### Règle 1 — Pas de log serveur du CP saisi

**Surface concernée** :
- `console.log/warn/error/info/debug` côté serveur (Vercel function logs).
- INSERT `audit_logs` (cluster `auth_*`, `payment_*`,
  `admin_invite_*`, `pickup_*`, etc.).
- INSERT `notifications` avec `metadata` JSONB.
- `metadata` Resend (champ `metadata` du SDK `resend.emails.send`).
- `metadata` Stripe (champ `metadata` du SDK `stripe.paymentIntents.
  create`, etc.).

**Ce qui est interdit** :
```ts
// ❌ Interdit — CP en log serveur
console.log(`[GEOCODE] cp=${cp} resolved`);

// ❌ Interdit — CP en audit_logs metadata
logAuthEvent({ eventType: "geocode_attempt",
               metadata: { cp_saisi: cp } });

// ❌ Interdit — CP en Resend metadata
sendTemplate({ ..., metadata: { user_cp: "72000" } });

// ❌ Interdit — CP en Stripe metadata
stripe.paymentIntents.create({ amount, metadata: { delivery_cp: cp } });
```

**Ce qui est acceptable** :
```ts
// ✅ OK — log d'erreur sans CP
console.warn(`[GEOCODE_RATE_LIMIT] ip=${ip}`);

// ✅ OK — log avec CP redacted (préfixe département seul)
console.log(`[GEOCODE] cp_dept=${cp.slice(0, 2)}XXX status=resolved`);
```

**Rationale** : un log Vercel ou une row audit_logs joints à une IP /
session / user_id permet de reconstituer un graphe géographique du
visiteur. Doctrine T-200 r1 zéro profilage user.

**Doc d'audit existant** :
`docs/security/audit-logs-serveur-non-capture-cp-coords-2026-05-06.md`
(T-249) confirme la conformité actuelle (1 finding défensif § B1
borderline accepté).

### Règle 2 — Pas de CP en query string GET visible à un tracker / proxy

**Surface concernée** :
- URL d'un endpoint REST GET (`/api/x?cp=XXXXX`).
- URL d'une page consumer-facing (`/producteurs?cp=72000`).
- Referer HTTP transmis par le browser à un tracker tiers (Vercel
  Analytics, futur PostHog, etc.).
- Logs proxies HTTP intermédiaires (Vercel edge, CDN).

**Ce qui est interdit** :
```ts
// ❌ Interdit — futur endpoint d'autocomplétion en GET
// GET /api/cp/suggest?prefix=72
// (le préfixe seul est moins sensible que le CP entier mais reste
// traçable. Préférer POST.)

// ❌ Interdit — page consumer avec CP en query string
router.push(`/producteurs?cp=${userCp}`);
// (capturé par Vercel Analytics, indexé par crawlers, log proxies.)
```

**Ce qui est acceptable** :
```ts
// ✅ OK — POST body avec CP
fetch('/api/cp/suggest', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ prefix: '72' }),
});

// ✅ OK — pas de CP en URL, fetch interne uniquement
const result = await fetch('/api/producers/search', {
  method: 'POST', body: JSON.stringify({ cp, radius: 50 }),
});
```

**Rationale** : Vercel Analytics + futurs trackers analytics capturent
les pageviews URL + Referer. CP en query string GET = CP visible dans
le dashboard analytics + indexable par crawler + loggué par proxies CDN.

**Doc d'audit existant** :
`docs/security/audit-trackers-front-exclusion-cp-2026-05-06.md` (T-265)
confirme qu'aucune route consumer n'a actuellement de CP en query
string. Cette règle 2 borde la régression future.

### Règle 3 — Pas de persistance CP↔user

**Surface concernée** :
- Toute table Supabase qui joindrait `consumer_id` (ou `user_id`) +
  `code_postal` saisi.
- Toute colonne `last_search_cp`, `recent_cps`, etc. attachée à un
  user.
- Tout cache mémoire serveur (Redis, Upstash KV) keyé par `(user_id,
  cp)` ou inversement.

**Ce qui est interdit** :
```sql
-- ❌ Interdit
CREATE TABLE consumer_search_history (
  consumer_id uuid REFERENCES users(id),
  cp_searched text,
  searched_at timestamptz
);

-- ❌ Interdit
ALTER TABLE users ADD COLUMN last_known_cp text;
```

**Ce qui est acceptable** :
```sql
-- ✅ OK — cache CP→coords agrégé anonyme
CREATE TABLE geocode_cache (
  cp text PRIMARY KEY,
  lat double precision,
  lng double precision,
  hit_count int,           -- compteur agrégé, pas par-user
  last_hit_at timestamptz, -- timestamp agrégé, pas par-user
  source text
);
```

**Rationale** : la persistence CP↔user crée un graphe géographique du
visiteur exploitable (profilage, ré-identification croisement données
publiques cf. T-227). Le cache géocode_cache existant (T-219) reste
conforme : il est strictement keyé par CP, pas par user.

### Règle 4 — Traitement éphémère

**Surface concernée** :
- Le CP saisi vit dans le state React le temps de la saisie (input
  contrôlé), puis est consumé au moment du clic CTA.
- Après résolution serveur, le CP doit être **oublié** : pas re-stocké
  côté client (sessionStorage, localStorage, cookie), pas re-stocké
  côté serveur en cache joint à une session.

**Ce qui est interdit** :
```ts
// ❌ Interdit — re-stockage CP en sessionStorage
sessionStorage.setItem('terroir_last_cp', cp);

// ❌ Interdit — cache user-keyed côté serveur
await kv.set(`user:${userId}:lastCp`, cp);
```

**Ce qui est acceptable** :
```ts
// ✅ OK — reset state après usage
setPostalInput(""); // cf. DistanceWidget.tsx:229

// ✅ OK — cache CP→coords agrégé anonyme
await setCachedGeocode(cp, lat, lng); // pas de user_id keyed
```

**Rationale** : le CP saisi sert UNE fois (résoudre les coords). Le
re-stocker (même côté client, même côté serveur sous une clé
user-keyed) crée une persistance qui pourrait être exfiltrée par un
script tiers / accédée par un acteur interne abusif.

**Vérification existante** :
- DistanceWidget reset `postalInput` à `""` après succès
  (DistanceWidget.tsx:229).
- Test contractuel T-253 :
  `tests/app/producteurs/distance-widget-interactive.test.tsx:346-348`
  vérifie que le CP n'est PAS dans le sessionStorage post-usage.

---

## Exceptions documentées

### E1. `/api/geocode?cp=XXXXX` (GET, T-219)
**Statut** : exception unique, dérogation acceptée par cluster T-200 r1.

**Justification** :
- Endpoint API interne, pas une page consumer-facing.
- Vercel Analytics ne tracke pas les routes `/api/*` par défaut (cf.
  T-265).
- HTTP cache `Cache-Control: public, max-age=2592000, immutable` (30
  jours) bénéficie du caching CDN/browser quand le CP est en URL —
  serait perdu en POST.
- Rate-limit 30/min/IP (Upstash KV éphémère) borde l'énumération.

**Conditions de maintien de la dérogation** :
- Pas de log serveur du CP saisi (cf. T-249 finding § B1, recommandation
  R1 à acter pour border).
- Pas d'audit log applicatif (commentaire route ligne 19 :
  conforme T-200 r1).

**Tout futur endpoint similaire** doit motiver explicitement sa
dérogation OU passer en POST.

---

## Process opposable code review

### Checklist PR review (à intégrer si template PR existe)
Pour toute PR ajoutant / modifiant un endpoint manipulant un CP saisi :
- [ ] Aucun `console.*` ne logue le CP saisi (Règle 1).
- [ ] Aucune INSERT `audit_logs` / `notifications` / Resend / Stripe
      metadata n'embarque le CP (Règle 1).
- [ ] Si endpoint REST : POST body, pas GET querystring (Règle 2).
- [ ] Si table SQL nouvelle : pas de FK user_id ni consumer_id sur
      une row qui contient un CP saisi (Règle 3).
- [ ] Si state React / cache serveur : éphémère, pas re-stocké après
      usage (Règle 4).
- [ ] Si dérogation à l'une des 4 règles : justification écrite dans
      le PR description + cross-réf à ce doc.

### Test contractuel recommandé
Pour chaque nouvel endpoint CP :
```ts
it('ne logue pas le CP saisi côté serveur', async () => {
  const consoleSpy = vi.spyOn(console, 'log');
  await handlePostCp({ cp: '72000' });
  for (const call of consoleSpy.mock.calls) {
    expect(call.join(' ')).not.toContain('72000');
  }
});
```

---

## Cross-références

- `docs/security/audit-logs-serveur-non-capture-cp-coords-2026-05-06.md`
  (T-249) — audit côté serveur.
- `docs/security/audit-trackers-front-exclusion-cp-2026-05-06.md`
  (T-265) — audit côté trackers front.
- `docs/security/audit-sessionstorage-non-fuite-tiers-2026-05-06.md`
  (T-253) — audit sessionStorage.
- `docs/conventions/lint-storage-namespace-2026-05-06.md` (T-266) —
  lint préfixe `terroir_`.
- `lib/geo/geocode-cache.ts` — implémentation conforme exception E1.
- `lib/geo/geocode-postal-client.ts` — call site client conforme R4.
- `app/api/geocode/route.ts` — endpoint dérogation E1.

---

## Maintenance de cette doctrine

- Toute modification de cette doctrine requiert validation Romain.
- Toute nouvelle exception (E2, E3, …) doit être documentée § Exceptions
  avec justification écrite + conditions de maintien.
- Cas litigieux en code review : pingear team-lead Romain ou ouvrir un
  ticket d'arbitrage.
