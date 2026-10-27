-- Agendas separadas para personas invitadas. Pega esto en Supabase > SQL Editor y toca "Run" (una sola vez).
-- Todo lo que ya existe queda en la agenda principal ("main").
alter table items add column if not exists owner text not null default 'main';
alter table push_subs add column if not exists owner text not null default 'main';
alter table items drop constraint if exists items_pkey;
alter table items add primary key (owner, id);
create table if not exists people (
  id text primary key,
  name text not null default '',
  token text not null unique,
  created_at timestamptz not null default now()
);
alter table people enable row level security;
