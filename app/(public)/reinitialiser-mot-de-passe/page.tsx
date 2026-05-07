import Link from "next/link";
import { ResetPasswordForm } from "./_components/ResetPasswordForm";

// Étape 2 du flow reset password (étape 1 = /mot-de-passe-oublie). L'user
// arrive ici via le lien custom de l'email Supabase :
//   ${SITE_URL}/reinitialiser-mot-de-passe?token_hash={{ .TokenHash }}&type=recovery
//
// Le template Supabase Reset Password DOIT pointer ici directement (et NON
// passer par /auth/callback via {{ .ConfirmationURL }}) — sinon Supabase
// crée la session puis redirige vers /compte sans jamais demander à l'user
// de définir un nouveau mot de passe (mauvaise UX, ancien mdp toujours
// valide).
//
// La vérification du token + l'update du mot de passe sont regroupés dans
// la même server action `updatePasswordAction` car verifyOtp consomme le
// token (one-shot) et écrit les cookies de session — opération impossible
// depuis un Server Component (cookies read-only).

type SearchParams = {
  token_hash?: string | string[];
  type?: string | string[];
};

function pickParam(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export default async function ReinitialiserMotDePassePage(
  props: {
    searchParams: Promise<SearchParams>;
  }
) {
  const searchParams = await props.searchParams;
  const tokenHash = pickParam(searchParams.token_hash);
  const type = pickParam(searchParams.type);

  const isShapeValid =
    tokenHash !== undefined && tokenHash.length >= 10 && type === "recovery";

  return (
    <main className="flex min-h-[70vh] items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm space-y-4 rounded-2xl border border-terroir-border bg-white p-6 shadow-sm">
        <div>
          <h1 className="font-serif text-2xl text-terroir-ink">
            Nouveau mot de passe
          </h1>
          <p className="mt-1 text-sm text-terroir-muted">
            {isShapeValid
              ? "Choisis un mot de passe d'au moins 8 caractères."
              : "Le lien que tu as utilisé est invalide ou incomplet."}
          </p>
        </div>

        {isShapeValid ? (
          <ResetPasswordForm tokenHash={tokenHash} />
        ) : (
          <div className="space-y-3">
            <div
              role="alert"
              className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
            >
              Lien invalide ou expiré. Demande un nouveau lien de
              réinitialisation.
            </div>
            <Link
              href="/mot-de-passe-oublie"
              className="block text-center text-sm text-terroir-green underline hover:opacity-80"
            >
              Demander un nouveau lien
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}
