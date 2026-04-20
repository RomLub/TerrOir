'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Logo } from '@/components/ui';

const NAV = [
  { href: '/dashboard', label: 'Vue d\'ensemble', icon: '▦' },
  { href: '/gestion-producteurs', label: 'Producteurs', icon: '◉' },
  { href: '/commandes', label: 'Commandes', icon: '⎙' },
  { href: '/avis', label: 'Avis', icon: '★' },
];

export function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="min-h-screen bg-[#1a1a1a] text-white flex">
      <aside className="w-64 flex-shrink-0 bg-black/40 border-r border-white/[0.06] flex flex-col sticky top-0 h-screen">
        <div className="p-6 border-b border-white/[0.06]">
          <Logo variant="light" />
          <div className="mt-2 text-[11px] uppercase tracking-[0.18em] text-green-400 font-semibold">Back-office</div>
        </div>
        <nav className="flex-1 p-3 space-y-0.5">
          {NAV.map((item) => {
            const active = pathname === item.href || pathname?.startsWith(item.href + '/');
            return (
              <Link key={item.href} href={item.href}
                className={`flex items-center gap-3 px-3 h-10 rounded-lg text-[14px] transition-colors ${
                  active ? 'bg-green-700 text-white font-semibold' : 'text-white/70 hover:bg-white/5 hover:text-white'
                }`}>
                <span className={`text-[14px] w-5 text-center ${active ? 'text-white' : 'text-green-400'}`}>{item.icon}</span>
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="p-4 border-t border-white/[0.06] text-[12px] text-white/55">
          <div className="font-serif text-[15px] text-white leading-tight">TerrOir Admin</div>
          <div className="mt-0.5">v0.1 · preview</div>
        </div>
      </aside>
      <main className="flex-1 min-w-0">{children}</main>
    </div>
  );
}
