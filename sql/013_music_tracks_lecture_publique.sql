-- Farha · correctif de 011 : les visiteurs (rôle anon) n'ont pas le droit d'appeler is_admin(),
-- donc la règle de lecture « is_active or is_admin() » leur renvoyait « permission denied ».
-- Les visiteurs lisent les titres actifs ; les comptes connectés gardent la lecture admin.
drop policy if exists music_tracks_public_read on public.music_tracks;
drop policy if exists music_tracks_anon_read on public.music_tracks;
drop policy if exists music_tracks_auth_read on public.music_tracks;
create policy music_tracks_anon_read on public.music_tracks for select to anon
  using (is_active);
create policy music_tracks_auth_read on public.music_tracks for select to authenticated
  using (is_active or public.is_admin());
