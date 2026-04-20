'use client';

import { useState } from 'react';
import { Button } from '@/components/ui';
import { ProducerLayout } from '../_components/ProducerLayout';

type Slot = { id: string; day: string; start: string; end: string; active: boolean };

const INITIAL: Slot[] = [
  { id: '1', day: 'Mercredi', start: '17:00', end: '19:00', active: true },
  { id: '2', day: 'Vendredi', start: '10:00', end: '12:00', active: true },
  { id: '3', day: 'Vendredi', start: '14:00', end: '17:00', active: true },
  { id: '4', day: 'Samedi', start: '10:00', end: '12:00', active: true },
];

const DAYS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];

export default function CreneauxPage() {
  const [slots, setSlots] = useState(INITIAL);
  const [showModal, setShowModal] = useState(false);
  const [draft, setDraft] = useState({ day: 'Lundi', start: '10:00', end: '12:00' });

  const toggle = (id: string) => setSlots((arr) => arr.map((s) => s.id === id ? { ...s, active: !s.active } : s));
  const remove = (id: string) => setSlots((arr) => arr.filter((s) => s.id !== id));
  const add = () => {
    setSlots((arr) => [...arr, { id: Math.random().toString(36).slice(2), active: true, ...draft }]);
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
          </div>
          <Button size="lg" onClick={() => setShowModal(true)}>+ Ajouter un créneau</Button>
        </header>

        <div className="bg-white rounded-2xl border border-dark/[0.06] shadow-soft p-5">
          <div className="grid grid-cols-7 gap-2">
            {DAYS.map((d) => {
              const daySlots = slots.filter((s) => s.day === d);
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
                          <button onClick={() => toggle(s.id)} className={`relative w-7 h-4 rounded-full ${s.active ? 'bg-green-700' : 'bg-dark/20'}`}>
                            <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${s.active ? 'translate-x-[14px]' : 'translate-x-0.5'}`} />
                          </button>
                          <button onClick={() => remove(s.id)} className="text-dark/40 hover:text-terra-700 text-xs">✕</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 bg-green-900/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setShowModal(false)}>
          <div className="bg-white rounded-3xl shadow-card w-full max-w-md p-8" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-serif text-[28px] text-green-900 leading-tight">Nouveau créneau</h2>
            <div className="mt-5 space-y-4">
              <label className="block">
                <span className="text-[12px] text-dark/70 font-medium">Jour</span>
                <select value={draft.day} onChange={(e) => setDraft({ ...draft, day: e.target.value })}
                  className="mt-1 w-full h-11 px-3 rounded-xl border border-dark/10 bg-white text-[15px] outline-none focus:border-green-700">
                  {DAYS.map((d) => <option key={d}>{d}</option>)}
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
              <Button onClick={add}>Ajouter</Button>
            </div>
          </div>
        </div>
      )}
    </ProducerLayout>
  );
}
