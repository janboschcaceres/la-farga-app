# App de La Farga FC

Web instalable (PWA) en HTML/JS sin compilación.

- `index.html`, `app.js`, `styles.css`: la app.
- `config.js`: datos de Supabase (URL, clave anon pública y email de la cuenta del equipo). Vacío = modo Claude.
- `supa.js`: conexión a Supabase (tabla `docs` + almacenamiento `fotos`).
- `supabase/esquema.sql`: crea la base de datos. Pegar en Supabase > SQL Editor y ejecutar.
- `data/liga.json`: datos de la liga que genera `scraper/valldor.py` desde la web de Fundació Valldor7.
- `sw.js` + `manifest.webmanifest`: instalación y uso sin conexión.

Publicación: GitHub Pages (rama main, carpeta raíz).
