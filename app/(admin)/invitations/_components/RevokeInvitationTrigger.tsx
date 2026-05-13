"use client";

import { useState } from "react";
import { TableActionButton } from "@/components/ui";
import { RevokeInvitationModal } from "./RevokeInvitationModal";

// Petit wrapper client : un bouton par ligne du tableau Server qui ouvre
// le modal `RevokeInvitationModal`. Pattern volontairement minimal pour
// que le coût "use client" reste local à la ligne (pas de remontée de
// toute la liste côté client).

type Props = {
  invitationId: string;
  invitationEmail: string;
};

export function RevokeInvitationTrigger({
  invitationId,
  invitationEmail,
}: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <TableActionButton
        variant="ghost-danger"
        onClick={() => setOpen(true)}
      >
        Révoquer
      </TableActionButton>
      {open && (
        <RevokeInvitationModal
          invitationId={invitationId}
          invitationEmail={invitationEmail}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
