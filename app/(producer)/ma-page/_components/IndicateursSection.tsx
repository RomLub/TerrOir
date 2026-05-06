'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui';
import {
  ALIMENTATION_HINTS,
  ALIMENTATION_LABELS,
  ALIMENTATION_VALUES,
  DENSITE_ANIMALE_HINTS,
  DENSITE_ANIMALE_LABELS,
  DENSITE_ANIMALE_VALUES,
  MODE_ELEVAGE_HINTS,
  MODE_ELEVAGE_LABELS,
  MODE_ELEVAGE_VALUES,
  type Alimentation,
  type DensiteAnimale,
  type ModeElevage,
} from '@/lib/producers/score-carbone-enums';
import { getDeclarationVeraciteText } from '@/lib/producers/declaration-veracite';
import { ScoreCarbonPreview } from '@/components/producer/ScoreCarbonPreview';
import { updateProducerIndicateursAction } from '@/lib/producers/update-indicateurs';

// T-232 — Section dédiée à la rectification post-onboarding des 3 enums
// score-carbone. Indépendante du save global de la page (qui couvre
// nom_exploitation, photos, especes, labels, etc.) — chaque save indicateur
// passe par la RPC update_producer_indicateurs (atomique, re-dating DGCCRF).
//
// La case d'attestation est REQUISE dès qu'au moins un enum est non-NULL :
// cohérent avec le validator d'onboarding (invitationBusinessInfoSchema)
// et avec la sémantique RPC SQL côté `v_persist`. Cocher la case ne
// re-stamp PAS systématiquement le snapshot — la RPC compare snapshot
// précédent vs valeurs effectives et ne re-date que sur changement réel.

export type IndicateursInitial = {
  mode_elevage: ModeElevage | null;
  alimentation: Alimentation | null;
  densite_animale: DensiteAnimale | null;
};

export type IndicateursSectionProps = {
  initial: IndicateursInitial;
  // Slug du producer pour invalider la fiche publique cached (audit Vercel
  // C-5). Optional car un producer en draft/pending sans slug ne révèle
  // pas encore de fiche publique à invalider.
  producerSlug: string | null;
  onSaveSuccess?: (next: IndicateursInitial) => void;
};

export function IndicateursSection({
  initial,
  producerSlug,
  onSaveSuccess,
}: IndicateursSectionProps) {
  const [modeElevage, setModeElevage] = useState<ModeElevage | null>(
    initial.mode_elevage,
  );
  const [alimentation, setAlimentation] = useState<Alimentation | null>(
    initial.alimentation,
  );
  const [densiteAnimale, setDensiteAnimale] = useState<DensiteAnimale | null>(
    initial.densite_animale,
  );
  const [declarationCochee, setDeclarationCochee] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const anyEnumSet =
    modeElevage !== null || alimentation !== null || densiteAnimale !== null;
  // Si tous les enums sont NULL (cas vidange), la case n'est pas requise
  // (la RPC SQL ne touchera pas aux colonnes declaration_*). Sinon
  // obligatoire pour cocher l'engagement DGCCRF avant tout save.
  const canSave = !anyEnumSet || declarationCochee;
  const wordingText = getDeclarationVeraciteText();

  const dirty =
    modeElevage !== initial.mode_elevage ||
    alimentation !== initial.alimentation ||
    densiteAnimale !== initial.densite_animale;

  const handleSave = () => {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const res = await updateProducerIndicateursAction({
        mode_elevage: modeElevage,
        alimentation: alimentation,
        densite_animale: densiteAnimale,
        declaration_cochee: declarationCochee,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSaved(true);
      setDeclarationCochee(false);
      onSaveSuccess?.({
        mode_elevage: modeElevage,
        alimentation: alimentation,
        densite_animale: densiteAnimale,
      });
      // Invalide le cache fiche publique (audit Vercel C-5). Lazy import
      // pour éviter de charger revalidate.ts au mount d'un producer sans
      // slug.
      if (producerSlug) {
        try {
          const mod = await import('@/lib/stats/revalidate');
          await mod.revalidateProducerCard({
            slug: producerSlug,
            source: 'producer-indicateurs-update',
          });
        } catch (e) {
          console.warn('[INDICATEURS_REVALIDATE_WARN]', e);
        }
      }
      setTimeout(() => setSaved(false), 2500);
    });
  };

  return (
    <section className="bg-white rounded-2xl border border-dark/[0.06] shadow-soft p-6">
      <h2 className="font-serif text-[22px] text-green-900 mb-1">
        Tes indicateurs publics
      </h2>
      <p className="text-[13px] text-dark/60 mb-4">
        Ces 3 indicateurs s&rsquo;affichent sur ta fiche publique. Tu peux les
        modifier à tout moment — chaque modification est horodatée pour
        traçabilité.
      </p>

      <div className="grid gap-6 md:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <fieldset className="space-y-2">
            <legend className="mb-1 block text-[13px] font-medium text-dark/80">
              Mode d&rsquo;élevage
            </legend>
            {MODE_ELEVAGE_VALUES.map((v) => (
              <label
                key={v}
                className="flex cursor-pointer select-none items-start gap-3 rounded-md border border-dark/10 bg-white p-3 hover:border-green-500"
              >
                <input
                  type="radio"
                  name="ma_page_indic_mode_elevage"
                  value={v}
                  checked={modeElevage === v}
                  onChange={() => {
                    setModeElevage(v);
                    setSaved(false);
                  }}
                  className="mt-1 h-4 w-4 accent-green-700"
                />
                <span className="flex flex-col">
                  <span className="text-[13px] font-medium text-dark/85">
                    {MODE_ELEVAGE_LABELS[v]}
                  </span>
                  <span className="text-[11px] text-dark/55">
                    {MODE_ELEVAGE_HINTS[v]}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="mb-1 block text-[13px] font-medium text-dark/80">
              Alimentation
            </legend>
            {ALIMENTATION_VALUES.map((v) => (
              <label
                key={v}
                className="flex cursor-pointer select-none items-start gap-3 rounded-md border border-dark/10 bg-white p-3 hover:border-green-500"
              >
                <input
                  type="radio"
                  name="ma_page_indic_alimentation"
                  value={v}
                  checked={alimentation === v}
                  onChange={() => {
                    setAlimentation(v);
                    setSaved(false);
                  }}
                  className="mt-1 h-4 w-4 accent-green-700"
                />
                <span className="flex flex-col">
                  <span className="text-[13px] font-medium text-dark/85">
                    {ALIMENTATION_LABELS[v]}
                  </span>
                  <span className="text-[11px] text-dark/55">
                    {ALIMENTATION_HINTS[v]}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="mb-1 block text-[13px] font-medium text-dark/80">
              Densité animale
            </legend>
            {DENSITE_ANIMALE_VALUES.map((v) => (
              <label
                key={v}
                className="flex cursor-pointer select-none items-start gap-3 rounded-md border border-dark/10 bg-white p-3 hover:border-green-500"
              >
                <input
                  type="radio"
                  name="ma_page_indic_densite_animale"
                  value={v}
                  checked={densiteAnimale === v}
                  onChange={() => {
                    setDensiteAnimale(v);
                    setSaved(false);
                  }}
                  className="mt-1 h-4 w-4 accent-green-700"
                />
                <span className="flex flex-col">
                  <span className="text-[13px] font-medium text-dark/85">
                    {DENSITE_ANIMALE_LABELS[v]}
                  </span>
                  <span className="text-[11px] text-dark/55">
                    {DENSITE_ANIMALE_HINTS[v]}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>

          {anyEnumSet && wordingText && (
            <label className="mt-4 flex cursor-pointer items-start gap-2 rounded-md border border-terra-300 bg-terra-50 p-3 text-[12.5px] text-dark/80">
              <input
                type="checkbox"
                checked={declarationCochee}
                onChange={(e) => {
                  setDeclarationCochee(e.target.checked);
                  setSaved(false);
                }}
                className="mt-0.5 h-4 w-4 accent-green-700"
              />
              <span>{wordingText}</span>
            </label>
          )}

          {error && (
            <p className="text-[12.5px] text-terra-700" role="alert">
              {error}
            </p>
          )}
        </div>

        <div className="md:sticky md:top-4 md:self-start">
          <ScoreCarbonPreview
            modeElevage={modeElevage}
            alimentation={alimentation}
            densiteAnimale={densiteAnimale}
          />
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3 border-t border-dark/[0.06] pt-4">
        <p className="text-[12px] text-dark/55">
          {saved
            ? '✓ Indicateurs enregistrés.'
            : dirty
              ? 'Modifications non enregistrées'
              : 'Indicateurs à jour'}
        </p>
        <Button
          variant="accent"
          size="md"
          onClick={handleSave}
          disabled={pending || !dirty || !canSave}
        >
          {pending ? 'Enregistrement…' : 'Enregistrer mes indicateurs'}
        </Button>
      </div>
    </section>
  );
}
