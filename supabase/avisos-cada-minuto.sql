-- Paso final: hace que Supabase revise cada minuto si toca mandar un aviso.
-- Antes de correrlo, cambia TU-SITIO por la dirección de tu página en Vercel
-- y TU-CONTRASEÑA por la misma APP_PASSWORD que pusiste en Vercel.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'avisos-agenda',
  '* * * * *',
  $$ select net.http_get(url := 'https://TU-SITIO.vercel.app/api/cron?key=TU-CONTRASEÑA') $$
);

-- Para borrar los avisos enviados de hace más de 30 días, una vez al día:
select cron.schedule('limpiar-avisos', '0 4 * * *', $$ delete from sent where created_at < now() - interval '30 days' $$);
