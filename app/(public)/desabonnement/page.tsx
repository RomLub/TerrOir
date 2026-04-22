import { verifyOptOutToken } from '@/lib/rgpd/opt-out-token';
import { UnsubscribeForm } from './UnsubscribeForm';

// 2-step confirm pour éviter que les prefetchers d'email (Outlook Safe Links,
// scanners antivirus) déclenchent l'opt-out à l'insu du destinataire : ici
// on vérifie le token et on affiche un bouton ; la suppression réelle ne
// survient que sur POST explicite via server action.

export default function DesabonnementPage({
  searchParams,
}: {
  searchParams: { email?: string; token?: string };
}) {
  const email = (searchParams.email ?? '').trim().toLowerCase();
  const token = (searchParams.token ?? '').trim();

  const valid = email && token && verifyOptOutToken(email, token);

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
            <div className="rounded-2xl border border-dark/10 bg-white p-6">
              <h2 className="font-serif text-[22px] text-green-900">
                Lien invalide ou expiré
              </h2>
              <p className="mt-2 text-[14px] text-dark/70 leading-relaxed">
                Le lien que vous avez suivi n&apos;est pas reconnu. Si vous
                souhaitez être supprimé de notre base, merci de nous contacter à{' '}
                <a
                  href="mailto:admin@terroir-local.fr"
                  className="text-green-700 underline hover:text-green-900"
                >
                  admin@terroir-local.fr
                </a>
                .
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
