import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  getCategory,
  updateCategory,
  deleteCategory,
  countCategoryDependencies,
} from "@/lib/products/admin/categories";
import {
  AdminCategorisationDeleteBlocked,
  AdminCategorisationSlugDuplicate,
} from "@/lib/products/admin/errors";
import { logCategorisationEvent } from "@/lib/audit-logs/log-categorisation-event";

// Routes admin /api/admin/categories/[id] — T-130.
// GET    : détail + count produits liés (utile UI confirm DELETE)
// PATCH  : update + audit log avec before/after
// DELETE : delete avec garde-fou applicatif → 409 si dépendances > 0

const SLUG_REGEX = /^[a-z0-9-]+$/;

const updateSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(SLUG_REGEX, "slug doit être en kebab-case (a-z, 0-9, -)"),
  name: z.string().trim().min(1).max(100),
  sort_order: z.number().int().min(0).max(10_000),
});

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, props: RouteContext) {
  const params = await props.params;
  const session = await getSessionUser();
  if (!session?.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const admin = createSupabaseAdminClient();
  const row = await getCategory(admin, params.id);
  if (!row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  // Count produits liés en complément (UI affiche AVANT confirm DELETE)
  const deps = await countCategoryDependencies(admin, params.id);
  return NextResponse.json({ row, dependencies: deps });
}

export async function PATCH(request: Request, props: RouteContext) {
  const params = await props.params;
  const session = await getSessionUser();
  if (!session?.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = updateSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid body" },
      { status: 400 },
    );
  }

  const admin = createSupabaseAdminClient();

  // Pre-SELECT pour 404 + capture before pour audit log diff. Sans cette
  // SELECT, UPDATE eq id inexistant renvoie 0 rows sans erreur (cf. pattern
  // gms-prices route).
  const before = await getCategory(admin, params.id);
  if (!before) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const result = await updateCategory(admin, params.id, parsed.data);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    await logCategorisationEvent({
      eventType: "admin_category_updated",
      userId: session.id,
      metadata: {
        id: params.id,
        before: {
          slug: before.slug,
          name: before.name,
          sort_order: before.sort_order,
        },
        after: parsed.data,
      },
    });

    return NextResponse.json({ id: params.id });
  } catch (e) {
    if (e instanceof AdminCategorisationSlugDuplicate) {
      return NextResponse.json(
        { error: "slug_duplicate", slug: e.slug },
        { status: 409 },
      );
    }
    throw e;
  }
}

export async function DELETE(_request: Request, props: RouteContext) {
  const params = await props.params;
  const session = await getSessionUser();
  if (!session?.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createSupabaseAdminClient();
  const before = await getCategory(admin, params.id);
  if (!before) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const result = await deleteCategory(admin, params.id);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    await logCategorisationEvent({
      eventType: "admin_category_deleted",
      userId: session.id,
      metadata: {
        id: params.id,
        slug: before.slug,
        name: before.name,
        sort_order: before.sort_order,
      },
    });

    return NextResponse.json({ id: params.id });
  } catch (e) {
    if (e instanceof AdminCategorisationDeleteBlocked) {
      return NextResponse.json(
        {
          error: "delete_blocked",
          dependencies: e.dependencies,
        },
        { status: 409 },
      );
    }
    throw e;
  }
}
