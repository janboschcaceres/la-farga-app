// Conexión a Supabase con la misma forma que usa app.js (doc / collection / onSnapshot),
// para que la app funcione igual en su web propia.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';

export function crear(url, clave) {
  const sb = createClient(url, clave, { auth: { persistSession: true, autoRefreshToken: true } });
  const oyentes = new Set(); // { coleccion, id|null, fn }
  let cache = {}; // coleccion -> Map(id -> data)

  const snapDoc = (id, data) => ({ id, exists: data !== undefined, data: () => data });
  const snapCol = col => {
    const m = cache[col] || new Map();
    return { docs: [...m.entries()].map(([id, d]) => snapDoc(id, d)), size: m.size, empty: !m.size };
  };
  const avisar = col => {
    for (const o of oyentes) if (o.coleccion === col) o.id ? o.fn(snapDoc(o.id, (cache[col] || new Map()).get(o.id))) : o.fn(snapCol(col));
  };
  async function cargar(col) {
    const { data, error } = await sb.from('docs').select('id,data').eq('coleccion', col);
    if (error) throw error;
    cache[col] = new Map(data.map(r => [r.id, r.data]));
    avisar(col);
  }
  let canal = null;
  function escuchar() {
    if (canal) return;
    canal = sb.channel('docs').on('postgres_changes', { event: '*', schema: 'public', table: 'docs' }, p => {
      const r = p.new && p.new.coleccion ? p.new : p.old;
      if (!r || !r.coleccion) return;
      const m = cache[r.coleccion] || (cache[r.coleccion] = new Map());
      if (p.eventType === 'DELETE') m.delete(r.id); else m.set(r.id, p.new.data);
      avisar(r.coleccion);
    }).subscribe();
  }
  const partir = path => { const i = path.indexOf('/'); return [path.slice(0, i), path.slice(i + 1)]; };

  const db = {
    doc(path) {
      const [col, id] = partir(path);
      return {
        async set(data) {
          const { error } = await sb.from('docs').upsert({ coleccion: col, id, data, updated_at: new Date().toISOString() });
          if (error) throw { code: 'unavailable', message: error.message };
          (cache[col] || (cache[col] = new Map())).set(id, data); avisar(col);
        },
        async delete() {
          const { error } = await sb.from('docs').delete().eq('coleccion', col).eq('id', id);
          if (error) throw { code: 'unavailable', message: error.message };
          cache[col] && cache[col].delete(id); avisar(col);
        },
        onSnapshot(fn, err) {
          const o = { coleccion: col, id, fn }; oyentes.add(o); escuchar();
          cargar(col).catch(e => err && err(e));
          return () => oyentes.delete(o);
        },
      };
    },
    collection(col) {
      return {
        onSnapshot(fn, err) {
          const o = { coleccion: col, id: null, fn }; oyentes.add(o); escuchar();
          cargar(col).catch(e => err && err(e));
          return () => oyentes.delete(o);
        },
      };
    },
  };

  const assets = {
    async upload(file) {
      if (file.size > 50 * 1024 * 1024) throw { code: 'too_large' };
      const ext = (file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
      const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const ruta = `${id}.${ext}`;
      const { error } = await sb.storage.from('fotos').upload(ruta, file, { contentType: file.type });
      if (error) throw { code: 'upstream_error', message: error.message };
      return { id, url: sb.storage.from('fotos').getPublicUrl(ruta).data.publicUrl, contentType: file.type };
    },
  };

  return {
    sb, db, assets,
    async sesion() { return (await sb.auth.getSession()).data.session; },
    async entrar(email, password) {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
    },
  };
}
