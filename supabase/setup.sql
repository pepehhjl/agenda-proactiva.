-- Pega todo esto en Supabase > SQL Editor > New query y toca "Run".
-- Crea las tablas de la agenda. Solo el servidor (con la clave service_role) puede leerlas.

create table if not exists items (
  id text primary key,
  kind text not null,
  data jsonb not null default '{}',
  updated_at timestamptz not null default now()
);
create table if not exists push_subs (
  endpoint text primary key,
  sub jsonb not null,
  created_at timestamptz not null default now()
);
create table if not exists sent (
  key text primary key,
  created_at timestamptz not null default now()
);
alter table items enable row level security;
alter table push_subs enable row level security;
alter table sent enable row level security;
