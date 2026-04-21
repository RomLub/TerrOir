'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Button, Badge, Input, Textarea, ProducerCard } from '@/components/ui';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { uploadProducerPhoto } from '@/lib/producers/upload';
import { labelEspece, labelLabel } from '@/lib/producers/labels';
import { ProducerLayout } from '../_components/ProducerLayout';

function OnboardedBanner() {
  const searchParams = useSearchParams();
  const [dismissed, setDismissed] = useState(false);
  if (dismissed || searchParams.get('onboarded') !== '1') return null;
  return (
    <div
      role="status"
      className="mb-6 flex items-start justify-between gap-4 rounded-md border border-terroir-green-700/30 bg-terroir-green-100 px-4 py-3 text-sm text-terroir-green-700"
    >
      <div>
        <p className="font-semibold">Demande enregistrée</p>
        <p className="mt-0.5 text-terroir-green-700/85">
          Votre demande est en cours de validation par l&apos;équipe TerrOir.
          Vous recevrez un email dès qu&apos;elle sera acceptée.
        </p>
      </div>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="shrink-0 rounded p-1 text-terroir-green-700/70 hover:bg-terroir-green-700/10 hover:text-terroir-green-700"
        aria-label="Fermer"
      >
        ✕
      </button>
    </div>
  );
}

const ESPECE_OPTIONS = [
  { value: 'bovin', label: 'Bœuf' },
  { value: 'porcin', label: 'Porc' },
  { value: 'ovin', label: 'Agneau' },
];
const LABEL_OPTIONS = [
  { value: 'bio', label: 'Agriculture Biologique' },
  { value: 'label_rouge', label: 'Label Rouge' },
  { value: 'aop', label: 'AOP' },
  { value: 'boeuf_fermier_maine', label: 'Bœuf Fermier du Maine' },
];

type Tab = 'preview' | 'edit';

type Form = {
  nom_exploitation: string;
  description: string;
  histoire: string;
  generations: string;
  annee_creation: string;
  especes: string[];
  labels: string[];
  commune: string;
  code_postal: string;
};

const EMPTY: Form = {
  nom_exploitation: '',
  description: '',
  histoire: '',
  generations: '',
  annee_creation: '',
  especes: [],
  labels: [],
  commune: '',
  code_postal: '',
};

export default function MaPagePage() {
  const [tab, setTab] = useState<Tab>('preview');
  const [producerId, setProducerId] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [heroPhoto, setHeroPhoto] = useState<string | null>(null);
  const [gallery, setGallery] = useState<string[]>([]);
  const [scores, setScores] = useState({ stock: 0, response: 0, reliability: 0 });
  const [rating, setRating] = useState(0);
  const [reviewCount, setReviewCount] = useState(0);
  const [newHero, setNewHero] = useState<File | null>(null);
  const [newHeroPreview, setNewHeroPreview] = useState<string | null>(null);
  const [newGalleryFiles, setNewGalleryFiles] = useState<File[]>([]);
  const [newGalleryPreviews, setNewGalleryPreviews] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const supabase = createSupabaseBrowserClient();

    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { if (active) { setError('Non connecté.'); setLoading(false); } return; }

      const { data: prod, error: fetchError } = await supabase
        .from('producers')
        .select('id, nom_exploitation, description, histoire, generations, annee_creation, especes, labels, commune, code_postal, photo_principale, photos, note_moyenne, nb_avis, badge_stock_score, badge_confirmation_score, badge_annulation_score')
        .eq('user_id', user.id)
        .maybeSingle();

      if (!active) return;
      if (fetchError) { setError(fetchError.message); setLoading(false); return; }
      if (!prod) { setError('Profil producteur introuvable.'); setLoading(false); return; }

      setProducerId(prod.id);
      setForm({
        nom_exploitation: prod.nom_exploitation ?? '',
        description: prod.description ?? '',
        histoire: prod.histoire ?? '',
        generations: prod.generations != null ? String(prod.generations) : '',
        annee_creation: prod.annee_creation != null ? String(prod.annee_creation) : '',
        especes: Array.isArray(prod.especes) ? prod.especes : [],
        labels: Array.isArray(prod.labels) ? prod.labels : [],
        commune: prod.commune ?? '',
        code_postal: prod.code_postal ?? '',
      });
      setHeroPhoto(prod.photo_principale ?? null);
      setGallery(Array.isArray(prod.photos) ? prod.photos : []);
      setRating(Number(prod.note_moyenne ?? 0));
      setReviewCount(prod.nb_avis ?? 0);
      setScores({
        stock: Math.round(prod.badge_stock_score ?? 0),
        response: Math.round(prod.badge_confirmation_score ?? 0),
        reliability: Math.round(prod.badge_annulation_score ?? 0),
      });
      setLoading(false);
    })();

    return () => { active = false; };
  }, []);

  useEffect(() => {
    return () => {
      if (newHeroPreview) URL.revokeObjectURL(newHeroPreview);
      newGalleryPreviews.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [newHeroPreview, newGalleryPreviews]);

  const toggleArr = (key: 'especes' | 'labels', value: string) => {
    setForm((f) => ({ ...f, [key]: f[key].includes(value) ? f[key].filter((v) => v !== value) : [...f[key], value] }));
    setSaved(false);
  };

  const handleHero = (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    if (newHeroPreview) URL.revokeObjectURL(newHeroPreview);
    setNewHero(f);
    setNewHeroPreview(URL.createObjectURL(f));
  };

  const addGallery = (files: FileList | null) => {
    if (!files) return;
    const remaining = 6 - gallery.length - newGalleryFiles.length;
    if (remaining <= 0) return;
    const accepted = Array.from(files).slice(0, remaining);
    const urls = accepted.map((f) => URL.createObjectURL(f));
    setNewGalleryFiles((p) => [...p, ...accepted]);
    setNewGalleryPreviews((p) => [...p, ...urls]);
  };

  const previewHero = newHeroPreview ?? heroPhoto;
  const previewGallery = useMemo(() => [...gallery, ...newGalleryPreviews], [gallery, newGalleryPreviews]);

  const producerPreview = {
    name: form.nom_exploitation || 'Votre exploitation',
    commune: [form.commune, form.code_postal].filter(Boolean).join(' · ') || '—',
    species: form.especes.map(labelEspece),
    labels: form.labels.map(labelLabel),
    scores,
    rating,
    reviewCount,
    productCount: 0,
    photo: previewHero,
  };

  const save = async () => {
    if (!producerId) return;
    setSaving(true);
    setError(null);
    setSaved(false);

    const supabase = createSupabaseBrowserClient();

    try {
      let heroUrl = heroPhoto;
      if (newHero) {
        const up = await uploadProducerPhoto(supabase, 'producer-photos', producerId, newHero, 'hero');
        heroUrl = up.url;
      }

      let galleryUrls = gallery;
      if (newGalleryFiles.length > 0) {
        const uploads = await Promise.all(
          newGalleryFiles.map((f) => uploadProducerPhoto(supabase, 'producer-photos', producerId, f, 'gallery')),
        );
        galleryUrls = [...gallery, ...uploads.map((u) => u.url)].slice(0, 6);
      }

      const { error: updateError } = await supabase
        .from('producers')
        .update({
          nom_exploitation: form.nom_exploitation.trim(),
          description: form.description.trim() || null,
          histoire: form.histoire.trim() || null,
          generations: form.generations ? Number(form.generations) : null,
          annee_creation: form.annee_creation ? Number(form.annee_creation) : null,
          especes: form.especes.length ? form.especes : null,
          labels: form.labels.length ? form.labels : null,
          commune: form.commune.trim() || null,
          code_postal: form.code_postal.trim() || null,
          photo_principale: heroUrl,
          photos: galleryUrls.length ? galleryUrls : null,
        })
        .eq('id', producerId);

      if (updateError) throw updateError;

      setHeroPhoto(heroUrl);
      setGallery(galleryUrls);
      setNewHero(null);
      setNewHeroPreview(null);
      setNewGalleryFiles([]);
      setNewGalleryPreviews([]);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError((err as Error).message ?? 'Enregistrement impossible');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <ProducerLayout>
        <div className="max-w-6xl mx-auto px-8 py-10 text-dark/60">Chargement…</div>
      </ProducerLayout>
    );
  }

  return (
    <ProducerLayout>
      <div className="max-w-6xl mx-auto px-8 py-10">
        <Suspense fallback={null}>
          <OnboardedBanner />
        </Suspense>
        <header className="mb-6">
          <div className="text-[11px] uppercase tracking-[0.18em] text-terra-700 font-semibold">Ma page</div>
          <h1 className="mt-1 font-serif text-[40px] text-green-900 leading-tight">Ma page publique</h1>
          <p className="text-[14px] text-dark/60 mt-1">Cette page représente votre exploitation auprès des consommateurs.</p>
          {error && <p className="mt-2 text-[13px] text-terra-700">{error}</p>}
        </header>

        <div className="flex gap-1.5 border-b border-dark/[0.08] mb-8">
          {([{ v: 'preview' as const, l: 'Prévisualisation' }, { v: 'edit' as const, l: 'Modifier' }]).map((t) => (
            <button key={t.v} onClick={() => setTab(t.v)}
              className={`px-4 py-3 text-[14px] font-medium border-b-2 -mb-px transition-colors ${
                tab === t.v ? 'border-green-700 text-green-900' : 'border-transparent text-dark/60 hover:text-green-900'
              }`}>{t.l}</button>
          ))}
        </div>

        {tab === 'preview' ? (
          <div className="bg-white rounded-2xl border border-dark/[0.06] shadow-soft overflow-hidden">
            <div className="relative h-64 bg-green-700">
              {previewHero ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={previewHero} alt="" className="absolute inset-0 w-full h-full object-cover" />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center text-white/40 font-mono text-[11px] uppercase"
                  style={{ backgroundImage: 'repeating-linear-gradient(45deg, rgba(255,255,255,0.08) 0 14px, rgba(255,255,255,0.04) 14px 28px)' }}>
                  Photo principale
                </div>
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-green-900/80 to-transparent" />
              <div className="absolute bottom-5 left-6 right-6">
                <h2 className="font-serif text-[40px] text-white leading-tight">{form.nom_exploitation || 'Votre exploitation'}</h2>
                <p className="text-green-100/90 text-[14px] mt-1">{[form.commune, form.code_postal].filter(Boolean).join(' · ') || '—'}</p>
              </div>
            </div>
            <div className="p-6">
              <p className="text-[16px] text-dark/80 leading-relaxed">{form.description}</p>
              <div className="mt-4 flex flex-wrap gap-1.5">
                {form.especes.map((s) => <Badge key={s}>{labelEspece(s)}</Badge>)}
                {form.labels.map((l) => <Badge key={l} variant="terra">{labelLabel(l)}</Badge>)}
              </div>
              <div className="mt-6 text-[14px] text-dark/75 leading-relaxed whitespace-pre-line">{form.histoire}</div>
            </div>
          </div>
        ) : (
          <div className="grid lg:grid-cols-[1fr_340px] gap-8 items-start">
            <div className="space-y-6">
              <section className="bg-white rounded-2xl border border-dark/[0.06] shadow-soft p-6">
                <h2 className="font-serif text-[22px] text-green-900 mb-4">Informations générales</h2>
                <div className="space-y-4">
                  <Input label="Nom de l'exploitation *" value={form.nom_exploitation}
                    onChange={(e) => { setForm({ ...form, nom_exploitation: e.target.value }); setSaved(false); }} />
                  <Textarea label="Description courte" rows={2} value={form.description}
                    onChange={(e) => { setForm({ ...form, description: e.target.value }); setSaved(false); }}
                    placeholder="En une phrase, votre ferme." />
                  <div className="grid sm:grid-cols-2 gap-4">
                    <Input label="Commune" value={form.commune}
                      onChange={(e) => { setForm({ ...form, commune: e.target.value }); setSaved(false); }} />
                    <Input label="Code postal" value={form.code_postal}
                      onChange={(e) => { setForm({ ...form, code_postal: e.target.value }); setSaved(false); }} />
                  </div>
                </div>
              </section>

              <section className="bg-white rounded-2xl border border-dark/[0.06] shadow-soft p-6">
                <h2 className="font-serif text-[22px] text-green-900 mb-4">Votre histoire</h2>
                <Textarea label="Récit long" rows={8} value={form.histoire}
                  onChange={(e) => { setForm({ ...form, histoire: e.target.value }); setSaved(false); }}
                  placeholder="Racontez votre ferme, vos générations, vos pratiques…" />
              </section>

              <section className="bg-white rounded-2xl border border-dark/[0.06] shadow-soft p-6">
                <h2 className="font-serif text-[22px] text-green-900 mb-4">Photos</h2>
                <label className="block">
                  <div className={`aspect-[2/1] rounded-xl border-2 border-dashed bg-bg overflow-hidden flex items-center justify-center cursor-pointer ${
                    previewHero ? 'border-green-500' : 'border-dark/15'
                  }`}>
                    {previewHero ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={previewHero} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="text-center">
                        <div className="font-serif text-[18px] text-green-900">Photo principale</div>
                        <p className="text-[12px] text-dark/55 mt-1">Cliquez pour choisir une photo</p>
                      </div>
                    )}
                  </div>
                  <input type="file" accept="image/*" className="hidden" onChange={(e) => handleHero(e.target.files)} />
                </label>

                <div className="mt-3 text-[12px] text-dark/60 font-medium">Galerie (jusqu&apos;à 6 photos)</div>
                <div className="mt-2 grid grid-cols-6 gap-2">
                  {previewGallery.map((url, i) => (
                    <div key={i} className="aspect-square rounded-lg overflow-hidden relative group">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={url} alt="" className="w-full h-full object-cover" />
                      <button type="button"
                        onClick={() => {
                          if (i < gallery.length) {
                            setGallery((g) => g.filter((_, j) => j !== i));
                          } else {
                            const idx = i - gallery.length;
                            setNewGalleryFiles((p) => p.filter((_, j) => j !== idx));
                            setNewGalleryPreviews((p) => {
                              const removed = p[idx];
                              if (removed) URL.revokeObjectURL(removed);
                              return p.filter((_, j) => j !== idx);
                            });
                          }
                        }}
                        className="absolute top-1 right-1 w-5 h-5 rounded-full bg-dark/70 text-white text-xs hover:bg-terra-700">×</button>
                    </div>
                  ))}
                  {previewGallery.length < 6 && (
                    <label className="aspect-square rounded-lg border-2 border-dashed border-dark/15 bg-bg flex items-center justify-center text-dark/30 text-xl cursor-pointer hover:border-green-500">
                      +
                      <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => addGallery(e.target.files)} />
                    </label>
                  )}
                </div>
              </section>

              <section className="bg-white rounded-2xl border border-dark/[0.06] shadow-soft p-6">
                <h2 className="font-serif text-[22px] text-green-900 mb-4">Espèces élevées</h2>
                <div className="flex flex-wrap gap-2">
                  {ESPECE_OPTIONS.map((o) => {
                    const on = form.especes.includes(o.value);
                    return (
                      <button key={o.value} type="button" onClick={() => toggleArr('especes', o.value)}
                        className={`h-10 px-4 rounded-full text-[13px] font-medium border transition-colors ${
                          on ? 'bg-green-700 text-white border-green-700' : 'bg-white text-dark/70 border-dark/10 hover:border-green-500'
                        }`}>{o.label}</button>
                    );
                  })}
                </div>
              </section>

              <section className="bg-white rounded-2xl border border-dark/[0.06] shadow-soft p-6">
                <h2 className="font-serif text-[22px] text-green-900 mb-4">Labels & certifications</h2>
                <div className="flex flex-wrap gap-2">
                  {LABEL_OPTIONS.map((o) => {
                    const on = form.labels.includes(o.value);
                    return (
                      <button key={o.value} type="button" onClick={() => toggleArr('labels', o.value)}
                        className={`h-10 px-4 rounded-full text-[13px] font-medium border transition-colors ${
                          on ? 'bg-terra-700 text-white border-terra-700' : 'bg-white text-dark/70 border-dark/10 hover:border-terra-300'
                        }`}>{o.label}</button>
                    );
                  })}
                </div>
              </section>

              <section className="bg-white rounded-2xl border border-dark/[0.06] shadow-soft p-6">
                <div className="grid sm:grid-cols-2 gap-4">
                  <Input label="Générations" type="number" min="1" value={form.generations}
                    onChange={(e) => { setForm({ ...form, generations: e.target.value }); setSaved(false); }} />
                  <Input label="Année de création" type="number" value={form.annee_creation}
                    onChange={(e) => { setForm({ ...form, annee_creation: e.target.value }); setSaved(false); }} />
                </div>
              </section>

              <div className="flex items-center justify-between gap-3 pt-2">
                <p className="text-[12px] text-dark/55 max-w-sm">
                  {saved ? '✓ Modifications enregistrées.' : 'Vos modifications ne sont pas encore enregistrées.'}
                </p>
                <Button size="lg" onClick={save} disabled={saving}>
                  {saving ? 'Enregistrement…' : 'Enregistrer'}
                </Button>
              </div>
            </div>

            <aside className="lg:sticky lg:top-10">
              <div className="text-[11px] uppercase tracking-[0.14em] text-terra-700 font-semibold mb-3">Aperçu dans la carte</div>
              <ProducerCard producer={producerPreview} />
            </aside>
          </div>
        )}
      </div>
    </ProducerLayout>
  );
}
