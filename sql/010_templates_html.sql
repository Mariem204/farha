-- Farha · modèles : code HTML saisi dans le back-office.
-- À exécuter une fois dans l'éditeur SQL de Supabase, avant de créer un modèle HTML.
alter table public.templates add column if not exists html text;
alter table public.templates drop constraint if exists templates_html_size;
alter table public.templates add constraint templates_html_size check (html is null or octet_length(html) <= 1048576);

-- Les privilèges sont accordés colonne par colonne (scripts 002 et 006) :
-- autoriser la lecture et l'écriture de la nouvelle colonne pour les comptes connectés.
-- Les politiques RLS existantes continuent de réserver l'écriture aux administrateurs.
grant select (html), insert (html), update (html) on public.templates to authenticated;
