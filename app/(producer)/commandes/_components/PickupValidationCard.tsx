'use client';

import { useState, type FormEvent } from 'react';
// Imports directs (pas via le barrel @/components/ui) pour éviter d'aspirer
// la chaîne NavbarPublic → use-logout-flow → log-auth-event (server-only)
// qui casse le test runtime Vite avec environment jsdom.
import { Button } from '@/components/ui/button';
import { AdminModal } from '@/components/ui/admin-modal';

// PickupValidationCard — UX "valider rapidement" en haut de page
// /producer/commandes (LOT 4 chantier pickup-validation 2026-05-06).
//
// 3 états visuels :
//   1. idle    : input code TRR-XXXXX + bouton "Vérifier"
//                Les erreurs serveur apparaissent in-place sous l'input
//                avec CTA contextuel selon le cas (ex : lien fiche
//                commande pour order_not_confirmed).
//   2. preview : modale (AdminModal) affichant nom client + items +
//                montant + date commande, avec 2 boutons "Confirmer la
//                livraison" (CTA terra) et "Annuler" (retour idle).
//   3. success : message "Commande remise à <Prenom>" + bouton
//                "Valider une autre commande" qui reset à idle.
//
// Path API : GET ?code=X (preview) puis POST {code} (validation
// effective). Mêmes erreurs typées des 2 côtés (cf. route LOT 3).

type ApiError =
  | { kind: 'code_unknown' }
  | { kind: 'invalid_format' }
  | { kind: 'order_not_confirmed'; currentStatus: string; detailUrl: string }
  | { kind: 'already_completed'; completedAt: string | null }
  | { kind: 'order_cancelled' }
  | { kind: 'order_refunded' }
  | { kind: 'rate_limit'; retryAfter: number }
  | { kind: 'unexpected'; detail: string };

type PreviewOrder = {
  id: string;
  code_commande: string;
  consumer_name: string;
  items: { name: string; qty: string; unit_price: number; total: number }[];
  total_amount: number;
  status: string;
  created_at: string;
};

type ValidatedOrder = {
  id: string;
  code_commande: string;
  consumer_name: string;
  status: 'completed';
  completed_at: string;
};

type View =
  | { kind: 'idle'; error: ApiError | null }
  | { kind: 'preview'; preview: PreviewOrder }
  | { kind: 'success'; orderId: string; consumerName: string };

function mapError(status: number, body: Record<string, unknown>): ApiError {
  if (status === 429) {
    const retry =
      typeof body.retry_after_seconds === 'number'
        ? body.retry_after_seconds
        : 60;
    return { kind: 'rate_limit', retryAfter: retry };
  }
  if (status === 400 && body.error === 'invalid_code_format') {
    return { kind: 'invalid_format' };
  }
  if (status === 404) {
    return { kind: 'code_unknown' };
  }
  if (status === 409) {
    if (body.error === 'pickup_order_not_confirmed') {
      return {
        kind: 'order_not_confirmed',
        currentStatus: String(body.current_status ?? ''),
        detailUrl: String(body.detail_url ?? ''),
      };
    }
    if (body.error === 'pickup_already_completed') {
      return {
        kind: 'already_completed',
        completedAt:
          typeof body.completed_at === 'string' ? body.completed_at : null,
      };
    }
    if (body.error === 'pickup_order_cancelled') {
      return { kind: 'order_cancelled' };
    }
    if (body.error === 'pickup_order_refunded') {
      return { kind: 'order_refunded' };
    }
  }
  return { kind: 'unexpected', detail: String(body.error ?? 'Erreur') };
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return (
    d.toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }) +
    ' à ' +
    d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
  );
}

function ErrorBanner({ error }: { error: ApiError }) {
  const base =
    'mt-4 rounded-lg border px-4 py-3 text-[13px] flex items-start gap-3';
  const cls = `${base} border-terra-700/30 bg-terra-100/40 text-terra-700`;
  switch (error.kind) {
    case 'code_unknown':
      return (
        <div className={cls} role="alert">
          <span>
            Code de retrait inconnu. Vérifiez le code auprès du client.
          </span>
        </div>
      );
    case 'invalid_format':
      return (
        <div className={cls} role="alert">
          <span>Format invalide. Le code doit ressembler à TRR-XXXXX.</span>
        </div>
      );
    case 'order_not_confirmed':
      return (
        <div className={cls} role="alert">
          <div>
            <p className="font-medium">
              Cette commande n&apos;a pas encore été confirmée.
            </p>
            <p className="mt-1 text-dark/70">
              Validez-la d&apos;abord dans votre espace commandes.{' '}
              {error.detailUrl && (
                <a
                  href={error.detailUrl}
                  className="font-medium text-green-900 underline hover:text-green-700"
                >
                  Voir la fiche commande
                </a>
              )}
            </p>
          </div>
        </div>
      );
    case 'already_completed':
      return (
        <div className={cls} role="alert">
          <span>
            Commande déjà remise
            {error.completedAt
              ? ` le ${formatDateTime(error.completedAt)}`
              : ''}
            .
          </span>
        </div>
      );
    case 'order_cancelled':
      return (
        <div className={cls} role="alert">
          <span>Cette commande a été annulée.</span>
        </div>
      );
    case 'order_refunded':
      return (
        <div className={cls} role="alert">
          <span>Cette commande a été remboursée.</span>
        </div>
      );
    case 'rate_limit':
      return (
        <div className={cls} role="alert">
          <span>
            Trop de tentatives. Réessayez dans {error.retryAfter} secondes.
          </span>
        </div>
      );
    case 'unexpected':
      return (
        <div className={cls} role="alert">
          <span>Erreur inattendue. {error.detail}</span>
        </div>
      );
  }
}

export type PickupValidationCardProps = {
  /**
   * Callback déclenché après validation effective réussie. Permet à
   * la page parente (ProducerCommandesClient) de mettre à jour le
   * statut local de la commande en 'completed' sans recharger la page.
   */
  onValidated?: (orderId: string) => void;
};

export function PickupValidationCard({
  onValidated,
}: PickupValidationCardProps) {
  const [code, setCode] = useState('');
  const [view, setView] = useState<View>({ kind: 'idle', error: null });
  const [busy, setBusy] = useState(false);

  async function onVerify(e?: FormEvent) {
    e?.preventDefault();
    if (busy) return;
    const cleanCode = code.trim().toUpperCase();
    if (!cleanCode) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/producer/orders/validate-pickup?code=${encodeURIComponent(cleanCode)}`,
        { method: 'GET' },
      );
      const body = (await res.json().catch(() => ({}))) as Record<
        string,
        unknown
      >;
      if (res.ok) {
        setView({ kind: 'preview', preview: body.order as PreviewOrder });
        return;
      }
      setView({ kind: 'idle', error: mapError(res.status, body) });
    } catch {
      setView({
        kind: 'idle',
        error: { kind: 'unexpected', detail: 'Connexion impossible' },
      });
    } finally {
      setBusy(false);
    }
  }

  async function onConfirm() {
    if (view.kind !== 'preview' || busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/producer/orders/validate-pickup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: view.preview.code_commande }),
      });
      const body = (await res.json().catch(() => ({}))) as Record<
        string,
        unknown
      >;
      if (res.ok) {
        const order = body.order as ValidatedOrder;
        setView({
          kind: 'success',
          orderId: order.id,
          consumerName: order.consumer_name,
        });
        onValidated?.(order.id);
        return;
      }
      setView({ kind: 'idle', error: mapError(res.status, body) });
    } catch {
      setView({
        kind: 'idle',
        error: { kind: 'unexpected', detail: 'Connexion impossible' },
      });
    } finally {
      setBusy(false);
    }
  }

  function onCancelPreview() {
    setView({ kind: 'idle', error: null });
  }

  function onReset() {
    setCode('');
    setView({ kind: 'idle', error: null });
  }

  // Étape 3 : succès
  if (view.kind === 'success') {
    const firstName = view.consumerName.split(' ')[0];
    return (
      <section className="bg-white rounded-2xl border border-dark/[0.06] shadow-soft p-6">
        <div className="flex items-start gap-4">
          <div className="shrink-0 w-12 h-12 rounded-full bg-green-100 border-2 border-green-700 flex items-center justify-center">
            <svg width="24" height="24" viewBox="0 0 48 48" className="text-green-700" aria-hidden="true">
              <path
                d="M12 24 L20 32 L36 16"
                stroke="currentColor"
                strokeWidth="4"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <div className="flex-1">
            <h2 className="font-serif text-[22px] text-green-900 leading-tight">
              Commande remise à {firstName}
            </h2>
            <p className="mt-1 text-[13px] text-dark/65">
              Le client a reçu un email d&apos;invitation à laisser un avis.
            </p>
          </div>
          <Button variant="success" size="sm" onClick={onReset}>
            Valider une autre commande
          </Button>
        </div>
      </section>
    );
  }

  // Étape 1 (idle) — input + bouton Vérifier + erreur in-place
  return (
    <>
      <section className="bg-white rounded-2xl border border-dark/[0.06] shadow-soft p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex-1 min-w-0">
            <div className="text-[11px] uppercase tracking-[0.18em] text-terra-700 font-semibold">
              Valider rapidement
            </div>
            <h2 className="mt-1 font-serif text-[22px] text-green-900 leading-tight">
              Saisissez le code de retrait
            </h2>
            <p className="mt-1 text-[13px] text-dark/65">
              Demandez le code TRR-XXXXX au client présent au retrait.
            </p>
          </div>
        </div>

        <form onSubmit={onVerify} className="mt-5">
          <div className="flex gap-2 flex-wrap">
            <input
              type="text"
              value={code}
              onChange={(e) =>
                setCode(e.target.value.toUpperCase().slice(0, 12))
              }
              placeholder="TRR-XXXXX"
              aria-label="Code de retrait"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              maxLength={12}
              className="flex-1 min-w-[200px] font-mono text-[18px] tracking-[0.18em] uppercase h-12 px-4 rounded-lg border-2 border-dark/10 focus:border-green-700 outline-none transition-colors bg-bg"
            />
            <Button
              type="submit"
              variant="success"
              size="lg"
              disabled={busy || code.trim().length === 0}
            >
              {busy ? 'Vérification…' : 'Vérifier'}
            </Button>
          </div>
        </form>

        {view.kind === 'idle' && view.error && (
          <ErrorBanner error={view.error} />
        )}
      </section>

      {/* Étape 2 — modale preview */}
      <AdminModal
        open={view.kind === 'preview'}
        onClose={onCancelPreview}
        title="Confirmer la livraison"
        eyebrow="Aperçu commande"
        size="md"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={onCancelPreview} disabled={busy}>
              Annuler
            </Button>
            <Button variant="success" size="sm" onClick={onConfirm} disabled={busy}>
              {busy ? 'Validation…' : 'Confirmer la livraison'}
            </Button>
          </>
        }
      >
        {view.kind === 'preview' && (
          <div className="mt-4 space-y-4">
            <div>
              <div className="text-[11px] uppercase tracking-[0.14em] text-dark/50 font-semibold">
                Client
              </div>
              <div className="mt-1 font-serif text-[20px] text-green-900">
                {view.preview.consumer_name}
              </div>
            </div>

            <div>
              <div className="text-[11px] uppercase tracking-[0.14em] text-dark/50 font-semibold">
                Code de retrait
              </div>
              <div className="mt-1 font-mono text-[15px] text-green-900">
                {view.preview.code_commande}
              </div>
            </div>

            <div>
              <div className="text-[11px] uppercase tracking-[0.14em] text-dark/50 font-semibold">
                Articles
              </div>
              <ul className="mt-2 divide-y divide-dark/[0.06]">
                {view.preview.items.map((it, i) => (
                  <li
                    key={i}
                    className="py-2 flex items-baseline justify-between gap-4 text-[14px]"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-green-900 font-medium">{it.name}</div>
                      <div className="text-[12px] mono text-dark/55 mt-0.5">
                        {it.qty} · {it.unit_price.toFixed(2).replace('.', ',')} €/u
                      </div>
                    </div>
                    <div className="font-serif text-[15px] text-green-900 tabular-nums">
                      {it.total.toFixed(2).replace('.', ',')} €
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            <div className="pt-3 border-t border-dark/[0.08] flex items-baseline justify-between">
              <span className="text-[13px] text-dark/65">Total commande</span>
              <span className="font-serif text-[20px] text-green-900 tabular-nums">
                {view.preview.total_amount.toFixed(2).replace('.', ',')} €
              </span>
            </div>

            <div className="text-[12px] text-dark/55">
              Reçue le {formatDateTime(view.preview.created_at)}
            </div>
          </div>
        )}
      </AdminModal>
    </>
  );
}
