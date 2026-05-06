"use server";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/auth/session";
import { logProducerIndicateursEvent } from "@/lib/audit-logs/log-producer-indicateurs-event";
import { DECLARATION_VERACITE_WORDING_VERSION } from "@/lib/producers/declaration-veracite";
import { SCORE_CARBONE_ENUMS_VERSION } from "@/lib/producers/score-carbone-enums-versions";
import {
  ALIMENTATION_VALUES,
  DENSITE_ANIMALE_VALUES,
  MODE_ELEVAGE_VALUES,
  type Alimentation,
  type DensiteAnimale,
  type ModeElevage,
} from "@/lib/producers/score-carbone-enums";

// T-232 — Server action de rectification post-onboarding des 3 enums
// score-carbone par le producteur depuis sa page /ma-page. La RPC
// `update_producer_indicateurs` (migration 20260507400000) :
//   - n'écrit QUE les 3 enums + colonnes declaration_indicateurs_*
//   - préserve statut/slug/badges/etc.
//   - ré-applique la sémantique DGCCRF de re-dating snapshot (T-241/T-243)
//
// Validation Zod amont côté caller : on whitelist les valeurs d'enums
// connues — un producer qui forgerait un POST avec une valeur d'enum
// inexistante doit être rejeté avant l'appel RPC. Pas de défense en
// profondeur côté SQL (la migration T-200 score-carbone n'a PAS de CHECK
// constraint sur les colonnes enum, c'est text libre — décision T-220
// codegen TS source de vérité, à dériver vers SQL plus tard si besoin).

export type UpdateIndicateursResult =
  | { ok: true }
  | { ok: false; error: string };

export type UpdateIndicateursInput = {
  mode_elevage: ModeElevage | null;
  alimentation: Alimentation | null;
  densite_animale: DensiteAnimale | null;
  declaration_cochee: boolean;
};

function isValidModeElevage(v: unknown): v is ModeElevage | null {
  return v === null || (MODE_ELEVAGE_VALUES as readonly string[]).includes(v as string);
}
function isValidAlimentation(v: unknown): v is Alimentation | null {
  return v === null || (ALIMENTATION_VALUES as readonly string[]).includes(v as string);
}
function isValidDensite(v: unknown): v is DensiteAnimale | null {
  return v === null || (DENSITE_ANIMALE_VALUES as readonly string[]).includes(v as string);
}

export async function updateProducerIndicateursAction(
  input: UpdateIndicateursInput,
): Promise<UpdateIndicateursResult> {
  const session = await getSessionUser();
  if (!session) {
    return { ok: false, error: "Session expirée" };
  }

  if (
    !isValidModeElevage(input.mode_elevage) ||
    !isValidAlimentation(input.alimentation) ||
    !isValidDensite(input.densite_animale)
  ) {
    return { ok: false, error: "Valeur d'indicateur invalide" };
  }

  const anyEnumSet =
    input.mode_elevage !== null ||
    input.alimentation !== null ||
    input.densite_animale !== null;

  // Si au moins un enum non-NULL et déclaration cochée requise par UX (cohérent
  // avec invitationBusinessInfoSchema). Si tous les enums sont NULL, la case
  // n'a pas besoin d'être cochée (rien à attester) — mais la RPC SQL gère ce
  // cas en n'écrivant rien sur les colonnes declaration_*.
  if (anyEnumSet && !input.declaration_cochee) {
    return {
      ok: false,
      error:
        "Vous devez cocher la case d'attestation pour modifier vos indicateurs.",
    };
  }

  const admin = createSupabaseAdminClient();
  const { error } = await admin.rpc("update_producer_indicateurs", {
    p_user_id: session.id,
    p_mode_elevage: input.mode_elevage,
    p_alimentation: input.alimentation,
    p_densite_animale: input.densite_animale,
    p_declaration_cochee: input.declaration_cochee,
    p_wording_version: DECLARATION_VERACITE_WORDING_VERSION,
    p_enums_version: SCORE_CARBONE_ENUMS_VERSION,
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  // Audit log : trace forensique de la rectification (cluster
  // producer_indicateurs_*). Fail-safe : un échec d'écriture audit ne
  // casse pas la rectification (cohérent pattern logXxxEvent).
  await logProducerIndicateursEvent({
    eventType: "producer_indicateurs_updated",
    userId: session.id,
    metadata: {
      mode_elevage: input.mode_elevage,
      alimentation: input.alimentation,
      densite_animale: input.densite_animale,
      declaration_cochee: input.declaration_cochee,
    },
  });

  return { ok: true };
}
