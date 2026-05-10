import { verifyOptOutToken } from '@/lib/rgpd/opt-out-token';
import { UnsubscribeForm } from './UnsubscribeForm';
import { RequestLinkForm } from './_components/RequestLinkForm';

// 2-step confirm pour éviter que les prefetchers d'email (Outlook Safe Links,
// scanners antivirus) déclenchent l'opt-out à l'insu du destinataire : ici
// on vérifie le token et on affiche un bouton ; la suppression réelle ne
// survient que sur POST explicite via server action.
//
// Si token absent ou invalide : fallback standalone permettant à un lead qui
// a perdu son email (ou n'en a jamais reçu) de redemander un lien
// enumeration-resistant (V2 opt-out RGPD).

export default async function DesabonnementPage(
  props: {
    searchParams: Promise<{ email?: string; token?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const email = (searchParams.email ?? '').trim().toLowerCase();
  const token = (searchParams.token ?? '').trim();

  // F-027 : verifyOptOutToken retourne { valid, expired? } pour distinguer
  // "lien invalide" (HMAC fail, format cassé) de "lien expiré" (TTL 30j
  // dépassé). On affiche un message différent dans le fallback RequestLinkForm.
  const verification =
    email && token
      ? verifyOptOutToken(email, token)
      : { valid: false as const, expired: false };
  const valid = verification.valid;
  const hasToken = Boolean(token);
  const wasExpired = !verification.valid && verification.expired;

  return (
    <section className="bg-bg">
      <div className="max-w-lg mx-auto px-6 py-20 md:py-28">
        <h1 className="font-serif text-[36px] md:text-[44px] text-green-900 leading-tight">
          Désabonnement
        </h1>
        <p className="mt-3 text-[15px] text-dark/70">
          Suppression de vos coordonnées de la base leads producteurs TerrOir.
        </p>

        <div className="mt-8">
          {valid ? (
            <UnsubscribeForm email={email} token={token} />
          ) : (
            <RequestLinkForm
              helperText={
                wasExpired
                  ? "Votre lien a expiré (durée de validité 30 jours). Renseignez votre email pour recevoir un nouveau lien de désabonnement."
                  : hasToken
                    ? "Votre lien n'est plus valide. Renseignez votre email pour recevoir un nouveau lien de désabonnement."
                    : undefined
              }
            />
          )}
        </div>
      </div>
    </section>
  );
}
