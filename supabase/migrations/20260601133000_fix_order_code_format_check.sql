-- TerrOir - resserrage format code_commande 5 OU 7 caracteres
-- Contexte : la migration 20260511007000 documentait "5 OU 7", mais le
-- CHECK utilisait {5,7}, ce qui autorise aussi 6 caracteres. Le generateur
-- produit uniquement 7 caracteres depuis cette migration ; les anciens codes
-- historiques restent en 5 caracteres.

alter table public.orders
  drop constraint if exists orders_code_commande_format_check;

alter table public.orders
  add constraint orders_code_commande_format_check
  check (
    code_commande ~ '^TRR-([23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{5}|[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{7})$'
  );
