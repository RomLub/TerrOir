'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Button, Badge, Input, Select, Textarea, ProductCard } from '@/components/ui';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { uploadProducerPhoto } from '@/lib/producers/upload';
import { updateProductAction } from '../../actions';
import {
  fetchProductCategories,
  fetchAnimals,
  fetchCuts,
} from '@/lib/products/fetch-references';
import { CATEGORIES_WITH_ANIMAL } from '@/lib/products/categories-with-animal';
import { STOCK_UNLIMITED_SENTINEL } from '@/lib/products/constants';
import type { Animal, Cut, ProductCategory } from '@/lib/products/types';
import {
  ProductPickupSection,
  type ProductPickupAvailabilityMode,
  type ProductPickupSlotOption,
  type ReservedProductSlotDraft,
} from '../../_components/ProductPickupSection';

type Form = {
  name: string; description: string; price: string; unit: string;
  weightStep: string; estimatedWeight: string; stock: string; stockUnlimited: boolean;
  delai: string; active: boolean;
  conseilActive: boolean; conseilTexte: string;
  pickupAvailabilityMode: ProductPickupAvailabilityMode;
  selectedSlotIds: string[];
  reservedSlots: ReservedProductSlotDraft[];
  // T-220 PR-B : tagging catégorisation produit (FK nullable transitoire
  // pendant le backfill — cf. migration PR-A 20260501002856).
  categoryId: string | null; animalId: string | null; cutId: string | null;
};

const EMPTY: Form = {
  name: '', description: '', price: '', unit: 'kg',
  weightStep: '0.25', estimatedWeight: '', stock: '', stockUnlimited: false, delai: '2', active: true,
  conseilActive: false, conseilTexte: '',
  pickupAvailabilityMode: 'all_shared_slots',
  selectedSlotIds: [],
  reservedSlots: [],
  categoryId: null, animalId: null, cutId: null,
};

const CONSEIL_MAX = 280;

export default function ProductEditPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const productId = params?.id ?? '';

  const [form, setForm] = useState<Form>(EMPTY);
  const [existingPhotos, setExistingPhotos] = useState<string[]>([]);
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const [newPreviews, setNewPreviews] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const [producerId, setProducerId] = useState<string | null>(null);
  const [producerName, setProducerName] = useState('');
  const [pickupSlots, setPickupSlots] = useState<ProductPickupSlotOption[]>([]);
  const [pickupError, setPickupError] = useState<string | null>(null);
  // slug + statut : pour afficher le lien "Voir ma fiche publique ↗"
  // uniquement si le producer est publié (statut='public'). Sinon la
  // route consumer renverrait 404.
  const [producerSlug, setProducerSlug] = useState<string | null>(null);
  const [producerStatut, setProducerStatut] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  // T-220 PR-B : référentiels catégorisation chargés en parallèle du
  // produit dans le useEffect ci-dessous. Le `loading` global est utilisé
  // pour gater l'affichage tant que produit + 3 référentiels ne sont pas
  // tous résolus (pas de flag séparé referencesLoading ici, vs page nouveau).
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [animals, setAnimals] = useState<Animal[]>([]);
  const [cuts, setCuts] = useState<Cut[]>([]);

  useEffect(() => {
    let active = true;
    const supabase = createSupabaseBrowserClient();

    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { if (active) { setError('Non connecté.'); setLoading(false); } return; }

      const { data: prod } = await supabase
        .from('producers')
        .select('id, nom_exploitation, slug, statut')
        .eq('user_id', user.id)
        .maybeSingle();
      if (!prod) { if (active) { setError('Profil producteur introuvable.'); setLoading(false); } return; }

      setProducerId(prod.id);
      setProducerName(prod.nom_exploitation);
      setProducerSlug(prod.slug);
      setProducerStatut(prod.statut);

      // Promise.all : produit + 3 référentiels en parallèle. Les références
      // sont nécessaires pour appliquer l'auto-cleanup Q5 (cf. plus bas)
      // avant le setForm initial, donc on ne peut pas les fetcher après.
      const [
        { data: product, error: fetchError },
        fetchedCategories,
        fetchedAnimals,
        fetchedCuts,
        { data: fetchedSlots },
        { data: fetchedLinks },
      ] = await Promise.all([
        supabase
          .from('products')
          .select('id, producer_id, nom, description, prix, unite, poids_estime_kg, stock_disponible, stock_illimite, delai_preparation_jours, active, photos, conseil_active, conseil_texte, category_id, animal_id, cut_id, pickup_availability_mode')
          .eq('id', productId)
          .maybeSingle(),
        fetchProductCategories(supabase),
        fetchAnimals(supabase),
        fetchCuts(supabase),
        supabase
          .from('slots')
          .select('id, starts_at, ends_at, availability_scope')
          .eq('producer_id', prod.id)
          .eq('active', true)
          .is('excluded_at', null)
          .gte('starts_at', new Date().toISOString())
          .order('starts_at', { ascending: true }),
        supabase
          .from('product_slot_availabilities')
          .select('product_id, slot_id')
          .eq('producer_id', prod.id),
      ]);

      if (!active) return;

      setCategories(fetchedCategories);
      setAnimals(fetchedAnimals);
      setCuts(fetchedCuts);

      if (fetchError) { setError(fetchError.message); setLoading(false); return; }
      if (!product || product.producer_id !== prod.id) { setNotFound(true); setLoading(false); return; }

      const linksBySlot = new Map<string, string[]>();
      const selectedSlotIds: string[] = [];
      for (const link of (fetchedLinks ?? []) as Array<{ product_id: string; slot_id: string }>) {
        const current = linksBySlot.get(link.slot_id) ?? [];
        current.push(link.product_id);
        linksBySlot.set(link.slot_id, current);
        if (link.product_id === productId) selectedSlotIds.push(link.slot_id);
      }
      setPickupSlots(
        ((fetchedSlots ?? []) as Array<{
          id: string;
          starts_at: string;
          ends_at: string;
          availability_scope: 'shared' | 'product_restricted';
        }>).map((slot) => ({
          id: slot.id,
          startsAt: slot.starts_at,
          endsAt: slot.ends_at,
          availabilityScope: slot.availability_scope,
          linkedProductIds: linksBySlot.get(slot.id) ?? [],
        })),
      );

      // T-220 PR-B — Auto-cleanup Q5 (silencieux, en mémoire uniquement) :
      // Si la catégorie persistée n'expose pas le select Animal (ex: produit
      // taggé `legumes` mais avec animal_id != null suite à modif manuelle DB
      // ou évolution de CATEGORIES_WITH_ANIMAL), on reset animalId/cutId à
      // null dans le form. La DB n'est pas mise à jour tant que le producteur
      // ne soumet pas le formulaire — c'est volontaire : on ne corrige pas
      // l'état persisté à son insu, on le réconcilie juste avec l'UI.
      const persistedCategoryId = (product.category_id as string | null) ?? null;
      const persistedAnimalId = (product.animal_id as string | null) ?? null;
      const persistedCutId = (product.cut_id as string | null) ?? null;
      let initialAnimalId = persistedAnimalId;
      let initialCutId = persistedCutId;
      if (persistedCategoryId) {
        const cat = fetchedCategories.find((c) => c.id === persistedCategoryId);
        if (
          cat &&
          !CATEGORIES_WITH_ANIMAL.includes(cat.slug) &&
          (persistedAnimalId !== null || persistedCutId !== null)
        ) {
          initialAnimalId = null;
          initialCutId = null;
        }
      }

      setForm({
        name: product.nom ?? '',
        description: product.description ?? '',
        price: product.prix != null ? String(product.prix) : '',
        unit: product.unite ?? 'kg',
        weightStep: '0.25',
        estimatedWeight: product.poids_estime_kg != null ? String(product.poids_estime_kg) : '',
        stock: product.stock_disponible != null ? String(product.stock_disponible) : '',
        stockUnlimited: !!product.stock_illimite,
        delai: product.delai_preparation_jours != null ? String(product.delai_preparation_jours) : '0',
        active: !!product.active,
        conseilActive: !!product.conseil_active,
        conseilTexte: (product.conseil_texte as string | null) ?? '',
        pickupAvailabilityMode:
          (product.pickup_availability_mode as ProductPickupAvailabilityMode | null) ??
          'all_shared_slots',
        selectedSlotIds,
        reservedSlots: [],
        categoryId: persistedCategoryId,
        animalId: initialAnimalId,
        cutId: initialCutId,
      });
      setExistingPhotos(Array.isArray(product.photos) ? product.photos : []);
      setLoading(false);
    })();

    return () => { active = false; };
  }, [productId]);

  useEffect(() => {
    return () => { newPreviews.forEach((u) => URL.revokeObjectURL(u)); };
  }, [newPreviews]);

  const up = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const setPickupMode = (mode: ProductPickupAvailabilityMode) => {
    setPickupError(null);
    setForm((f) => ({ ...f, pickupAvailabilityMode: mode }));
  };

  const togglePickupSlot = (slotId: string) => {
    setPickupError(null);
    setForm((f) => ({
      ...f,
      selectedSlotIds: f.selectedSlotIds.includes(slotId)
        ? f.selectedSlotIds.filter((id) => id !== slotId)
        : [...f.selectedSlotIds, slotId],
    }));
  };

  const addReservedSlot = () => {
    setPickupError(null);
    setForm((f) => ({
      ...f,
      reservedSlots: [
        ...f.reservedSlots,
        { id: crypto.randomUUID(), startAt: '', endAt: '', capacity: '1' },
      ],
    }));
  };

  const updateReservedSlot = (
    id: string,
    field: keyof Omit<ReservedProductSlotDraft, 'id'>,
    value: string,
  ) => {
    setPickupError(null);
    setForm((f) => ({
      ...f,
      reservedSlots: f.reservedSlots.map((slot) =>
        slot.id === id ? { ...slot, [field]: value } : slot,
      ),
    }));
  };

  const removeReservedSlot = (id: string) => {
    setPickupError(null);
    setForm((f) => ({
      ...f,
      reservedSlots: f.reservedSlots.filter((slot) => slot.id !== id),
    }));
  };

  const handleFiles = (files: FileList | null) => {
    if (!files) return;
    const totalAllowed = 5 - existingPhotos.length - newFiles.length;
    if (totalAllowed <= 0) return;
    const accepted = Array.from(files).slice(0, totalAllowed);
    const urls = accepted.map((f) => URL.createObjectURL(f));
    setNewFiles((p) => [...p, ...accepted]);
    setNewPreviews((p) => [...p, ...urls]);
  };

  const removeExisting = (i: number) => setExistingPhotos((p) => p.filter((_, j) => j !== i));
  const removeNew = (i: number) => {
    setNewFiles((p) => p.filter((_, j) => j !== i));
    setNewPreviews((p) => {
      const removed = p[i];
      if (removed) URL.revokeObjectURL(removed);
      return p.filter((_, j) => j !== i);
    });
  };

  const allPhotoUrls = [...existingPhotos, ...newPreviews];

  // T-220 PR-B : computed values pour la cascade de selects et le preview.
  // Identiques à la page nouveau (cf. nouveau/page.tsx pour le commentaire
  // détaillé). Pas de factorisation dans T-220 (décision PR-B : duplication
  // assumée, refacto ProductForm dans un ticket séparé plus tard).
  const selectedCategory = categories.find((c) => c.id === form.categoryId) ?? null;
  const hasAnimalSelect = !!selectedCategory && CATEGORIES_WITH_ANIMAL.includes(selectedCategory.slug);
  const hasCutSelect = hasAnimalSelect && form.animalId !== null;
  const filteredCuts = form.animalId
    ? cuts.filter((c) => c.animal_id === form.animalId)
    : [];

  const onCategoryChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newId = e.target.value || null;
    setForm((f) => ({ ...f, categoryId: newId, animalId: null, cutId: null }));
  };
  const onAnimalChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newId = e.target.value || null;
    setForm((f) => ({ ...f, animalId: newId, cutId: null }));
  };
  const onCutChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setForm((f) => ({ ...f, cutId: e.target.value || null }));
  };

  const preview = {
    id: productId,
    name: form.name || 'Nom du produit',
    category: selectedCategory?.name,
    price: parseFloat(form.price) || 0,
    unit: form.unit,
    stockLeft: form.stockUnlimited ? STOCK_UNLIMITED_SENTINEL : parseInt(form.stock) || 0,
    producer: producerName || 'Votre ferme',
    image: allPhotoUrls[0] ?? null,
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!producerId || !productId) return;
    if (!form.name || !form.price) { setError('Nom et prix requis.'); return; }
    if (form.conseilActive && !form.conseilTexte.trim()) {
      setError('Conseil activé : saisissez le texte ou désactivez le conseil.');
      return;
    }
    if (
      form.pickupAvailabilityMode === 'selected_slots' &&
      form.selectedSlotIds.length === 0 &&
      form.reservedSlots.length === 0
    ) {
      setPickupError('Sélectionnez au moins un créneau pour ce produit.');
      return;
    }
    setSaving(true);
    setError(null);
    setPickupError(null);

    const supabase = createSupabaseBrowserClient();

    try {
      const uploads = await Promise.all(
        newFiles.map((f) => uploadProducerPhoto(supabase, 'product-photos', producerId, f)),
      );
      const finalPhotos = [...existingPhotos, ...uploads.map((u) => u.url)];

      // Plomberie chantier 3 : l'écriture passe par une action serveur (liste
      // blanche + ownership serveur + invalidation cache). Plus d'update
      // Supabase navigateur.
      const res = await updateProductAction(productId, {
        nom: form.name.trim(),
        description: form.description.trim() || null,
        prix: Number(form.price),
        unite: form.unit,
        poids_estime_kg: form.estimatedWeight ? Number(form.estimatedWeight) : null,
        stock_disponible: form.stockUnlimited ? 0 : (parseInt(form.stock) || 0),
        stock_illimite: form.stockUnlimited,
        delai_preparation_jours: parseInt(form.delai) || 0,
        active: form.active,
        photos: finalPhotos,
        conseil_active: form.conseilActive,
        conseil_texte: form.conseilActive ? (form.conseilTexte.trim() || null) : null,
        category_id: form.categoryId,
        animal_id: form.animalId,
        cut_id: form.cutId,
        pickup_availability_mode: form.pickupAvailabilityMode,
        slot_ids: form.selectedSlotIds,
        reserved_slots: form.reservedSlots.map((slot) => ({
          start_at: slot.startAt,
          end_at: slot.endAt,
          capacity_per_slot: Number(slot.capacity),
          mode: 'libre' as const,
        })),
      });
      if (res.error) throw new Error(res.error);
      router.push('/catalogue');
    } catch (err) {
      setError((err as Error).message ?? 'Enregistrement impossible');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-8 py-10 text-dark/60">Chargement…</div>
    );
  }

  if (notFound) {
    return (
      <div className="max-w-3xl mx-auto px-8 py-20 text-center">
        <h1 className="font-serif text-[36px] text-green-900">Produit introuvable</h1>
        <p className="mt-2 text-[14px] text-dark/60">Ce produit n&apos;existe pas ou n&apos;est pas le vôtre.</p>
        <div className="mt-6"><Link href="/catalogue"><Button variant="primary">Retour au catalogue</Button></Link></div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-8 py-10">
      <header className="mb-8">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <Link href="/catalogue" className="text-[13px] text-dark/60 hover:text-green-900">← Retour au catalogue</Link>
          {producerStatut === 'public' && producerSlug && (
            <a
              href={`/producteurs/${producerSlug}/produits/${productId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[13px] text-green-700 font-medium hover:text-green-900"
            >
              Voir ma fiche publique ↗
            </a>
          )}
        </div>
        <h1 className="mt-2 font-serif text-[40px] text-green-900 leading-tight">Modifier le produit</h1>
        <p className="text-[13px] text-dark/55 mt-1">ID : {productId}</p>
        {error && <p className="mt-2 text-[13px] text-terra-700">{error}</p>}
      </header>

      {/* T-220 PR-B — Bandeau warning produit non-catégorisé.
          Visible quand form.categoryId == null APRÈS le fetch initial
          (le `loading` gate au-dessus garantit qu'on n'arrive ici qu'une
          fois le fetch produit terminé, donc pas de flash transitoire).
          Cible uniquement les produits sans catégorie du tout — un produit
          avec catégorie mais sans animal/cut (cas légume) ne déclenche pas
          le bandeau. Pas de composant Alert global dans components/ui/ :
          div Tailwind inline minimaliste. */}
      {!form.categoryId && (
        <div
          role="alert"
          className="mb-6 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-[14px] text-amber-900"
        >
          ⚠️ Ce produit n&apos;est pas encore catégorisé. Sélectionnez une catégorie pour qu&apos;il soit visible dans les filtres du catalogue.
        </div>
      )}

      <div className="grid lg:grid-cols-[1fr_380px] gap-10 items-start">
        <form onSubmit={save} className="space-y-8">
          <section className="bg-white rounded-2xl border border-dark/[0.06] shadow-soft p-6">
            <h2 className="font-serif text-[22px] text-green-900 mb-4">Informations produit</h2>
            <div className="space-y-4">
              <Input id="product-name" label="Nom du produit *" value={form.name} onChange={up('name')} required />
              <Textarea label="Description" rows={4} value={form.description} onChange={up('description')} />
              {/* T-220 PR-B : cascade catégorie → animal → morceau.
                  Comportement identique à la page nouveau (cf. nouveau/page.tsx
                  pour les détails). Pas de hint "Chargement…" : le `loading`
                  global gate déjà tout le rendu au-dessus, donc à ce stade
                  les références sont déjà fetchées. */}
              <Select
                label="Catégorie"
                value={form.categoryId ?? ''}
                onChange={onCategoryChange}
                placeholder="Choisir une catégorie…"
                options={categories.map((c) => ({ value: c.id, label: c.name }))}
              />
              {hasAnimalSelect && (
                <Select
                  label="Espèce"
                  value={form.animalId ?? ''}
                  onChange={onAnimalChange}
                  placeholder="Choisir une espèce…"
                  options={animals.map((a) => ({ value: a.id, label: a.name }))}
                />
              )}
              {hasCutSelect && (
                <Select
                  label="Morceau"
                  value={form.cutId ?? ''}
                  onChange={onCutChange}
                  placeholder="Choisir un morceau…"
                  options={filteredCuts.map((c) => ({ value: c.id, label: c.name }))}
                />
              )}
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
              <Input id="product-price" label="Prix *" type="number" step="0.01" min="0" value={form.price} onChange={up('price')} required />
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
                <Input label="Poids estimé par pièce (kg)" type="number" step="0.1" value={form.estimatedWeight} onChange={up('estimatedWeight')} />
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

            {allPhotoUrls.length > 0 && (
              <div className="mt-4 grid grid-cols-5 gap-2">
                {existingPhotos.map((url, i) => (
                  <div key={`e-${i}`} className="relative aspect-square rounded-lg overflow-hidden group">
                    <Image
                      src={url}
                      alt=""
                      fill
                      sizes="120px"
                      className="object-cover"
                    />
                    {i === 0 && <div className="absolute bottom-1 left-1"><Badge variant="terra">Principale</Badge></div>}
                    <button type="button" onClick={() => removeExisting(i)}
                      className="absolute top-1 right-1 w-6 h-6 rounded-full bg-dark/70 text-white text-xs hover:bg-terra-700">×</button>
                  </div>
                ))}
                {newPreviews.map((url, i) => (
                  <div key={`n-${i}`} className="relative aspect-square rounded-lg overflow-hidden group">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt="" className="w-full h-full object-cover" />
                    {existingPhotos.length === 0 && i === 0 && <div className="absolute bottom-1 left-1"><Badge variant="terra">Principale</Badge></div>}
                    <button type="button" onClick={() => removeNew(i)}
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
              <Input id="product-stock" label={`Quantité en stock (${form.unit})`} type="number" min="0" value={form.stock} onChange={up('stock')} />
            )}
            <div className="mt-4">
              <Input label="Délai de préparation (en jours)" type="number" min="0" value={form.delai} onChange={up('delai')} />
            </div>
          </section>

          <ProductPickupSection
            productId={productId}
            mode={form.pickupAvailabilityMode}
            slots={pickupSlots}
            selectedSlotIds={form.selectedSlotIds}
            reservedSlots={form.reservedSlots}
            error={pickupError}
            onModeChange={setPickupMode}
            onToggleSlot={togglePickupSlot}
            onAddReservedSlot={addReservedSlot}
            onUpdateReservedSlot={updateReservedSlot}
            onRemoveReservedSlot={removeReservedSlot}
          />

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
            <Button variant="success" size="lg" type="submit" disabled={saving}>
              {saving ? 'Enregistrement…' : 'Enregistrer les modifications'}
            </Button>
          </div>
        </form>

        <aside className="lg:sticky lg:top-10">
          <div className="text-[11px] uppercase tracking-[0.14em] text-terra-700 font-semibold mb-3">Prévisualisation</div>
          <ProductCard product={preview} />
          <p className="mt-3 text-[11px] text-dark/50 text-center">Voici comment votre produit apparaîtra aux clients.</p>
        </aside>
      </div>
    </div>
  );
}
