-- Farha · collections : les catégories deviennent des « collections » affichées sur la page Thèmes.
-- À exécuter une fois dans l'éditeur SQL de Supabase (après les scripts précédents : is_admin() doit exister).
--
-- Une collection = une ligne de public.categories. Chaque modèle appartient à une seule collection (templates.category_id).
-- Nouveaux champs :
--   tagline     : phrase courte sous le titre (« Le grand jour, en majesté »)
--   cover_url   : photo de couverture hébergée ailleurs (https://…)
--   cover_path  : photo de couverture déposée depuis le back-office (bucket template-previews, dossier collections/)
--   is_featured : affiche le badge « La plus demandée »

alter table public.categories add column if not exists tagline text;
alter table public.categories add column if not exists cover_url text;
alter table public.categories add column if not exists cover_path text;
alter table public.categories add column if not exists is_featured boolean not null default false;

alter table public.categories drop constraint if exists categories_tagline_len;
alter table public.categories add constraint categories_tagline_len check (tagline is null or char_length(tagline) <= 80);
alter table public.categories drop constraint if exists categories_cover_url_ok;
alter table public.categories add constraint categories_cover_url_ok check (cover_url is null or (cover_url ~ '^https://' and char_length(cover_url) <= 500));
alter table public.categories drop constraint if exists categories_cover_path_ok;
alter table public.categories add constraint categories_cover_path_ok check (cover_path is null or char_length(cover_path) <= 300);

-- Lecture publique des nouveaux champs ; écriture réservée aux administrateurs (RLS existante + privilèges).
grant select (tagline, cover_url, cover_path, is_featured) on public.categories to anon, authenticated;
grant insert (tagline, cover_url, cover_path, is_featured), update (tagline, cover_url, cover_path, is_featured)
  on public.categories to authenticated;

-- Suppression d'une collection (le back-office déplace d'abord ses modèles vers une autre collection).
grant delete on public.categories to authenticated;
drop policy if exists categories_admin_delete on public.categories;
create policy categories_admin_delete on public.categories for delete to authenticated
  using (public.is_admin());

-- Phrases et photos de départ (celles affichées aujourd'hui sur le site), sans écraser ce qui a déjà été saisi.
update public.categories c set
  tagline   = coalesce(c.tagline, v.tagline),
  cover_url = coalesce(c.cover_url, case when c.cover_path is null then v.cover end),
  is_featured = c.is_featured or v.featured
from (values
  ('Mariage',      'Le grand jour, en majesté',    'https://images.unsplash.com/photo-1591604466107-ec97de577aff?auto=format&fit=crop&w=1400&h=700&q=72', true),
  ('Fiançailles',  'La promesse, en douceur',      'https://images.unsplash.com/photo-1518370265276-f22b706aeac8?auto=format&fit=crop&w=1400&h=700&q=72', false),
  ('Anniversaire', 'Des fêtes pleines de vie',     'https://images.unsplash.com/photo-1606983340126-99ab4feaa64a?auto=format&fit=crop&w=1400&h=700&q=72', false),
  ('Naissance',    'Bienvenue au petit trésor',    'https://images.unsplash.com/photo-1773243086631-962baefccd8a?auto=format&fit=crop&w=1400&h=700&q=72', false),
  ('Tahara',       'La tradition, avec élégance',  'https://images.unsplash.com/photo-1777980652216-68112200e3c8?auto=format&fit=crop&w=1400&h=700&q=72', false),
  ('Diplôme',      'Célébrer la réussite',         'https://images.unsplash.com/photo-1523580846011-d3a5bc25702b?auto=format&fit=crop&w=1400&h=700&q=72', false),
  ('Événement',    'Pour toutes vos occasions',    'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?auto=format&fit=crop&w=1400&h=700&q=72', false)
) as v(name, tagline, cover, featured)
where c.name = v.name;
