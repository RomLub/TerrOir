import "server-only";

// Erreurs typées des helpers admin de catégorisation produit (T-130).
//
// Levées par lib/products/admin/{categories,animals,cuts}.ts. Catchées par
// les routes app/api/admin/{categories,animals,cuts}/* pour traduction en
// HTTP 409 avec body structuré.
//
// Pourquoi des classes plutôt qu'un discriminé { ok: false; error: 'kind' } :
//   - Cohérence avec la sémantique métier "delete BLOQUÉ" (filet de sécurité
//     applicatif, jamais le ON DELETE SET NULL DB n'est censé s'enclencher
//     en flux normal — cf. décisions Romain LOT 1).
//   - Le call site route fait `try { delete } catch (e) { instanceof check }`
//     plus lisible qu'un nested if-discriminé.
//   - Stack trace conservée pour debug (vs un return error qui se perd).

export type CategorisationResource = "category" | "animal" | "cut";

// Dépendances bloquantes la suppression. Une seule des 2 clés peut être
// non-zero selon la ressource :
//   - category : products uniquement
//   - animal   : products ET/OU cuts (les 2 cas remontés séparément)
//   - cut      : products uniquement
export type CategorisationDependencies = {
  products?: number;
  cuts?: number;
};

export class AdminCategorisationDeleteBlocked extends Error {
  readonly resource: CategorisationResource;
  readonly dependencies: CategorisationDependencies;

  constructor(
    resource: CategorisationResource,
    dependencies: CategorisationDependencies,
  ) {
    const parts: string[] = [];
    if (dependencies.products && dependencies.products > 0) {
      parts.push(`${dependencies.products} produit(s)`);
    }
    if (dependencies.cuts && dependencies.cuts > 0) {
      parts.push(`${dependencies.cuts} morceau(x)`);
    }
    super(
      `delete blocked on ${resource}: ${parts.join(" + ") || "unknown deps"}`,
    );
    this.name = "AdminCategorisationDeleteBlocked";
    this.resource = resource;
    this.dependencies = dependencies;
  }
}

// Slug duplicate sur INSERT/UPDATE. Mappé depuis Postgres SQLSTATE 23505
// (unique_violation) côté helpers. La route traduit en 409 { error:
// 'slug_duplicate' } pour permettre une UX précise côté form.
export class AdminCategorisationSlugDuplicate extends Error {
  readonly resource: CategorisationResource;
  readonly slug: string;

  constructor(resource: CategorisationResource, slug: string) {
    super(`slug duplicate on ${resource}: ${slug}`);
    this.name = "AdminCategorisationSlugDuplicate";
    this.resource = resource;
    this.slug = slug;
  }
}

// Détecte les erreurs Postgres unique_violation à partir du retour Supabase.
// Le code SQLSTATE 23505 est exposé par PostgREST via error.code (string).
// Détection défensive multi-champ : code précis, sinon fallback message.
export function isUniqueViolation(error: {
  code?: string;
  message?: string;
} | null | undefined): boolean {
  if (!error) return false;
  if (error.code === "23505") return true;
  const msg = (error.message ?? "").toLowerCase();
  return (
    msg.includes("duplicate key") ||
    msg.includes("unique constraint") ||
    msg.includes("unique violation")
  );
}
