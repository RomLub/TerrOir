import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  listCategories,
  createCategory,
} from "@/lib/products/admin/categories";
import { AdminCategorisationSlugDuplicate } from "@/lib/products/admin/errors";
import { logCategorisationEvent } from "@/lib/audit-logs/log-categorisation-event";

// Routes admin /api/admin/categories — T-130.
// GET  : liste pour usage backend (pages admin font READ direct supabase
//        sur RLS public read, mais l'endpoint reste disponible pour
//        scripts/intégrations futures).
// POST : création + audit log admin_category_created.

const SLUG_REGEX = /^[a-z0-9-]+$/;
const NAME_MIN = 1;
const NAME_MAX = 100;

const createSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(SLUG_REGEX, "slug doit être en kebab-case (a-z, 0-9, -)"),
  name: z.string().trim().min(NAME_MIN).max(NAME_MAX),
  sort_order: z.number().int().min(0).max(10_000),
});

export async function GET() {
  const session = await getSessionUser();
  if (!session?.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createSupabaseAdminClient();
  try {
    const rows = await listCategories(admin);
    return NextResponse.json({ rows });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const session = await getSessionUser();
  if (!session?.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = createSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid body" },
      { status: 400 },
    );
  }

  const admin = createSupabaseAdminClient();
  try {
    const result = await createCategory(admin, parsed.data);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    await logCategorisationEvent({
      eventType: "admin_category_created",
      userId: session.id,
      metadata: {
        id: result.data.id,
        slug: parsed.data.slug,
        name: parsed.data.name,
        sort_order: parsed.data.sort_order,
      },
    });

    return NextResponse.json({ id: result.data.id }, { status: 201 });
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
