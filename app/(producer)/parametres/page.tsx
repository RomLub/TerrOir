'use client';

import { useEffect, useState } from 'react';
import { Button, Input, Textarea } from '@/components/ui';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { ProducerLayout } from '../_components/ProducerLayout';

type State = {
  producerId: string | null;
  nom_exploitation: string;
  adresse: string;
  commune: string;
  code_postal: string;
  siret: string;
  sms_optin: boolean;
  stripe_account_id: string | null;
  stripe_charges_enabled: boolean;
  stripe_payouts_enabled: boolean;
  stripe_details_submitted: boolean;
};

const INITIAL: State = {
  producerId: null,
  nom_exploitation: '',
  adresse: '',
  commune: '',
  code_postal: '',
  siret: '',
  sms_optin: false,
  stripe_account_id: null,
  stripe_charges_enabled: false,
  stripe_payouts_enabled: false,
  stripe_details_submitted: false,
};

function Toggle({ checked, onChange, label, hint, disabled }: {
  checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; disabled?: boolean;
}) {
  return (
    <label className={`flex items-center justify-between gap-4 py-3 ${disabled ? '' : 'cursor-pointer'}`}>
      <div className="flex-1 min-w-0">
        <div className="text-[15px] font-medium text-green-900">{label}</div>
        {hint && <div className="text-[12px] text-dark/55 mt-0.5">{hint}</div>}
      </div>
      <span className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${checked ? 'bg-green-700' : 'bg-dark/20'}`}>
        <input type="checkbox" className="sr-only" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
        <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
      </span>
    </label>
  );
}

export default function ProducerSettingsPage() {
  const [s, setS] = useState<State>(INITIAL);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    let active = true;
    const supabase = createSupabaseBrowserClient();

    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { if (active) { setError('Non connecté.'); setLoading(false); } return; }
      setUserId(user.id);

      const [{ data: prod, error: prodErr }, { data: userRow }] = await Promise.all([
        supabase.from('producers')
          .select('id, nom_exploitation, adresse, commune, code_postal, siret, stripe_account_id, stripe_charges_enabled, stripe_payouts_enabled, stripe_details_submitted')
          .eq('user_id', user.id)
          .maybeSingle(),
        supabase.from('users').select('sms_optin').eq('id', user.id).maybeSingle(),
      ]);

      if (!active) return;
      if (prodErr) { setError(prodErr.message); setLoading(false); return; }
      if (!prod) { setError('Profil producteur introuvable.'); setLoading(false); return; }

      setS({
        producerId: prod.id,
        nom_exploitation: prod.nom_exploitation ?? '',
        adresse: prod.adresse ?? '',
        commune: prod.commune ?? '',
        code_postal: prod.code_postal ?? '',
        siret: prod.siret ?? '',
        sms_optin: !!userRow?.sms_optin,
        stripe_account_id: prod.stripe_account_id ?? null,
        stripe_charges_enabled: !!prod.stripe_charges_enabled,
        stripe_payouts_enabled: !!prod.stripe_payouts_enabled,
        stripe_details_submitted: !!prod.stripe_details_submitted,
      });
      setLoading(false);
    })();

    return () => { active = false; };
  }, []);

  const up = (k: keyof State) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setS((prev) => ({ ...prev, [k]: e.target.value } as State));
    setSaved(false);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!s.producerId || !userId) return;
    setSaving(true);
    setError(null);
    setSaved(false);

    const supabase = createSupabaseBrowserClient();

    const [prodRes, userRes] = await Promise.all([
      supabase.from('producers').update({
        nom_exploitation: s.nom_exploitation.trim(),
        adresse: s.adresse.trim() || null,
        commune: s.commune.trim() || null,
        code_postal: s.code_postal.trim() || null,
        siret: s.siret.trim() || null,
      }).eq('id', s.producerId),
      supabase.from('users').update({ sms_optin: s.sms_optin }).eq('id', userId),
    ]);

    setSaving(false);
    if (prodRes.error) { setError(prodRes.error.message); return; }
    if (userRes.error) { setError(userRes.error.message); return; }
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const toggleSms = async (v: boolean) => {
    setS((prev) => ({ ...prev, sms_optin: v }));
    if (!userId) return;
    const supabase = createSupabaseBrowserClient();
    await supabase.from('users').update({ sms_optin: v }).eq('id', userId);
  };

  const onboardStripe = async () => {
    setConnecting(true);
    setError(null);
    try {
      const res = await fetch('/api/stripe/connect/onboard', { method: 'POST' });
      const body = await res.json();
      if (!res.ok || !body.url) {
        setError(body.error ?? 'Impossible de démarrer l\'onboarding Stripe');
        return;
      }
      window.location.href = body.url;
    } finally {
      setConnecting(false);
    }
  };

  if (loading) {
    return (
      <ProducerLayout>
        <div className="max-w-3xl mx-auto px-8 py-10 text-dark/60">Chargement…</div>
      </ProducerLayout>
    );
  }

  // 3 états distincts (cf commit feat(db) ajoutant les 3 flags Stripe):
  //   ready        = compte créé ET charges activées ET KYC soumis
  //   pending      = compte créé mais onboarding incomplet (faux positif
  //                  d'avant: stripe_account_id suffisait à afficher ready)
  //   not-started  = aucun compte Stripe encore créé
  const stripeReady =
    !!s.stripe_account_id && s.stripe_charges_enabled && s.stripe_details_submitted;
  const stripePending = !!s.stripe_account_id && !stripeReady;

  return (
    <ProducerLayout>
      <div className="max-w-3xl mx-auto px-8 py-10">
        <header className="mb-8">
          <div className="text-[11px] uppercase tracking-[0.18em] text-terra-700 font-semibold">Paramètres</div>
          <h1 className="mt-1 font-serif text-[40px] text-green-900 leading-tight">Votre compte</h1>
          <p className="text-[14px] text-dark/60 mt-1">Gérez les informations de votre exploitation, vos paiements et vos notifications.</p>
          {error && <p className="mt-2 text-[13px] text-terra-700">{error}</p>}
        </header>

        <form onSubmit={submit} className="space-y-6">
          <section className="bg-white rounded-2xl border border-dark/[0.06] shadow-soft p-6">
            <h2 className="font-serif text-[22px] text-green-900 mb-1">Exploitation</h2>
            <p className="text-[12px] text-dark/55 mb-5">Ces informations apparaissent sur vos factures et votre page publique.</p>
            <div className="space-y-4">
              <Input label="Nom de l'exploitation *" value={s.nom_exploitation} onChange={up('nom_exploitation')} />
              <Textarea label="Adresse *" rows={2} value={s.adresse} onChange={up('adresse')} placeholder="Rue, voie, lieu-dit" />
              <div className="grid sm:grid-cols-2 gap-4">
                <Input label="Code postal" value={s.code_postal} onChange={up('code_postal')} />
                <Input label="Commune" value={s.commune} onChange={up('commune')} />
              </div>
              <Input label="SIRET" value={s.siret} onChange={up('siret')} placeholder="14 chiffres" hint="Visible uniquement par l'équipe TerrOir." />
            </div>
          </section>

          <section className="bg-white rounded-2xl border border-dark/[0.06] shadow-soft p-6">
            <h2 className="font-serif text-[22px] text-green-900 mb-1">Paiements Stripe Connect</h2>
            <p className="text-[12px] text-dark/55 mb-4">Nécessaire pour recevoir vos virements hebdomadaires.</p>
            <div className={`flex items-start justify-between gap-4 rounded-xl border p-4 ${
              stripeReady ? 'bg-green-100/50 border-green-500' : 'bg-amber-50 border-amber-200'
            }`}>
              <div>
                <div className="text-[14px] font-semibold text-dark">
                  {stripeReady
                    ? '✓ Compte Stripe connecté'
                    : stripePending
                      ? '⚠ Onboarding Stripe en cours — complétez la vérification d\'identité'
                      : 'Compte Stripe non configuré'}
                </div>
                {s.stripe_account_id && (
                  <div className="text-[11px] mono text-dark/55 mt-1">{s.stripe_account_id}</div>
                )}
                <p className="text-[12px] text-dark/65 mt-1">
                  {stripeReady
                    ? 'Vous pouvez recevoir vos paiements. Mettez à jour vos informations si besoin.'
                    : stripePending
                      ? 'Reprenez le formulaire Stripe pour soumettre vos informations d\'identité et activer les virements.'
                      : 'Démarrez l\'onboarding pour pouvoir recevoir vos premiers virements.'}
                </p>
              </div>
              <Button
                type="button"
                variant="primary"
                onClick={onboardStripe}
                disabled={connecting}
              >
                {connecting
                  ? 'Redirection…'
                  : stripeReady
                    ? 'Mettre à jour'
                    : stripePending
                      ? 'Reprendre l\'onboarding'
                      : 'Démarrer'}
              </Button>
            </div>
          </section>

          <section className="bg-white rounded-2xl border border-dark/[0.06] shadow-soft p-6">
            <h2 className="font-serif text-[22px] text-green-900 mb-1">Notifications</h2>
            <p className="text-[12px] text-dark/55 mb-2">Choisissez comment TerrOir vous avertit des nouvelles commandes.</p>
            <div className="divide-y divide-dark/[0.06]">
              <Toggle
                checked={true}
                onChange={() => {}}
                label="Notifications par email"
                hint="Activées par défaut via l'adresse de votre compte."
                disabled
              />
              <Toggle
                checked={s.sms_optin}
                onChange={toggleSms}
                label="Notifications par SMS"
                hint="Alertes urgentes (nouvelle commande, retrait du jour)."
              />
            </div>
          </section>

          <div className="flex items-center justify-end gap-3 pt-2">
            {saved && <span className="text-[13px] text-green-700 font-medium">✓ Modifications enregistrées</span>}
            <Button type="submit" variant="success" size="lg" disabled={saving}>
              {saving ? 'Enregistrement…' : 'Enregistrer'}
            </Button>
          </div>
        </form>
      </div>
    </ProducerLayout>
  );
}
