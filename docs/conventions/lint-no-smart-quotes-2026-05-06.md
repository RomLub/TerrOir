# Règle ESLint anti-apostrophe courbe U+2019 — 2026-05-06 (T-255)

**Contexte** : pendant les chantiers T-239 + T-240 (Bundle Stripe webhook),
une apostrophe courbe `'` (U+2019) introduite dans un label JSX a fait
diverger un smoke Playwright qui matchait l'apostrophe droite ASCII (`'`
U+0027). Le test passait localement mais cassait en CI selon l'encoding du
fichier source. Mettre en place une règle ESLint qui bloque U+2019 dans les
sources `.ts`/`.tsx` pour empêcher la récidive.

---

## Choix technique

**Règle ESLint built-in** `no-restricted-syntax` avec 3 sélecteurs
AST/esquery (pas de plugin externe nécessaire).

```json
{
  "extends": "next/core-web-vitals",
  "rules": {
    "no-restricted-syntax": [
      "error",
      {
        "selector": "Literal[value=/\\u2019/]",
        "message": "T-255: ..."
      },
      {
        "selector": "TemplateElement[value.raw=/\\u2019/]",
        "message": "T-255: ..."
      },
      {
        "selector": "JSXText[raw=/\\u2019/]",
        "message": "T-255: ..."
      }
    ]
  }
}
```

3 sélecteurs couvrent les contextes où une apostrophe courbe peut s'écrire
en source TS/TSX :
- `Literal` : strings JS (`'foo'`, `"foo"`) — couvre les attributs JSX
  (`<Tag prop="foo" />`) et les valeurs d'objets.
- `TemplateElement` : template literals (`` `foo${bar}` ``).
- `JSXText` : texte entre balises JSX (`<p>foo</p>`).

**Choix `JSXText[raw=/.../]` plutôt que `[value=/.../]`** : le AST esprima/
babel décode les entités HTML (`&rsquo;`) en U+2019 dans `JSXText.value`.
Sélectionner sur `value` bloquerait aussi les usages légitimes de
`&rsquo;`. Sélectionner sur `raw` (la source brute) ne bloque que les
U+2019 littéraux, ce qui est l'intention.

Pas de plugin npm dédié (ex. `eslint-plugin-no-smart-quotes`) : la règle
built-in suffit, zéro nouvelle dépendance, message d'erreur personnalisable.

---

## Niveau et scope

- **Niveau** : `error` (pas `warn` — sinon ignoré en pratique au CI).
- **Scope** : tous les fichiers `.ts` et `.tsx` (default ESLint pour Next.js).

---

## Comment contourner légitimement

Selon le contexte :
- **Strings JS** (`'foo'`, `"foo"`, template literals) : utiliser
  apostrophe droite ASCII (`'`). Si nécessaire (préférence typographique
  française), passer le contenu via une vue qui décodera des entités HTML
  côté JSX (mais c'est rare en string JS pure).
- **JSX text** (entre balises) : utiliser entité HTML `&rsquo;` pour le
  rendu typographique courbe (l'apostrophe culturellement française), ou
  `&apos;` pour droite. Les entités sont préservées par la règle `raw=`.
- **JSX attributs** (`<Tag prop="..." />`) : ce sont des `Literal`, donc
  même contrainte que strings JS. Apostrophe ASCII directe.

Exemples :

```tsx
// ❌ Bloqué par T-255
const label = "L'éleveur"; // U+2019
<p>L'éleveur</p>           // U+2019 dans JSXText

// ✅ Accepté
const label = "L'éleveur"; // U+0027 ASCII
<p>L&rsquo;éleveur</p>     // entité HTML, rendu typographique courbe
<p>L&apos;éleveur</p>      // entité HTML, apostrophe droite
<p>L'éleveur</p>           // ASCII brut (peut déclencher react/no-unescaped-entities,
                           // règle Next séparée → préférer &rsquo; / &apos; en JSX text)
```

Note : la règle Next.js `react/no-unescaped-entities` s'applique en plus
sur les JSX text contenant `'` ASCII non échappée (problème distinct de
T-255, mais utiliser `&rsquo;` / `&apos;` règle les deux d'un coup).

---

## Validation

1. **Test négatif manuel** : ajouter une apostrophe courbe U+2019 dans
   un fichier .ts/.tsx → `npx next lint` retourne erreur `T-255: ...`.
   Constaté pendant le développement de la règle (cf. lint output qui
   listait initialement 8+ occurrences résiduelles dans le repo).

2. **Test positif** : `npx next lint --max-warnings=0` actuellement OK
   (1 warning préexistant `react-hooks/exhaustive-deps` non-lié dans
   `components/providers/user-provider.tsx`).

3. **Tests vitest** : 181/181 fichiers, 2098/2098 tests verts post-T-255.

---

## Migration des occurrences existantes

8 occurrences U+2019 résiduelles trouvées (mix `JSXText` source brut et
strings JS), normalisées :

- `app/(consumer)/compte/notifications/NotificationsClient.tsx:20`
  string JS → ASCII (+ guillemets externes passés en `"..."` pour ne pas
  casser le parser).
- `app/(public)/producteurs/[slug]/_components/ScoreCarbonBlock.tsx:37,41`
  strings JS → ASCII.
- `app/(public)/_components/home/Reassurance.tsx:71` string JS → ASCII.
- `app/(public)/_components/home/SarthemapPostit.tsx:54,64`
  JSX text → `&rsquo;` (rendu typographique courbe préservé).
- `app/(public)/_components/home/SarthemapPostit.tsx:70` attribut JSX
  → ASCII.
- `app/(public)/_components/home/Steps.tsx:56,70` strings JS → ASCII.

Tests `tests/app/producteurs/score-carbon-block.test.tsx:55,73,93,114`
adaptés : assertions HTML rendues passent maintenant par regex
`/de l(&#x27;|')éleveur/` (React échappe `'` ASCII en `&#x27;` côté
output). Robustesse : la regex couvre les 2 formes ASCII pour ne pas se
recasser si la convention HTML output change.

---

## Pattern à suivre pour de futures règles lint custom

1. **Privilégier les règles built-in** (`no-restricted-syntax`,
   `no-restricted-imports`, `no-restricted-globals`) avant de créer un
   plugin custom : message d'erreur personnalisable via `message`,
   sélecteurs AST/esquery puissants, zéro dépendance.
2. **Niveau `error`** par défaut (les warnings sont ignorés en pratique
   au CI).
3. **Documenter le contournement légitime** explicitement dans la règle
   et dans une doc dédiée — sinon les développeurs paniquent et désactivent
   la règle au-dessus du fichier.
4. **Vérifier que le repo passe le lint** avant d'activer la règle (sinon
   on bloque tout le monde au prochain push).
5. **Tester négativement** (ajouter le pattern → lint fail) puis
   positivement (retirer → lint pass).

---

## Backlog

- T-266 (en parallèle, ce chantier) : règle ESLint similaire pour préfixe
  `terroir_` sur clés `sessionStorage`/`localStorage`. Pattern aligné
  (`no-restricted-syntax` avec sélecteur sur `CallExpression`).
- Si le besoin évolue (ex. interdire d'autres caractères Unicode
  problématiques type `…` U+2026, `—` U+2014 dans certains contextes),
  étendre `no-restricted-syntax` avec des sélecteurs supplémentaires
  plutôt que créer un plugin.
