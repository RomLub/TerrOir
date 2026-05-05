# Fallback : storage policies via Dashboard

**Contexte** : la migration `20260505100200_audit_rls_lot_5_fix_storage_policies_select.sql` crée/recrée 8 policies RLS sur `storage.objects` via SQL. La migration historique `20260422100000_storage_policies_for_producers.sql` utilisait déjà ce pattern sans incident — l'apply via SQL Editor doit fonctionner.

**Si l'apply SQL échoue** (selon la version de Supabase, l'ownership de `storage.objects` peut interdire `CREATE POLICY` au rôle `postgres`), bascule sur le Dashboard. Erreur typique :

```
ERROR:  permission denied for table objects
```

## Étapes UI exactes

### 1. Ouvrir le Storage Policies editor

1. Dashboard Supabase → ton projet TerrOir.
2. Menu de gauche → **Storage** (icône caisse).
3. Onglet **Policies** (en haut de la page Storage).

Tu verras 2 sections : `bucket: product-photos` et `bucket: producer-photos`. Chaque bucket affiche les policies existantes : `owner select` (à créer), `owner insert`, `owner update`, `owner delete`.

### 2. Pour chaque bucket — recréer les 4 policies

Pour chaque bucket (`product-photos`, puis `producer-photos`), répéter ces 4 actions :

#### a. SELECT (à AJOUTER — n'existe pas encore)

1. Cliquer sur **New Policy** dans la section du bucket.
2. Choisir **For full customization** (option du bas).
3. Renseigner :
   - **Policy name** : `<bucket> owner select` (ex. `product-photos owner select`)
   - **Allowed operation** : cocher uniquement `SELECT`
   - **Target roles** : `authenticated`
   - **USING expression** :
     ```sql
     bucket_id = '<bucket>'
     and (select public.owns_producer((storage.foldername(name))[1]::uuid))
     ```
     (remplacer `<bucket>` par le nom exact `product-photos` ou `producer-photos`)
4. **Save policy**.

#### b. INSERT (à RECRÉER — drop ancien puis create)

1. Trouver `<bucket> owner insert` dans la liste → menu **⋮** → **Delete**.
2. **New Policy** → **For full customization**.
3. Renseigner :
   - **Policy name** : `<bucket> owner insert`
   - **Allowed operation** : `INSERT`
   - **Target roles** : `authenticated`
   - **WITH CHECK expression** :
     ```sql
     bucket_id = '<bucket>'
     and (select public.owns_producer((storage.foldername(name))[1]::uuid))
     ```
4. **Save policy**.

#### c. UPDATE (à RECRÉER)

1. Drop `<bucket> owner update`.
2. **New Policy** → **For full customization**.
3. Renseigner :
   - **Policy name** : `<bucket> owner update`
   - **Allowed operation** : `UPDATE`
   - **Target roles** : `authenticated`
   - **USING expression** : (même que SELECT ci-dessus)
   - **WITH CHECK expression** : (même que SELECT ci-dessus)
4. **Save policy**.

#### d. DELETE (à RECRÉER)

1. Drop `<bucket> owner delete`.
2. **New Policy** → **For full customization**.
3. Renseigner :
   - **Policy name** : `<bucket> owner delete`
   - **Allowed operation** : `DELETE`
   - **Target roles** : `authenticated`
   - **USING expression** : (même que SELECT ci-dessus)
4. **Save policy**.

### 3. Vérification

Dans le SQL Editor du Dashboard, exécuter :

```sql
select policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'storage'
  and tablename = 'objects'
order by policyname;
```

Attendu : 8 policies (2 buckets × 4 commands), toutes `roles = {authenticated}`, toutes les expressions contiennent `(select public.owns_producer((storage.foldername(name))[1]::uuid))`.

### 4. Test fonctionnel post-apply

Connexion comme un producteur authentifié dans l'app, puis :

1. **Upload neuf** : ajouter une photo produit via `/produits/<id>/edit` → succès attendu.
2. **Replacement (upsert)** : remplacer la photo principale d'un produit existant par une nouvelle → succès attendu (avant ce fix, l'ancien fichier restait silencieusement).
3. **Cross-producer denial** : avec un compte producteur A, essayer (via DevTools console) un upload sur le path `<producerB-id>/...` → erreur 403 attendue.

## Notes

- Le Dashboard ne permet pas le `WITH CHECK` distinct du `USING` pour les commands INSERT/DELETE — c'est normal (INSERT n'a pas de USING, DELETE n'a pas de WITH CHECK).
- La syntaxe `(select public.owns_producer(...))` doit être identique au repo (cf. la migration SQL 20260505100200) pour bénéficier du caching InitPlan post-lot 1.
- Si tu vois apparaître la policy `disputes_service_role_all` côté Dashboard sur `public.disputes`, ne pas la recréer — c'est elle que le lot 7 supprime (cf. audit MEDIUM-5).
