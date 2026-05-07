// Banner affiché en haut de la home quand l'user vient juste de supprimer
// son compte (redirect serveur depuis delete-account-action.ts ajoute
// ?compte-supprime=1). Permet de confirmer visuellement la suppression
// pendant ~5s avant que l'user ne quitte ou refresh la page.
//
// Pourquoi un Server Component pur : la home est SC, lit searchParams en
// SC. Rendu inconditionnel + masquage CSS aurait été suffisant aussi mais
// on prend le rendu conditionnel pour pas polluer le DOM des hits home
// nominaux.
//
// Le heading h2 "Compte supprimé" est ce que cible le test E2E
// delete-account.spec.ts:81 (`getByRole('heading', { name: /Compte supprimé/i })`).

export function AccountDeletedBanner() {
  return (
    <section
      role="status"
      aria-live="polite"
      className="border-b border-terroir-green-700/20 bg-terroir-green-50 px-4 py-6 text-center"
    >
      <h2 className="font-serif text-[24px] leading-tight text-terroir-green-700">
        Compte supprimé
      </h2>
      <p className="mt-2 text-sm text-terroir-muted">
        Toutes tes données personnelles ont été effacées de nos systèmes. Un
        email de confirmation t&apos;a été envoyé.
      </p>
    </section>
  );
}
