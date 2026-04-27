'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Button, Badge } from '@/components/ui';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { promoteProducerToPublicIfActive } from '@/lib/producers/promote-to-public';
import { revalidatePublicStats } from '@/lib/stats/revalidate';
import { ProducerLayout } from '../_components/ProducerLayout';

type Product = {
  id: string;
  nom: string;
  prix: number;
  unite: string;
  stock: number;
  unlimited: boolean;
  active: boolean;
  image: string | null;
};

export default function ProducerCataloguePage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [producerId, setProducerId] = useState<string | null>(null);
  // slug + statut : nécessaires pour afficher le lien ↗ "voir la fiche
  // publique" uniquement si le producer est en statut='public' (sinon la
  // route consumer renvoie 404 via fetchPublicProducerBySlug).
  const [producerSlug, setProducerSlug] = useState<string | null>(null);
  const [producerStatut, setProducerStatut] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const supabase = createSupabaseBrowserClient();

    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { if (active) { setError('Non connecté.'); setLoading(false); } return; }

      const { data: prod } = await supabase
        .from('producers')
        .select('id, slug, statut')
        .eq('user_id', user.id)
        .maybeSingle();
      if (!prod) { if (active) { setError('Profil producteur introuvable.'); setLoading(false); } return; }
      if (active) {
        setProducerId(prod.id);
        setProducerSlug(prod.slug);
        setProducerStatut(prod.statut);
      }

      const { data, error: fetchError } = await supabase
        .from('products')
        .select('id, nom, prix, unite, stock_disponible, stock_illimite, active, photos')
        .eq('producer_id', prod.id)
        .order('created_at', { ascending: false });

      if (!active) return;
      if (fetchError) { setError(fetchError.message); setLoading(false); return; }

      const rows: Product[] = (data ?? []).map((p) => ({
        id: p.id,
        nom: p.nom,
        prix: Number(p.prix),
        unite: p.unite ?? 'kg',
        stock: p.stock_disponible ?? 0,
        unlimited: !!p.stock_illimite,
        active: !!p.active,
        image: Array.isArray(p.photos) && p.photos.length > 0 ? p.photos[0] : null,
      }));

      setProducts(rows);
      setLoading(false);
    })();

    return () => { active = false; };
  }, []);

  const toggle = async (id: string) => {
    const current = products.find((p) => p.id === id);
    if (!current) return;
    setToggling(id);
    const supabase = createSupabaseBrowserClient();
    const next = !current.active;
    const { error: upError } = await supabase
      .from('products')
      .update({ active: next })
      .eq('id', id);
    if (!upError) {
      setProducts((arr) => arr.map((p) => p.id === id ? { ...p, active: next } : p));
      if (next === true && producerId) {
        await promoteProducerToPublicIfActive(supabase, producerId);
      }
      // Toggle actif change toujours productsCount (et possiblement
      // producersCount via l'auto-promotion).
      try {
        await revalidatePublicStats();
      } catch (e) {
        console.warn(`[STATS_REVAL_WARN] ${(e as Error).message}`);
      }
    } else {
      setError(upError.message);
    }
    setToggling(null);
  };

  return (
    <ProducerLayout>
      <div className="max-w-6xl mx-auto px-8 py-10">
        <header className="mb-8 flex items-end justify-between gap-4 flex-wrap">
          <div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-terra-700 font-semibold">Catalogue</div>
            <h1 className="mt-1 font-serif text-[40px] text-green-900 leading-tight">Vos produits</h1>
            <p className="text-[14px] text-dark/60 mt-1">
              {loading ? 'Chargement…' : `${products.filter((p) => p.active).length} produits actifs · ${products.length} au total`}
            </p>
            {error && <p className="mt-2 text-[13px] text-terra-700">{error}</p>}
          </div>
          <Link href="/catalogue/nouveau"><Button variant="accent" size="lg">+ Ajouter un produit</Button></Link>
        </header>

        {!loading && products.length === 0 ? (
          <div className="bg-white rounded-2xl border border-dark/[0.06] p-12 text-center">
            <h3 className="font-serif text-[24px] text-green-900">Aucun produit</h3>
            <p className="text-[14px] text-dark/60 mt-1">Créez votre premier produit pour l&apos;afficher sur votre page.</p>
            <div className="mt-6"><Link href="/catalogue/nouveau"><Button variant="accent" size="lg">+ Ajouter un produit</Button></Link></div>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {products.map((p) => {
              const lowStock = !p.unlimited && p.stock > 0 && p.stock < 5;
              const empty = !p.unlimited && p.stock === 0;
              return (
                <article key={p.id} className={`bg-white rounded-2xl border shadow-soft overflow-hidden transition-opacity ${
                  p.active ? 'border-dark/[0.06]' : 'border-dark/[0.04] opacity-60'
                }`}>
                  <div className="aspect-[4/3] relative flex items-center justify-center text-green-900/30 font-mono text-[10px] uppercase overflow-hidden"
                       style={!p.image ? { backgroundImage: 'repeating-linear-gradient(45deg, #D8F3DC 0 12px, #C9EAD0 12px 24px)' } : undefined}>
                    {p.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.image} alt="" className="absolute inset-0 w-full h-full object-cover" />
                    ) : (
                      'Photo produit'
                    )}
                    {lowStock && <div className="absolute top-3 right-3"><Badge variant="terra">Stock faible</Badge></div>}
                    {empty && <div className="absolute top-3 right-3"><Badge variant="gray">Épuisé</Badge></div>}
                  </div>
                  <div className="p-4">
                    <h3 className="font-serif text-[18px] text-green-900 leading-tight">{p.nom}</h3>
                    <div className="mt-2 flex items-baseline gap-2">
                      <span className="font-serif text-[22px] text-green-900 tabular-nums">{p.prix.toFixed(2).replace('.', ',')} €</span>
                      <span className="text-[12px] text-dark/55">/ {p.unite}</span>
                    </div>
                    <div className="mt-1 text-[12px] text-dark/60 mono">{p.unlimited ? '∞ illimité' : `${p.stock} ${p.unite} en stock`}</div>
                    <div className="mt-4 pt-4 border-t border-dark/[0.06] flex items-center justify-between gap-2">
                      <label className="flex items-center gap-2 cursor-pointer select-none">
                        <span className="text-[12px] text-dark/60 font-medium">{p.active ? 'Actif' : 'Inactif'}</span>
                        <span className={`relative w-9 h-5 rounded-full transition-colors ${p.active ? 'bg-green-700' : 'bg-dark/20'}`}>
                          <input type="checkbox" className="sr-only" checked={p.active} disabled={toggling === p.id} onChange={() => toggle(p.id)} />
                          <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${p.active ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
                        </span>
                      </label>
                      <div className="flex items-center gap-3">
                        <Link href={`/catalogue/${p.id}/modifier`} className="text-[13px] text-green-700 font-medium hover:text-green-900">Modifier →</Link>
                        {producerStatut === 'public' && producerSlug && (
                          <a
                            href={`/producteurs/${producerSlug}/produits/${p.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[13px] text-dark/55 hover:text-green-900"
                            title="Voir la fiche publique"
                            aria-label="Voir la fiche publique"
                          >
                            ↗
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </ProducerLayout>
  );
}
