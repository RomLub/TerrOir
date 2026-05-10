import "server-only";
import type { PostgrestError } from "@supabase/supabase-js";

// Mapping centralisé SQLSTATE Postgres → HTTP status code.
// Utilisé par les routes qui consomment des RPC SECDEF (transitions order
// F-001, create_order_with_items, etc.) pour mapper proprement les RAISE
// EXCEPTION SQL en réponses HTTP cohérentes côté caller.
//
// Pré-existant local : `app/api/orders/create/route.ts:32-53` (sqlstateToStatus)
// — extrait ici pour réutilisation par les 5 routes orders/stripe touchées
// par F-001 (confirm, complete, cancel, refund, cron/order-timeout).
//
// Codes utilisés par les RPC TerrOir :
//   02000 no_data                  → 404 (order_not_found)
//   22023 invalid_parameter_value  → 400 (invalid input : reason, target_status, code)
//   22P02 invalid_text_repr        → 400 (PostgREST UUID cast échoué)
//   23514 check_violation          → 409 (CHECK constraint DB)
//   40001 serialization_failure    → 503 (race lost — transient, client peut retry)
//   42501 insufficient_privilege   → 403 (forbidden : pas owner/admin)
//   P0001 raise_exception          → 409 (illegal transition state machine)
//   P0002 no_data_found            → 404 (lookup miss côté SECDEF)

const SQLSTATE_HTTP_MAP: Record<string, number> = {
  "02000": 404,
  "22023": 400,
  "22P02": 400,
  "23514": 409,
  "40001": 503,
  "42501": 403,
  P0001: 409,
  P0002: 404,
};

export function sqlstateToStatus(code: string | undefined | null): number {
  if (!code) return 500;
  return SQLSTATE_HTTP_MAP[code] ?? 500;
}

// Helper unifié pour transformer une PostgrestError de RPC en réponse HTTP
// avec status mappé + body sécurisé (pas de leak du message brut Postgres
// si SQLSTATE inconnu — tombe en 500 + log côté caller).
//
// Le caller reste responsable du logging via dbErrorResponse / console.error
// si besoin forensique. Cette fonction ne logge pas elle-même pour rester
// pure et composable.
export function rpcErrorPayload(
  error:
    | PostgrestError
    | { code?: string | null; message?: string | null }
    | null,
): { status: number; body: { error: string; code?: string } } {
  const code = error?.code ?? undefined;
  const status = sqlstateToStatus(code);
  if (status === 500) {
    return { status, body: { error: "Internal database error" } };
  }
  return {
    status,
    body: {
      error: error?.message ?? "RPC error",
      ...(code ? { code } : {}),
    },
  };
}
