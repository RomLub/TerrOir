import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { listCuts, createCut } from "@/lib/products/admin/cuts";
import { AdminCategorisationSlugDuplicate } from "@/lib/products/admin/errors";
import { logCategorisationEvent } from "@/lib/audit-logs/log-categorisation-event";

// Routes admin /api/admin/cuts — T-130.
// GET supporte ?animal_id=<uuid> pour filtrage scopé (deep-link UI).

const SLUG_REGEX = /^[a-z0-9-]+$/;
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const createSchema = z.object({
  animal_id: z.string().regex(UUID_REGEX, "animal_id doit être un UUID"),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(SLUG_REGEX, "slug doit être en kebab-case (a-z, 0-9, -)"),
  name: z.string().trim().min(1).max(100),
  sort_order: z.number().int().min(0).max(10_000),
});

export async function GET(request: Request) {
  const session = await getSessionUser();
  if (!session?.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const animalId = url.searchParams.get("animal_id");
  // Validation soft : si présent mais pas un UUID → 400 (évite SQL parse
  // error côté Supabase — defense-in-depth).
  if (animalId !== null && !UUID_REGEX.test(animalId)) {
    return NextResponse.json(
      { error: "animal_id invalide" },
      { status: 400 },
    );
  }

  const admin = createSupabaseAdminClient();
  try {
    const rows = await listCuts(
      admin,
      animalId ? { animal_id: animalId } : undefined,
    );
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
    const result = await createCut(admin, parsed.data);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    await logCategorisationEvent({
      eventType: "admin_cut_created",
      userId: session.id,
      metadata: {
        id: result.data.id,
        animal_id: parsed.data.animal_id,
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
