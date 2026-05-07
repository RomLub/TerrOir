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

  const valid = email && token && verifyOptOutToken(email, token);
  const hasToken = Boolean(token);

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
                hasToken
                  ? "Votre lien n'est plus valide ou a expiré. Renseignez votre email pour recevoir un nouveau lien de désabonnement."
                  : undefined
              }
            />
          )}
        </div>
      </div>
    </section>
  );
}
