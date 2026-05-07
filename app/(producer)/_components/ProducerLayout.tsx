'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Logo, RoleSwitcher } from '@/components/ui';
import { useUserContext } from '@/components/providers/user-provider';

const NAV = [
  { href: '/dashboard', label: 'Dashboard', icon: '▦' },
  { href: '/commandes', label: 'Commandes', icon: '⎙' },
  { href: '/catalogue', label: 'Catalogue', icon: '❏' },
  { href: '/alertes-stock', label: 'Alertes stock', icon: '◐' },
  { href: '/creneaux', label: 'Créneaux', icon: '◷' },
  { href: '/ma-page', label: 'Ma page', icon: '◉' },
  { href: '/mes-avis', label: 'Avis', icon: '★' },
  { href: '/revenus', label: 'Revenus', icon: '€' },
  { href: '/comptabilite', label: 'Comptabilité', icon: '⊟' },
  { href: '/parametres', label: 'Paramètres', icon: '⚙' },
];

export function ProducerLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { producer, loading } = useUserContext();

  return (
    <div className="min-h-screen bg-bg flex">
      <aside className="w-64 shrink-0 bg-green-900 text-white flex flex-col sticky top-0 h-screen">
        <div className="p-6 border-b border-white/10">
          <Logo variant="mono" />
          <div className="mt-2 text-[11px] uppercase tracking-[0.18em] text-terra-300 font-semibold">Espace Producteur</div>
        </div>
        <nav className="flex-1 p-3 space-y-0.5">
          {NAV.map((item) => {
            const active = pathname === item.href || pathname?.startsWith(item.href + '/');
            return (
              <Link key={item.href} href={item.href}
                className={`flex items-center gap-3 px-3 h-10 rounded-lg text-[14px] transition-colors ${
                  active ? 'bg-terra-700 text-white font-semibold' : 'text-white/75 hover:bg-white/5 hover:text-white'
                }`}>
                <span className={`text-[14px] w-5 text-center ${active ? 'text-white' : 'text-terra-300'}`}>{item.icon}</span>
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="p-3 border-t border-white/10">
          <RoleSwitcher current="producer" variant="dark" />
        </div>
        <div className="p-4 border-t border-white/10">
          {producer ? (
            <>
              <div className="font-serif text-[18px] leading-tight">{producer.nom_exploitation}</div>
              {producer.statut === 'public' && producer.slug ? (
                <Link href={`/producteurs/${producer.slug}`} className="text-[12px] text-terra-300 hover:text-white mt-1 inline-block">
                  ↗ Voir ma page publique
                </Link>
              ) : (
                <div className="text-[12px] text-terra-300/60 mt-1">Page publique après 1er produit</div>
              )}
            </>
          ) : loading ? (
            <div className="font-serif text-[18px] leading-tight text-white/40">—</div>
          ) : null}
        </div>
      </aside>
      <main className="flex-1 min-w-0">{children}</main>
    </div>
  );
}
