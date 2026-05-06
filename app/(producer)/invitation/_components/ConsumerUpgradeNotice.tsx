// T-105 — Notice UX affichée au-dessus du wizard onboarding quand l'email
// invité existe déjà comme consumer (caseKind 'consumer-login'). Contenu
// volontairement rassurant : on précise que l'historique d'achats consumer
// est préservé après upgrade. Tutoiement (TerrOir convention).
//
// Pas de side-effect : juste un blob informatif. L'auto-link vers le compte
// producer se fait à la step 1 du wizard (login-and-upgrade.ts → upgrade
// roles + INSERT producers). Cf. accept-invitation.ts pour le flow logged-in
// déjà cohérent.

export function ConsumerUpgradeNotice() {
  return (
    <div
      role="status"
      className="mb-6 flex items-start gap-3 rounded-md border border-terroir-green-700/30 bg-terroir-green-100 px-4 py-3 text-sm text-terroir-green-700"
    >
      <span aria-hidden className="mt-0.5 text-base">
        ℹ
      </span>
      <div>
        <p className="font-semibold">Compte client déjà existant</p>
        <p className="mt-1 text-terroir-green-700/85">
          Cet email est déjà associé à un compte client. En continuant, tu
          vas l&rsquo;upgrader en compte producteur tout en gardant ton
          historique d&rsquo;achats.
        </p>
      </div>
    </div>
  );
}
