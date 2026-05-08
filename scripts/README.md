# Scripts

## fetch-cut-images.ts

Telecharge une photo "plat cuisine" pour chaque morceau de boeuf via
l'API Pixabay et genere `scripts/cut-images.generated.ts` (mapping
`slug -> { imageUrl, imageAlt, imageCredit }`) consomme par
`lib/beef-cuts.ts`.

### Obtenir une cle Pixabay

1. Creer un compte gratuit sur https://pixabay.com/accounts/register/
2. Une fois connecte, recuperer la cle sur https://pixabay.com/api/docs/
3. Quota plan gratuit : 100 requetes / 60s, 5000 requetes / jour. Le
   script fait 30 requetes max — largement dans les bornes.

**Ne pas commiter la cle.** Passe la via env var :

```bash
# PowerShell
$env:PIXABAY_API_KEY = "ta_cle"
npx tsx scripts/fetch-cut-images.ts

# Bash / Git Bash
PIXABAY_API_KEY=ta_cle npx tsx scripts/fetch-cut-images.ts
```

### Usage

Regenerer toutes les photos (ecrase celles existantes) :

```bash
PIXABAY_API_KEY=xxx npx tsx scripts/fetch-cut-images.ts
```

Ne fetcher que les slugs sans photo en cache :

```bash
PIXABAY_API_KEY=xxx npx tsx scripts/fetch-cut-images.ts --skip-existing
```

Remplacer la photo d'un seul slug (ex. si la photo retournee n'est
pas pertinente) :

```bash
PIXABAY_API_KEY=xxx npx tsx scripts/fetch-cut-images.ts --only filet
```

### Sortie

- `public/images/cuts/<slug>.jpg` : photo telechargee, servie par
  Next.js a l'URL `/images/cuts/<slug>.jpg`
- `scripts/cut-images.generated.ts` : mapping consomme par
  `lib/beef-cuts.ts`. Fichier ecrase a chaque run, NE PAS editer
  manuellement.

### Notes

- Filtres Pixabay actifs : `image_type=photo`, `safesearch=true`,
  `min_width=800`, `orientation=horizontal`
- Le script prend la 1ere photo retournee (`hits[0]`). Pour cibler
  une photo specifique, passer une query alternative dans
  `SEARCH_TERMS`.
- Si l'API renvoie 0 hits pour un slug, le slug reste sans entree
  dans le mapping — la page detail affichera le placeholder
  "Photo a venir".
- Licence Pixabay : usage commercial autorise sans attribution
  obligatoire. On affiche tout de meme `Photo : <author> / Pixabay`
  par bonne pratique editoriale.
