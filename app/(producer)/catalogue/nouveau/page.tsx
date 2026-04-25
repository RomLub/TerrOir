'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, Badge, Input, Select, Textarea, ProductCard } from '@/components/ui';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { uploadProducerPhoto } from '@/lib/producers/upload';
import { promoteProducerToPublicIfActive } from '@/lib/producers/promote-to-public';
import { revalidatePublicStats } from '@/lib/stats/revalidate';
import { ProducerLayout } from '../../_components/ProducerLayout';

type Form = {
  name: string; description: string; category: string; price: string; unit: string;
  weightStep: string; estimatedWeight: string; stock: string; stockUnlimited: boolean;
  delai: string; active: boolean;
  conseilActive: boolean; conseilTexte: string;
};

const EMPTY: Form = {
  name: '', description: '', category: 'Bœuf', price: '', unit: 'kg',
  weightStep: '0.25', estimatedWeight: '', stock: '', stockUnlimited: false, delai: '2', active: true,
  conseilActive: false, conseilTexte: '',
};

const CONSEIL_MAX = 280;

export default function ProductNewPage() {
  const router = useRouter();
  const [form, setForm] = useState<Form>(EMPTY);
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const [producerId, setProducerId] = useState<string | null>(null);
  const [producerName, setProducerName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const supabase = createSupabaseBrowserClient();
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { if (active) setError('Non connecté.'); return; }
      const { data: prod } = await supabase
        .from('producers')
        .select('id, nom_exploitation')
        .eq('user_id', user.id)
        .maybeSingle();
      if (!active) return;
      if (!prod) { setError('Profil producteur introuvable.'); return; }
      setProducerId(prod.id);
      setProducerName(prod.nom_exploitation);
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    return () => { previewUrls.forEach((u) => URL.revokeObjectURL(u)); };
  }, [previewUrls]);

  const up = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleFiles = (files: FileList | null) => {
    if (!files) return;
    const accepted = Array.from(files).slice(0, 5 - photoFiles.length);
    const urls = accepted.map((f) => URL.createObjectURL(f));
    setPhotoFiles((p) => [...p, ...accepted].slice(0, 5));
    setPreviewUrls((p) => [...p, ...urls].slice(0, 5));
  };

  const removePhoto = (i: number) => {
    setPhotoFiles((p) => p.filter((_, j) => j !== i));
    setPreviewUrls((p) => {
      const removed = p[i];
      if (removed) URL.revokeObjectURL(removed);
      return p.filter((_, j) => j !== i);
    });
  };

  const preview = {
    id: 'preview', name: form.name || 'Nom du produit', category: form.category,
    price: parseFloat(form.price) || 0, unit: form.unit,
    stockLeft: form.stockUnlimited ? 999 : parseInt(form.stock) || 0, producer: producerName || 'Votre ferme',
    image: previewUrls[0] ?? null,
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!producerId) return;
    if (!form.name || !form.price) { setError('Nom et prix requis.'); return; }
    if (form.conseilActive && !form.conseilTexte.trim()) {
      setError('Conseil activé : saisissez le texte ou désactivez le conseil.');
      return;
    }
    setSaving(true);
    setError(null);

    const supabase = createSupabaseBrowserClient();

    try {
      const uploads = await Promise.all(
        photoFiles.map((f) => uploadProducerPhoto(supabase, 'product-photos', producerId, f)),
      );
      const photoUrls = uploads.map((u) => u.url);

      const { data: inserted, error: insertError } = await supabase
        .from('products')
        .insert({
          producer_id: producerId,
          nom: form.name.trim(),
          description: form.description.trim() || null,
          prix: Number(form.price),
          unite: form.unit,
          poids_estime_kg: form.estimatedWeight ? Number(form.estimatedWeight) : null,
          stock_disponible: form.stockUnlimited ? 0 : (parseInt(form.stock) || 0),
          stock_illimite: form.stockUnlimited,
          delai_preparation_jours: parseInt(form.delai) || 0,
          active: form.active,
          photos: photoUrls.length ? photoUrls : null,
          conseil_active: form.conseilActive,
          conseil_texte: form.conseilActive ? (form.conseilTexte.trim() || null) : null,
        })
        .select('id')
        .single();

      if (insertError || !inserted) throw insertError ?? new Error('Insertion impossible');
      if (form.active === true) {
        await promoteProducerToPublicIfActive(supabase, producerId);
        // Nouveau produit actif → +1 productsCount (et possiblement +1
        // producersCount via auto-promotion). Si form.active=false, le
        // produit n'entre pas dans le filtre, pas besoin d'invalider.
        try {
          await revalidatePublicStats();
        } catch (e) {
          console.warn(`[STATS_REVAL_WARN] ${(e as Error).message}`);
        }
      }
      router.push('/catalogue');
    } catch (err) {
      setError((err as Error).message ?? 'Enregistrement impossible');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ProducerLayout>
      <div className="max-w-7xl mx-auto px-8 py-10">
        <header className="mb-8">
          <Link href="/catalogue" className="text-[13px] text-dark/60 hover:text-green-900">← Retour au catalogue</Link>
          <h1 className="mt-2 font-serif text-[40px] text-green-900 leading-tight">Nouveau produit</h1>
          {error && <p className="mt-2 text-[13px] text-terra-700">{error}</p>}
        </header>

        <div className="grid lg:grid-cols-[1fr_380px] gap-10 items-start">
          <form onSubmit={save} className="space-y-8">
            <section className="bg-white rounded-2xl border border-dark/[0.06] shadow-soft p-6">
              <h2 className="font-serif text-[22px] text-green-900 mb-4">Informations produit</h2>
              <div className="space-y-4">
                <Input label="Nom du produit *" value={form.name} onChange={up('name')} required placeholder="Ex : Entrecôte maturée 21 jours" />
                <Textarea label="Description" rows={4} value={form.description} onChange={up('description')}
                  placeholder="Détaillez l'origine, la découpe, les conseils de cuisson…" />
                <Select label="Catégorie" value={form.category} onChange={up('category')}>
                  {['Bœuf', 'Veau', 'Porc', 'Agneau', 'Volaille', 'Colis'].map((c) => <option key={c}>{c}</option>)}
                </Select>
              </div>
            </section>

            <section className="bg-white rounded-2xl border border-dark/[0.06] shadow-soft p-6">
              <label className="flex items-center justify-between gap-3 cursor-pointer">
                <div>
                  <div className="font-serif text-[18px] text-green-900">Le conseil de l&apos;éleveur</div>
                  <div className="text-[12px] text-dark/55 mt-0.5">
                    Un mot manuscrit visible sur la fiche. Cuisson, conservation, accord…
                  </div>
                </div>
                <span className={`relative w-10 h-6 rounded-full transition-colors ${form.conseilActive ? 'bg-green-700' : 'bg-dark/20'}`}>
                  <input type="checkbox" className="sr-only" checked={form.conseilActive}
                    onChange={(e) => setForm({ ...form, conseilActive: e.target.checked })} />
                  <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${form.conseilActive ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
                </span>
              </label>
              {form.conseilActive && (
                <div className="mt-4">
                  <Textarea
                    rows={4}
                    maxLength={CONSEIL_MAX}
                    value={form.conseilTexte}
                    onChange={up('conseilTexte')}
                    placeholder="Ex : Sortez la viande 1h avant de la cuire. Saisir 2 min par face à feu vif, puis reposer sous papier alu."
                  />
                  <div className="mt-1 text-right text-[11px] text-dark/50 tabular-nums">
                    {form.conseilTexte.length}/{CONSEIL_MAX}
                  </div>
                </div>
              )}
            </section>

            <section className="bg-white rounded-2xl border border-dark/[0.06] shadow-soft p-6">
              <h2 className="font-serif text-[22px] text-green-900 mb-4">Prix et conditionnement</h2>
              <div className="grid sm:grid-cols-2 gap-4">
                <Input label="Prix *" type="number" step="0.01" min="0" value={form.price} onChange={up('price')} required placeholder="0,00" />
                <Select label="Unité *" value={form.unit} onChange={up('unit')}>
                  <option value="kg">Au kilo (kg)</option>
                  <option value="piece">À la pièce</option>
                  <option value="colis">Au colis</option>
                </Select>
              </div>
              {form.unit === 'kg' && (
                <div className="mt-4 grid sm:grid-cols-2 gap-4">
                  <Select label="Pas de commande" value={form.weightStep} onChange={up('weightStep')}>
                    <option value="0.25">0,25 kg</option>
                    <option value="0.5">0,5 kg</option>
                    <option value="1">1 kg</option>
                  </Select>
                  <Input label="Poids estimé par pièce (kg, optionnel)" type="number" step="0.1" value={form.estimatedWeight} onChange={up('estimatedWeight')} placeholder="Ex : 1,2" />
                </div>
              )}
            </section>

            <section className="bg-white rounded-2xl border border-dark/[0.06] shadow-soft p-6">
              <h2 className="font-serif text-[22px] text-green-900 mb-1">Photos</h2>
              <p className="text-[12px] text-dark/55 mb-4">Jusqu&apos;à 5 photos. La première servira de photo principale.</p>
              <div
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files); }}
                className={`rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
                  dragging ? 'border-green-700 bg-green-100/50' : 'border-dark/15 bg-bg'
                }`}>
                <div className="font-serif text-[18px] text-green-900">Glissez vos photos ici</div>
                <p className="text-[13px] text-dark/55 mt-1">ou</p>
                <label className="inline-block mt-3">
                  <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => handleFiles(e.target.files)} />
                  <span className="inline-flex items-center h-10 px-4 rounded-lg bg-green-700 text-white text-[14px] font-semibold cursor-pointer hover:bg-green-900">Choisir des fichiers</span>
                </label>
              </div>
              {previewUrls.length > 0 && (
                <div className="mt-4 grid grid-cols-5 gap-2">
                  {previewUrls.map((url, i) => (
                    <div key={i} className="relative aspect-square rounded-lg overflow-hidden group">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={url} alt="" className="w-full h-full object-cover" />
                      {i === 0 && <div className="absolute bottom-1 left-1"><Badge variant="terra">Principale</Badge></div>}
                      <button type="button" onClick={() => removePhoto(i)}
                        className="absolute top-1 right-1 w-6 h-6 rounded-full bg-dark/70 text-white text-xs hover:bg-terra-700">×</button>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="bg-white rounded-2xl border border-dark/[0.06] shadow-soft p-6">
              <h2 className="font-serif text-[22px] text-green-900 mb-4">Stock et disponibilité</h2>
              <label className="flex items-center gap-3 cursor-pointer mb-4">
                <span className={`relative w-10 h-6 rounded-full transition-colors ${form.stockUnlimited ? 'bg-green-700' : 'bg-dark/20'}`}>
                  <input type="checkbox" className="sr-only" checked={form.stockUnlimited}
                    onChange={(e) => setForm({ ...form, stockUnlimited: e.target.checked })} />
                  <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${form.stockUnlimited ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
                </span>
                <span className="text-[14px] font-medium">Stock illimité</span>
              </label>
              {!form.stockUnlimited && (
                <Input label={`Quantité en stock (${form.unit})`} type="number" min="0" value={form.stock} onChange={up('stock')} placeholder="0" />
              )}
              <div className="mt-4">
                <Input label="Délai de préparation (en jours)" type="number" min="0" value={form.delai} onChange={up('delai')} />
                <p className="text-[11px] text-dark/50 mt-1">Les clients verront : « Disponible sous {form.delai || 0} jour{parseInt(form.delai) > 1 ? 's' : ''} ».</p>
              </div>
            </section>

            <section className="bg-white rounded-2xl border border-dark/[0.06] shadow-soft p-6">
              <label className="flex items-center justify-between gap-3 cursor-pointer">
                <div>
                  <div className="font-serif text-[18px] text-green-900">Produit actif</div>
                  <div className="text-[12px] text-dark/55 mt-0.5">Visible sur votre page publique.</div>
                </div>
                <span className={`relative w-10 h-6 rounded-full transition-colors ${form.active ? 'bg-green-700' : 'bg-dark/20'}`}>
                  <input type="checkbox" className="sr-only" checked={form.active}
                    onChange={(e) => setForm({ ...form, active: e.target.checked })} />
                  <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${form.active ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
                </span>
              </label>
            </section>

            <div className="flex gap-3 justify-end pt-2">
              <Link href="/catalogue"><Button variant="ghost" size="lg" type="button">Annuler</Button></Link>
              <Button size="lg" type="submit" disabled={saving || !producerId}>
                {saving ? 'Enregistrement…' : 'Enregistrer le produit'}
              </Button>
            </div>
          </form>

          <aside className="lg:sticky lg:top-10">
            <div className="text-[11px] uppercase tracking-[0.14em] text-terra-700 font-semibold mb-3">Prévisualisation</div>
            <ProductCard product={preview} onClick={() => {}} />
            <p className="mt-3 text-[11px] text-dark/50 text-center">Voici comment votre produit apparaîtra aux clients.</p>
          </aside>
        </div>
      </div>
    </ProducerLayout>
  );
}
