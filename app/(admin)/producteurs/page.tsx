'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui';
import { AdminLayout } from '../_components/AdminLayout';

type Status = 'pending' | 'active' | 'suspended';
type Plan = 'Découverte' | 'Standard' | 'Pro';

type Producer = {
  id: string;
  slug: string;
  name: string;
  city: string;
  status: Status;
  plan: Plan;
  joinedAt: string;
  email: string;
};

const PRODUCERS: Producer[] = [
  { id: 'p1', slug: 'ferme-des-chenes', name: 'Ferme des Chênes', city: 'Charolles (71)', status: 'active', plan: 'Standard', joinedAt: '12 janv. 2026', email: 'contact@ferme-chenes.fr' },
  { id: 'p2', slug: 'domaine-saint-martin', name: 'Domaine Saint-Martin', city: 'Beaune (21)', status: 'active', plan: 'Pro', joinedAt: '03 févr. 2026', email: 'hello@saint-martin.fr' },
  { id: 'p3', slug: 'bergerie-du-causse', name: 'Bergerie du Causse', city: 'Millau (12)', status: 'pending', plan: 'Découverte', joinedAt: '18 avr. 2026', email: 'causse@exemple.fr' },
  { id: 'p4', slug: 'mareyeurs-de-groix', name: 'Mareyeurs de Groix', city: 'Groix (56)', status: 'pending', plan: 'Standard', joinedAt: '15 avr. 2026', email: 'groix@exemple.fr' },
  { id: 'p5', slug: 'potager-de-lucie', name: 'Le Potager de Lucie', city: 'Saumur (49)', status: 'active', plan: 'Découverte', joinedAt: '22 mars 2026', email: 'lucie@potager.fr' },
  { id: 'p6', slug: 'caprins-d-ardeche', name: "Caprins d'Ardèche", city: 'Aubenas (07)', status: 'suspended', plan: 'Standard', joinedAt: '08 déc. 2025', email: 'caprins@exemple.fr' },
  { id: 'p7', slug: 'ruche-d-or', name: "La Ruche d'Or", city: 'Digne-les-Bains (04)', status: 'active', plan: 'Pro', joinedAt: '14 févr. 2026', email: 'ruche@exemple.fr' },
];

type Filter = 'all' | Status;
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'Tous' },
  { value: 'pending', label: 'À valider' },
  { value: 'active', label: 'Actifs' },
  { value: 'suspended', label: 'Suspendus' },
];

const STATUS_META: Record<Status, { label: string; dot: string; bg: string; text: string }> = {
  pending: { label: 'En attente', dot: 'bg-amber-400', bg: 'bg-amber-500/10', text: 'text-amber-300' },
  active: { label: 'Actif', dot: 'bg-green-400', bg: 'bg-green-500/10', text: 'text-green-300' },
  suspended: { label: 'Suspendu', dot: 'bg-red-400', bg: 'bg-red-500/10', text: 'text-red-300' },
};

export default function AdminProducteursPage() {
  const [filter, setFilter] = useState<Filter>('all');
  const [producers, setProducers] = useState(PRODUCERS);
  const [inviting, setInviting] = useState(false);

  const counts = useMemo(() => ({
    all: producers.length,
    pending: producers.filter((p) => p.status === 'pending').length,
    active: producers.filter((p) => p.status === 'active').length,
    suspended: producers.filter((p) => p.status === 'suspended').length,
  }), [producers]);

  const filtered = filter === 'all' ? producers : producers.filter((p) => p.status === filter);

  const setStatus = (id: string, status: Status) =>
    setProducers((arr) => arr.map((p) => p.id === id ? { ...p, status } : p));

  return (
    <AdminLayout>
      <div className="max-w-7xl mx-auto px-8 py-10">
        <header className="mb-8 flex items-end justify-between gap-4 flex-wrap">
          <div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-green-400 font-semibold">Producteurs</div>
            <h1 className="mt-1 font-serif text-[40px] text-white leading-tight">Gestion des producteurs</h1>
            <p className="text-[14px] text-white/55 mt-1">{counts.active} actifs · {counts.pending} en attente · {counts.suspended} suspendus</p>
          </div>
          <Button size="lg" onClick={() => setInviting(true)}>+ Inviter un producteur</Button>
        </header>

        <div className="flex gap-1.5 flex-wrap border-b border-white/[0.08] mb-6">
          {FILTERS.map((f) => {
            const active = filter === f.value;
            return (
              <button key={f.value} onClick={() => setFilter(f.value)}
                className={`px-4 py-3 text-[14px] font-medium transition-colors border-b-2 -mb-px flex items-center gap-2 ${
                  active ? 'border-green-500 text-white' : 'border-transparent text-white/55 hover:text-white'
                }`}>
                {f.label}
                <span className={`text-[11px] font-mono px-1.5 rounded ${active ? 'bg-green-500/20 text-green-300' : 'bg-white/5 text-white/55'}`}>
                  {counts[f.value]}
                </span>
              </button>
            );
          })}
        </div>

        <div className="bg-black/30 border border-white/[0.06] rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[14px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-[0.14em] text-white/50 bg-white/[0.03] border-b border-white/[0.06]">
                  <th className="px-5 py-3 font-semibold">Exploitation</th>
                  <th className="px-5 py-3 font-semibold">Commune</th>
                  <th className="px-5 py-3 font-semibold">Statut</th>
                  <th className="px-5 py-3 font-semibold">Abonnement</th>
                  <th className="px-5 py-3 font-semibold">Inscription</th>
                  <th className="px-5 py-3 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-10 text-center text-white/55">Aucun producteur.</td>
                  </tr>
                ) : filtered.map((p) => {
                  const meta = STATUS_META[p.status];
                  return (
                    <tr key={p.id} className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02]">
                      <td className="px-5 py-4">
                        <div className="font-serif text-[17px] text-white leading-tight">{p.name}</div>
                        <div className="text-[12px] text-white/45 mt-0.5">{p.email}</div>
                      </td>
                      <td className="px-5 py-4 text-white/75">{p.city}</td>
                      <td className="px-5 py-4">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] font-medium ${meta.bg} ${meta.text}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
                          {meta.label}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-white/75">{p.plan}</td>
                      <td className="px-5 py-4 text-white/60 font-mono text-[13px]">{p.joinedAt}</td>
                      <td className="px-5 py-4">
                        <div className="flex items-center justify-end gap-2 flex-wrap">
                          {p.status === 'pending' && (
                            <button onClick={() => setStatus(p.id, 'active')}
                              className="px-3 py-1.5 rounded-md bg-green-700 text-white text-[12px] font-semibold hover:bg-green-600 transition-colors">
                              Valider
                            </button>
                          )}
                          {p.status === 'active' && (
                            <button onClick={() => setStatus(p.id, 'suspended')}
                              className="px-3 py-1.5 rounded-md bg-white/5 text-red-300 text-[12px] font-medium hover:bg-red-500/20 transition-colors">
                              Suspendre
                            </button>
                          )}
                          {p.status === 'suspended' && (
                            <button onClick={() => setStatus(p.id, 'active')}
                              className="px-3 py-1.5 rounded-md bg-white/5 text-green-300 text-[12px] font-medium hover:bg-green-500/20 transition-colors">
                              Réactiver
                            </button>
                          )}
                          <Link href={`/producteurs/${p.slug}`} target="_blank"
                            className="px-3 py-1.5 rounded-md text-white/70 text-[12px] font-medium hover:bg-white/5 hover:text-white transition-colors">
                            Voir page publique ↗
                          </Link>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {inviting && <InviteModal onClose={() => setInviting(false)} />}
    </AdminLayout>
  );
}

function InviteModal({ onClose }: { onClose: () => void }) {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('Bonjour, nous serions ravis de vous accueillir sur TerrOir, une place de marché dédiée aux producteurs français. Créez votre page en quelques minutes.');
  const [sent, setSent] = useState(false);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.includes('@')) return;
    setSent(true);
    setTimeout(onClose, 1400);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-[#1a1a1a] border border-white/[0.08] rounded-2xl shadow-2xl w-full max-w-lg p-8" onClick={(e) => e.stopPropagation()}>
        {sent ? (
          <div className="text-center py-4">
            <div className="w-16 h-16 mx-auto rounded-full bg-green-500/15 border-2 border-green-500 flex items-center justify-center">
              <svg width="36" height="36" viewBox="0 0 48 48" className="text-green-400">
                <path d="M12 24 L20 32 L36 16" stroke="currentColor" strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <h2 className="mt-4 font-serif text-[24px] text-white">Invitation envoyée</h2>
            <p className="mt-1 text-[13px] text-white/60">Un email vient de partir à {email}.</p>
          </div>
        ) : (
          <form onSubmit={submit}>
            <div className="text-[11px] uppercase tracking-[0.2em] text-green-400 font-semibold">Nouvelle invitation</div>
            <h2 className="mt-1 font-serif text-[26px] text-white leading-tight">Inviter un producteur</h2>
            <p className="mt-1 text-[13px] text-white/60">Il recevra un lien de création de compte personnalisé.</p>

            <div className="mt-6 space-y-4">
              <div>
                <label className="block text-[12px] font-medium text-white/80 mb-1.5">Email du producteur</label>
                <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                  placeholder="contact@ma-ferme.fr"
                  className="w-full rounded-md bg-black/40 border border-white/10 px-3 py-2.5 text-[14px] text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500" />
              </div>
              <div>
                <label className="block text-[12px] font-medium text-white/80 mb-1.5">Message personnalisé</label>
                <textarea rows={5} value={message} onChange={(e) => setMessage(e.target.value)}
                  className="w-full rounded-md bg-black/40 border border-white/10 px-3 py-2.5 text-[14px] text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 resize-none" />
              </div>
            </div>

            <div className="mt-6 flex gap-2 justify-end">
              <button type="button" onClick={onClose}
                className="px-4 py-2 rounded-md text-[14px] text-white/70 hover:bg-white/5 hover:text-white transition-colors">
                Annuler
              </button>
              <button type="submit" disabled={!email.includes('@')}
                className="px-4 py-2 rounded-md bg-green-700 text-white text-[14px] font-semibold hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                Envoyer l&apos;invitation
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
