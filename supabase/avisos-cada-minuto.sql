-- Paso final: hace que Supabase revise cada minuto si toca mandar un aviso.
-- Antes de correrlo, cambia TU-SITIO por la dirección de tu página en Vercel
-- y TU-CONTRASEÑA por la misma APP_PASSWORD que pusiste en Vercel (puede llevar símbolos; deja las comillas simples).

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'avisos-agenda',
  '* * * * *',
  $job$ select net.http_get(
    url := 'https://TU-SITIO.vercel.app/api/cron',
    headers := jsonb_build_object('x-app-password', 'TU-CONTRASEÑA')
  ) $job$
);

-- Para borrar los avisos enviados de hace más de 30 días, una vez al día:
select cron.schedule('limpiar-avisos', '0 4 * * *', $job$ delete from sent where created_at < now() - interval '30 days' $job$);
