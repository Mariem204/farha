-- Farha · réponses des invités (RSVP) : « J'arrive » / « Je ne peux pas » + un mot facultatif.
-- À exécuter une fois dans l'éditeur SQL de Supabase.
--
-- Chaque réponse est écrite par la fonction serveur /api/rsvp (clé service_role) ; le client qui a commandé
-- l'invitation reçoit à chaque nouvelle réponse un e-mail avec le tableau de toutes les réponses.
-- Les invités n'ont aucun accès direct à cette table (RLS activée, aucune règle pour anon).

create table if not exists public.rsvps (
  id            bigint generated always as identity primary key,
  invitation_slug text not null check (invitation_slug ~ '^[a-z0-9-]{2,80}$'),
  guest_name    text not null check (char_length(guest_name) between 2 and 120),
  attending     boolean not null,
  message       text check (message is null or char_length(message) <= 600),
  created_at    timestamptz not null default now()
);
create index if not exists rsvps_invitation_slug_idx on public.rsvps (invitation_slug, created_at);

alter table public.rsvps enable row level security;
revoke all on public.rsvps from anon;
-- Lecture par les administrateurs dans le back-office.
grant select on public.rsvps to authenticated;
drop policy if exists rsvps_admin_read on public.rsvps;
create policy rsvps_admin_read on public.rsvps for select to authenticated using (public.is_admin());
