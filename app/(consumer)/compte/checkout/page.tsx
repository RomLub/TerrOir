'use client';

// debt-P2-6 — page checkout monolithique 721 lignes 'use client'. Refacto
// conservative : extraction du formulaire Stripe Elements (StripeCheckoutForm
// + CheckoutForm + branche carte enregistrée vs nouvelle) dans
// `_components/StripeCheckoutForm.tsx`. Aucun changement UX. La page reste
// orchestratrice (init order/PI, gestion erreurs init, layout récap +
// retrait + paiement).

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui';
import { useCartStore, type CartItem } from '@/lib/store/cart';
import { itemKey, type ValidateResponse } from '@/lib/cart/validate';
import { type CheckoutError } from '@/lib/checkout/classify-stripe-error';
import { SUPPORT_EMAIL_PUBLIC } from '@/lib/env/support-email-public';
import { clientLog } from '@/lib/utils/client-log';
import { StripeCheckoutForm } from './_components/StripeCheckoutForm';

type OrderCreated = {
  order_id: string;
  code_commande: string;
  montant_total: number;
  commission: number;
  montant_net: number;
};

// T-443 : payload erreur exposé par /api/orders/create depuis T-434.
// Le serveur joint le hint structuré (`slot_invalid`/`slot_full`/`stock_depleted`/
// `product_producer_mismatch`) + details `key=value;key=value` quand la RPC
// raise SQLSTATE 23514. Avant T-443, le client lisait uniquement `error`.
type OrderCreateErrorPayload = {
  error?: string;
  code?: string;
  hint?: string;
  details?: string;
};

// T-443 : anomalie technique détectée côté RPC (cas `product_producer_mismatch` :
// un item du panier appartient à un autre producer). Friction user-facing
// minimale (pas de modal lourde) : div + mailto support pour signaler.
type TechnicalError = {
  message: string;
  code: string;
  details?: string;
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
  // T-443 : état séparé pour anomalie technique product_producer_mismatch
  // (rare). Distinct de CheckoutError dont l'enum kind ne couvre pas ce cas.
  const [technicalError, setTechnicalError] = useState<TechnicalError | null>(
    null,
  );
  const [preparing, setPreparing] = useState(false);
  // Acceptation CGV obligatoire avant init order/PI. Tant que false, le
  // useEffect d'init reste gardé : pas d'order créée en DB, pas de PI Stripe.
  // Garantit l'invariant "cgv_accepted_at toujours peuplé pour les orders
  // créées via le flow checkout standard".
  const [cgvAccepted, setCgvAccepted] = useState(false);

  const subtotal = group ? group.items.reduce((s, i) => s + i.prix * i.quantite, 0) : 0;

  const router = useRouter();

  useEffect(() => {
    if (!hydrated || !group || order || preparing || !cgvAccepted) return;
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
            cgv_accepted: true,
          }),
        });
        const orderData = await orderRes.json();
        if (!orderRes.ok) {
          // T-443 : route /api/orders/create expose `{error, code, hint, details}`
          // depuis T-434. Discriminer par hint pour UX riche au lieu d'un
          // message hardcodé qui masquait les hints UX FR du serveur.
          const errPayload = orderData as OrderCreateErrorPayload;
          clientLog(
            'warn',
            '[CHECKOUT_ORDER_CREATE_ERR]',
            `status=${orderRes.status}`,
            `hint=${errPayload.hint ?? 'none'}`,
            errPayload.error,
          );
          switch (errPayload.hint) {
            // Slot devenu indisponible/saturé entre cart/validate initial et
            // POST orders/create (race rare). Le panier re-validera via ?stale=1
            // et affichera StaleItemsBanner avec le changement détecté.
            case 'slot_invalid':
            case 'slot_full':
            case 'stock_depleted':
              router.replace('/compte/panier?stale=1');
              return;
            // Anomalie technique : item du panier appartient à un autre
            // producer (corruption store/manipulation client). Cas patho
            // rare → div + mailto support, pas de retry pertinent.
            case 'product_producer_mismatch':
              setTechnicalError({
                message:
                  errPayload.error ?? 'Erreur technique. Contactez le support.',
                code: errPayload.code ?? 'P_MISMATCH',
                details: errPayload.details,
              });
              return;
            // Fallback : autres 409 sans hint (ex: route line 84 "Créneau
            // invalide ou indisponible" hors RPC) ou status non-409. Préserve
            // T-407 init_409 (UX commande morte → "Voir mes commandes").
            default:
              if (orderRes.status === 409) {
                setInitError({
                  kind: 'init_409',
                  message: errPayload.error ?? 'Cette commande n\'est plus payable.',
                });
                return;
              }
              setInitError({
                kind: 'generic',
                message: errPayload.error ?? 'Impossible de créer la commande',
              });
              return;
          }
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
          // confirmed/completed/refunded). Pas de retry possible sur
          // cette order, l'user doit consulter ses commandes.
          if (piRes.status === 409) {
            clientLog('warn', '[CHECKOUT_INIT_409]', 'create-payment-intent', piData?.error);
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
  }, [hydrated, group, order, preparing, router, cgvAccepted]);

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
        <h1 className="font-serif text-[36px] text-green-900">Ton panier est vide</h1>
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
            Ton panier contient plusieurs producteurs ou créneaux. Seule la première commande est traitée ici — les autres restent dans ton panier.
          </div>
        )}

        <div className="mt-8 grid lg:grid-cols-[1fr_380px] gap-10 items-start">
          <div className="space-y-6">
            <section className="bg-white rounded-2xl border border-dark/[0.06] shadow-soft p-6">
              <div className="text-[11px] uppercase tracking-[0.14em] text-terra-700 font-semibold mb-3">Ta commande</div>
              <ul className="divide-y divide-dark/[0.06]">
                {group.items.map((it) => (
                  <li key={`${it.productId}-${it.creneauId}-${it.dateRetrait}`} className="py-3 flex items-center justify-between gap-4">
                    <div>
                      <div className="text-[15px] text-dark font-medium">{it.nom}</div>
                      <div className="text-[12px] text-dark/50">{it.quantite.toFixed(2).replace('.', ',')} {it.unite}</div>
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
                <span className="text-[11px] text-dark/50">🔒 Stripe · SSL</span>
              </div>

              {/* CGV obligatoire — checkbox gate l'init order/PI. Désactivée
                  une fois cochée (l'order est créée DB avec cgv_accepted_at,
                  décocher n'aurait aucun effet sur la trace persistée). */}
              <label className="mb-4 flex items-start gap-3 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={cgvAccepted}
                  onChange={(e) => setCgvAccepted(e.target.checked)}
                  disabled={cgvAccepted}
                  className="mt-1 h-4 w-4 accent-green-900"
                />
                <span className="text-[13px] text-dark/80 leading-relaxed">
                  J&rsquo;ai lu et j&rsquo;accepte les{' '}
                  <Link
                    href="/cgv"
                    target="_blank"
                    rel="noopener"
                    className="text-green-900 underline hover:opacity-80"
                  >
                    Conditions générales de vente
                  </Link>{' '}
                  et confirme ma commande.
                </span>
              </label>

              {!cgvAccepted && (
                <p className="text-[13px] text-dark/60">
                  Pour finaliser ta commande, accepte les conditions générales de vente.
                </p>
              )}

              {technicalError ? (
                // T-443 product_producer_mismatch : anomalie technique rare
                // (item du panier appartient à un autre producer). Pas de retry
                // pertinent — div + mailto support pour signaler. Cohérent
                // style terra des autres erreurs init.
                <div className="p-4 rounded-xl bg-terra-100/60 border border-terra-300/40">
                  <div className="text-[11px] uppercase tracking-[0.14em] text-terra-700 font-semibold mb-1">
                    Erreur technique
                  </div>
                  <p className="text-[13px] text-terra-900">{technicalError.message}</p>
                  <p className="text-[11px] text-dark/60 mt-2">
                    Code : {technicalError.code}
                    {technicalError.details ? ` — ${technicalError.details}` : ''}
                  </p>
                  <a
                    href={`mailto:${SUPPORT_EMAIL_PUBLIC}?subject=${encodeURIComponent(`Erreur technique commande - ${technicalError.code}`)}&body=${encodeURIComponent(`Code erreur : ${technicalError.code}\nDétails : ${technicalError.details ?? 'N/A'}\n\nContexte : (décris ce que tu tentais de faire)`)}`}
                    className="inline-block mt-3 text-[13px] underline text-terra-900 hover:text-terra-700"
                  >
                    Contacter le support →
                  </a>
                </div>
              ) : initError?.kind === 'init_409' ? (
                // T-407 : order morte (T-406 guard 409 sur create-PI/create-order).
                // Webhook payment_failed a probablement déjà cancelle l'order,
                // ou statut confirmed/completed/refunded. Pas de retry
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

              {cgvAccepted && !initError && !technicalError && !clientSecret && (
                <p className="text-[13px] text-dark/60">Initialisation du paiement…</p>
              )}

              {clientSecret && order && (
                <StripeCheckoutForm
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
            <p className="text-[11px] text-dark/50 text-center mt-3">Tu recevras un code de commande à présenter au retrait.</p>
          </aside>
        </div>
    </section>
  );
}

