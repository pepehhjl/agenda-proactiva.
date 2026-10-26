# Agenda Proactiva

Tu calendario con IA: le cuentas lo que tienes que hacer, te propone horarios, te avisa 1 hora, 30 y 10 minutos antes con un consejo, y te recuerda los cumpleaños 2 días antes con ideas de regalo.

Es una app web instalable: en el iPhone (iOS 16.4 o más nuevo) y en Android se agrega a la pantalla de inicio y manda notificaciones aunque esté cerrada. No necesita App Store.

## Cómo ponerla en marcha (todo gratis)

### 1. Publicarla en Vercel
1. En Vercel toca **Add New > Project**, elige este repositorio y toca **Deploy**.
2. En el proyecto ve a **Settings > Environment Variables** y agrega:
   - `APP_PASSWORD`: una contraseña que tú inventes. Protege tu agenda.
   - `GEMINI_API_KEY`: tu clave gratis de [Google AI Studio](https://aistudio.google.com/apikey).
3. Ve a **Deployments**, abre el menú del último y toca **Redeploy**.

Con eso ya funciona la IA. Las tareas se guardan en el dispositivo.

### 2. Guardar en la nube (Supabase)
1. Crea un proyecto gratis en [Supabase](https://supabase.com).
2. Abre **SQL Editor**, pega el contenido de `supabase/setup.sql` y toca **Run**.
3. En **Project Settings > API** copia la *Project URL* y la clave *service_role*.
4. En Vercel agrega `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` con esos valores, y haz Redeploy.

### 3. Avisos con la app cerrada
1. Abre la app, entra a **Ajustes > Configuración** y copia las dos claves que aparecen.
2. En Vercel agrégalas como `VAPID_PUBLIC_KEY` y `VAPID_PRIVATE_KEY`, y haz Redeploy.
3. En Supabase abre **SQL Editor**, pega `supabase/avisos-cada-minuto.sql`, cambia `TU-SITIO` y `TU-CONTRASEÑA`, y toca **Run**.
4. En el iPhone: abre la página en Safari, toca **Compartir > Agregar a pantalla de inicio**, ábrela desde el ícono y toca **Ajustes > Activar avisos**.

## Qué hay dentro
- `index.html`: la app (agenda del día, organizar, chat, cumpleaños, ajustes).
- `sw.js`, `manifest.webmanifest`, íconos: lo que la hace instalable y le permite mostrar notificaciones.
- `api/`: el servidor. `ai.js` habla con Gemini, `items.js` guarda en Supabase, `subscribe.js` registra el celular, `cron.js` manda los avisos, `status.js` dice qué falta configurar.
- `supabase/`: el SQL para crear las tablas y programar los avisos.
