-- Reportes de problemas e ideas (Pendi 0.15.0). Pega esto en Supabase > SQL Editor y toca "Run" (una sola vez).
-- Crea una tabla nueva y no toca ninguna de las que ya existen.
create table if not exists feedback (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  person_id text,
  type text not null check (type in ('bug', 'idea')),
  message text not null check (char_length(message) between 1 and 2000),
  meta jsonb not null default '{}'::jsonb
);
create index if not exists feedback_created_at_idx on feedback (created_at desc);
-- Igual que las otras tablas: solo el servidor (con su clave secreta) puede leer o escribir.
alter table feedback enable row level security;
