'use client';

import { Suspense, useEffect, useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  AdminModal,
  AdminPageHeader,
  Button,
  FilterTabs,
  ProducerStatusBadge,
  TableActionButton,
  TableStatus,
  getProducerStatusLabel,
} from '@/components/ui';
import { ListingHeader } from '@/components/listings/ListingHeader';
import { NEXT_PUBLIC_APP_URL } from '@/lib/env/urls';
import type {
  AdminProducerRow,
  ProducerStatus,
  ProducerStatusFilter,
} from '@/lib/admin/producers/types';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Client Component de la page admin /gestion-producteurs (refacto PR
// refactor/admin-pattern-uniform). Reçoit en props les données fetchées
// côté Server Component via service_role (cf. page.tsx parent) et gère
// purement les interactions : filtres tabs, toggle showAll, modals
// Invite / ConfirmValidate, et les mutations via API routes :
//   - PATCH /api/admin/producers/[id]/statut (validation / suspension / réactivation)
//   - POST  /api/admin/producers/invite (modal invitation — existant, intouché)
//
// La pagination cursor reste côté server : Link href change le search param
// `?before=&before_id=` → re-render Server Component qui refetch via le helper
// `fetchAdminProducersList`.

const BASE_FILTERS: { value: ProducerStatusFilter; label: string }[] = [
  { value: 'all', label: 'Tous' },
  { value: 'pending', label: 'À valider' },
  { value: 'active', label: 'Actifs' },
  { value: 'suspended', label: 'Suspendus' },
];
const EXTRA_FILTERS: { value: ProducerStatusFilter; label: string }[] = [
  { value: 'draft', label: 'Brouillons' },
  { value: 'deleted', label: 'Supprimés' },
];

// Le filtre "Actifs" agrège 'active' (validé, pas encore vitrine) et 'public'
// (visible publiquement) — les deux sont considérés comme « en activité ».
function matchesFilter(status: ProducerStatus, filter: ProducerStatusFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'active') return status === 'active' || status === 'public';
  return status === filter;
}

export type GestionProducteursClientProps = {
  initialProducers: AdminProducerRow[];
  initialTotal: number;
  initialNextCursor: { created_at: string; id: string } | null;
  initialError: string | null;
  // showAll côté server pour cohérence des filtres SQL (cf. fetchAdminProducersList).
  // Le client n'a pas besoin de le re-calculer ; on le surfacage pour
  // contrôler l'état du checkbox + lien toggle (qui modifie le search param).
  showAll: boolean;
  // True quand un cursor `before` est actif → banner ListingHeader affiche
  // "page suivante" (rendu déjà cohérent avec ancien comportement page CSR).
  isPaginated: boolean;
  // Chantier 4 — filtre statut initial lu depuis `?status=` côté server
  // (deep-link cockpit dashboard / journal d'audit). Fail-safe 'all'.
  initialStatusFilter: ProducerStatusFilter;
};

export function GestionProducteursClient(props: GestionProducteursClientProps) {
  return (
    <Suspense fallback={<GestionProducteursFallback />}>
      <Inner {...props} />
    </Suspense>
  );
}

function Inner({
  initialProducers,
  initialTotal,
  initialNextCursor,
  initialError,
  showAll,
  isPaginated,
  initialStatusFilter,
}: GestionProducteursClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [filter, setFilter] = useState<ProducerStatusFilter>(initialStatusFilter);
  const [error, setError] = useState<string | null>(initialError);
  const [busy, setBusy] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const [prefillEmail, setPrefillEmail] = useState<string | null>(null);
  const [validating, setValidating] = useState<AdminProducerRow | null>(null);
  const [, startTransition] = useTransition();

  const FILTERS = useMemo(
    () => (showAll ? [...BASE_FILTERS, ...EXTRA_FILTERS] : BASE_FILTERS),
    [showAll],
  );

  // Reset du filtre si on masque brouillons/supprimés alors qu'un de ces
  // deux tabs était actif (sinon tableau vide sans tab highlight visible).
  useEffect(() => {
    if (!showAll && (filter === 'draft' || filter === 'deleted')) {
      setFilter('all');
    }
  }, [showAll, filter]);

  // Toggle showAll : on bascule via search param, le Server Component
  // refetch avec le nouveau filtre SQL. router.refresh() pour rafraîchir
  // les Server Components sans navigation full.
  const handleToggleShowAll = () => {
    const next = !showAll;
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    if (next) {
      params.set('show_all', '1');
    } else {
      params.delete('show_all');
    }
    // Reset cursor quand on change le toggle : la page 2+ devient invalide
    // dès que le filtre SQL change (sinon on saute des rows).
    params.delete('before');
    params.delete('before_id');
    startTransition(() => {
      router.push(`/gestion-producteurs${params.toString() ? `?${params.toString()}` : ''}`);
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

  // Pré-filtre `?user_id=<uuid>` (deep-link depuis /audit-logs T-080).
  // Lu directement depuis l'URL pour rester réactif à un Link → /gestion-producteurs
  // sans param qui doit re-afficher la liste complète sans rechargement.
  // UUID invalide = ignoré silencieusement (cohérent parse-search-params côté audit-logs).
  const prefillUserIdRaw = searchParams?.get('user_id') ?? null;
  const prefillUserId =
    prefillUserIdRaw && UUID_REGEX.test(prefillUserIdRaw) ? prefillUserIdRaw : null;

  const counts = useMemo(() => ({
    all: initialProducers.length,
    pending: initialProducers.filter((p) => p.status === 'pending').length,
    active: initialProducers.filter((p) => p.status === 'active' || p.status === 'public').length,
    suspended: initialProducers.filter((p) => p.status === 'suspended').length,
    draft: initialProducers.filter((p) => p.status === 'draft').length,
    deleted: initialProducers.filter((p) => p.status === 'deleted').length,
  }), [initialProducers]);

  const filtered = initialProducers
    .filter((p) => matchesFilter(p.status, filter))
    .filter((p) => (prefillUserId ? p.userId === prefillUserId : true));

  const setStatus = async (id: string, statut: ProducerStatus) => {
    setBusy(id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/producers/${id}/statut`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ statut }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? `Erreur HTTP ${res.status}`);
        setBusy(null);
        return;
      }
      // Refresh Server Component pour repasser par fetchAdminProducersList
      // côté server (service_role). Pas de manip locale du state : la source
      // de vérité reste le serveur.
      startTransition(() => {
        router.refresh();
        setBusy(null);
      });
    } catch (err) {
      setError((err as Error).message || 'Erreur réseau');
      setBusy(null);
    }
  };

  // Chantier 3 Phase 5 — validation/refus de la certification bio.
  const setBioValidation = async (id: string, validate: boolean) => {
    setBusy(id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/producers/${id}/bio-validation`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ validate }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? `Erreur HTTP ${res.status}`);
        setBusy(null);
        return;
      }
      startTransition(() => {
        router.refresh();
        setBusy(null);
      });
    } catch (err) {
      setError((err as Error).message || 'Erreur réseau');
      setBusy(null);
    }
  };

  const buildPaginationUrl = () => {
    if (!initialNextCursor) return null;
    // On garde les autres search params actifs (show_all, user_id, invite…)
    // en plus du cursor — sinon un click sur "page suivante" perdrait le
    // filtre showAll/le pré-filtre user_id.
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    params.set('before', initialNextCursor.created_at);
    params.set('before_id', initialNextCursor.id);
    return `/gestion-producteurs?${params.toString()}`;
  };

  const nextHref = buildPaginationUrl();

  return (
    <>
      <div>
        <AdminPageHeader
          eyebrow="Producteurs"
          title="Gestion des producteurs"
          subtitle={`${counts.active} actifs · ${counts.pending} en attente · ${counts.suspended} suspendus`}
          error={error}
          right={<Button variant="primary" size="lg" onClick={() => setInviting(true)}>+ Inviter un producteur</Button>}
        />

        <div className="mb-4">
          <ListingHeader displayed={initialProducers.length} total={initialTotal} label="producteurs" isPaginated={isPaginated} />
        </div>

        {prefillUserId && (
          <div
            role="status"
            className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-blue-200 bg-blue-50 px-4 py-2.5 text-[13px] text-blue-900"
          >
            <span>
              Filtré sur user{' '}
              <span className="font-mono text-[12px]">{prefillUserId.slice(0, 8)}&hellip;</span>
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
                  <th className="px-5 py-3 font-semibold">Contact</th>
                  <th className="px-5 py-3 font-semibold">Email</th>
                  <th className="px-5 py-3 font-semibold">Téléphone</th>
                  <th className="px-5 py-3 font-semibold">Statut</th>
                  <th className="px-5 py-3 font-semibold">Abonnement</th>
                  <th className="px-5 py-3 font-semibold">Inscription</th>
                  <th className="px-5 py-3 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <TableStatus kind="empty" colSpan={8} emptyLabel="Aucun producteur." />
                ) : filtered.map((p) => {
                  const disabled = busy === p.id;
                  const publicUrl = `${NEXT_PUBLIC_APP_URL}/producteurs/${p.slug}`;
                  return (
                    <tr key={p.id} className="border-b border-gray-200 last:border-0 hover:bg-gray-50">
                      <td className="px-5 py-4">
                        {p.status === 'public' ? (
                          <a
                            href={publicUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="font-serif text-[17px] leading-tight text-terroir-green-700 hover:underline"
                          >
                            {p.name}
                          </a>
                        ) : (
                          <div className="font-serif text-[17px] leading-tight text-gray-900">{p.name}</div>
                        )}
                        <div className="mt-0.5 text-[12px] text-gray-500">{p.city}</div>
                      </td>
                      <td className="px-5 py-4 text-gray-700">{p.contactName}</td>
                      <td className="px-5 py-4">
                        {p.email !== '—' ? (
                          <a
                            href={`mailto:${p.email}`}
                            className="text-[13px] text-terroir-green-700 hover:underline"
                          >
                            {p.email}
                          </a>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-5 py-4">
                        {p.phone ? (
                          <a
                            href={`tel:${p.phone.replace(/\s+/g, '')}`}
                            className="font-mono text-[13px] text-terroir-green-700 hover:underline"
                          >
                            {p.phone}
                          </a>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-5 py-4">
                        <ProducerStatusBadge status={p.status} />
                        <div className="mt-1 flex flex-wrap gap-1">
                          {p.publicationRequested && (
                            <span className="rounded-full bg-terra-50 px-2 py-0.5 text-[11px] text-terra-800">
                              Publication demandée
                            </span>
                          )}
                          {p.bioPending && (
                            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] text-amber-800">
                              Bio à valider
                            </span>
                          )}
                          {p.bioValidated && (
                            <span className="rounded-full bg-green-50 px-2 py-0.5 text-[11px] text-green-700">
                              Bio ✓
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-5 py-4 text-gray-700">{p.plan}</td>
                      <td className="px-5 py-4 font-mono text-[13px] text-gray-500">{p.joinedAt}</td>
                      <td className="px-5 py-4">
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          {p.publicationRequested && p.status !== 'public' && (
                            <TableActionButton variant="primary" onClick={() => setStatus(p.id, 'public')} disabled={disabled}>
                              Publier
                            </TableActionButton>
                          )}
                          {p.bioPending && (
                            <>
                              <TableActionButton variant="primary" onClick={() => setBioValidation(p.id, true)} disabled={disabled}>
                                Valider bio
                              </TableActionButton>
                              <TableActionButton variant="ghost-danger" onClick={() => setBioValidation(p.id, false)} disabled={disabled}>
                                Refuser bio
                              </TableActionButton>
                            </>
                          )}
                          {p.bioValidated && (
                            <TableActionButton variant="ghost" onClick={() => setBioValidation(p.id, false)} disabled={disabled}>
                              Révoquer bio
                            </TableActionButton>
                          )}
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
                            <TableActionButton variant="ghost" href={publicUrl} target="_blank">
                              Voir page publique &#x2197;
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

        {nextHref && (
          <div className="mt-6 flex justify-center">
            <Link
              href={nextHref}
              className="text-[14px] font-medium text-terroir-green-700 underline hover:text-terroir-green-700/80"
            >
              Charger les 100 plus anciens
            </Link>
          </div>
        )}
      </div>

      {inviting && (
        <InviteModal
          initialEmail={prefillEmail ?? ''}
          onClose={() => {
            setInviting(false);
            setPrefillEmail(null);
          }}
          onSuccess={() => {
            // Refresh server-side au lieu d'un setState local : cohérent avec
            // les autres mutations (source de vérité serveur).
            startTransition(() => router.refresh());
          }}
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

// Squelette de fallback aligné sur la table admin réelle (audit Vercel L-1
// 2026-05-05). Utilisé pendant les transitions React (router.push toggle).
function GestionProducteursFallback() {
  return (
    <div className="space-y-6" aria-busy="true">
      <div className="space-y-2">
        <div className="h-8 w-1/2 max-w-sm animate-pulse rounded bg-dark/10" />
        <div className="h-4 w-1/3 max-w-xs animate-pulse rounded bg-dark/10" />
      </div>
      <div className="flex gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-8 w-24 animate-pulse rounded-full bg-dark/10" />
        ))}
      </div>
      <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="divide-y divide-gray-100">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 p-4">
              <div className="flex-1 space-y-2">
                <div className="h-4 w-2/3 animate-pulse rounded bg-dark/10" />
                <div className="h-3 w-1/3 animate-pulse rounded bg-dark/10" />
              </div>
              <div className="h-6 w-20 animate-pulse rounded-full bg-dark/10" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ConfirmValidateModal({
  producer, busy, onClose, onConfirm,
}: {
  producer: AdminProducerRow;
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
  // T-105 : capture des 2 autres cas 409 contextuels (admin ou producer
  // déjà inscrit). Affichage encadré dédié au lieu d'une simple ligne
  // rouge — cohérence avec l'encadré orange draft_resend et bleu
  // existing_account=consumer. `statut` n'est rempli que pour blocked_producer.
  const [blocked, setBlocked] = useState<
    | { kind: 'blocked_admin' }
    | { kind: 'blocked_producer'; statut: string | null }
    | null
  >(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.includes('@')) return;
    setSubmitting(true);
    setError(null);
    setBlocked(null);

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
        // T-105 : 2 cas 409 contextuels — afficher l'encadré dédié plutôt
        // qu'une simple ligne rouge sous le form (cohérence draft_resend +
        // existing_account). Garde-fou kind: si le backend devient muet
        // (contrat cassé), fallback sur le message texte historique.
        if (body.kind === 'blocked_admin') {
          setBlocked({ kind: 'blocked_admin' });
          return;
        }
        if (body.kind === 'blocked_producer') {
          setBlocked({
            kind: 'blocked_producer',
            statut: typeof body.statut === 'string' ? body.statut : null,
          });
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
                Cet email correspond déjà à un compte client TerrOir. À l&rsquo;acceptation de
                l&rsquo;invitation, le rôle producteur sera ajouté à son compte existant
                (pas de création d&rsquo;un nouveau compte).
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
                Cet email correspond à un compte producteur dont l&rsquo;onboarding n&rsquo;a pas été finalisé.
                Une nouvelle invitation va être envoyée pour relancer le processus. L&rsquo;ancien lien
                d&rsquo;invitation deviendra orphelin.
              </p>
            </div>
          )}
          {blocked?.kind === 'blocked_admin' && (
            <div
              className="rounded-md border border-gray-300 bg-gray-50 px-4 py-3 text-[13px] text-gray-800"
              role="alert"
            >
              <p className="font-semibold">Cet email est déjà rattaché à un compte administrateur</p>
              <p className="mt-1 leading-relaxed">
                Un administrateur ne peut pas être invité comme producteur. Utilisez une autre
                adresse email.
              </p>
            </div>
          )}
          {blocked?.kind === 'blocked_producer' && (
            <div
              className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-[13px] text-red-900"
              role="alert"
            >
              <p className="font-semibold">Un producteur est déjà inscrit avec cet email</p>
              <p className="mt-1 leading-relaxed">
                {blocked.statut
                  ? `Statut actuel : ${getProducerStatusLabel(blocked.statut)}.`
                  : null}{' '}
                Pour le retrouver, ouvrez la liste des producteurs et filtrez sur son email.
              </p>
              <Link
                href="/gestion-producteurs"
                onClick={onClose}
                className="mt-2 inline-block text-[13px] font-medium text-red-900 underline hover:text-red-700"
              >
                Aller à la liste des producteurs &rarr;
              </Link>
            </div>
          )}
          <div>
            <label className="mb-1.5 block text-[12px] font-medium text-gray-800">Email du producteur</label>
            <input type="email" required value={email} onChange={(e) => {
                setEmail(e.target.value);
                if (confirmDraftResend) setConfirmDraftResend(false);
                if (blocked) setBlocked(null);
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
