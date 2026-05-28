-- =============================================================================
-- TerrOir - Integrite review_producer_reads
-- =============================================================================
-- Une ligne de lecture doit pointer vers l'avis ET le producteur de cet avis.
-- Sans contrainte composite, un producteur pourrait theorquement creer une row
-- de lecture sur un review_id qui ne lui appartient pas en indiquant son propre
-- producer_id. La FK composite ferme cette incoherence.
-- =============================================================================

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'reviews_id_producer_id_key'
      and conrelid = 'public.reviews'::regclass
  ) then
    alter table public.reviews
      add constraint reviews_id_producer_id_key unique (id, producer_id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'review_producer_reads_review_producer_fkey'
      and conrelid = 'public.review_producer_reads'::regclass
  ) then
    alter table public.review_producer_reads
      add constraint review_producer_reads_review_producer_fkey
      foreign key (review_id, producer_id)
      references public.reviews(id, producer_id)
      on delete cascade;
  end if;
end $$;
