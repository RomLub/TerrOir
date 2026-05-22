-- Chantier 3 (Leads) — Phase 1 / sous-chantier 0.1bis : flag bio isolé validé.
-- Remplace le système score-carbone (supprimé en 20260522093000) par une
-- mention bio dédiée, avec numéro de certificat Agence Bio et validation admin.
-- Forward-only, idempotent.

alter table public.producers
  add column if not exists bio boolean not null default false,
  add column if not exists bio_certificate_number text null,
  add column if not exists bio_validated_at timestamptz null;

-- Retrait de la valeur 'bio' des labels[] existants : bio devient un flag isolé
-- validé administrativement, plus un label libre (cf. ADR 0003). On NE coche PAS
-- bio = true automatiquement : on ignore si ces producteurs sont réellement
-- certifiés Agence Bio. Ils devront re-déclarer leur statut avec leur numéro
-- d'opérateur, soumis à validation admin avant exposition publique.
update public.producers
set labels = array_remove(labels, 'bio')
where labels is not null and 'bio' = any(labels);
