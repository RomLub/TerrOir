'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { Button } from '@/components/ui';
import { getStripe } from '@/lib/stripe/client';
import { useCartStore, type CartItem } from '@/lib/store/cart';
import { itemKey, type ValidateResponse } from '@/lib/cart/validate';
import type { CheckoutError } from '@/lib/checkout/classify-stripe-error';
import { listPaymentMethodsAction, type PaymentMethodSummary } from './actions';

const BRAND_LABEL: Record<string, string> = {
  visa: 'Visa',
  mastercard: 'Mastercard',
  amex: 'American Express',
  discover: 'Discover',
  diners: 'Diners Club',
  jcb: 'JCB',
  unionpay: 'UnionPay',
  unknown: 'Carte',
};

function brandLabel(brand: string): string {
  return BRAND_LABEL[brand] ?? brand.charAt(0).toUpperCase() + brand.slice(1);
}

type OrderCreated = {
  order_id: string;
  code_commande: string;
  montant_total: number;
  commission: number;
  montant_net: number;
};

type CheckoutGroup = {
  producerId: string;
  slug: string;
  producerName: string;
  slotId: string;
  dateRetrait: string;
  items: CartItem[];
};

function groupByOrder(items: CartItem[]): CheckoutGroup[] {
  const map: Record<string, CheckoutGroup> = {};
  items.forEach((it) => {
    const key = `${it.producerId}|${it.creneauId}|${it.dateRetrait}`;
    if (!map[key]) {
      map[key] = {
        producerId: it.producerId,
        slug: it.slug,
        producerName: it.producerName ?? 'Producteur',
        slotId: it.creneauId,
        dateRetrait: it.dateRetrait,
        items: [],
      };
    }
    map[key].items.push(it);
  });
  return Object.values(map);
}

function formatDateFr(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

export default function CheckoutPage() {
  const items = useCartStore((s) => s.items);
  const clearCart = useCartStore((s) => s.clear);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  const groups = useMemo(() => groupByOrder(items), [items]);
  const group = groups[0] ?? null;
  const multipleGroups = groups.length > 1;

  const [order, setOrder] = useState<OrderCreated | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [initError, setInitError] = useState<CheckoutError | null>(null);
  const [preparing, setPreparing] = useState(false);

  const subtotal = group ? group.items.reduce((s, i) => s + i.prix * i.quantite, 0) : 0;

  const router = useRouter();

  useEffect(() => {
    if (!hydrated || !group || order || preparing) return;
    setPreparing(true);
    setInitError(null);

    (async () => {
      try {
        // Phase 3 — re-validation du panier AVANT création d'order. Le
        // producer/produit/slot peuvent avoir été invalidés entre l'ouverture
        // du panier et ce clic (admin a suspendu, producer a dépublié un
        // produit, slot plein par un autre consumer, stock tombé). On
        // redirige vers /compte/panier?stale=1 → la page panier clear le
        // dismiss du bandeau, re-valide, ré-affiche les changements.
        // Stock_insufficient (non-fatal) aussi : le total affiché ici serait
        // trompeur et l'user doit voir la quantité ajustée avant paiement.
        const validateRes = await fetch('/api/cart/validate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            items: group.items.map((it) => ({
              productId: it.productId,
              producerId: it.producerId,
              creneauId: it.creneauId,
              dateRetrait: it.dateRetrait,
              quantite: it.quantite,
            })),
          }),
        });
        if (validateRes.ok) {
          const vData = (await validateRes.json()) as ValidateResponse;
          const hasIssue = group.items.some((it) => {
            const status = vData.results[itemKey(it)];
            return status !== undefined && !status.ok;
          });
          if (hasIssue) {
            router.replace('/compte/panier?stale=1');
            return;
          }
        }
        // Si /validate fail (erreur réseau/serveur) : on laisse passer.
        // La RPC create_order_with_items reste le garde-fou final.

        const orderRes = await fetch('/api/orders/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            producer_id: group.producerId,
            slot_id: group.slotId,
            date_retrait: group.dateRetrait,
            items: group.items.map((it) => ({
              product_id: it.productId,
              quantite: it.quantite,
            })),
          }),
        });
        const orderData = await orderRes.json();
        if (!orderRes.ok) {
          // T-407 : 409 sur create-order (cas borderline, ex. order existante).
          // Même UX que 409 PI : rediriger vers commandes au lieu de retry.
          if (orderRes.status === 409) {
            console.warn('[CHECKOUT_INIT_409]', 'orders/create', orderData?.error);
            setInitError({ kind: 'init_409', message: 'Cette commande n\'est plus payable.' });
            return;
          }
          setInitError({
            kind: 'generic',
            message: orderData.error ?? 'Impossible de créer la commande',
          });
          return;
        }
        const created = orderData as OrderCreated;
        setOrder(created);

        const piRes = await fetch('/api/stripe/create-payment-intent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ order_id: created.order_id }),
        });
        const piData = await piRes.json();
        if (!piRes.ok || !piData.client_secret) {
          // T-407 : 409 = T-406 guard (order non-pending). Order morte
          // (webhook payment_failed a déjà cancelle, ou order
          // confirmed/ready/completed/refunded). Pas de retry possible
          // sur cette order, l'user doit consulter ses commandes.
          if (piRes.status === 409) {
            console.warn('[CHECKOUT_INIT_409]', 'create-payment-intent', piData?.error);
            setInitError({ kind: 'init_409', message: 'Cette commande n\'est plus payable.' });
            return;
          }
          setInitError({
            kind: 'generic',
            message: piData.error ?? 'Impossible d\'initialiser le paiement',
          });
          return;
        }
        setClientSecret(piData.client_secret as string);
      } catch {
        setInitError({ kind: 'generic', message: 'Erreur de connexion au serveur' });
      } finally {
        setPreparing(false);
      }
    })();
  }, [hydrated, group, order, preparing, router]);

  if (!hydrated) {
    return (
      <section className="py-24 text-center text-dark/50">
        Préparation du paiement…
      </section>
    );
  }

  if (!group) {
    return (
      <section className="py-24 text-center">
        <h1 className="font-serif text-[36px] text-green-900">Votre panier est vide</h1>
        <div className="mt-6"><Link href="/carte"><Button size="lg">Trouver un producteur →</Button></Link></div>
      </section>
    );
  }

  return (
    <section>
      <Link href="/compte/panier" className="text-[13px] text-dark/60 hover:text-green-900">← Retour au panier</Link>
        <h1 className="mt-3 font-serif text-[40px] md:text-[52px] text-green-900 leading-tight">Finaliser la commande</h1>

        {multipleGroups && (
          <div className="mt-4 p-4 rounded-xl bg-terra-100/60 border border-terra-300/40 text-[13px] text-terra-900">
            Votre panier contient plusieurs producteurs ou créneaux. Seule la première commande est traitée ici — les autres restent dans votre panier.
          </div>
        )}

        <div className="mt-8 grid lg:grid-cols-[1fr_380px] gap-10 items-start">
          <div className="space-y-6">
            <section className="bg-white rounded-2xl border border-dark/[0.06] shadow-soft p-6">
              <div className="text-[11px] uppercase tracking-[0.14em] text-terra-700 font-semibold mb-3">Votre commande</div>
              <ul className="divide-y divide-dark/[0.06]">
                {group.items.map((it) => (
                  <li key={`${it.productId}-${it.creneauId}-${it.dateRetrait}`} className="py-3 flex items-center justify-between gap-4">
                    <div>
                      <div className="text-[15px] text-dark font-medium">{it.nom}</div>
                      <div className="text-[12px] text-dark/50 mono">{it.quantite.toFixed(2).replace('.', ',')} {it.unite}</div>
                    </div>
                    <div className="font-serif text-[18px] text-green-900 tabular-nums">
                      {(it.prix * it.quantite).toFixed(2).replace('.', ',')} €
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            <section className="bg-white rounded-2xl border border-dark/[0.06] shadow-soft p-6">
              <div className="text-[11px] uppercase tracking-[0.14em] text-terra-700 font-semibold mb-3">Retrait à la ferme</div>
              <div className="font-serif text-[20px] text-green-900">{group.producerName}</div>
              <div className="mt-2 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-green-100 text-green-900 text-[13px] font-medium">
                🕐 {formatDateFr(group.dateRetrait)}
              </div>
            </section>

            <section className="bg-white rounded-2xl border border-dark/[0.06] shadow-soft p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="text-[11px] uppercase tracking-[0.14em] text-terra-700 font-semibold">Paiement</div>
                <span className="text-[11px] mono text-dark/50">🔒 Stripe · SSL</span>
              </div>

              {initError?.kind === 'init_409' ? (
                // T-407 : order morte (T-406 guard 409 sur create-PI/create-order).
                // Webhook payment_failed a probablement déjà cancelle l'order,
                // ou statut confirmed/ready/completed/refunded. Pas de retry
                // possible sur cette order — orienter user vers ses commandes.
                <div className="space-y-4">
                  <div className="p-4 rounded-xl bg-terra-100/60 border border-terra-300/40 text-[13px] text-terra-900">
                    {initError.message}
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Link href="/compte/commandes" className="flex-1">
                      <Button size="lg" className="w-full">Voir mes commandes</Button>
                    </Link>
                    <Button
                      size="lg"
                      variant="ghost"
                      className="flex-1"
                      onClick={() => {
                        clearCart();
                        router.push('/');
                      }}
                    >
                      Vider le panier
                    </Button>
                  </div>
                </div>
              ) : initError ? (
                <div className="p-4 rounded-xl bg-terra-100/60 border border-terra-300/40 text-[13px] text-terra-900">{initError.message}</div>
              ) : null}

              {!initError && !clientSecret && (
                <p className="text-[13px] text-dark/60">Initialisation du paiement…</p>
              )}

              {clientSecret && order && (
                <StripeElementsForm
                  clientSecret={clientSecret}
                  orderId={order.order_id}
                  amountLabel={Number(order.montant_total).toFixed(2).replace('.', ',')}
                />
              )}

              <div className="mt-5 flex items-start gap-3 p-3 rounded-xl bg-green-100/60 border border-green-300/40">
                <span className="text-xl">🛡️</span>
                <p className="text-[12px] text-dark/75 leading-relaxed">
                  <span className="font-semibold text-green-900">Paiement 100% sécurisé.</span> Remboursement garanti si le producteur annule la commande.
                </p>
              </div>
            </section>
          </div>

          <aside className="lg:sticky lg:top-24 bg-white rounded-2xl border border-dark/[0.06] shadow-soft p-6">
            <h2 className="font-serif text-[24px] text-green-900">À régler</h2>
            <div className="mt-4 flex items-baseline justify-between">
              <span className="text-[14px] text-dark/60">Total TTC</span>
              <span className="font-serif text-[38px] text-green-900 tabular-nums">
                {(order ? Number(order.montant_total) : subtotal).toFixed(2).replace('.', ',')} €
              </span>
            </div>
            <p className="text-[11px] text-dark/50 text-center mt-3">Vous recevrez un code de commande à présenter au retrait.</p>
          </aside>
        </div>
    </section>
  );
}

function StripeElementsForm({
  clientSecret,
  orderId,
  amountLabel,
}: {
  clientSecret: string;
  orderId: string;
  amountLabel: string;
}) {
  return (
    <Elements stripe={getStripe()} options={{ clientSecret, locale: 'fr', appearance: { theme: 'stripe' } }}>
      <CheckoutForm clientSecret={clientSecret} orderId={orderId} amountLabel={amountLabel} />
    </Elements>
  );
}

type PaymentMode = 'saved' | 'new';

function CheckoutForm({
  clientSecret,
  orderId,
  amountLabel,
}: {
  clientSecret: string;
  orderId: string;
  amountLabel: string;
}) {
  const router = useRouter();
  const stripe = useStripe();
  const elements = useElements();
  const clear = useCartStore((s) => s.clear);

  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<CheckoutError | null>(null);
  const [saveCard, setSaveCard] = useState(false);

  // Phase 7 : sélecteur CB enregistrée vs nouvelle CB.
  const [savedPms, setSavedPms] = useState<PaymentMethodSummary[] | null>(null);
  const [mode, setMode] = useState<PaymentMode>('new');
  const [selectedPmId, setSelectedPmId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await listPaymentMethodsAction();
      if (cancelled) return;
      if ('pms' in res && res.pms.length > 0) {
        setSavedPms(res.pms);
        setMode('saved');
        const defaultPm = res.pms.find((p) => p.isDefault) ?? res.pms[0];
        setSelectedPmId(defaultPm.id);
      } else {
        if ('error' in res) {
          console.warn('[LIST_PM]', res.error);
        }
        // Fail-silent : on laisse le mode 'new' par défaut.
        setSavedPms([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const hasSaved = !!savedPms && savedPms.length > 0;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe) return;
    setProcessing(true);
    setError(null);

    // Branche "CB enregistrée" : confirm direct via clientSecret + payment_method.
    // Stripe gère 3DS nativement (iframe modal in-page). Pas de PaymentElement
    // nécessaire puisque la CB est déjà attachée au Customer.
    if (mode === 'saved' && selectedPmId) {
      const { error: payError, paymentIntent } = await stripe.confirmCardPayment(
        clientSecret,
        { payment_method: selectedPmId },
      );

      if (payError) {
        setError({
          kind: 'generic',
          message: payError.message ?? 'Le paiement a échoué.',
        });
        setProcessing(false);
        return;
      }

      if (paymentIntent?.status === 'succeeded') {
        // Pas d'appel ensure-default-payment-method : la CB est déjà
        // enregistrée, donc déjà default ou intentionnellement non-default.
        clear();
        router.push(`/compte/confirmation/${orderId}`);
      } else {
        setProcessing(false);
      }
      return;
    }

    // Branche "Nouvelle carte" : comportement Phase 6 inchangé.
    if (!elements) return;

    if (saveCard) {
      const updateRes = await fetch('/api/stripe/create-payment-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_id: orderId, save_card: true }),
      });
      if (!updateRes.ok) {
        setError({
          kind: 'generic',
          message: "Impossible d'activer la mémorisation de la carte. Réessayez.",
        });
        setProcessing(false);
        return;
      }
    }

    const { error: payError, paymentIntent } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: `${window.location.origin}/compte/confirmation/${orderId}`,
      },
      redirect: 'if_required',
    });

    if (payError) {
      setError({
        kind: 'generic',
        message: payError.message ?? 'Le paiement a échoué.',
      });
      setProcessing(false);
      return;
    }

    if (paymentIntent?.status === 'succeeded') {
      if (saveCard) {
        try {
          const res = await fetch('/api/stripe/ensure-default-payment-method', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ order_id: orderId }),
          });
          if (!res.ok) {
            console.warn('[ENSURE_DEFAULT_PM]', res.status, await res.text());
          }
        } catch (err) {
          console.warn('[ENSURE_DEFAULT_PM]', (err as Error).message);
        }
      }
      clear();
      router.push(`/compte/confirmation/${orderId}`);
    } else {
      setProcessing(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {hasSaved && (
        <div className="space-y-3">
          <label className="flex items-start gap-3 cursor-pointer select-none">
            <input
              type="radio"
              name="payment-mode"
              checked={mode === 'saved'}
              onChange={() => setMode('saved')}
              disabled={processing}
              className="mt-1 h-4 w-4 accent-green-900"
            />
            <span className="text-[14px] font-medium text-dark/90">
              Carte enregistrée
            </span>
          </label>
          {mode === 'saved' && (
            <div className="ml-7 space-y-2">
              {savedPms!.map((pm) => (
                <label
                  key={pm.id}
                  className="flex items-center gap-3 cursor-pointer select-none rounded-lg border border-dark/[0.08] bg-white p-3 hover:border-green-700/40"
                >
                  <input
                    type="radio"
                    name="saved-pm"
                    checked={selectedPmId === pm.id}
                    onChange={() => setSelectedPmId(pm.id)}
                    disabled={processing}
                    className="h-4 w-4 accent-green-900"
                  />
                  <span className="text-[13px] text-dark/90">
                    {brandLabel(pm.brand)} •••• {pm.last4}
                    <span className="ml-2 text-[11px] text-dark/50">
                      exp. {String(pm.expMonth).padStart(2, '0')}/{String(pm.expYear).slice(-2)}
                    </span>
                  </span>
                  {pm.isDefault && (
                    <span className="ml-auto text-[10px] uppercase tracking-[0.12em] font-semibold text-green-900 bg-green-100 px-2 py-0.5 rounded">
                      Par défaut
                    </span>
                  )}
                </label>
              ))}
            </div>
          )}
          <label className="flex items-start gap-3 cursor-pointer select-none">
            <input
              type="radio"
              name="payment-mode"
              checked={mode === 'new'}
              onChange={() => setMode('new')}
              disabled={processing}
              className="mt-1 h-4 w-4 accent-green-900"
            />
            <span className="text-[14px] font-medium text-dark/90">
              Nouvelle carte
            </span>
          </label>
        </div>
      )}

      {/* PaymentElement toujours monté (required par useElements) mais caché
          en mode 'saved' pour éviter un remount coûteux. */}
      <div className={mode === 'saved' ? 'hidden' : 'space-y-4'}>
        <PaymentElement
          options={{
            layout: 'tabs',
            wallets: { applePay: 'never', googlePay: 'never' },
          }}
        />
        <label className="flex items-start gap-3 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={saveCard}
            onChange={(e) => setSaveCard(e.target.checked)}
            disabled={processing}
            className="mt-1 h-4 w-4 accent-green-900"
          />
          <span className="text-[13px] text-dark/80 leading-relaxed">
            Mémoriser cette carte pour mes prochaines commandes
            <span className="block text-[11px] text-dark/50 mt-0.5">
              Enregistrement sécurisé chez Stripe. Supprimable à tout moment dans « Moyens de paiement ».
            </span>
          </span>
        </label>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-terra-100/60 border border-terra-300/40 text-[13px] text-terra-900">{error.message}</div>
      )}
      <Button
        type="submit"
        size="lg"
        className="w-full"
        disabled={
          !stripe ||
          processing ||
          (mode === 'new' && !elements) ||
          (mode === 'saved' && !selectedPmId)
        }
      >
        {processing ? 'Traitement…' : `Payer ${amountLabel} €`}
      </Button>
    </form>
  );
}
