import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getOwnedProducerId } from "@/lib/auth/producerOwnership";
import {
  previewPickup,
  validatePickup,
  type PickupValidationError,
} from "@/lib/orders/pickup-validation";
import {
  consumeRateLimit,
  getPickupValidationRateLimit,
} from "@/lib/rate-limit";
import { logPickupEvent } from "@/lib/audit-logs/log-pickup-event";
import { sendPickupReviewEmail } from "@/lib/orders/send-pickup-review-email";
import { NEXT_PUBLIC_PRODUCER_URL } from "@/lib/env/urls";

// =============================================================================
// Route code-based pour la validation pickup producer (LOT 3 chantier
// pickup-validation 2026-05-06). Distincte des routes id-based existantes
// (/api/orders/[id]/complete) : ici, le code seul résout l'order et
// déclenche la transition confirmed → completed.
//
// GET ?code=X : preview lecture seule (pour modale UI haut-de-liste avant
//               confirmation 2 étapes — LOT 4).
// POST { code }: validation effective + email J0 review-request.
//
// Garde-fous (defense in depth) :
//   1. Auth producer obligatoire (session + getOwnedProducerId)
//   2. Rate-limit Upstash 10/min keying par producerId
//   3. Format Zod strict TRR-XXXXX (côté helper)
//   4. Scope strict producer_id post-lookup (anti-info-leakage : 404
//      générique unifié pour code_unknown ET wrong_producer)
//   5. UPDATE atomique avec WHERE statut='confirmed' (race-safe sur
//      validations concurrentes — cf. lib/orders/pickup-validation.ts)
//   6. Audit log cluster pickup_* sur 5 events forensiques
// =============================================================================

const postBodySchema = z.object({
  code: z.string().trim().min(1, "code requis"),
});

type RateLimitOutcome =
  | { kind: "allowed" }
  | {
      kind: "rate_limited";
      response: NextResponse;
    };

interface AuthContext {
  userId: string;
  producerId: string;
}

interface ErrorMapping {
  status: number;
  body: Record<string, unknown>;
  auditReason: string;
}

function mapPickupError(error: PickupValidationError): ErrorMapping {
  switch (error.kind) {
    case "code_format_invalid":
      return {
        status: 400,
        body: { error: "invalid_code_format" },
        auditReason: "code_format_invalid",
      };
    case "code_unknown":
    case "wrong_producer":
      // Anti-info-leakage : 404 unifié en surface API. Distinction
      // préservée uniquement dans audit log interne.
      return {
        status: 404,
        body: { error: "pickup_code_unknown" },
        auditReason: error.kind,
      };
    case "order_not_confirmed":
      return {
        status: 409,
        body: {
          error: "pickup_order_not_confirmed",
          current_status: error.current_status,
          detail_url: `${NEXT_PUBLIC_PRODUCER_URL}/commandes/${error.order_id}`,
        },
        auditReason: `order_not_confirmed:${error.current_status}`,
      };
    case "order_already_completed":
      return {
        status: 409,
        body: {
          error: "pickup_already_completed",
          completed_at: error.completed_at,
        },
        auditReason: "order_already_completed",
      };
    case "order_cancelled":
      return {
        status: 409,
        body: { error: "pickup_order_cancelled" },
        auditReason: "order_cancelled",
      };
    case "order_refunded":
      return {
        status: 409,
        body: { error: "pickup_order_refunded" },
        auditReason: "order_refunded",
      };
  }
}

async function authenticateProducer(): Promise<
  | { ok: true; ctx: AuthContext; admin: ReturnType<typeof createSupabaseAdminClient> }
  | { ok: false; response: NextResponse }
> {
  const session = await getSessionUser();
  if (!session) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  const admin = createSupabaseAdminClient();
  const producerId = await getOwnedProducerId(admin, session.id);
  if (!producerId) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }
  return { ok: true, ctx: { userId: session.id, producerId }, admin };
}

async function enforceRateLimit(
  ctx: AuthContext,
  method: "GET" | "POST",
): Promise<RateLimitOutcome> {
  const result = await consumeRateLimit(
    getPickupValidationRateLimit(),
    `producer:${ctx.producerId}`,
  );
  if (result.success) {
    return { kind: "allowed" };
  }
  await logPickupEvent({
    eventType: "pickup_attempt_rate_limited",
    userId: ctx.userId,
    metadata: { producer_id: ctx.producerId, method },
  });
  const retrySec = Math.max(
    1,
    Math.ceil((result.reset - Date.now()) / 1000),
  );
  const response = NextResponse.json(
    { error: "rate_limit", retry_after_seconds: retrySec },
    { status: 429, headers: { "Retry-After": String(retrySec) } },
  );
  return { kind: "rate_limited", response };
}

// -----------------------------------------------------------------------------
// GET — preview (lecture seule)
// -----------------------------------------------------------------------------

export async function GET(request: Request) {
  const auth = await authenticateProducer();
  if (!auth.ok) return auth.response;
  const { ctx, admin } = auth;

  const limitOutcome = await enforceRateLimit(ctx, "GET");
  if (limitOutcome.kind === "rate_limited") return limitOutcome.response;

  const url = new URL(request.url);
  const rawCode = url.searchParams.get("code") ?? "";

  const result = await previewPickup(admin, rawCode, ctx.producerId);

  if (result.ok) {
    await logPickupEvent({
      eventType: "pickup_preview_ok",
      userId: ctx.userId,
      metadata: {
        producer_id: ctx.producerId,
        order_id: result.order.id,
      },
    });
    return NextResponse.json({
      order: {
        id: result.order.id,
        code_commande: result.order.code_commande,
        numero_commande: result.order.numero_commande,
        consumer_name: result.order.consumer_name,
        items: result.order.items,
        total_amount: result.order.total_amount,
        status: result.order.status,
        created_at: result.order.created_at,
      },
    });
  }

  const mapping = mapPickupError(result.error);
  await logPickupEvent({
    eventType: "pickup_preview_invalid",
    userId: ctx.userId,
    metadata: {
      producer_id: ctx.producerId,
      reason: mapping.auditReason,
    },
  });
  return NextResponse.json(mapping.body, { status: mapping.status });
}

// -----------------------------------------------------------------------------
// POST — validation effective (transition confirmed → completed + email J0)
// -----------------------------------------------------------------------------

export async function POST(request: Request) {
  const auth = await authenticateProducer();
  if (!auth.ok) return auth.response;
  const { ctx, admin } = auth;

  const limitOutcome = await enforceRateLimit(ctx, "POST");
  if (limitOutcome.kind === "rate_limited") return limitOutcome.response;

  const parsed = postBodySchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid body" },
      { status: 400 },
    );
  }

  const result = await validatePickup(admin, parsed.data.code, ctx.producerId);

  if (result.ok) {
    await logPickupEvent({
      eventType: "pickup_validated",
      userId: ctx.userId,
      metadata: {
        producer_id: ctx.producerId,
        order_id: result.order.id,
        completed_at: result.order.completed_at,
      },
    });
    // Email J0 review-request (best-effort : un échec d'envoi ne doit
    // pas casser la validation pickup en DB déjà commitée).
    try {
      await sendPickupReviewEmail(admin, {
        orderId: result.order.id,
        consumerId: result.order.consumer_id,
        producerId: ctx.producerId,
        codeCommande: result.order.code_commande,
      });
    } catch (err) {
      console.warn(
        `PICKUP_REVIEW_EMAIL_WARN order_id=${result.order.id} error=${(err as Error).message}`,
      );
    }
    return NextResponse.json({
      order: {
        id: result.order.id,
        code_commande: result.order.code_commande,
        numero_commande: result.order.numero_commande,
        consumer_name: result.order.consumer_name,
        status: result.order.status,
        completed_at: result.order.completed_at,
      },
    });
  }

  const mapping = mapPickupError(result.error);
  await logPickupEvent({
    eventType: "pickup_attempt_invalid",
    userId: ctx.userId,
    metadata: {
      producer_id: ctx.producerId,
      reason: mapping.auditReason,
    },
  });
  return NextResponse.json(mapping.body, { status: mapping.status });
}
