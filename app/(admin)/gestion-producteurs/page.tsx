'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

// Statuts producers visibles côté admin. 'draft' est exclu au fetch —
// formulaire d'onboarding incomplet, pas de sens à afficher en admin.
type Status = 'pending' | 'active' | 'public' | 'suspended';

type Producer = {
  id: string;
  slug: string;
  name: string;
  city: string;
  status: Status;
  plan: string;
  joinedAt: string;
  email: string;
};

type Filter = 'all' | 'pending' | 'active' | 'suspended';
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'Tous' },
  { value: 'pending', label: 'À valider' },
  { value: 'active', label: 'Actifs' },
  { value: 'suspended', label: 'Suspendus' },
];

const STATUS_META: Record<Status, { label: string; dot: string; bg: string; text: string }> = {
  pending:   { label: 'En attente', dot: 'bg-amber-500',         bg: 'bg-amber-50',          text: 'text-amber-800' },
  active:    { label: 'Validé',     dot: 'bg-amber-600',         bg: 'bg-amber-100',         text: 'text-amber-900' },
  public:    { label: 'Public',     dot: 'bg-terroir-green-700', bg: 'bg-terroir-green-100', text: 'text-terroir-green-700' },
  suspended: { label: 'Suspendu',   dot: 'bg-red-500',           bg: 'bg-red-100',           text: 'text-red-700' },
};

// Le filtre "Actifs" agrège 'active' (validé, pas encore vitrine) et 'public'
// (visible publiquement) — les deux sont considérés comme « en activité ».
function matchesFilter(status: Status, filter: Filter): boolean {
  if (filter === 'all') return true;
  if (filter === 'active') return status === 'active' || status === 'public';
  return status === filter;
}

const PLAN_LABEL: Record<string, string> = {
  starter: 'Découverte',
  pro: 'Pro',
  premium: 'Premium',
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function AdminProducteursPage() {
  const [filter, setFilter] = useState<Filter>('all');
  const [producers, setProducers] = useState<Producer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const [validating, setValidating] = useState<Producer | null>(null);

  const refresh = async () => {
    const supabase = createSupabaseBrowserClient();
    const { data, error: fetchError } = await supabase
      .from('producers')
      .select('id, slug, nom_exploitation, commune, code_postal, statut, abonnement_niveau, created_at, user:user_id ( email )')
      .neq('statut', 'draft')
      .order('created_at', { ascending: false });
    if (fetchError) { setError(fetchError.message); setLoading(false); return; }

    const rows: Producer[] = ((data ?? []) as unknown as Array<{
      id: string;
      slug: string;
      nom_exploitation: string;
      commune: string | null;
      code_postal: string | null;
      statut: Status;
      abonnement_niveau: string | null;
      created_at: string;
      user: { email: string | null } | Array<{ email: string | null }> | null;
    }>).map((p) => {
      const user = Array.isArray(p.user) ? p.user[0] : p.user;
      const city = [p.commune, p.code_postal ? `(${p.code_postal.slice(0, 2)})` : null].filter(Boolean).join(' ');
      return {
        id: p.id,
        slug: p.slug,
        name: p.nom_exploitation,
        city: city || '—',
        status: p.statut,
        plan: PLAN_LABEL[p.abonnement_niveau ?? ''] ?? '—',
        joinedAt: formatDate(p.created_at),
        email: user?.email ?? '—',
      };
    });

    setProducers(rows);
    setLoading(false);
  };

  useEffect(() => {
    let active = true;
    (async () => {
      if (!active) return;
      await refresh();
    })();
    return () => { active = false; };
  }, []);

  const counts = useMemo(() => ({
    all: producers.length,
    pending: producers.filter((p) => p.status === 'pending').length,
    active: producers.filter((p) => p.status === 'active' || p.status === 'public').length,
    suspended: producers.filter((p) => p.status === 'suspended').length,
  }), [producers]);

  const filtered = producers.filter((p) => matchesFilter(p.status, filter));

  const setStatus = async (id: string, status: Status) => {
    setBusy(id);
    setError(null);
    const supabase = createSupabaseBrowserClient();
    const { error: upError } = await supabase.from('producers').update({ statut: status }).eq('id', id);
    if (upError) setError(upError.message);
    else setProducers((arr) => arr.map((p) => p.id === id ? { ...p, status } : p));
    setBusy(null);
  };

  return (
    <>
      <div>
        <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-terroir-green-700">Producteurs</div>
            <h1 className="mt-1 font-serif text-[40px] leading-tight text-gray-900">Gestion des producteurs</h1>
            <p className="mt-1 text-[14px] text-gray-500">{counts.active} actifs · {counts.pending} en attente · {counts.suspended} suspendus</p>
            {error && <p className="mt-2 text-[13px] text-red-700">{error}</p>}
          </div>
          <Button size="lg" onClick={() => setInviting(true)}>+ Inviter un producteur</Button>
        </header>

        <div className="mb-6 flex flex-wrap gap-1.5 border-b border-gray-200">
          {FILTERS.map((f) => {
            const active = filter === f.value;
            return (
              <button key={f.value} onClick={() => setFilter(f.value)}
                className={`-mb-px flex items-center gap-2 border-b-2 px-4 py-3 text-[14px] font-medium transition-colors ${
                  active ? 'border-terroir-green-700 text-gray-900' : 'border-transparent text-gray-600 hover:text-gray-900'
                }`}>
                {f.label}
                <span className={`rounded px-1.5 font-mono text-[11px] ${active ? 'bg-terroir-green-100 text-terroir-green-700' : 'bg-gray-100 text-gray-600'}`}>
                  {counts[f.value]}
                </span>
              </button>
            );
          })}
        </div>

        <div className="overflow-hidden rounded-md border border-gray-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-[14px]">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-100 text-left text-[11px] uppercase tracking-[0.14em] text-gray-600">
                  <th className="px-5 py-3 font-semibold">Exploitation</th>
                  <th className="px-5 py-3 font-semibold">Commune</th>
                  <th className="px-5 py-3 font-semibold">Statut</th>
                  <th className="px-5 py-3 font-semibold">Abonnement</th>
                  <th className="px-5 py-3 font-semibold">Inscription</th>
                  <th className="px-5 py-3 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={6} className="px-5 py-10 text-center text-gray-500">Chargement…</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={6} className="px-5 py-10 text-center text-gray-500">Aucun producteur.</td></tr>
                ) : filtered.map((p) => {
                  const meta = STATUS_META[p.status];
                  const disabled = busy === p.id;
                  return (
                    <tr key={p.id} className="border-b border-gray-200 last:border-0 hover:bg-gray-50">
                      <td className="px-5 py-4">
                        <div className="font-serif text-[17px] leading-tight text-gray-900">{p.name}</div>
                        <div className="mt-0.5 text-[12px] text-gray-500">{p.email}</div>
                      </td>
                      <td className="px-5 py-4 text-gray-700">{p.city}</td>
                      <td className="px-5 py-4">
                        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium ${meta.bg} ${meta.text}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
                          {meta.label}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-gray-700">{p.plan}</td>
                      <td className="px-5 py-4 font-mono text-[13px] text-gray-500">{p.joinedAt}</td>
                      <td className="px-5 py-4">
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          {p.status === 'pending' && (
                            <button onClick={() => setValidating(p)} disabled={disabled}
                              className="rounded-md bg-terroir-green-700 px-3 py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-terroir-green-700/90 disabled:opacity-60">
                              Valider
                            </button>
                          )}
                          {(p.status === 'active' || p.status === 'public') && (
                            <button onClick={() => setStatus(p.id, 'suspended')} disabled={disabled}
                              className="rounded-md px-3 py-1.5 text-[12px] font-medium text-red-700 transition-colors hover:bg-red-50 disabled:opacity-60">
                              Suspendre
                            </button>
                          )}
                          {p.status === 'suspended' && (
                            <button onClick={() => setStatus(p.id, 'active')} disabled={disabled}
                              className="rounded-md px-3 py-1.5 text-[12px] font-medium text-gray-700 transition-colors hover:bg-gray-100 hover:text-gray-900 disabled:opacity-60">
                              Réactiver
                            </button>
                          )}
                          {p.status === 'public' && (
                            <Link href={`/producteurs/${p.slug}`} target="_blank"
                              className="rounded-md px-3 py-1.5 text-[12px] font-medium text-gray-700 transition-colors hover:bg-gray-100 hover:text-gray-900">
                              Voir page publique ↗
                            </Link>
                          )}
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

      {inviting && <InviteModal onClose={() => setInviting(false)} onSuccess={() => { refresh(); }} />}
      {validating && (
        <ConfirmValidateModal
          producer={validating}
          busy={busy === validating.id}
          onClose={() => setValidating(null)}
          onConfirm={async () => {
            await setStatus(validating.id, 'active');
            setValidating(null);
          }}
        />
      )}
    </>
  );
}

function ConfirmValidateModal({
  producer, busy, onClose, onConfirm,
}: {
  producer: Producer;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/50 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md rounded-md border border-gray-200 bg-white p-8 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-terroir-green-700">Validation</div>
        <h2 className="mt-1 font-serif text-[24px] leading-tight text-gray-900">Valider ce producteur ?</h2>
        <p className="mt-3 text-[14px] leading-relaxed text-gray-700">
          Le producteur <span className="font-semibold text-gray-900">{producer.name}</span> passera en statut validé et pourra publier ses produits.
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy}
            className="rounded-md px-4 py-2 text-[14px] text-gray-700 transition-colors hover:bg-gray-100 hover:text-gray-900 disabled:opacity-60">
            Annuler
          </button>
          <button type="button" onClick={onConfirm} disabled={busy}
            className="rounded-md bg-terroir-green-700 px-4 py-2 text-[14px] font-semibold text-white transition-colors hover:bg-terroir-green-700/90 disabled:cursor-not-allowed disabled:opacity-60">
            {busy ? 'Validation…' : 'Valider'}
          </button>
        </div>
      </div>
    </div>
  );
}

function InviteModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.includes('@')) return;
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch('/api/admin/producers/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), message: message.trim() || undefined }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? 'Invitation impossible');
        return;
      }
      setSent(true);
      onSuccess();
      setTimeout(onClose, 1400);
    } catch {
      setError('Erreur de connexion');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/50 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-lg rounded-md border border-gray-200 bg-white p-8 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {sent ? (
          <div className="py-4 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border-2 border-terroir-green-700 bg-terroir-green-100">
              <svg width="36" height="36" viewBox="0 0 48 48" className="text-terroir-green-700">
                <path d="M12 24 L20 32 L36 16" stroke="currentColor" strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <h2 className="mt-4 font-serif text-[24px] text-gray-900">Invitation envoyée</h2>
            <p className="mt-1 text-[13px] text-gray-600">Un email vient de partir à {email}.</p>
          </div>
        ) : (
          <form onSubmit={submit}>
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-terroir-green-700">Nouvelle invitation</div>
            <h2 className="mt-1 font-serif text-[26px] leading-tight text-gray-900">Inviter un producteur</h2>
            <p className="mt-1 text-[13px] text-gray-600">Il recevra un lien de création de compte personnalisé.</p>

            <div className="mt-6 space-y-4">
              <div>
                <label className="mb-1.5 block text-[12px] font-medium text-gray-800">Email du producteur</label>
                <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                  placeholder="contact@ma-ferme.fr"
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2.5 text-[14px] text-gray-900 placeholder:text-gray-400 focus:border-terroir-green-700 focus:outline-none focus:ring-2 focus:ring-terroir-green-700" />
              </div>
              <div>
                <label className="mb-1.5 block text-[12px] font-medium text-gray-800">Message personnalisé</label>
                <textarea rows={5} value={message} onChange={(e) => setMessage(e.target.value)}
                  placeholder="Quelques mots pour personnaliser l'invitation (optionnel)"
                  className="w-full resize-none rounded-md border border-gray-300 bg-white px-3 py-2.5 text-[14px] text-gray-900 placeholder:text-gray-400 focus:border-terroir-green-700 focus:outline-none focus:ring-2 focus:ring-terroir-green-700" />
              </div>
              {error && <p className="text-[13px] text-red-700">{error}</p>}
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button type="button" onClick={onClose}
                className="rounded-md px-4 py-2 text-[14px] text-gray-700 transition-colors hover:bg-gray-100 hover:text-gray-900">
                Annuler
              </button>
              <button type="submit" disabled={!email.includes('@') || submitting}
                className="rounded-md bg-terroir-green-700 px-4 py-2 text-[14px] font-semibold text-white transition-colors hover:bg-terroir-green-700/90 disabled:cursor-not-allowed disabled:opacity-50">
                {submitting ? 'Envoi…' : 'Envoyer l\'invitation'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
