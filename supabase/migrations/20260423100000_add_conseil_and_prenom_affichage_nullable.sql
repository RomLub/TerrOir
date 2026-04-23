-- =============================================================================
-- TerrOir — Le conseil de l'éleveur + prenom_affichage producer
-- Migration A : ADD COLUMN nullable + CHECK constraints
-- =============================================================================
-- Séquence en 3 fichiers (A/B/C) pour donner un point d'arrêt explicite entre
-- chaque étape. Cette migration crée les colonnes sans verrou NOT NULL :
-- après apply, l'UI producer peut déjà écrire, et les producers existants
-- ne sont pas bloqués. Migration B fera le backfill automatique, migration C
-- posera le NOT NULL avec garde-fou.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- producers.prenom_affichage
-- -----------------------------------------------------------------------------
-- Texte libre visible sur les produits ("Julien", "Julien et Marie", "La
-- famille Durand"). Séparé de users.prenom (identité légale du owner) pour
-- permettre un pseudonyme commercial propre à l'exploitation.
alter table public.producers
  add column prenom_affichage text;

alter table public.producers
  add constraint producers_prenom_affichage_len_check
    check (prenom_affichage is null
           or char_length(prenom_affichage) between 1 and 50);

-- -----------------------------------------------------------------------------
-- products.conseil_active + products.conseil_texte
-- -----------------------------------------------------------------------------
-- Feature opt-in par produit. Si conseil_active=false, conseil_texte doit
-- rester null (garde-fou applicatif côté UI + check ci-dessous côté DB).
alter table public.products
  add column conseil_active boolean not null default false,
  add column conseil_texte  text;

alter table public.products
  add constraint products_conseil_texte_len_check
    check (conseil_texte is null or char_length(conseil_texte) <= 280);

alter table public.products
  add constraint products_conseil_active_requires_texte_check
    check (conseil_active = false
           or (conseil_texte is not null
               and length(trim(conseil_texte)) > 0));

commit;
