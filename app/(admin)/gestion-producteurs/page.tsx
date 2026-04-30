'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { AdminModal, AdminPageHeader, Button, FilterTabs, ProducerStatusBadge, TableActionButton, TableStatus, type ProducerStatus } from '@/components/ui';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { revalidatePublicStats } from '@/lib/stats/revalidate';
import { formatDateFr } from '@/lib/format/date';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Statuts producers visibles côté admin. 'draft' et 'deleted' sont exclus
// au fetch par défaut (formulaire d'onboarding incomplet / anonymisé RGPD
// via delete_user_account), le toggle "Inclure brouillons et supprimés"
// les ramène. Le type + les palettes sont centralisés dans
// components/ui/producer-status-badge.tsx depuis la Phase B1 consolidation.
type Status = ProducerStatus;

type Producer = {
  id: string;
  slug: string;
  name: string;
  city: string;
  status: Status;
  plan: string;
  joinedAt: string;
  email: string;
  // Présent pour permettre le pré-filtrage `?user_id=<uuid>` (deep-link
  // depuis /audit-logs). Peut être null sur les vieilles rows ou les
  // producers en draft sans user lié.
  userId: string | null;
};

type Filter = 'all' | 'pending' | 'active' | 'suspended' | 'draft' | 'deleted';
const BASE_FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'Tous' },
  { value: 'pending', label: 'À valider' },
  { value: 'active', label: 'Actifs' },
  { value: 'suspended', label: 'Suspendus' },
];
const EXTRA_FILTERS: { value: Filter; label: string }[] = [
  { value: 'draft', label: 'Brouillons' },
  { value: 'deleted', label: 'Supprimés' },
];

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

export default function AdminProducteursPage() {
  // Suspense requis par Next.js 14 autour de useSearchParams (lecture
  // de ?invite=<email> depuis /producer-interests). Le fallback est null
  // car la page rend déjà un état "Chargement…" à l'intérieur.
  return (
    <Suspense fallback={null}>
      <AdminProducteursPageInner />
    </Suspense>
  );
}

function AdminProducteursPageInner() {
  const searchParams = useSearchParams();
  const [filter, setFilter] = useState<Filter>('all');
  const [showAll, setShowAll] = useState(false);
  const [producers, setProducers] = useState<Producer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const [prefillEmail, setPrefillEmail] = useState<string | null>(null);
  const [validating, setValidating] = useState<Producer | null>(null);

  const FILTERS = useMemo(
    () => (showAll ? [...BASE_FILTERS, ...EXTRA_FILTERS] : BASE_FILTERS),
    [showAll],
  );

  // Reset du filtre si on masque brouillons/supprimés alors qu'un de ces
  // deux tabs était actif (sinon tableau vide sans tab highlight visible).
  const handleToggleShowAll = () => {
    setShowAll((prev) => {
      const next = !prev;
      if (!next && (filter === 'draft' || filter === 'deleted')) {
        setFilter('all');
      }
      return next;
    });
  };

  // Ouvre l'InviteModal pré-rempli quand on arrive depuis
  // /producer-interests avec ?invite=<email>. Déclenché une seule fois au
  // mount : on ne veut pas rouvrir le modal à chaque re-render du param.
  useEffect(() => {
    const invite = searchParams?.get('invite');
    if (invite) {
      setPrefillEmail(invite);
      setInviting(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refresh = async () => {
    const supabase = createSupabaseBrowserClient();
    let query = supabase
      .from('producers')
      .select('id, slug, nom_exploitation, commune, code_postal, statut, abonnement_niveau, created_at, user_id, user:user_id ( email )');
    if (!showAll) {
      query = query.neq('statut', 'draft').neq('statut', 'deleted');
    }
    const { data, error: fetchError } = await query
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
      user_id: string | null;
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
        joinedAt: formatDateFr(p.created_at),
        email: user?.email ?? '—',
        userId: p.user_id ?? null,
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAll]);

  // Pré-filtre `?user_id=<uuid>` (deep-link depuis /audit-logs T-080).
  // Lu directement depuis l'URL pour rester réactif à un Link → /gestion-producteurs
  // sans param qui doit re-afficher la liste complète sans rechargement.
  // UUID invalide = ignoré silencieusement (cohérent parse-search-params côté audit-logs).
  const prefillUserIdRaw = searchParams?.get('user_id') ?? null;
  const prefillUserId =
    prefillUserIdRaw && UUID_REGEX.test(prefillUserIdRaw) ? prefillUserIdRaw : null;

  const counts = useMemo(() => ({
    all: producers.length,
    pending: producers.filter((p) => p.status === 'pending').length,
    active: producers.filter((p) => p.status === 'active' || p.status === 'public').length,
    suspended: producers.filter((p) => p.status === 'suspended').length,
    draft: producers.filter((p) => p.status === 'draft').length,
    deleted: producers.filter((p) => p.status === 'deleted').length,
  }), [producers]);

  const filtered = producers
    .filter((p) => matchesFilter(p.status, filter))
    .filter((p) => (prefillUserId ? p.userId === prefillUserId : true));

  const setStatus = async (id: string, status: Status) => {
    setBusy(id);
    setError(null);
    const supabase = createSupabaseBrowserClient();
    const { error: upError } = await supabase.from('producers').update({ statut: status }).eq('id', id);
    if (upError) {
      setError(upError.message);
    } else {
      setProducers((arr) => arr.map((p) => p.id === id ? { ...p, status } : p));
      // Toute transition admin peut faire entrer/sortir le producer du filtre
      // statut='public' du cache public-stats (suspend, réactivate, validate
      // si suivi d'une auto-promotion ailleurs). Inconditionnel pour simplifier.
      try {
        await revalidatePublicStats();
      } catch (e) {
        console.warn(`[STATS_REVAL_WARN] ${(e as Error).message}`);
      }
    }
    setBusy(null);
  };

  return (
    <>
      <div>
        <AdminPageHeader
          eyebrow="Producteurs"
          title="Gestion des producteurs"
          subtitle={`${counts.active} actifs · ${counts.pending} en attente · ${counts.suspended} suspendus`}
          error={error}
          right={<Button variant="accent" size="lg" onClick={() => setInviting(true)}>+ Inviter un producteur</Button>}
        />

        {prefillUserId && (
          <div
            role="status"
            className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-blue-200 bg-blue-50 px-4 py-2.5 text-[13px] text-blue-900"
          >
            <span>
              Filtré sur user{' '}
              <span className="font-mono text-[12px]">{prefillUserId.slice(0, 8)}…</span>
            </span>
            <Link
              href="/gestion-producteurs"
              className="text-[13px] font-medium text-blue-900 underline hover:text-blue-700"
            >
              Effacer
            </Link>
          </div>
        )}

        <div className="mb-6 flex flex-wrap items-end justify-between gap-3 border-b border-gray-200">
          <FilterTabs filters={FILTERS} counts={counts} active={filter} onChange={setFilter} />
          <label className="-mb-px inline-flex cursor-pointer items-center gap-2 pb-3 text-[12px] text-gray-600 hover:text-gray-900">
            <input
              type="checkbox"
              checked={showAll}
              onChange={handleToggleShowAll}
              className="h-3.5 w-3.5 rounded border-gray-300 text-terroir-green-700 focus:ring-terroir-green-700"
            />
            <span>Inclure brouillons et supprimés</span>
          </label>
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
                  <TableStatus kind="loading" colSpan={6} />
                ) : filtered.length === 0 ? (
                  <TableStatus kind="empty" colSpan={6} emptyLabel="Aucun producteur." />
                ) : filtered.map((p) => {
                  const disabled = busy === p.id;
                  return (
                    <tr key={p.id} className="border-b border-gray-200 last:border-0 hover:bg-gray-50">
                      <td className="px-5 py-4">
                        <div className="font-serif text-[17px] leading-tight text-gray-900">{p.name}</div>
                        <div className="mt-0.5 text-[12px] text-gray-500">{p.email}</div>
                      </td>
                      <td className="px-5 py-4 text-gray-700">{p.city}</td>
                      <td className="px-5 py-4">
                        <ProducerStatusBadge status={p.status} />
                      </td>
                      <td className="px-5 py-4 text-gray-700">{p.plan}</td>
                      <td className="px-5 py-4 font-mono text-[13px] text-gray-500">{p.joinedAt}</td>
                      <td className="px-5 py-4">
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          {p.status === 'pending' && (
                            <TableActionButton variant="primary" onClick={() => setValidating(p)} disabled={disabled}>
                              Valider
                            </TableActionButton>
                          )}
                          {(p.status === 'active' || p.status === 'public') && (
                            <TableActionButton variant="ghost-danger" onClick={() => setStatus(p.id, 'suspended')} disabled={disabled}>
                              Suspendre
                            </TableActionButton>
                          )}
                          {p.status === 'suspended' && (
                            <TableActionButton variant="ghost" onClick={() => setStatus(p.id, 'active')} disabled={disabled}>
                              Réactiver
                            </TableActionButton>
                          )}
                          {p.status === 'public' && (
                            <TableActionButton variant="ghost" href={`/producteurs/${p.slug}`} target="_blank">
                              Voir page publique ↗
                            </TableActionButton>
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

      {inviting && (
        <InviteModal
          initialEmail={prefillEmail ?? ''}
          onClose={() => {
            setInviting(false);
            setPrefillEmail(null);
          }}
          onSuccess={() => { refresh(); }}
        />
      )}
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
    <AdminModal
      open
      onClose={onClose}
      eyebrow="Validation"
      title="Valider ce producteur ?"
      size="md"
      footer={<>
        <button type="button" onClick={onClose} disabled={busy}
          className="rounded-md px-4 py-2 text-[14px] text-gray-700 transition-colors hover:bg-gray-100 hover:text-gray-900 disabled:opacity-60">
          Annuler
        </button>
        <button type="button" onClick={onConfirm} disabled={busy}
          className="rounded-md bg-terroir-green-700 px-4 py-2 text-[14px] font-semibold text-white transition-colors hover:bg-terroir-green-700/90 disabled:cursor-not-allowed disabled:opacity-60">
          {busy ? 'Validation…' : 'Valider'}
        </button>
      </>}
    >
      <p className="mt-3 text-[14px] leading-relaxed text-gray-700">
        Le producteur <span className="font-semibold text-gray-900">{producer.name}</span> passera en statut validé et pourra publier ses produits.
      </p>
    </AdminModal>
  );
}

function InviteModal({
  initialEmail = '',
  onClose,
  onSuccess,
}: {
  initialEmail?: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [email, setEmail] = useState(initialEmail);
  const [message, setMessage] = useState('');
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Capture du flag renvoyé par la route quand l'email correspond à un
  // users row role='consumer' (sans 'producer'). L'acceptation de
  // l'invitation déclenchera loginAndUpgradeAction côté /invitation page,
  // pas une création de compte from scratch. On le surface dans le sent
  // view pour que l'admin ait la confirmation visuelle de ce qu'il a fait.
  const [existingAccount, setExistingAccount] = useState<'consumer' | null>(null);
  // Friction UX : quand la route renvoie 409 kind='draft_resend_confirm_required'
  // (email correspond à un producer en statut='draft' = onboarding abandonné),
  // on bascule en mode confirmation : encadré informatif orange + bouton
  // dédié "Confirmer la relance". Le 2nd POST embarque confirm_draft_resend=true.
  const [confirmDraftResend, setConfirmDraftResend] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.includes('@')) return;
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch('/api/admin/producers/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          message: message.trim() || undefined,
          ...(confirmDraftResend ? { confirm_draft_resend: true } : {}),
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        if (body.kind === 'draft_resend_confirm_required') {
          setConfirmDraftResend(true);
          setError(null);
          return;
        }
        setError(body.error ?? 'Invitation impossible');
        return;
      }
      setExistingAccount(body.existing_account ?? null);
      setSent(true);
      onSuccess();
      // Délai allongé quand un encart info est affiché : l'admin a
      // besoin de plus de temps pour lire le message upgrade-rôles.
      setTimeout(onClose, body.existing_account === 'consumer' ? 3200 : 1400);
    } catch {
      setError('Erreur de connexion');
    } finally {
      setSubmitting(false);
    }
  };

  if (sent) {
    return (
      <AdminModal
        open
        onClose={onClose}
        title="Invitation envoyée"
        size="lg"
      >
        <div className="mt-3 py-2 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border-2 border-terroir-green-700 bg-terroir-green-100">
            <svg width="36" height="36" viewBox="0 0 48 48" className="text-terroir-green-700">
              <path d="M12 24 L20 32 L36 16" stroke="currentColor" strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <p className="mt-3 text-[13px] text-gray-600">Un email vient de partir à {email}.</p>
          {existingAccount === 'consumer' && (
            <div
              className="mx-auto mt-4 max-w-md rounded-md border border-blue-300 bg-blue-50 px-4 py-3 text-left text-[13px] text-blue-900"
              role="status"
            >
              <p className="font-semibold">Compte consumer existant détecté</p>
              <p className="mt-1 leading-relaxed">
                Cet email correspond déjà à un compte client TerrOir. À l&apos;acceptation de
                l&apos;invitation, le rôle producteur sera ajouté à son compte existant
                (pas de création d&apos;un nouveau compte).
              </p>
            </div>
          )}
        </div>
      </AdminModal>
    );
  }

  return (
    <AdminModal
      open
      onClose={onClose}
      eyebrow="Nouvelle invitation"
      title="Inviter un producteur"
      size="lg"
      footer={<>
        <button type="button" onClick={onClose}
          className="rounded-md px-4 py-2 text-[14px] text-gray-700 transition-colors hover:bg-gray-100 hover:text-gray-900">
          Annuler
        </button>
        <button type="submit" form="admin-invite-form" disabled={!email.includes('@') || submitting}
          className={`rounded-md px-4 py-2 text-[14px] font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
            confirmDraftResend
              ? 'bg-terroir-terracotta hover:bg-terroir-terracotta/90'
              : 'bg-terroir-green-700 hover:bg-terroir-green-700/90'
          }`}>
          {submitting
            ? 'Envoi…'
            : confirmDraftResend
              ? 'Confirmer la relance'
              : 'Envoyer l\'invitation'}
        </button>
      </>}
    >
      <form id="admin-invite-form" onSubmit={submit}>
        <p className="mt-1 text-[13px] text-gray-600">Il recevra un lien de création de compte personnalisé.</p>
        <div className="mt-6 space-y-4">
          {confirmDraftResend && (
            <div
              className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-[13px] text-amber-900"
              role="alert"
            >
              <p className="font-semibold">Onboarding producteur abandonné détecté</p>
              <p className="mt-1 leading-relaxed">
                Cet email correspond à un compte producteur dont l&apos;onboarding n&apos;a pas été finalisé.
                Une nouvelle invitation va être envoyée pour relancer le processus. L&apos;ancien lien
                d&apos;invitation deviendra orphelin.
              </p>
            </div>
          )}
          <div>
            <label className="mb-1.5 block text-[12px] font-medium text-gray-800">Email du producteur</label>
            <input type="email" required value={email} onChange={(e) => {
                setEmail(e.target.value);
                if (confirmDraftResend) setConfirmDraftResend(false);
              }}
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
      </form>
    </AdminModal>
  );
}
