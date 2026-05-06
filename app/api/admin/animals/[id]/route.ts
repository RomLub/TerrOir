import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  getAnimal,
  updateAnimal,
  deleteAnimal,
  countAnimalDependencies,
} from "@/lib/products/admin/animals";
import {
  AdminCategorisationDeleteBlocked,
  AdminCategorisationSlugDuplicate,
} from "@/lib/products/admin/errors";
import { logCategorisationEvent } from "@/lib/audit-logs/log-categorisation-event";

// Routes admin /api/admin/animals/[id] — T-130.

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
  params: { id: string };
}

export async function GET(_request: Request, { params }: RouteContext) {
  const session = await getSessionUser();
  if (!session?.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const admin = createSupabaseAdminClient();
  const row = await getAnimal(admin, params.id);
  if (!row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const deps = await countAnimalDependencies(admin, params.id);
  return NextResponse.json({ row, dependencies: deps });
}

export async function PATCH(request: Request, { params }: RouteContext) {
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
  const before = await getAnimal(admin, params.id);
  if (!before) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const result = await updateAnimal(admin, params.id, parsed.data);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    await logCategorisationEvent({
      eventType: "admin_animal_updated",
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

export async function DELETE(_request: Request, { params }: RouteContext) {
  const session = await getSessionUser();
  if (!session?.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createSupabaseAdminClient();
  const before = await getAnimal(admin, params.id);
  if (!before) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const result = await deleteAnimal(admin, params.id);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    await logCategorisationEvent({
      eventType: "admin_animal_deleted",
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
