import Link from 'next/link';
import type { Metadata } from 'next';
import { Logo } from '@/components/ui';
import { NEXT_PUBLIC_APP_URL, NEXT_PUBLIC_PRODUCER_URL } from '@/lib/env/urls';

export const metadata: Metadata = {
  title: 'Administration — TerrOir',
  robots: { index: false, follow: false },
};

export default function AdminAccueilPage() {
  const year = new Date().getFullYear();

  return (
    <div className="min-h-screen bg-bg flex flex-col">
      <main className="flex-1 flex items-center justify-center px-6 py-16">
        <div className="w-full max-w-md text-center">
          <Logo size="lg" href="/" />

          <h1 className="mt-8 font-serif text-[32px] md:text-[36px] text-green-900 leading-tight">
            Administration TerrOir
          </h1>
          <p className="mt-4 text-[15px] text-dark/70 leading-relaxed">
            Espace réservé à l&apos;équipe TerrOir.
            <br />
            Connectez-vous pour accéder au back-office.
          </p>

          <div className="mt-8">
            <Link
              href="/connexion"
              className="inline-flex items-center justify-center rounded-md bg-green-900 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-green-900/90 focus:outline-none focus:ring-2 focus:ring-green-700 focus:ring-offset-2"
            >
              Connexion
            </Link>
          </div>

          <div className="mt-12 pt-8 border-t border-dark/[0.08] text-[13px] text-dark/55 space-y-1">
            <p>
              Vous êtes producteur ?{' '}
              <a
                href={`${NEXT_PUBLIC_PRODUCER_URL}/`}
                className="text-green-700 hover:underline"
              >
                pro.terroir-local.fr
              </a>
            </p>
            <p>
              Vous êtes client ?{' '}
              <a
                href={`${NEXT_PUBLIC_APP_URL}/`}
                className="text-green-700 hover:underline"
              >
                terroir-local.fr
              </a>
            </p>
          </div>
        </div>
      </main>

      <footer className="px-6 py-6 text-center text-[12px] text-dark/45">
        TerrOir — Espace administrateur · {year}
      </footer>
    </div>
  );
}
