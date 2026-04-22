'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { ProducerLayout } from '../_components/ProducerLayout';

type Slot = { id: string; jour_semaine: number; start: string; end: string; active: boolean };

const DAYS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
// Postgres convention on jour_semaine: Sunday=0..Saturday=6. We present Monday first.
const DB_INDEX = [1, 2, 3, 4, 5, 6, 0];

function toHHMM(t: string): string {
  return (t ?? '').slice(0, 5);
}

export default function CreneauxPage() {
  const [producerId, setProducerId] = useState<string | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [draft, setDraft] = useState({ dayIndex: 0, start: '10:00', end: '12:00' });
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const supabase = createSupabaseBrowserClient();

    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { if (active) { setError('Non connecté.'); setLoading(false); } return; }

      const { data: prod } = await supabase
        .from('producers')
        .select('id')
        .eq('user_id', user.id)
        .maybeSingle();
      if (!prod) { if (active) { setError('Profil producteur introuvable.'); setLoading(false); } return; }

      setProducerId(prod.id);

      const { data, error: fetchError } = await supabase
        .from('slots')
        .select('id, jour_semaine, heure_debut, heure_fin, actif')
        .eq('producer_id', prod.id)
        .order('jour_semaine', { ascending: true })
        .order('heure_debut', { ascending: true });

      if (!active) return;
      if (fetchError) { setError(fetchError.message); setLoading(false); return; }

      setSlots((data ?? []).map((s) => ({
        id: s.id,
        jour_semaine: s.jour_semaine ?? 0,
        start: toHHMM(s.heure_debut),
        end: toHHMM(s.heure_fin),
        active: !!s.actif,
      })));
      setLoading(false);
    })();

    return () => { active = false; };
  }, []);

  const toggle = async (id: string) => {
    const current = slots.find((s) => s.id === id);
    if (!current) return;
    setBusy(id);
    const supabase = createSupabaseBrowserClient();
    const next = !current.active;
    const { error: upError } = await supabase.from('slots').update({ actif: next }).eq('id', id);
    if (upError) setError(upError.message);
    else setSlots((arr) => arr.map((s) => s.id === id ? { ...s, active: next } : s));
    setBusy(null);
  };

  const remove = async (id: string) => {
    setBusy(id);
    const supabase = createSupabaseBrowserClient();
    const { error: delError } = await supabase.from('slots').delete().eq('id', id);
    if (delError) setError(delError.message);
    else setSlots((arr) => arr.filter((s) => s.id !== id));
    setBusy(null);
  };

  const add = async () => {
    if (!producerId) return;
    const jour = DB_INDEX[draft.dayIndex];
    if (draft.end <= draft.start) { setError('L\'heure de fin doit être après le début.'); return; }

    setBusy('add');
    const supabase = createSupabaseBrowserClient();
    const { data, error: insertError } = await supabase
      .from('slots')
      .insert({
        producer_id: producerId,
        jour_semaine: jour,
        heure_debut: draft.start,
        heure_fin: draft.end,
        actif: true,
      })
      .select('id, jour_semaine, heure_debut, heure_fin, actif')
      .single();

    setBusy(null);
    if (insertError || !data) { setError(insertError?.message ?? 'Ajout impossible'); return; }

    setSlots((arr) => [
      ...arr,
      { id: data.id, jour_semaine: data.jour_semaine, start: toHHMM(data.heure_debut), end: toHHMM(data.heure_fin), active: !!data.actif },
    ]);
    setShowModal(false);
  };

  return (
    <ProducerLayout>
      <div className="max-w-5xl mx-auto px-8 py-10">
        <header className="mb-8 flex items-end justify-between gap-4 flex-wrap">
          <div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-terra-700 font-semibold">Créneaux</div>
            <h1 className="mt-1 font-serif text-[40px] text-green-900 leading-tight">Vos créneaux de retrait</h1>
            <p className="text-[14px] text-dark/60 mt-1">Les clients verront ces créneaux lors de la commande.</p>
            {error && <p className="mt-2 text-[13px] text-terra-700">{error}</p>}
          </div>
          <Button size="lg" onClick={() => setShowModal(true)} disabled={!producerId}>+ Ajouter un créneau</Button>
        </header>

        {loading ? (
          <div className="bg-white rounded-2xl border border-dark/[0.06] p-6 text-dark/60">Chargement…</div>
        ) : (
          <div className="bg-white rounded-2xl border border-dark/[0.06] shadow-soft p-5">
            <div className="grid grid-cols-7 gap-2">
              {DAYS.map((d, dayIndex) => {
                const dbDay = DB_INDEX[dayIndex];
                const daySlots = slots.filter((s) => s.jour_semaine === dbDay);
                return (
                  <div key={d} className="bg-bg rounded-xl p-3 min-h-[160px] border border-dark/[0.06]">
                    <div className="text-[12px] font-semibold uppercase tracking-wider text-dark/60 mb-2">{d.slice(0, 3)}</div>
                    <div className="space-y-2">
                      {daySlots.length === 0 ? (
                        <div className="text-[11px] text-dark/25 italic">—</div>
                      ) : daySlots.map((s) => (
                        <div key={s.id} className={`rounded-lg p-2 border transition-opacity ${
                          s.active ? 'bg-green-100 border-green-500' : 'bg-dark/5 border-dark/10 opacity-60'
                        }`}>
                          <div className="text-[11px] mono font-semibold text-green-900">{s.start}–{s.end}</div>
                          <div className="flex items-center justify-between mt-1.5">
                            <button onClick={() => toggle(s.id)} disabled={busy === s.id}
                              className={`relative w-7 h-4 rounded-full ${s.active ? 'bg-green-700' : 'bg-dark/20'}`}>
                              <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${s.active ? 'translate-x-[14px]' : 'translate-x-0.5'}`} />
                            </button>
                            <button onClick={() => remove(s.id)} disabled={busy === s.id}
                              className="text-dark/40 hover:text-terra-700 text-xs">✕</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 bg-green-900/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setShowModal(false)}>
          <div className="bg-white rounded-3xl shadow-card w-full max-w-md p-8 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-serif text-[28px] text-green-900 leading-tight">Nouveau créneau</h2>
            <div className="mt-5 space-y-4">
              <label className="block">
                <span className="text-[12px] text-dark/70 font-medium">Jour</span>
                <select value={draft.dayIndex} onChange={(e) => setDraft({ ...draft, dayIndex: Number(e.target.value) })}
                  className="mt-1 w-full h-11 px-3 rounded-xl border border-dark/10 bg-white text-[15px] outline-none focus:border-green-700">
                  {DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
                </select>
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-[12px] text-dark/70 font-medium">Début</span>
                  <input type="time" value={draft.start} onChange={(e) => setDraft({ ...draft, start: e.target.value })}
                    className="mt-1 w-full h-11 px-3 rounded-xl border border-dark/10 bg-white text-[15px] mono outline-none focus:border-green-700" />
                </label>
                <label className="block">
                  <span className="text-[12px] text-dark/70 font-medium">Fin</span>
                  <input type="time" value={draft.end} onChange={(e) => setDraft({ ...draft, end: e.target.value })}
                    className="mt-1 w-full h-11 px-3 rounded-xl border border-dark/10 bg-white text-[15px] mono outline-none focus:border-green-700" />
                </label>
              </div>
            </div>
            <div className="mt-6 flex gap-2 justify-end">
              <Button variant="ghost" onClick={() => setShowModal(false)}>Annuler</Button>
              <Button onClick={add} disabled={busy === 'add'}>{busy === 'add' ? 'Ajout…' : 'Ajouter'}</Button>
            </div>
          </div>
        </div>
      )}
    </ProducerLayout>
  );
}
