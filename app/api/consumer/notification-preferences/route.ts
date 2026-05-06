import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import {
  getUserNotificationPreferences,
  upsertUserNotificationPreference,
} from "@/lib/notifications/preferences";
import { logReviewEvent } from "@/lib/audit-logs/log-review-event";

// Toggle d'une pref notification consumer/producer (l'API est partagée :
// la pref est self-only, le rôle ne change rien).

const bodySchema = z.object({
  key: z.enum(["email_review_response"]),
  value: z.boolean(),
});

export async function PATCH(request: Request) {
  const session = await getSessionUser();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Body invalide" },
      { status: 400 },
    );
  }

  // Lookup valeur précédente pour audit (utile pour distinguer activation
  // vs désactivation post-mortem si litige légal CGU 6.4).
  const previous = await getUserNotificationPreferences(session.id);
  const previousValue = previous[parsed.data.key];

  const result = await upsertUserNotificationPreference(
    session.id,
    parsed.data.key,
    parsed.data.value,
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  await logReviewEvent({
    eventType: "notification_preference_updated",
    userId: session.id,
    metadata: {
      pref_key: parsed.data.key,
      new_value: parsed.data.value,
      previous_value: previousValue,
    },
  });

  return NextResponse.json({ ok: true });
}
