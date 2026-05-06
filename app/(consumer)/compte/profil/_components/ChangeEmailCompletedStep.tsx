"use client";

// =============================================================================
// CompletedStep + CompleteErrorPanel — états finaux ChangeEmailSection
// =============================================================================
// Extraction T-013 PR2 C2.10 pour garder ChangeEmailSection.tsx sous le seuil
// 300 lignes (guideline plan PHASE 2.A). Regroupe :
//   - CompletedStep : écran succès post-completeEmailChange ok
//   - CompleteErrorPanel : message inline si completeEmailChange retourne
//     un reason d'erreur (collision, désynchro, etc.) — l'user redémarre.
//   - completeReasonToMessage : mapping FR pour les 7 reasons possibles.
// =============================================================================

import { type CompleteEmailChangeReason } from "../_actions/complete-email-change";

export function CompletedStep({
  newEmail,
  onClose,
}: {
  newEmail: string;
  onClose: () => void;
}) {
  return (
    <div className="mt-6 space-y-3 rounded-md border border-green-200 bg-green-50 p-4">
      <p className="text-sm font-medium text-terroir-green-700">
        Email mis à jour avec succès.
      </p>
      <p className="text-sm text-terroir-ink">
        Ton adresse de connexion est désormais <strong>{newEmail}</strong>.
      </p>
      <p className="text-sm text-terroir-muted">
        Tes sessions actives sur les autres appareils ont été déconnectées —
        tu resteras connecté sur cet appareil.
      </p>
      <button
        type="button"
        onClick={onClose}
        className="rounded-md border border-terroir-border bg-white px-4 py-2 text-sm font-medium text-terroir-ink hover:bg-terroir-bg/60"
      >
        Fermer
      </button>
    </div>
  );
}

export function CompleteErrorPanel({
  reason,
  onRestart,
}: {
  reason: CompleteEmailChangeReason;
  onRestart: () => void;
}) {
  return (
    <div className="mt-6 space-y-3 rounded-md border border-red-200 bg-red-50 p-4">
      <p className="text-sm font-medium text-red-700">
        Impossible de finaliser le changement
      </p>
      <p className="text-sm text-terroir-ink">
        {completeReasonToMessage(reason)}
      </p>
      <button
        type="button"
        onClick={onRestart}
        className="rounded-md border border-terroir-border bg-white px-4 py-2 text-sm font-medium text-terroir-ink hover:bg-terroir-bg/60"
      >
        Recommencer
      </button>
    </div>
  );
}

function completeReasonToMessage(reason: CompleteEmailChangeReason): string {
  switch (reason) {
    case "session":
      return "Session expirée. Reconnecte-toi.";
    case "format":
      return "Email invalide.";
    case "same_email":
      return "Le nouvel email est identique à l'actuel.";
    case "flow_invalid":
      return "Le flow de changement n'est plus valide. Recommence depuis le début.";
    case "email_collision":
      return "Cet email est déjà utilisé par un autre compte.";
    case "auth_update_failed":
      return "Impossible de mettre à jour l'email. Réessayez plus tard.";
    case "users_update_failed":
      return "Erreur de synchronisation. Contactez le support.";
    default:
      return "Erreur inconnue. Réessayez plus tard.";
  }
}
