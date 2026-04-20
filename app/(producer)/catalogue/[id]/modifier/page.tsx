'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Button, Badge, Input, Select, Textarea, ProductCard } from '@/components/ui';
import { ProducerLayout } from '../../../_components/ProducerLayout';

type ProductForm = {
  name: string;
  description: string;
  category: string;
  price: string;
  unit: string;
  weightStep: string;
  estimatedWeight: string;
  stock: string;
  stockUnlimited: boolean;
  delai: string;
  active: boolean;
};

const PRODUCTS: Record<string, ProductForm> = {
  entrecote: {
    name: 'Entrecôte maturée 21 jours',
    description: "Pièce noble de Charolais, maturée 21 jours sur os pour développer tout son caractère. Idéale poêlée ou grillée.",
    category: 'Bœuf', price: '34.50', unit: 'kg', weightStep: '0.25', estimatedWeight: '1.2',
    stock: '5', stockUnlimited: false, delai: '2', active: true,
  },
  roti: {
    name: 'Rôti de bœuf Charolais',
    description: "Rôti de tranche grasse, ficelé par nos soins. Cuisson au four recommandée.",
    category: 'Bœuf', price: '24.90', unit: 'kg', weightStep: '0.5', estimatedWeight: '1.5',
    stock: '12', stockUnlimited: false, delai: '2', active: true,
  },
  bourguignon: {
    name: 'Bourguignon Charolais',
    description: "Morceaux parés pour mijoté, paleron et macreuse. Fond et mâche garantis.",
    category: 'Bœuf', price: '19.90', unit: 'kg', weightStep: '0.5', estimatedWeight: '',
    stock: '22', stockUnlimited: false, delai: '2', active: true,
  },
  gigot: {
    name: "Gigot d'agneau de pré",
    description: "Agneau de pré-salé, élevage en plein air. Parfait pour un rôti du dimanche.",
    category: 'Agneau', price: '28.00', unit: 'kg', weightStep: '0.5', estimatedWeight: '2.2',
    stock: '3', stockUnlimited: false, delai: '3', active: true,
  },
  merguez: {
    name: 'Merguez maison',
    description: "Recette traditionnelle, pur agneau, épices fraîches broyées chaque semaine.",
    category: 'Agneau', price: '18.50', unit: 'kg', weightStep: '0.25', estimatedWeight: '',
    stock: '0', stockUnlimited: false, delai: '2', active: false,
  },
  colis: {
    name: 'Colis découverte 5 kg',
    description: "5 kg de viande variée : steaks, rôti, bourguignon, saucisses. Idéal pour découvrir la ferme.",
    category: 'Colis', price: '89.00', unit: 'colis', weightStep: '1', estimatedWeight: '',
    stock: '8', stockUnlimited: false, delai: '5', active: true,
  },
  steak: {
    name: 'Steak haché frais',
    description: "Haché du jour 15 % MG, pure viande Charolais.",
    category: 'Bœuf', price: '16.90', unit: 'kg', weightStep: '0.25', estimatedWeight: '',
    stock: '0', stockUnlimited: true, delai: '1', active: true,
  },
};

const EMPTY: ProductForm = {
  name: '', description: '', category: 'Bœuf', price: '', unit: 'kg',
  weightStep: '0.25', estimatedWeight: '', stock: '', stockUnlimited: false, delai: '2', active: true,
};

export default function ProductEditPage() {
  const params = useParams<{ id: string }>();
  const productId = params?.id ?? '';
  const initial = PRODUCTS[productId] ?? EMPTY;

  const [form, setForm] = useState<ProductForm>(initial);
  const [photos, setPhotos] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);

  const up = (k: keyof ProductForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleFiles = (files: FileList | null) => {
    if (!files) return;
    const urls = Array.from(files).slice(0, 5 - photos.length).map((f) => URL.createObjectURL(f));
    setPhotos((p) => [...p, ...urls].slice(0, 5));
  };

  const preview = {
    id: productId || 'preview',
    name: form.name || 'Nom du produit',
    category: form.category,
    price: parseFloat(form.price) || 0,
    unit: form.unit,
    stockLeft: form.stockUnlimited ? 999 : parseInt(form.stock) || 0,
    producer: 'Ferme des Chênes',
  };

  const notFound = !PRODUCTS[productId];

  return (
    <ProducerLayout>
      <div className="max-w-7xl mx-auto px-8 py-10">
        <header className="mb-8">
          <Link href="/catalogue" className="text-[13px] text-dark/60 hover:text-green-900">← Retour au catalogue</Link>
          <div className="mt-2 flex items-baseline gap-3 flex-wrap">
            <h1 className="font-serif text-[40px] text-green-900 leading-tight">Modifier le produit</h1>
            {notFound && <Badge variant="gray">Produit introuvable</Badge>}
          </div>
          <p className="text-[13px] text-dark/55 mt-1 mono">ID : {productId}</p>
        </header>

        <div className="grid lg:grid-cols-[1fr_380px] gap-10 items-start">
          <form className="space-y-8">
            <section className="bg-white rounded-2xl border border-dark/[0.06] shadow-soft p-6">
              <h2 className="font-serif text-[22px] text-green-900 mb-4">Informations produit</h2>
              <div className="space-y-4">
                <Input label="Nom du produit *" value={form.name} onChange={up('name')} placeholder="Ex : Entrecôte maturée 21 jours" />
                <Textarea label="Description" rows={4} value={form.description} onChange={up('description')}
                  placeholder="Détaillez l'origine, la découpe, les conseils de cuisson…" />
                <Select label="Catégorie" value={form.category} onChange={up('category')}>
                  {['Bœuf', 'Veau', 'Porc', 'Agneau', 'Volaille', 'Colis'].map((c) => <option key={c}>{c}</option>)}
                </Select>
              </div>
            </section>

            <section className="bg-white rounded-2xl border border-dark/[0.06] shadow-soft p-6">
              <h2 className="font-serif text-[22px] text-green-900 mb-4">Prix et conditionnement</h2>
              <div className="grid sm:grid-cols-2 gap-4">
                <Input label="Prix *" type="number" step="0.01" value={form.price} onChange={up('price')} placeholder="0,00" />
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
                  <Input label="Poids estimé par pièce (optionnel)" value={form.estimatedWeight} onChange={up('estimatedWeight')} placeholder="Ex : 1,2 kg" />
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
              {photos.length > 0 && (
                <div className="mt-4 grid grid-cols-5 gap-2">
                  {photos.map((url, i) => (
                    <div key={i} className="relative aspect-square rounded-lg overflow-hidden group">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={url} alt="" className="w-full h-full object-cover" />
                      {i === 0 && <div className="absolute bottom-1 left-1"><Badge variant="terra">Principale</Badge></div>}
                      <button type="button" onClick={() => setPhotos((p) => p.filter((_, j) => j !== i))}
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
                <Input label={`Quantité en stock (${form.unit})`} type="number" value={form.stock} onChange={up('stock')} placeholder="0" />
              )}
              <div className="mt-4">
                <Input label="Délai de préparation (en jours)" type="number" value={form.delai} onChange={up('delai')} />
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
              <Link href="/catalogue"><Button variant="ghost" size="lg">Annuler</Button></Link>
              <Button size="lg">Enregistrer les modifications</Button>
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
