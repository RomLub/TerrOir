# Contribuer à TerrOir

Ce document décrit la procédure complète pour gérer la base de données
Supabase et les migrations dans le projet.

---

## Supabase CLI

### Installation

Le CLI Supabase est installé **en tant que dépendance de développement** du projet
(version épinglée dans `package.json`, reproductible pour toute l'équipe).

> Note : `npm install -g supabase` n'est **pas** supporté par Supabase. Le
> postinstall script refuse explicitement l'installation globale. Utilisez
> toujours la version projet via `npx`.

Pour installer les dépendances (y compris Supabase CLI) :

```bash
npm install
```

Pour vérifier la version :

```bash
npx supabase --version
```

### Scripts npm

Des raccourcis sont disponibles dans `package.json` :

| Script             | Équivalent CLI                 | Usage                                           |
| ------------------ | ------------------------------ | ----------------------------------------------- |
| `npm run db:push`  | `supabase db push`             | Applique les migrations en attente vers le cloud |
| `npm run db:pull`  | `supabase db pull`             | Récupère le schéma distant comme migration      |
| `npm run db:diff`  | `supabase db diff`             | Compare local vs distant                        |
| `npm run db:reset` | `supabase db reset`            | Réinitialise la DB locale (dev only)            |
| `npm run db:new`   | `supabase migration new`       | Crée un fichier de migration vide               |
| `npm run db:status`| `supabase migration list`      | Liste les migrations et leur état               |

---

## Lier le projet à Supabase Cloud

À faire **une seule fois** par développeur / machine.

### 1. Créer un projet sur supabase.com

1. Aller sur [supabase.com](https://supabase.com) et se connecter.
2. Cliquer sur **New project**.
3. Choisir une organisation, un nom (`terroir-prod`, `terroir-staging`, etc.),
   un mot de passe de base de données (à garder précieusement), une région
   (préférer `eu-west-3` Paris pour la France).
4. Attendre que le projet soit provisionné (~2 minutes).

### 2. Récupérer le project ID (project ref)

Dans le dashboard du projet :
- **Project Settings** → **General** → copier la valeur **Reference ID**.
- Format : `abcdefghijklmnopqrst` (20 caractères alphanumériques).

Récupérer aussi les clés API dans **Project Settings** → **API** :
- `Project URL` → à mettre dans `NEXT_PUBLIC_SUPABASE_URL`
- `anon public` → à mettre dans `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `service_role` → à mettre dans `SUPABASE_SERVICE_ROLE_KEY` (**jamais** côté client)

Mettre à jour `.env.local` avec ces valeurs.

### 3. S'authentifier en CLI

```bash
npx supabase login
```

Ouvre un navigateur, on se connecte au compte Supabase, le CLI récupère un
access token et le stocke dans `~/.supabase/`.

### 4. Lier le repo local au projet cloud

```bash
npx supabase link --project-ref <project-id>
```

Le CLI demandera le mot de passe de la base de données (celui choisi à
l'étape 1). La liaison crée des métadonnées dans `supabase/.temp/` (ignoré
par git).

---

## Appliquer la migration initiale

Une fois le projet lié :

```bash
npm run db:push
```

ou directement :

```bash
npx supabase db push
```

Cela applique toutes les migrations présentes dans `supabase/migrations/`
qui ne sont pas encore dans le schéma distant.

Pour vérifier l'état :

```bash
npm run db:status
```

---

## Créer une nouvelle migration

**Toujours** passer par une migration versionnée — ne **jamais** modifier
le schéma directement dans le dashboard Supabase sans la rejouer en local.

### 1. Générer le fichier

```bash
npm run db:new -- nom_de_la_migration
```

Exemple :

```bash
npm run db:new -- add_product_category
```

Crée un fichier vide `supabase/migrations/<timestamp>_add_product_category.sql`.

### 2. Écrire le SQL

Éditer le fichier. Chaque migration doit être :
- **idempotente si possible** (`create table if not exists`, `create index if not exists`)
- **atomique** : une seule intention par migration
- **réversible en pensée** : noter dans un commentaire comment rollback si besoin

### 3. Tester localement (optionnel mais recommandé)

```bash
npx supabase start    # démarre un Postgres + studio en Docker
npm run db:reset      # réapplique toutes les migrations from scratch
```

Ouvrir `http://localhost:54323` pour le studio local.

### 4. Appliquer en cloud

```bash
npm run db:push
```

### 5. Commiter

```bash
git add supabase/migrations/
git commit -m "db: add product category"
```

---

## En cas de drift (schéma cloud modifié hors CLI)

Si quelqu'un a modifié le schéma via le dashboard :

```bash
npm run db:diff -- --file fix_drift
```

Génère une migration qui capture la différence. À relire, renommer si
besoin, puis `npm run db:push` pour la ré-appliquer proprement.

Alternative pour récupérer l'état complet distant :

```bash
npm run db:pull
```

---

## Checklist avant de pusher une migration

- [ ] Fichier dans `supabase/migrations/<timestamp>_<nom>.sql`
- [ ] Migration testée en local (`npm run db:reset` si Docker disponible)
- [ ] RLS activée sur les nouvelles tables
- [ ] Policies définies pour **chaque opération** (SELECT/INSERT/UPDATE/DELETE)
- [ ] Index sur les FK et colonnes utilisées en `WHERE` / `ORDER BY`
- [ ] Pas de secret en dur dans le SQL
- [ ] Commit atomique sur une seule migration à la fois

---

## Planification des crons

Toutes les routes `app/api/cron/*` s'authentifient via
`Authorization: Bearer $CRON_SECRET`. À câbler sur l'ordonnanceur de
l'hébergement (Vercel Cron, GitHub Actions, pg_cron, etc.).

| Route                              | Cron expr (UTC) | Fréquence                  | Rôle                                              |
| ---------------------------------- | --------------- | -------------------------- | ------------------------------------------------- |
| `POST /api/cron/reminder-consumer` | `0 18 * * *`    | Chaque jour à 18h          | Email rappel J-1 retrait                          |
| `POST /api/cron/reminder-sms`      | `0 8 * * *`     | Chaque jour à 8h           | SMS rappel J-0 (opt-in)                           |
| `POST /api/cron/order-timeout`     | `0 * * * *`     | Chaque heure               | Annulation + remboursement commandes pending 24h  |
| `POST /api/cron/review-followup`   | `0 10 * * *`    | Chaque jour à 10h          | Relances avis J+2 et J+7                          |
| `POST /api/cron/weekly-payout`     | `0 8 * * 1`     | Lundi 8h                   | Virements producteurs + email récap               |
| `POST /api/cron/weekly-badges`     | `30 8 * * 1`    | Lundi 8h30                 | Recalcul des 3 badges pour chaque producteur actif |

Exemple Vercel (`vercel.json`) :

```json
{
  "crons": [
    { "path": "/api/cron/reminder-consumer", "schedule": "0 18 * * *" },
    { "path": "/api/cron/reminder-sms", "schedule": "0 8 * * *" },
    { "path": "/api/cron/order-timeout", "schedule": "0 * * * *" },
    { "path": "/api/cron/review-followup", "schedule": "0 10 * * *" },
    { "path": "/api/cron/weekly-payout", "schedule": "0 8 * * 1" },
    { "path": "/api/cron/weekly-badges", "schedule": "30 8 * * 1" }
  ]
}
```

> Vercel Cron utilise GET par défaut — ajouter une méthode `GET` dans
> chaque route ou configurer l'appel via un webhook externe qui fait
> un POST. Toutes les routes actuelles sont en POST.
