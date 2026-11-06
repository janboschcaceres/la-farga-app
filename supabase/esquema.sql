-- Base de datos de la app de La Farga FC (Supabase).
-- Pegar entero en Supabase > SQL Editor > New query > Run.

-- Una tabla genérica de documentos: colección + id + datos en JSON.
create table if not exists public.docs (
  coleccion text not null,
  id text not null,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (coleccion, id)
);

alter table public.docs enable row level security;

-- Solo la cuenta del equipo (usuario con sesión iniciada) puede leer y escribir.
drop policy if exists "equipo lee" on public.docs;
create policy "equipo lee" on public.docs for select to authenticated using (true);
drop policy if exists "equipo escribe" on public.docs;
create policy "equipo escribe" on public.docs for insert to authenticated with check (true);
drop policy if exists "equipo actualiza" on public.docs;
create policy "equipo actualiza" on public.docs for update to authenticated using (true) with check (true);
drop policy if exists "equipo borra" on public.docs;
create policy "equipo borra" on public.docs for delete to authenticated using (true);

-- Cambios en directo para que todos vean lo mismo al momento.
alter publication supabase_realtime add table public.docs;

-- Fotos y vídeos de los partidos.
insert into storage.buckets (id, name, public, file_size_limit)
values ('fotos', 'fotos', true, 52428800)
on conflict (id) do nothing;

drop policy if exists "equipo sube fotos" on storage.objects;
create policy "equipo sube fotos" on storage.objects for insert to authenticated with check (bucket_id = 'fotos');
drop policy if exists "equipo borra fotos" on storage.objects;
create policy "equipo borra fotos" on storage.objects for delete to authenticated using (bucket_id = 'fotos');
