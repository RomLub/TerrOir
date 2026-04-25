import { ConnexionForm } from "./connexion-form";

// Server entry : extrait searchParams.redirectTo pour le passer au form
// client. La validation de sécurité (anti open-redirect) est faite côté
// loginAction via resolvePostLoginPath ; on transmet ici tel quel — React
// échappe la value en HTML donc pas de risque XSS.
export default function ConnexionPage({
  searchParams,
}: {
  searchParams: { redirectTo?: string | string[] };
}) {
  const raw = searchParams.redirectTo;
  const redirectTo = typeof raw === "string" ? raw : undefined;
  return <ConnexionForm redirectTo={redirectTo} />;
}
