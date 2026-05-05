'use client';

import Image from 'next/image';
import Link from 'next/link';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Button, Badge } from '@/components/ui';
import { useCartStore, type CartItem } from '@/lib/store/cart';
import { itemKey, type ValidateResponse } from '@/lib/cart/validate';
import { StaleItemsBanner, type StaleChange } from './_components/StaleItemsBanner';

// Libellés user-facing pour chaque raison retournée par /api/cart/validate.
function reasonLabel(
  reason: 'producer_unavailable' | 'product_unavailable' | 'slot_unavailable' | 'slot_full',
): string {
  switch (reason) {
    case 'producer_unavailable':
      return "ce producteur n'est plus disponible";
    case 'product_unavailable':
      return "ce produit n'est plus disponible";
    case 'slot_unavailable':
      return 'ce créneau de retrait n\'est plus disponible';
    case 'slot_full':
      return 'le créneau choisi est complet';
  }
}

function formatQty(qty: number, unite: string): string {
  return `${qty.toFixed(2).replace('.', ',')} ${unite}`;
}

function formatDateFr(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
}

function PanierFallback() {
  return (
    <div className="space-y-4 py-10" aria-busy="true">
      {Array.from({ length: 3 }).map((_, i) => (
        <div
          key={i}
          className="flex gap-4 rounded-2xl border border-terroir-border bg-white p-4 shadow-sm"
        >
          <div className="h-20 w-20 shrink-0 animate-pulse rounded-xl bg-terroir-green-100" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-2/3 animate-pulse rounded bg-dark/10" />
            <div className="h-3 w-1/3 animate-pulse rounded bg-dark/10" />
            <div className="h-5 w-24 animate-pulse rounded bg-dark/10" />
          </div>
        </div>
      ))}
    </div>
  );
}

// Audit Vercel C-4 (2026-05-05) : migration partielle "coquille SSR" du
// panier. Le shell (h1 + scaffolding récap) est rendu serveur via page.tsx
// pour réduire le flash pré-hydratation. Items panier restent en Zustand
// localStorage (zero-knowledge serveur par design — le serveur ne peut PAS
// connaître le contenu du panier).
export function PanierClient() {
  return (
    <Suspense fallback={<PanierFallback />}>
      <PanierClientInner />
    </Suspense>
  );
}

function PanierClientInner() {
  const items = useCartStore((s) => s.items);
  const updateQuantity = useCartStore((s) => s.updateQuantity);
  const removeItem = useCartStore((s) => s.removeItem);

  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setHydrated(true);
  }, []);

  // Validation DB au load : détecte les items orphelins (producer
  // suspended/deleted, produit inactif, slot supprimé, slot plein, stock
  // tombé en dessous de la quantité en panier) et applique remove/clamp.
  //
  // L'effet ne tourne QU'UNE fois après hydratation — on ne relance pas
  // sur chaque mutation du panier, sinon boucle infinie. Le checkout
  // re-valide explicitement avant POST /api/orders/create, et un arrivage
  // sur /compte/panier?stale=1 (redirect depuis le checkout) force un
  // re-run + clear du dismiss banner.
  const searchParams = useSearchParams();
  const forceRefresh = searchParams.get('stale') === '1';
  const validatedRef = useRef(false);
  const [staleChanges, setStaleChanges] = useState<StaleChange[]>([]);

  useEffect(() => {
    if (!hydrated) return;
    if (validatedRef.current && !forceRefresh) return;
    validatedRef.current = true;

    const current = useCartStore.getState().items;
    if (current.length === 0) {
      setStaleChanges([]);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/cart/validate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            items: current.map((it) => ({
              productId: it.productId,
              producerId: it.producerId,
              creneauId: it.creneauId,
              dateRetrait: it.dateRetrait,
              quantite: it.quantite,
            })),
          }),
        });
        if (cancelled) return;
        if (!res.ok) return; // fail-silent : le checkout re-validera.

        const data = (await res.json()) as ValidateResponse;
        const store = useCartStore.getState();
        const changes: StaleChange[] = [];

        for (const item of current) {
          const status = data.results[itemKey(item)];
          if (!status || status.ok) continue;

          const key = {
            productId: item.productId,
            creneauId: item.creneauId,
            dateRetrait: item.dateRetrait,
          };
          if (status.fatal) {
            store.removeItem(key);
            changes.push({ nom: item.nom, reason: reasonLabel(status.reason) });
          } else {
            store.updateQuantity(key, status.maxQuantite);
            changes.push({
              nom: item.nom,
              reason: `quantité ajustée à ${formatQty(status.maxQuantite, item.unite)} (stock restreint)`,
            });
          }
        }
        if (!cancelled) setStaleChanges(changes);
      } catch {
        // fail-silent
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [hydrated, forceRefresh]);

  const byProducer = useMemo(() => {
    const map: Record<string, { name: string; slug: string; producerId: string; items: CartItem[] }> = {};
    items.forEach((i) => {
      if (!map[i.producerId]) {
        map[i.producerId] = {
          name: i.producerName ?? 'Producteur',
          slug: i.slug,
          producerId: i.producerId,
          items: [],
        };
      }
      map[i.producerId].items.push(i);
    });
    return Object.values(map);
  }, [items]);

  const subtotal = items.reduce((s, i) => s + i.prix * i.quantite, 0);

  const step = (unite: string) => (unite === 'kg' ? 0.25 : 1);

  if (!hydrated) {
    return <PanierFallback />;
  }

  if (items.length === 0) {
    return (
      <div className="py-24 text-center">
        <div className="max-w-xl mx-auto text-left">
          <StaleItemsBanner changes={staleChanges} forceShow={forceRefresh} />
        </div>
        <p className="font-serif text-[28px] text-green-900">Votre panier est vide</p>
        <p className="mt-3 text-[16px] text-dark/70">Découvrez les éleveurs sarthois près de chez vous.</p>
        <div className="mt-8"><Link href="/carte"><Button size="lg">Trouver un producteur →</Button></Link></div>
      </div>
    );
  }

  return (
    <>
      <p className="text-[14px] text-dark/60 mt-1">{items.length} article{items.length > 1 ? 's' : ''} chez {byProducer.length} producteur{byProducer.length > 1 ? 's' : ''}</p>

      <div className="mt-6">
        <StaleItemsBanner changes={staleChanges} forceShow={forceRefresh} />
      </div>

      <div className="mt-10 grid lg:grid-cols-[1fr_380px] gap-10 items-start">
        <div className="space-y-6">
          {byProducer.map((p) => (
            <section key={p.producerId} className="bg-white rounded-2xl border border-dark/[0.06] shadow-soft overflow-hidden">
              <header className="px-5 py-4 border-b border-dark/[0.06] flex items-center justify-between gap-3">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.14em] text-terra-700 font-semibold">Commande chez</div>
                  <Link href={`/producteurs/${p.slug}`} className="font-serif text-[22px] text-green-900 hover:text-green-700">{p.name}</Link>
                </div>
                <Badge>{p.items.length} article{p.items.length > 1 ? 's' : ''}</Badge>
              </header>
              <ul className="divide-y divide-dark/[0.06]">
                {p.items.map((it) => {
                  const key = { productId: it.productId, creneauId: it.creneauId, dateRetrait: it.dateRetrait };
                  const s = step(it.unite);
                  return (
                    <li key={`${it.productId}-${it.creneauId}-${it.dateRetrait}`} className="p-5 flex items-start gap-4">
                      <div className="relative w-20 h-20 rounded-xl flex-shrink-0 overflow-hidden"
                           style={!it.image ? { backgroundImage: 'repeating-linear-gradient(45deg, #D8F3DC 0 10px, #C9EAD0 10px 20px)' } : undefined}>
                        {it.image && (
                          <Image
                            src={it.image}
                            alt=""
                            fill
                            sizes="80px"
                            className="object-cover"
                          />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-serif text-[18px] text-green-900 leading-tight">{it.nom}</h3>
                        <div className="text-[12px] text-dark/60 mt-0.5 mono">Retrait · {formatDateFr(it.dateRetrait)}</div>
                        <div className="mt-3 flex items-center gap-3 flex-wrap">
                          <div className="inline-flex items-stretch rounded-lg border border-dark/10 bg-white">
                            <button type="button"
                              onClick={() => updateQuantity(key, Number((it.quantite - s).toFixed(2)))}
                              className="w-9 h-9 text-green-900 hover:bg-green-100 disabled:opacity-30"
                              disabled={it.quantite <= s}>−</button>
                            <div className="w-20 h-9 flex items-center justify-center text-[13px] font-semibold tabular-nums border-x border-dark/10">
                              {it.quantite.toFixed(2).replace('.', ',')} {it.unite}
                            </div>
                            <button type="button"
                              onClick={() => updateQuantity(key, Number((it.quantite + s).toFixed(2)))}
                              className="w-9 h-9 text-green-900 hover:bg-green-100">+</button>
                          </div>
                          <button type="button" onClick={() => removeItem(key)}
                            className="text-[13px] text-dark/50 hover:text-terra-700 underline">Retirer</button>
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <div className="font-serif text-[20px] text-green-900 tabular-nums">{(it.prix * it.quantite).toFixed(2).replace('.', ',')} €</div>
                        <div className="text-[12px] text-dark/50 mono">{it.prix.toFixed(2).replace('.', ',')} € / {it.unite}</div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>

        <aside className="lg:sticky lg:top-24 bg-white rounded-2xl border border-dark/[0.06] shadow-soft p-6">
          <h2 className="font-serif text-[24px] text-green-900">Récapitulatif</h2>
          <dl className="mt-5 space-y-3 text-[14px]">
            <div className="flex justify-between"><dt className="text-dark/70">Sous-total</dt><dd className="tabular-nums">{subtotal.toFixed(2).replace('.', ',')} €</dd></div>
            <div className="flex justify-between text-dark/55"><dt>Commission TerrOir (6%)</dt><dd className="mono">incluse</dd></div>
            <div className="flex justify-between text-dark/55"><dt>Retrait à la ferme</dt><dd className="mono">gratuit</dd></div>
          </dl>
          <div className="border-t border-dark/[0.08] mt-5 pt-5 flex items-baseline justify-between">
            <span className="font-serif text-[20px] text-green-900">Total</span>
            <span className="font-serif text-[32px] text-green-900 tabular-nums">{subtotal.toFixed(2).replace('.', ',')} €</span>
          </div>
          <Link href="/compte/checkout"><Button size="lg" className="w-full mt-6">Commander →</Button></Link>
          <p className="text-[11px] text-dark/50 text-center mt-3">Paiement sécurisé · Remboursement garanti</p>
        </aside>
      </div>
    </>
  );
}
