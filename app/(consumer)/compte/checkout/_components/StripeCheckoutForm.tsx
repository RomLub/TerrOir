'use client';

// debt-P2-6 — extraction du formulaire Stripe Elements de checkout/page.tsx
// (page monolithique 721 lignes 'use client'). Ce composant encapsule :
//   - le mount du provider <Elements> avec clientSecret
//   - la branche "carte enregistrée" (confirmCardPayment direct via clientSecret
//     + payment_method, 3DS modal Stripe natif)
//   - la branche "nouvelle carte" (PaymentElement + confirmPayment + option
//     mémorisation via /api/stripe/create-payment-intent save_card=true puis
//     ensure-default-payment-method post-success)
//   - la liste des cartes enregistrées via listPaymentMethodsAction (server
//     action). Mode auto-sélectionné 'saved' si l'user a >= 1 CB attachée,
//     sinon 'new'.
//
// Aucun changement de comportement runtime vs l'inline pré-extraction. Pattern
// identique : useEffect cleanup `cancelled` flag pour éviter setState après
// unmount sur la fetch listPaymentMethodsAction.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { Button } from '@/components/ui';
import { getStripe } from '@/lib/stripe/client';
import { useCartStore } from '@/lib/store/cart';
import { classifyStripeError, type CheckoutError } from '@/lib/checkout/classify-stripe-error';
import { clientLog } from '@/lib/utils/client-log';
import {
  listPaymentMethodsAction,
  type PaymentMethodSummary,
} from '../actions';

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

type PaymentMode = 'saved' | 'new';

type StripeCheckoutFormProps = {
  clientSecret: string;
  orderId: string;
  cartGroupId: string;
  amountLabel: string;
};

export function StripeCheckoutForm({ clientSecret, orderId, cartGroupId, amountLabel }: StripeCheckoutFormProps) {
  return (
    <Elements stripe={getStripe()} options={{ clientSecret, locale: 'fr', appearance: { theme: 'stripe' } }}>
      <CheckoutForm clientSecret={clientSecret} orderId={orderId} cartGroupId={cartGroupId} amountLabel={amountLabel} />
    </Elements>
  );
}

function CheckoutForm({ clientSecret, orderId, cartGroupId, amountLabel }: StripeCheckoutFormProps) {
  const router = useRouter();
  const stripe = useStripe();
  const elements = useElements();
  const removeGroup = useCartStore((s) => s.removeGroup);

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
          clientLog('warn', '[LIST_PM]', res.error);
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
        const classified = classifyStripeError(payError);
        clientLog('warn', `[CHECKOUT_${classified.kind.toUpperCase()}]`, classified.code ?? payError.code, payError.decline_code);
        setError(classified);
        setProcessing(false);
        return;
      }

      if (paymentIntent?.status === 'succeeded') {
        // Pas d'appel ensure-default-payment-method : la CB est déjà
        // enregistrée, donc déjà default ou intentionnellement non-default.
        removeGroup(cartGroupId);
        router.push(`/compte/confirmation/${orderId}?paid_group=${encodeURIComponent(cartGroupId)}`);
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
        return_url: `${window.location.origin}/compte/confirmation/${orderId}?paid_group=${encodeURIComponent(cartGroupId)}`,
      },
      redirect: 'if_required',
    });

    if (payError) {
      const classified = classifyStripeError(payError);
      clientLog('warn', `[CHECKOUT_${classified.kind.toUpperCase()}]`, classified.code ?? payError.code, payError.decline_code);
      setError(classified);
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
            clientLog('warn', '[ENSURE_DEFAULT_PM]', res.status, await res.text());
          }
        } catch (err) {
          clientLog('warn', '[ENSURE_DEFAULT_PM]', (err as Error).message);
        }
      }
      removeGroup(cartGroupId);
      router.push(`/compte/confirmation/${orderId}?paid_group=${encodeURIComponent(cartGroupId)}`);
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
          en mode 'saved' pour éviter un remount coûteux. Audit M-1 + L-3 :
          wallets Apple Pay / Google Pay autorisés (domain enregistré côté
          Stripe via scripts/register-payment-method-domain.ts, PI créé avec
          automatic_payment_methods.enabled). Le PaymentElement détecte
          automatiquement le support device-side (Safari iOS pour Apple Pay,
          Chrome avec compte Google pour Google Pay). En mode 'saved', le
          path confirmCardPayment est card-only (cohérent : on confirme une
          CB déjà attachée au Customer, pas un wallet). */}
      <div className={mode === 'saved' ? 'hidden' : 'space-y-4'}>
        <PaymentElement
          options={{
            layout: 'tabs',
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
      {error?.kind === 'pi_invalid' ? (
        // T-407 : PI canceled côté Stripe (timeout > 24h, cancel admin).
        // L'order est probablement déjà cancelled DB via webhook -> retry
        // sans intérêt, rediriger vers commandes.
        <Link href="/compte/commandes" className="block">
          <Button size="lg" className="w-full" type="button">Voir mes commandes</Button>
        </Link>
      ) : (
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
      )}
    </form>
  );
}
