import { ConnexionForm } from "./connexion-form";

// Mappe un `reason` code symbolique court (expired/invalid/missing/technical)
// remonté par /auth/callback sur un message FR final. Fix T-318 : codes
// catégoriels au lieu du verbatim Supabase, anti information disclosure (la
// classification est faite côté serveur via classifyAuthError, le verbatim
// reste côté logs Vercel pour debug). Le default catch-all couvre aussi les
// vieux emails legacy en transit avec verbatim brut (graceful degradation).
function getFriendlyAuthError(reason: string | undefined): string | null {
  if (!reason) return null;
  switch (reason) {
    case "expired":
      return "Ce lien a expiré. Demandez un nouveau lien magique.";
    case "invalid":
      return "Ce lien n'est plus valide. Demandez un nouveau lien magique.";
    case "missing":
      return "Lien incomplet. Demandez un nouveau lien magique.";
    case "technical":
    default:
      return "Une erreur est survenue lors de la connexion. Réessayez.";
  }
}

// Server entry : extrait searchParams.redirectTo pour le passer au form
// client. La validation de sécurité (anti open-redirect) est faite côté
// loginAction via resolvePostLoginPath ; on transmet ici tel quel — React
// échappe la value en HTML donc pas de risque XSS.
export default async function ConnexionPage(
  props: {
    searchParams: Promise<{
      redirectTo?: string | string[];
      error?: string | string[];
      reason?: string | string[];
    }>;
  }
) {
  const searchParams = await props.searchParams;
  const raw = searchParams.redirectTo;
  const redirectTo = typeof raw === "string" ? raw : undefined;

  const errorParam =
    typeof searchParams.error === "string" ? searchParams.error : undefined;
  const reasonParam =
    typeof searchParams.reason === "string" ? searchParams.reason : undefined;
  const callbackError =
    errorParam === "auth_callback" ? getFriendlyAuthError(reasonParam) : null;

  return (
    <ConnexionForm redirectTo={redirectTo} callbackError={callbackError} />
  );
}
