# Glossaire du terroir — convention rédaction

T-243 — scaffolding livré 2026-05-07.

## Architecture V0 (sans MDX)

Le glossaire utilise un registry TypeScript plutôt qu'un runtime MDX pour
éviter d'ajouter une dépendance lourde avant ouverture publique. Migration
MDX possible plus tard sans casser l'API.

```
content/glossaire/
├── index.ts                          # Registry + types + helpers
├── labels/
│   ├── label-rouge.tsx               # Composant React Server (Body)
│   └── agriculture-biologique.tsx    # Composant React Server (Body)
├── races/                            # vide en V0
├── modes-elevage/                    # vide en V0
└── terroirs/                         # vide en V0
```

Routes Next.js :

```
app/(public)/glossaire/
├── page.tsx                          # Liste par catégorie
└── [slug]/page.tsx                   # Détail article (generateStaticParams)
```

## Ajouter un article

1. Crée le fichier `content/glossaire/<categorie>/<slug>.tsx` avec un
   composant nommé `<Slug>Body` (ex. `LabelRougeBody`) qui exporte
   uniquement le corps de l'article (pas de header, pas de breadcrumb —
   le layout `app/(public)/glossaire/[slug]/page.tsx` les ajoute).

2. Ajoute une entrée dans `GLOSSAIRE_ARTICLES` (`content/glossaire/index.ts`)
   avec le frontmatter requis :

   ```ts
   {
     slug: "label-rouge",
     title: "Label Rouge",
     category: "labels",          // labels | races | modes-elevage | terroirs
     excerpt: "Une phrase d'accroche pour la liste.",
     tags: ["qualité", "officiel"],
     last_updated: "2026-05-07",  // YYYY-MM-DD
     sources: [{ label: "INAO", url: "https://www.inao.gouv.fr" }],
     Body: LabelRougeBody,
   }
   ```

3. Le slug doit être unique global (le registry est plat, pas de namespace
   par catégorie côté URL).

## Conventions wording

- Tutoiement du visiteur (cohérent avec le reste du site).
- Apostrophe courbe `&rsquo;` ou `&apos;` dans le JSX (règle ESLint stricte).
- Pas de mention nominale de concurrent. Source officielle citée systématiquement
  (INAO, Agence BIO, FranceAgriMer, INRAE, etc.).
- 3-5 paragraphes pour V0 placeholder. Cycles rédactionnels suivants
  enrichissent.

## Catégories closed-list

Les 4 catégories sont fixées en enum (`GlossaireCategory`) :

- `labels` — labels officiels et signes de qualité (Label Rouge, AB, IGP,
  AOP, etc.)
- `races` — races animales et variétés végétales (rouge des prés, vache
  Maine-Anjou, poire Pierre Corneille, etc.)
- `modes-elevage` — pratiques d'élevage (plein air, alimentation, densité,
  abattage, etc.)
- `terroirs` — spécificités sarthoises (Bercé, Vallée du Loir, Perche
  sarthois, etc.)

Ajout d'une catégorie = nouveau littéral dans le type union + entrée dans
`GLOSSAIRE_CATEGORY_LABELS` + entrée dans `CATEGORY_ORDER` côté page liste +
nouveau dossier `content/glossaire/<categorie>/`.

## Migration future vers MDX

Si le volume éditorial le justifie (>30 articles, contributions externes
fréquentes), la migration vers `next-mdx-remote` ou `@next/mdx` est
linéaire :

- Le frontmatter actuel (`title`, `slug`, `category`, `tags`,
  `last_updated`, `sources`) est déjà aligné sur les conventions YAML
  frontmatter MDX.
- Les composants `Body` deviennent du contenu MDX inline.
- Le registry `GLOSSAIRE_ARTICLES` peut être généré au build à partir des
  `.mdx` via `globby` + `gray-matter`.

À reconsidérer après ouverture publique.
