# Audit migrations & cohérence schéma — 2026-05-05

**Source live** : MCP Supabase `read-write` sur prod (Postgres 17.6).
**Source repo** : `supabase/migrations/*.sql` — 50 fichiers, 6 436 lignes.
**Source tracker** : `supabase_migrations.schema_migrations` — 15 entrées.
**Périmètre** : schéma `public` (26 tables), RPCs (14 fonctions), idempotence, naming, ordre d'application, T-241 (à valider avant apply).

Cet audit se branche sur `audit-rls-2026-05-05.md` (déjà publié). Quand un finding chevauche, je renvoie au RLS et je couvre uniquement l'angle migration ici. Les findings RLS C-1/C-2 (RPC publiques sans `revoke execute`) sont rappelés dans la synthèse — leur fix passe par une nouvelle migration, donc relèvent aussi de cet audit.

---

## Synthèse priorisée

| Sévérité | # | Finding                                                                          |
|----------|---|----------------------------------------------------------------------------------|
| CRITICAL | 3 | T-241 sans garde `auth.uid()` ni `revoke public` ; reprise des CRITICAL RLS C-1/C-2 (corollaire migration) |
| HIGH     | 2 | Drift `supabase_migrations` ↔ repo (35 fichiers non tracés) ; T-241 non apply alors que code mergé      |
| MEDIUM   | 5 | T-241 hors pattern `search_path` projet ; idempotence partielle ; pas de `revoke public` côté création RPC ; DROP COLUMN sans `if exists` (1 occurrence) ; absence de `begin/commit` sur T-241 |
| LOW      | 4 | Cosmétique conventions ; fichiers tracés avec ID décalés (3 cas) ; index timestamp DGCCRF ; absence de `force row level security` (cf. RLS M-1) |

**Verdict opérationnel** :

1. **NE PAS APPLY T-241 EN L'ÉTAT** — la migration est exploitable depuis n'importe quel client authenticated et permettrait à un user A de réécrire la fiche producteur d'un user B. Cf. section T-241 ci-dessous : verdict `patch-avant-apply`.
2. **Aligner `supabase_migrations` avec le repo** — 35 migrations sont apply via SQL Editor (Dashboard) sans tracking. Empêche la détection automatique de drift et bloque `supabase migration up --linked`.
3. **Une fois T-241 patch + apply, créer une migration d'hygiène** — révoquer `EXECUTE PUBLIC` sur les 14 fonctions, fixer les 2 RPC CRITICAL RLS (C-1/C-2).

---

# T-241 — Section dédiée (verdict apply / patch-avant-apply / rollback)

**Fichier** : `supabase/migrations/20260504100000_t241_declaration_veracite_persistance.sql`
**Tracking DB** : ✗ absent de `supabase_migrations.schema_migrations`.
**État schéma live** : `producers.declaration_indicateurs_veracite_at`, `..._snapshot`, `..._wording_version` **n'existent pas**. RPC `update_producer_onboarding(uuid, ...)` **n'existe pas**.
**Code applicatif** : commit `e352a63` mergé (cf. recent commits) — la server action `complete-onboarding.ts` appelle déjà cette RPC. **Tout call onboarding producteur en prod est cassé tant que la migration n'est pas apply**.

## Verdict : **PATCH-AVANT-APPLY**

Trois défauts bloquants en sécurité, un défaut de cohérence pattern, deux défauts d'hygiène. Rollback nominal trivial (DROP COLUMN + DROP FUNCTION).

### Défauts bloquants (sécurité)

#### T241-CRIT-1 — Aucune garde `auth.uid() = p_user_id`

La fonction est `SECURITY DEFINER`. Le commentaire ligne 96-101 affirme : *« la fonction tourne avec les droits de son owner (postgres) — elle est appelée par la server action via le client admin service_role uniquement »*. **Mais rien dans la migration n'enforce cette convention.**

Le pattern correct existe ailleurs dans le projet : `delete_user_account` (ligne 59-62 de `20260424000000_producers_stripe_connect_flags.sql`) :

```sql
if auth.uid() is null or auth.uid() is distinct from p_user_id then
  raise exception 'Not authorized to delete this account'
    using errcode = '42501';
end if;
```

Idem dans `create_order_with_items` (ligne 70-73 de `20260422400000_slots_adhoc_and_exceptions.sql`).

T-241 ne reprend pas le pattern. Conséquence directe : si la fonction est exposée à `authenticated` (cf. T241-CRIT-2 ci-dessous), un user A peut appeler la RPC avec `p_user_id = <user_b_id>` et **réécrire intégralement la fiche producteur de B**, y compris :
- `nom_exploitation`, `siret`, `adresse`, `commune`
- enums score-carbone (`mode_elevage`, `alimentation`, `densite_animale`)
- snapshot DGCCRF + timestamp probatoire
- repasse `statut = 'pending'` (force re-modération)

L'attaque requiert seulement `auth.uid()` valide + UUID cible (récupérable via la page publique producteur — `producers.user_id` n'est pas exposé directement, mais `producers.id` l'est, et un join via la PostgREST data API peut remonter au `user_id`).

#### T241-CRIT-2 — Pas de `revoke execute on function ... from public`

CREATE FUNCTION en Postgres accorde `EXECUTE` à PUBLIC par défaut. Le grep sur la migration confirme : **aucun `revoke`, aucun `grant`**. Conséquence après apply :

```
update_producer_onboarding
  acl: =X/postgres, postgres=X/postgres, anon=X/postgres,
       authenticated=X/postgres, service_role=X/postgres, supabase_auth_admin=X/postgres
```

C'est exactement le même bug que **CRITICAL-1 / CRITICAL-2 de l'audit RLS** sur `revive_order_with_stock_check` et `record_refund_attempt`. Combiné à T241-CRIT-1, n'importe quel utilisateur authentifié peut appeler la RPC.

Le commentaire ligne 215 (« cette RPC reste le seul write path légitime ») est une intention de design, pas une garantie. Le revoke est obligatoire.

#### T241-CRIT-3 — Combinaison T241-CRIT-1 + T241-CRIT-2 = take-over fiche producteur

Aucun des deux défauts pris isolément ne suffirait :
- T241-CRIT-1 sans T241-CRIT-2 : authenticated peut tenter mais EXECUTE révoqué côté PG.
- T241-CRIT-2 sans T241-CRIT-1 : authenticated peut appeler mais ne peut pas modifier un autre user (la garde bloque).

Le combo des deux ouvre le take-over.

### Défaut de cohérence pattern

#### T241-MED-1 — `set search_path = public` (sans `pg_temp`)

Ligne 123 :
```sql
set search_path = public
```

**Toutes les autres fonctions SECURITY DEFINER du projet** (21/21 vérifiées via `pg_proc.proconfig`) utilisent :
```sql
set search_path = public, pg_temp
```

Fonctionnellement, omettre `pg_temp` est plus restrictif (le schéma temporaire de session n'est pas du tout cherché). Ce n'est donc pas un bug de sécurité. Mais c'est une déviation isolée du pattern projet, repérable en revue, et qui sera flaggée par `supabase db advisors` à terme. À aligner sur l'existant pour ne pas créer de précédent.

### Défauts d'hygiène

#### T241-LOW-1 — Pas de `begin; / commit;` autour des deux statements

Lignes 30-33 (alter) puis 104-208 (function) sont 2 statements indépendants. Si `create function` échoue (erreur de syntaxe sur un futur backport, par exemple), les colonnes sont déjà ajoutées. État intermédiaire incohérent.

Comparaison T-200 (ligne 14, 24) qui wrappe en `begin; ... commit;` : pattern projet établi.

L'apply via SQL Editor Dashboard wrappe automatiquement en transaction implicite, donc ce défaut n'affecte pas l'apply manuel actuel. Il affecterait `supabase db push` ou un apply via `psql -f` non-interactif.

#### T241-LOW-2 — `add column` sans `if not exists`

Lignes 30-33. Re-run de la migration (cas idempotence) → `ERROR: column already exists`.

Le projet est inconsistant sur ce point : T-200 omet aussi `if not exists` ; les chantiers slot_rules, audit_logs, gms_prices, refund_incidents l'utilisent. Pas un blocker car re-runs ne sont pas une pratique projet (apply unique par migration), mais à harmoniser sur le long terme.

### Sémantique business — verdict positif

Hors sécurité, la logique de la RPC est solide :

- `select ... for update` lock row-level — ferme la fenêtre double-clic / retry concurrent. ✓
- `is distinct from` (NULL-safe) sur les comparaisons snapshot — bon. ✓
- Décision SQL côté `case when v_persist then ...` au lieu de roundtrip JS — élimine la race lecture/modification. ✓
- COALESCE pour les enums score-carbone — préserve la sémantique pré-T-241 (un enum NULL côté formulaire ne doit pas écraser la colonne). ✓
- Cas « tous enums passent à NULL » → bloque la re-persistance, conserve le snapshot historique probatoire. Décision documentée et défendable. ✓
- Commentaires en-tête et MIROIR JS ↔ SQL alignés (`lib/producers/declaration-veracite.ts`). ✓ (la dette TODO T-296 — test d'intégration SQL réel — est mentionnée et acceptable.)

### Patch recommandé avant apply

Modification minimale du fichier `20260504100000_t241_declaration_veracite_persistance.sql` :

```sql
-- Au début de la fonction, juste après begin (ligne 134)
begin;
  -- Ouvert : décider service_role only OU authenticated avec garde.
  -- Décision recommandée projet (alignement delete_user_account) : authenticated + garde.
  if auth.uid() is null or auth.uid() is distinct from p_user_id then
    raise exception 'Not authorized to update this producer onboarding'
      using errcode = '42501';
  end if;
  -- ... reste de la fonction inchangé
```

Et après le `$$;` final (ligne 208) :

```sql
revoke execute on function public.update_producer_onboarding(
  uuid, text, text, text, text, text, text, text, text, text, text, text, text, boolean, text
) from public;

grant execute on function public.update_producer_onboarding(
  uuid, text, text, text, text, text, text, text, text, text, text, text, text, boolean, text
) to authenticated;
```

Et aligner ligne 123 sur le pattern projet :
```sql
set search_path = public, pg_temp
```

Et wrapper le tout en `begin; / commit;` (lignes 30 et fin de fichier).

### Rollback (si apply effectué malgré les défauts)

```sql
begin;
drop function if exists public.update_producer_onboarding(
  uuid, text, text, text, text, text, text, text, text, text, text, text, text, boolean, text
);
alter table public.producers
  drop column if exists declaration_indicateurs_veracite_at,
  drop column if exists declaration_indicateurs_snapshot,
  drop column if exists declaration_indicateurs_wording_version;
commit;
```

Pas de data à conserver (la migration n'a jamais été apply, snapshot vide). Après rollback, redéployer le code applicatif sans l'appel à la RPC (cf. point T-241-HIGH-1 sur le code mergé qui précède la migration).

#### T241-HIGH-1 — Code mergé en avance de la migration

Le commit `e352a63 T-241 — Persister la déclaration sur l'honneur producteur (DGCCRF) (#107)` est sur master. Le commit `3f7932b BL-2 — Archive v1.1 wording déclaration sur l'honneur` ajoute une couche par-dessus. **La server action onboarding appelle `update_producer_onboarding` aujourd'hui en prod, donc l'onboarding producteur est cassé** (`function does not exist`).

Implication audit : T-241 doit être apply (avec patch ci-dessus) **avant** que de nouveaux producteurs puissent finaliser l'onboarding. Si l'onboarding producteur est en hold business par ailleurs (pre-prod, pas d'utilisateurs réels), le risque est latent ; sinon c'est un blocker production immédiat.

À vérifier : statut actuel de l'ouverture onboarding producteur (`producers.statut` distribution + traffic réel sur la server action).

---

# CRITICAL

## C-1 (rappel RLS) — RPC `revive_order_with_stock_check(uuid)` exposée à PUBLIC

**Source migration** : `20260427300000_revive_order_with_stock_check.sql` (line 188 grant à service_role mais **pas de revoke from public**).
**État live** : ACL = `=X/postgres, anon=X/postgres, authenticated=X/postgres, ...`.
**Détail complet** : audit-rls-2026-05-05.md § C-1.

**Fix migration recommandé** (un seul fichier pour C-1 + C-2 + T241-CRIT-2 + cleanup M-6) :

```sql
-- supabase/migrations/<NEW_TS>_revoke_public_execute_on_sensitive_rpcs.sql
begin;

revoke execute on function public.revive_order_with_stock_check(uuid)
  from public, anon, authenticated;
grant execute on function public.revive_order_with_stock_check(uuid)
  to service_role;

revoke execute on function public.record_refund_attempt(
  uuid, text, text, uuid, text, text, text, text, text, text, text, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.record_refund_attempt(
  uuid, text, text, uuid, text, text, text, text, text, text, text, text, timestamptz
) to service_role;

-- Fonctions trigger : pas de risque pratique (PostgREST ne les expose pas comme RPC),
-- mais hygiène : revoke PUBLIC pour empêcher tout abus si PostgREST évolue.
revoke execute on function public.compute_order_commission() from public;
revoke execute on function public.set_order_code() from public;
revoke execute on function public.set_updated_at() from public;
revoke execute on function public.slot_rules_set_updated_at() from public;
revoke execute on function public.enforce_user_exclusive() from public;
revoke execute on function public.restore_product_stock_on_order_cancel() from public;
revoke execute on function public.generate_order_code() from public;

commit;
```

## C-2 (rappel RLS) — RPC `record_refund_attempt(...)` exposée à PUBLIC

**Source migration** : `20260502064800_t102_2b_record_refund_attempt_rpc.sql` (apply sous version `20260502065402` côté tracker).
**Détail complet** : audit-rls-2026-05-05.md § C-2.

**Fix** : inclus dans le bloc migration C-1 ci-dessus.

## C-3 — T-241 (cf. section dédiée plus haut)

Voir verdict **PATCH-AVANT-APPLY**.

---

# HIGH

## H-1 — Drift massif `supabase_migrations` ↔ repo (35 fichiers non tracés)

**État live** : `supabase_migrations.schema_migrations` contient 15 lignes ; le repo a 50 fichiers SQL. **35 migrations sont apply via SQL Editor (Dashboard) sans entrée dans le tracker.**

Tableau récapitulatif (antichronologique) :

| Version repo (timestamp fichier)   | Tracker DB                  | Schéma live |
|------------------------------------|-----------------------------|-------------|
| 20260504100000 t241                | ✗ NON                       | ✗ NON apply (T-241 critical) |
| 20260503100000 t200_score_carbone  | ✓ tracé sous `20260503014338 t200_score_carbone_bien_etre` (alt id+name) | ✓ apply (`mode_elevage`, `alimentation`, `densite_animale`) |
| 20260502064800 t102_2b record_refund_attempt | ✓ tracé sous `20260502065402` (alt id) | ✓ apply |
| 20260501231300 t102_1 refund_incidents | ✓ tracé sous `20260501231515` (alt id)  | ✓ apply |
| 20260501002856 t220_pra_categories_animals_cuts | ✓ tracé              | ✓ apply |
| 20260430161902 t013_email_change_a3_schema | ✓ tracé                    | ✓ apply |
| 20260430030000 t448_p0001_wording  | ✗ NON                       | ✓ apply via Dashboard |
| 20260430020000 t438_encoding_utf8_rpc_comments | ✗ NON                | ✓ apply via Dashboard |
| 20260430010000 t434_create_order_rpc_distinct_errors | ✗ NON          | ✓ apply via Dashboard |
| 20260430000000 t413_rename_cancellation_reason_to_closure_reason | ✗ NON | ✓ apply (`orders.closure_reason` confirmé, `cancellation_reason` absent) |
| 20260429030000 payouts_updated_at_error_msg | ✗ NON                  | ✓ apply (`payouts.updated_at`, `error_msg` confirmés) |
| 20260429020000 disputes_table      | ✗ NON                       | ✓ apply (`disputes` table présente) |
| 20260429010000 payouts_statut_enum_extend | ✗ NON                  | ✓ apply |
| 20260429000000 webhook_events_processed | ✗ NON                  | ✓ apply (`webhook_events_processed` présente) |
| 20260428300000 producer_interests_unique_email | ✗ NON              | ✓ apply (`producer_interests_email_key` UNIQUE confirmé) |
| 20260428200000 product_stock_alerts | ✗ NON                      | ✓ apply (`product_stock_alerts` présente) |
| 20260428100000 gms_prices_updated_by | ✗ NON                     | ✓ apply (`gms_prices.updated_by` confirmé) |
| 20260428000000 gms_prices          | ✗ NON                       | ✓ apply (`gms_prices`, `gms_prices_history` présentes) |
| 20260427300000 revive_order_with_stock_check | ✗ NON              | ✓ apply (RPC présente, ACL public — cf. C-1) |
| 20260427200000 restore_stock_on_order_cancel | ✗ NON              | ✓ apply |
| 20260427100000 create_audit_logs   | ✗ NON                       | ✓ apply (`audit_logs` présente) |
| 20260427000000 add_prenom_to_producer_interests | ✗ NON             | ✓ apply (`producer_interests.prenom` confirmé) |
| 20260426000000 add_source_to_producer_interests | ✗ NON             | ✓ apply (`producer_interests.source` confirmé) |
| 20260424000000 producers_stripe_connect_flags | ✗ NON                | ✓ apply (3 booléens confirmés) |
| 20260423130000 prevent_self_ordering | ✗ NON                     | ✓ apply (RPC mise à jour) |
| 20260423120000 set_producers_prenom_affichage_not_null | ✗ NON       | ✓ apply (`prenom_affichage` NOT NULL confirmé) |
| 20260423110000 backfill_producers_prenom_affichage | ✗ NON         | ✓ apply (data backfill, pas vérifiable structurellement) |
| 20260423100000 add_conseil_and_prenom_affichage_nullable | ✗ NON | ✓ apply (`products.conseil_active`, `conseil_texte` confirmés) |
| 20260423000000 rename_products_actif_to_active | ✗ NON           | ✓ apply (`products.active` présent, `actif` absent) |
| 20260422700000 rename_slots_actif_to_active | ✗ NON              | ✓ apply (`slots.active` présent, `actif` absent) |
| 20260422600000 producer_interests_admin_delete | ✗ NON           | ✓ apply (policy présente — cf. RLS) |
| 20260422500000 slots_capacity_check_in_order_rpc | ✗ NON         | ✓ apply (RPC mise à jour) |
| 20260422400000 slots_adhoc_and_exceptions | ✗ NON                | ✓ apply (`slots.excluded_at` confirmé, `rule_id` nullable confirmé) |
| 20260422310000 add_stripe_customer_id_to_users | ✗ NON           | ✓ apply (`users.stripe_customer_id` confirmé) |
| 20260422300000 slot_rules_and_materialized_slots | ✗ NON         | ✓ apply (`slot_rules` table + `slots` refonte confirmés) |
| 20260422200000 rgpd_account_deletion | ✗ NON                  | ✓ apply (`delete_user_account` présente) |
| 20260422100000 storage_policies_for_producers | ✗ NON             | ✓ apply (cf. RLS H-3) |
| 20260422000000 producer_public_filtering | ✗ NON                | ✓ apply (statut 'public' check actif) |
| 20260421500000 producers_admin_rls_policy | ✗ NON               | ✓ apply (cf. RLS) |
| 20260421400000 producers_forme_juridique_type_production | ✗ NON | ✓ apply (`forme_juridique`, `type_production` confirmés) |
| 20260421300000 producer_statut_draft_public | ✗ NON              | ✓ apply (statut accepte 'public', 'draft') |
| 20260421200000 grant_auth_admin_on_public | ✓ tracé            | ✓ apply |
| 20260421100000 cumulative_roles_admin_users | ✓ tracé          | ✓ apply (`users.roles[]`, `admin_users` présents) |
| 20260421000000 search_producers_product_count | ✓ tracé        | ✓ apply |
| 20260419060000 optimize_search_producers | ✓ tracé             | ✓ apply |
| 20260419050000 producer_ratings    | ✓ tracé                     | ✓ apply (`note_moyenne`, `nb_avis` confirmés) |
| 20260419040000 create_order_rpc    | ✓ tracé                     | ✓ apply |
| 20260419030000 orders_cancellation_reason_and_search | ✓ tracé | ✓ apply |
| 20260419020000 fix_payout_ids      | ✓ tracé                     | ✓ apply |
| 20260419010000 producer_invitations | ✓ tracé                    | ✓ apply |
| 20260419000000 initial_schema      | ✓ tracé                     | ✓ apply |

**Conséquences** :
- `supabase migration up --linked` est inutilisable (replay-only).
- `supabase db diff` produit du bruit (les migrations apply hors tracker apparaissent comme « manquantes »).
- Détection automatique de drift = impossible. **Ce drift T-241 lui-même n'a été détecté que parce qu'il y a un audit manuel en cours.**

**Fix recommandé** : `supabase_migrations.schema_migrations` est une table normale (pas un objet système). Insérer manuellement les 35 entrées manquantes une fois, puis adopter `supabase migration up --linked` pour les futures.

```sql
-- Patron (à dupliquer 35 fois avec les bons noms) :
insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20260421300000', 'producer_statut_draft_public', null)
on conflict (version) do nothing;
```

Le champ `statements` peut rester NULL pour le rattrapage (les migrations sont déjà apply, donc replay impossible de toute façon — la colonne sert au tooling, pas à la cohérence transactionnelle). Alternative plus propre : dump les fichiers `.sql` dans `statements::text[]` — utile pour la traçabilité forensique mais lourde à maintenir.

**Décision à arbitrer** : qui maintient le tracker ? Aujourd'hui personne. Soit (a) `supabase migration up --linked` devient le mode d'apply unique (déprécier le SQL Editor pour les schema changes), soit (b) chaque apply via Dashboard est doublé d'un INSERT manuel dans `schema_migrations`. Option (a) recommandée — option (b) sera oubliée.

## H-2 — Trois migrations tracées avec des IDs différents du fichier repo

Cas observés (cf. tableau H-1 colonne « Tracker DB ») :

| Fichier repo                                  | ID dans tracker  | Décalage |
|-----------------------------------------------|------------------|----------|
| `20260501231300_t102_1_refund_incidents.sql`  | `20260501231515` | +2m15s   |
| `20260502064800_t102_2b_record_refund_attempt_rpc.sql` | `20260502065402` | +6m02s |
| `20260503100000_t200_score_carbone.sql`       | `20260503014338` (et `name=t200_score_carbone_bien_etre`) | -8h17m |

**Cause** : `supabase migration new <name>` produit un timestamp UTC au moment de la commande ; si le fichier est ensuite renommé (ou créé manuellement), il y a écart. Pour T-200, le name dans le tracker (`t200_score_carbone_bien_etre`) ne correspond même plus au nom du fichier repo (`t200_score_carbone`). Le tracker a été créé avant un rename de fichier.

**Conséquences** :
- `supabase migration list --linked` affichera des entrées « ghost » (présentes en remote, fichier `<remote_id>_<remote_name>.sql` absent localement).
- `supabase db diff` peut générer des doublons.

**Fix** : mettre à jour le tracker pour qu'il pointe sur les IDs réels du repo :
```sql
update supabase_migrations.schema_migrations
   set version = '20260501231300'
 where version = '20260501231515';
update supabase_migrations.schema_migrations
   set version = '20260502064800'
 where version = '20260502065402';
update supabase_migrations.schema_migrations
   set version = '20260503100000', name = 't200_score_carbone'
 where version = '20260503014338';
```

À combiner avec le fix H-1 (rattrapage des 35 entrées). Migration unique d'hygiène recommandée.

---

# MEDIUM

## M-1 — `add column` sans `if not exists` sur 5 migrations récentes

Re-run d'une migration apply → erreur `column already exists`. Affecte l'idempotence pour le tooling automatisé.

| Migration                                                | Colonnes ajoutées |
|----------------------------------------------------------|-------------------|
| `20260504100000_t241_declaration_veracite_persistance.sql` | 3 (declaration_indicateurs_*) |
| `20260503100000_t200_score_carbone.sql`                   | 3 (mode_elevage, alimentation, densite_animale) |
| `20260423100000_add_conseil_and_prenom_affichage_nullable.sql` | 3 (prenom_affichage, conseil_active, conseil_texte) |
| `20260422310000_add_stripe_customer_id_to_users.sql`     | 1 (stripe_customer_id) — *à vérifier* |
| `20260421400000_producers_forme_juridique_type_production.sql` | 2 (forme_juridique, type_production) — *à vérifier* |

Le projet est mixte — 29 fichiers utilisent `if not exists` (slot_rules, audit_logs, disputes, refund_incidents, gms_prices, etc.), 5 ne l'utilisent pas. Convention non figée.

**Recommandation** : adopter `add column if not exists` partout par défaut, à intégrer au commit hook ou à la convention `METHODOLOGY.md`. Faible coût, élimine la classe entière d'erreurs.

## M-2 — `drop column` sans `if exists` sur `users.role` (1 occurrence)

`20260421100000_cumulative_roles_admin_users.sql:39` :
```sql
alter table public.users drop column role;
```

Re-run → erreur. Acceptable car la migration commence par `truncate ... cascade` + `delete from auth.users` — clairement marquée non idempotente, dédiée au wipe pré-prod.

Lignes 107 et 117 ont aussi des `drop constraint` sans `if exists`.

**Recommandation** : ajouter un commentaire `-- WARNING: non-idempotent, single-shot` en tête de migration. Aucun fix structurel — le caractère destructif est volontaire.

## M-3 — Pas de `revoke execute from public` lors de la création des RPCs

Toutes les migrations qui créent une RPC (15 occurrences de `create or replace function`) **omettent** le `revoke execute on function ... from public`. Conséquence : ACL `=X/postgres` (PUBLIC EXECUTE) sur les 14 fonctions live (cf. RLS M-6).

Les fonctions à risque pratique (appelables via PostgREST sans validation) sont les 5 RPCs « business » : `create_order_with_items`, `delete_user_account`, `revive_order_with_stock_check`, `record_refund_attempt`, `update_producer_onboarding` (post-T-241). Sur les 5, **3 ont une garde `auth.uid()`** (create_order_with_items, delete_user_account, et search_producers qui n'écrit pas) ; **2 n'en ont pas** (revive_order_with_stock_check → cf. RLS C-1 ; record_refund_attempt → cf. RLS C-2). T-241 ajoutera la 6e dans la même catégorie « pas de garde ».

**Recommandation** : adopter dans `METHODOLOGY.md` la règle « toute migration qui crée/replace une fonction `SECURITY DEFINER` doit inclure soit (a) `grant execute to <role>` + `revoke execute from public`, soit (b) une garde explicite `auth.uid()` au début ». Idéalement les deux.

## M-4 — T-241 : `set search_path = public` (sans `pg_temp`) — déviation pattern

Détaillé dans la section T-241 ci-dessus (T241-MED-1). Pas exploitable en sécurité (omettre `pg_temp` est plus restrictif), mais inconsistance unique dans le projet.

## M-5 — T-241 : pas de `begin; / commit;` autour des statements

Détaillé dans la section T-241 ci-dessus (T241-LOW-1, classé MEDIUM ici car couplé au défaut d'apply automatisé via `supabase db push`).

---

# LOW

## L-1 — Conventions naming : globalement cohérentes

Vérifié sur les 50 fichiers :

| Élément          | Convention observée                            | Cas atypiques |
|------------------|------------------------------------------------|---------------|
| Tables           | `snake_case` pluriel (users, producers, products, slot_rules, refund_incidents) | aucun |
| Colonnes         | `snake_case` ; mix FR/EN cohérent (FR pour le métier producteur — `nom_exploitation`, `forme_juridique`, `densite_animale` ; EN pour technique — `created_at`, `updated_at`, `stripe_*`) | aucun |
| FK               | `<table>_<col>_fkey` (default Postgres) — ex. `notifications_user_id_fkey` | aucun |
| Index            | `<table>_<col(s)>_idx` ou `idx_<table>_<col>` (audit_logs) | mineur |
| Contraintes CHECK | nommées explicitement (`slots_time_window`, `slot_rules_capacity_min`, `producer_interests_email_unique`) | aucun |
| Policies         | `"<table> <action> <when>"` en doubles quotes — ex. `"products public read when producer public"`, `"slot_rules owner all"` | aucun |
| Functions        | `verb_object` snake_case — `create_order_with_items`, `update_producer_onboarding`, `is_admin`, `owns_producer` | aucun |
| Triggers         | `<table>_<verb>_<context>` — ex. `slot_rules_set_updated_at`, `users_exclusive_with_admin` | aucun |

**Atypie mineure** : `audit_logs` utilise `idx_audit_logs_user_id` (préfixe `idx_`) alors que le reste utilise le suffixe `_idx`. Cosmétique.

## L-2 — Index timestamp probatoire DGCCRF (T-241 future)

`producers.declaration_indicateurs_veracite_at` (post-T-241 apply) sera utilisé à terme par une page admin « historique déclarations DGCCRF » ou par un export forensique. Aucun index actuellement prévu (la migration n'en crée pas). Acceptable au volume actuel (< 100 producteurs en pré-prod), à anticiper si volumétrie croît.

**Pas de fix immédiat** — à tracer en TODO post-T-241.

## L-3 — Fonctions trigger exposables PUBLIC (cf. RLS L-3 / M-6)

7 fonctions trigger (`compute_order_commission`, `set_order_code`, `set_updated_at`, `slot_rules_set_updated_at`, `enforce_user_exclusive`, `restore_product_stock_on_order_cancel`, `generate_order_code`) ont l'ACL PUBLIC EXECUTE. PostgREST n'expose pas les fonctions trigger (pas de signature standard appelable), donc inoffensif en pratique.

**Fix** : inclus dans la migration d'hygiène C-1 ci-dessus.

## L-4 — Absence de `force row level security` (cf. RLS M-1)

Aucune table en `forcerowsecurity = true`. Defense-in-depth recommandée pour `audit_logs`, `disputes`, `refund_incidents`, `payouts`, `email_change_*`, `webhook_events_processed`. Détaillé dans audit-rls-2026-05-05.md § M-1.

---

# Annexe A — Statistiques globales

| Métrique                                          | Valeur |
|---------------------------------------------------|--------|
| Fichiers SQL repo                                 | 50     |
| Lignes SQL totales                                | 6 436  |
| Migrations tracées dans `supabase_migrations`     | 15     |
| Migrations apply non tracées                      | 35     |
| Fonctions `public.*` live                         | 14     |
| Fonctions `SECURITY DEFINER` live                 | 14 (toutes) |
| Fonctions avec `set search_path` verrouillé       | 14 (toutes) |
| Fonctions avec `revoke execute from public`       | 0      |
| Fonctions avec garde `auth.uid()` côté code       | 3 (create_order_with_items, delete_user_account, search_producers — search-only) |
| Tables `public.*`                                 | 26     |
| Tables RLS-enabled                                | 26 (toutes) |
| Tables `forcerowsecurity = true`                  | 0      |
| Migrations `T-241`, `T-200` style (timestamps grouped) | 9 (chantiers récents Phase 6+) |

---

# Annexe B — Recommandations d'action priorisées

## Sprint immédiat (ce week-end)

1. **Patcher T-241 avant apply** (cf. section dédiée)
   - Ajouter garde `auth.uid() = p_user_id`
   - Ajouter `revoke execute from public` + `grant execute to authenticated`
   - Aligner `set search_path = public, pg_temp`
   - Wrapper `begin; / commit;`
   - Apply via SQL Editor + INSERT manuel dans `schema_migrations`

2. **Migration d'hygiène RPC** (1 fichier, ~30 lignes)
   - Fix C-1 (revive_order_with_stock_check) + C-2 (record_refund_attempt)
   - Revoke PUBLIC sur les 7 fonctions trigger
   - Apply après T-241 patch

## Court terme (sprint suivant)

3. **Aligner `supabase_migrations` avec le repo** (H-1, H-2)
   - INSERT des 35 entrées manquantes
   - UPDATE des 3 entrées avec ID décalé
   - Décider du mode d'apply unique (CLI `supabase migration up --linked` vs Dashboard)
   - Tracer la décision dans `METHODOLOGY.md`

4. **Convention `SECURITY DEFINER`** (M-3)
   - Ajouter à `METHODOLOGY.md` : toute nouvelle RPC `SECURITY DEFINER` doit avoir
     (a) `revoke execute from public` + `grant execute to <role>`
     (b) garde `auth.uid()` ou justification explicite (ex: trigger)

5. **Convention idempotence** (M-1, M-2)
   - Adopter `add column if not exists` par défaut
   - Documenter les exceptions volontaires (wipe migrations)

## Moyen terme (chantier dédié)

6. **`force row level security`** sur les 6 tables sensibles (cf. RLS M-1)
7. **Wrap `(select auth.uid())`** sur les 29 policies (cf. RLS H-1)
8. **Helpers `is_producer_public(uuid)` + `can_access_order(uuid)`** (cf. RLS H-2)

---

*Audit conduit en lecture seule. Aucune correction appliquée. Périmètre : repo + DB live, hors code applicatif sauf renvois explicites. Les findings RLS référencés (C-1, C-2, M-*, H-*) sont détaillés dans `audit-rls-2026-05-05.md`.*
