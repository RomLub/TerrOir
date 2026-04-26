import { ConnexionForm } from "./connexion-form";

// Mappe une `reason` technique remontée par /auth/callback (Supabase) sur
// un message FR digestible. Match par substring lowercase pour absorber
// les variations exactes (URL-encoded, slicé à 120 chars, libellés
// upstream qui bougent). Fallback générique si la reason ne matche rien.
function getFriendlyAuthError(reason: string | undefined): string | null {
  if (!reason) return null;
  const r = reason.toLowerCase();
  if (r.includes("challenge") || r.includes("pkce")) {
    return "Ce lien a expiré ou n'est plus valide. Demandez un nouveau lien magique.";
  }
  if (r.includes("expired")) {
    return "Ce lien a expiré. Demandez un nouveau lien magique.";
  }
  if (r.includes("missing code") || r.includes("token_hash")) {
    return "Ce lien n'est pas valide. Demandez un nouveau lien magique.";
  }
  return "Une erreur est survenue lors de la connexion. Demandez un nouveau lien.";
}

// Server entry : extrait searchParams.redirectTo pour le passer au form
// client. La validation de sécurité (anti open-redirect) est faite côté
// loginAction via resolvePostLoginPath ; on transmet ici tel quel — React
// échappe la value en HTML donc pas de risque XSS.
export default function ConnexionPage({
  searchParams,
}: {
  searchParams: {
    redirectTo?: string | string[];
    error?: string | string[];
    reason?: string | string[];
  };
}) {
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
