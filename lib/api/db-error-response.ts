import "server-only";
import { NextResponse } from "next/server";
import type { PostgrestError } from "@supabase/supabase-js";

// bugs-P1-5 (T9 2026-05-07) — Helper standardisé pour réponses 500 sur
// erreur Postgres/Supabase via routes API publiques.
//
// Avant : `return NextResponse.json({ error: error.message }, { status: 500 })`
// Après : `return dbErrorResponse(error, "CART_VALIDATE_SELECT")`
//
// Pourquoi : un attaquant qui sonde une route publique ne doit pas pouvoir
// extraire des messages bruts Postgres (nom de table/colonne, indices,
// schéma RLS implicite). On loggue côté serveur avec un préfixe grep-able
// pour la SRE, et on retourne un message générique au caller.
//
// Doctrine T-200/T-218 : pas de leak de structure DB côté surface publique.
// Aligné sur les routes existantes qui le font déjà bien (admin/reviews
// moderate qui sont auth gated retourne aussi le message — c'est OK pour
// les surfaces admin).

type DbLikeError =
  | PostgrestError
  | Error
  | { message?: string; code?: string; details?: string }
  | null
  | undefined;

export function dbErrorResponse(
  error: DbLikeError,
  logTag: string,
  extraContext?: Record<string, string | number | null | undefined>,
) {
  const message = error?.message ?? "(no message)";
  const code = (error as { code?: string } | null)?.code;
  const contextStr = extraContext
    ? Object.entries(extraContext)
        .filter(([, v]) => v !== undefined && v !== null)
        .map(([k, v]) => `${k}=${v}`)
        .join(" ")
    : "";
  console.error(
    `[${logTag}] db_error code=${code ?? "none"} ${contextStr} message=${message}`,
  );
  return NextResponse.json(
    { error: "Internal database error" },
    { status: 500 },
  );
}
