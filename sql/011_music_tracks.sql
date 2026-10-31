-- Farha · musiques d'ambiance : bibliothèque gérée depuis le back-office.
-- À exécuter une fois dans l'éditeur SQL de Supabase (après les scripts précédents : is_admin() doit exister).
--
-- Trois sources possibles pour un titre :
--   file    : fichier audio (MP3…) déposé dans le bucket « music »
--   youtube : identifiant de vidéo YouTube (lecture intégrée, selon les autorisations de la vidéo)
--   demo    : mélodie de démonstration générée par le site (les 20 titres d'origine, index 0 à 19)

create table if not exists public.music_tracks (
  id          uuid primary key default gen_random_uuid(),
  title       text not null check (char_length(title) between 2 and 80),
  category    text not null default 'Instrumental'
              check (category in ('Romantique', 'Mariage', 'Anniversaire', 'Oriental', 'Instrumental')),
  source      text not null check (source in ('file', 'youtube', 'demo')),
  file_path   text check (file_path is null or char_length(file_path) <= 300),
  youtube_id  text check (youtube_id is null or youtube_id ~ '^[A-Za-z0-9_-]{11}$'),
  demo_index  smallint check (demo_index is null or demo_index between 0 and 19),
  is_active   boolean not null default true,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint music_tracks_source_ok check (
    (source = 'file'    and file_path is not null and youtube_id is null and demo_index is null) or
    (source = 'youtube' and youtube_id is not null and file_path is null and demo_index is null) or
    (source = 'demo'    and demo_index is not null and file_path is null and youtube_id is null)
  )
);
create index if not exists music_tracks_order on public.music_tracks (sort_order, title);

create or replace function public.music_tracks_touch() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists music_tracks_touch on public.music_tracks;
create trigger music_tracks_touch before update on public.music_tracks
  for each row execute function public.music_tracks_touch();

-- RLS : le site public ne lit que les titres actifs ; seuls les administrateurs écrivent.
alter table public.music_tracks enable row level security;
-- (les visiteurs n'ont pas le droit d'appeler is_admin() : deux règles séparées)
drop policy if exists music_tracks_public_read on public.music_tracks;
drop policy if exists music_tracks_anon_read on public.music_tracks;
create policy music_tracks_anon_read on public.music_tracks for select to anon
  using (is_active);
drop policy if exists music_tracks_auth_read on public.music_tracks;
create policy music_tracks_auth_read on public.music_tracks for select to authenticated
  using (is_active or public.is_admin());
drop policy if exists music_tracks_admin_insert on public.music_tracks;
create policy music_tracks_admin_insert on public.music_tracks for insert to authenticated
  with check (public.is_admin());
drop policy if exists music_tracks_admin_update on public.music_tracks;
create policy music_tracks_admin_update on public.music_tracks for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists music_tracks_admin_delete on public.music_tracks;
create policy music_tracks_admin_delete on public.music_tracks for delete to authenticated
  using (public.is_admin());

grant select on public.music_tracks to anon, authenticated;
grant insert, update, delete on public.music_tracks to authenticated;

-- Les 20 titres de démonstration déjà proposés sur le site (désactivables ou supprimables ensuite).
insert into public.music_tracks (title, category, source, demo_index, sort_order)
select v.title, v.category, 'demo', v.idx, v.idx + 1
from (values
  (0, 'Rêve de jasmin', 'Romantique'), (1, 'Promesse au clair de lune', 'Romantique'),
  (2, 'Éclat de tendresse', 'Romantique'), (3, 'Premier regard', 'Romantique'),
  (4, 'Danse des amoureux', 'Mariage'), (5, 'Notre grand jour', 'Mariage'),
  (6, 'Valse des fleurs', 'Mariage'), (7, 'Éternelle union', 'Mariage'),
  (8, 'Bougies et sourires', 'Anniversaire'), (9, 'Jour de fête', 'Anniversaire'),
  (10, 'Confettis dorés', 'Anniversaire'), (11, 'Un an de plus', 'Anniversaire'),
  (12, 'Soleil de Carthage', 'Oriental'), (13, 'Brise de Sidi Bou Saïd', 'Oriental'),
  (14, 'Nuit de jasmin', 'Oriental'), (15, 'Étoiles du désert', 'Oriental'),
  (16, 'Piano du matin', 'Instrumental'), (17, 'Nuages légers', 'Instrumental'),
  (18, 'Douce lavande', 'Instrumental'), (19, 'Lumière du lac', 'Instrumental')
) as v(idx, title, category)
where not exists (select 1 from public.music_tracks where source = 'demo');

-- Stockage des fichiers audio : bucket public (lecture par les invités), 15 Mo max par fichier.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('music', 'music', true, 15728640,
        array['audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/ogg', 'audio/wav', 'audio/x-wav', 'audio/webm'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists music_admin_insert on storage.objects;
create policy music_admin_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'music' and public.is_admin());
drop policy if exists music_admin_update on storage.objects;
create policy music_admin_update on storage.objects for update to authenticated
  using (bucket_id = 'music' and public.is_admin());
drop policy if exists music_admin_delete on storage.objects;
create policy music_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'music' and public.is_admin());
