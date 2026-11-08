'use strict';

/* ---------- Estado ----------
 * web   = data/liga.json (lo que se saca de la web de Valldor, se actualiza solo)
 * local = lo que se mete a mano en la app (plantilla, partidos, goles, asistencia)
 * Si un partido existe en los dos, manda lo metido a mano.
 */
const KEY = 'lafarga.v1';
const EQUIPO = 'La Farga FC';
let web = { clasificacion: [], partidos: [], plantilla: [] };
let local = load();
local.lesiones = local.lesiones || [];
local.votos = local.votos || [];
local.eventos = local.eventos || [];
local.porras = local.porras || [];
let fotos = [];
let assets = null;
let tab = 'inicio';

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s) return s;
  } catch (e) { /* sin almacenamiento */ }
  return { jugadores: [], partidos: {}, borrados: [], lesiones: [] };
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(local)); } catch (e) { /* sin almacenamiento */ }
}

/* Base de datos compartida: cuando la app se abre desde su enlace, todo lo que
 * se mete a mano lo ven los 11. Si no hay conexión, se guarda en el móvil. */
let db = null;
const store = {
  async setPartido(p) {
    local.partidos[p.id] = p;
    local.borrados = local.borrados.filter(x => x !== p.id);
    save(); render();
    if (db) await db.doc('partidos/' + p.id).set(p).catch(fallo);
    if (db) await this.syncBorrados();
  },
  async delPartido(id, deWeb) {
    delete local.partidos[id];
    if (deWeb) local.borrados.push(id);
    save(); render();
    if (db) await db.doc('partidos/' + id).delete().catch(fallo);
    if (db && deWeb) await this.syncBorrados();
  },
  async setJugador(j) {
    local.jugadores = local.jugadores.filter(x => x.id !== j.id).concat(j);
    save(); render();
    if (db) await db.doc('jugadores/' + j.id).set(j).catch(fallo);
  },
  async setLesion(l) {
    local.lesiones = local.lesiones.filter(x => x.id !== l.id).concat(l);
    save(); render();
    if (db) await db.doc('lesiones/' + l.id).set(l).catch(fallo);
  },
  async delLesion(id) {
    local.lesiones = local.lesiones.filter(x => x.id !== id);
    save(); render();
    if (db) await db.doc('lesiones/' + id).delete().catch(fallo);
  },
  async setEvento(ev) {
    local.eventos = local.eventos.filter(x => x.id !== ev.id).concat(ev);
    save(); render();
    if (db) await db.doc('eventos/' + ev.id).set(ev).catch(fallo);
  },
  async delEvento(id) {
    local.eventos = local.eventos.filter(x => x.id !== id);
    save(); render();
    if (db) await db.doc('eventos/' + id).delete().catch(fallo);
  },
  async setPorra(v) {
    local.porras = local.porras.filter(x => x.id !== v.id).concat(v);
    save();
    if (db) await db.doc('porras/' + v.id).set(v).catch(fallo);
  },
  async setVoto(v) {
    local.votos = local.votos.filter(x => x.id !== v.id).concat(v);
    save();
    if (db) await db.doc('votos/' + v.id).set(v).catch(fallo);
  },
  async delJugador(id) {
    local.jugadores = local.jugadores.filter(x => x.id !== id);
    save(); render();
    if (db) await db.doc('jugadores/' + id).delete().catch(fallo);
  },
  async syncBorrados() {
    await db.doc('meta/borrados').set({ ids: local.borrados }).catch(fallo);
  },
};
function fallo(e) {
  toast(e && e.code === 'not_granted' ? 'Solo puedes mirar: pide permiso de edición' : 'No se ha podido guardar en la nube');
}
async function conectarSupabase(cfg) {
  const { crear } = await import('./supa.js');
  const c = crear(cfg.supabaseUrl, cfg.supabaseClave);
  if (!(await c.sesion())) await pedirClave(c, cfg.emailEquipo);
  assets = c.assets;
  return c.db;
}
function pedirClave(c, email) {
  return new Promise(ok => {
    const pedir = msg => modal(`
      <div style="text-align:center"><img src="icons/escudo.webp" alt="" style="height:120px"></div>
      <h3 style="text-align:center">Entrar en La Farga</h3>
      <p class="muted" style="margin:0;text-align:center">${msg || 'Pon la contraseña del equipo. Solo hace falta una vez en cada móvil.'}</p>
      <label>Contraseña<input type="password" name="clave" required autocomplete="current-password"></label>
      <div class="actions"><button class="btn" value="ok">Entrar</button></div>`, async fd => {
        try { await c.entrar(email, fd.get('clave')); ok(); }
        catch (e) { setTimeout(() => pedir('Contraseña incorrecta, prueba otra vez.'), 0); }
      });
    pedir();
    document.getElementById('modal').addEventListener('cancel', e => e.preventDefault());
  });
}

async function conectarNube() {
  const cfg = window.LAFARGA || {};
  if (cfg.supabaseUrl && cfg.supabaseClave) {
    try { db = await conectarSupabase(cfg); } catch (e) { toast('No se ha podido conectar'); return; }
  } else {
    if (!window.claude || !window.claude.use) return;
    db = await window.claude.use('db');
  }
  if (!db) return;
  db = conCola(db);
  db.collection('jugadores').onSnapshot(s => { local.jugadores = s.docs.map(d => d.data()); save(); render(); }, () => {});
  db.collection('partidos').onSnapshot(s => {
    local.partidos = Object.fromEntries(s.docs.map(d => [d.id, d.data()])); save(); render();
  }, () => {});
  db.collection('porras').onSnapshot(s => { local.porras = s.docs.map(d => d.data()); save(); render(); }, () => {});
  for (const c of ['notas', 'jugadas', 'zonas']) db.collection(c).onSnapshot(s => { local[c] = s.docs.map(d => d.data()); save(); if (!document.getElementById('modal').open) render(); if (c === 'jugadas' && enlacePendiente) abrirEnlace(); }, () => {});
  db.collection('animos').onSnapshot(s => { local.animos = s.docs.map(d => d.data()); save(); pintarMuro(); }, () => {});
  db.collection('votos').onSnapshot(s => { local.votos = s.docs.map(d => d.data()); save(); render(); }, () => {});
  db.collection('fotos').onSnapshot(s => { fotos = s.docs.map(d => d.data()); render(); }, () => {});
  if (!assets && window.claude && window.claude.use) window.claude.use('assets').then(a => { assets = a; }).catch(() => {});
  db.collection('eventos').onSnapshot(s => { local.eventos = s.docs.map(d => d.data()); save(); render(); }, () => {});
  db.collection('lesiones').onSnapshot(s => { local.lesiones = s.docs.map(d => d.data()); save(); render(); }, () => {});
  db.doc('meta/borrados').onSnapshot(d => { local.borrados = (d.exists && d.data().ids) || []; save(); render(); }, () => {});
  db.doc('liga/actual').onSnapshot(d => { if (d.exists) { web = d.data(); pintarCabecera(); render(); } }, () => {});
}
function pintarCabecera() {
  if (web.grupo) document.getElementById('sub').textContent = `${web.grupo} · ${(web.competicion || '').split('(')[0].trim()}`;
}
const uid = () => Math.random().toString(36).slice(2, 9);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- Datos combinados ---------- */
function jugadores() {
  const base = (web.plantilla || []).map(p => ({ ...p, id: p.id || 'w-' + p.nombre, fuente: 'web' }));
  const ids = new Set(local.jugadores.map(j => j.id));
  const OFICIAL = ['pj', 'goles', 'amarillas', 'rojas', 'edad', 'invitado'];
  const mezcla = l => { const b = base.find(x => x.id === l.id); return b ? { ...l, ...Object.fromEntries(OFICIAL.filter(k => k in b).map(k => [k, b[k]])) } : l; };
  return [...base.filter(b => !ids.has(b.id)), ...local.jugadores.map(mezcla)]
    .sort((a, b) => (+(a.camiseta || a.dorsal) || 99) - (+(b.camiseta || b.dorsal) || 99));
}
function partidos() {
  const out = {};
  for (const p of web.partidos || []) {
    const id = p.id || `w-${p.fecha}-${p.rival}`;
    out[id] = { eventos: [], asistencia: {}, ...p, id, fuente: 'web' };
  }
  for (const [id, p] of Object.entries(local.partidos)) {
    out[id] = { ...(out[id] || {}), ...p, id, fuente: out[id] ? 'web+manual' : 'manual' };
  }
  for (const id of local.borrados) delete out[id];
  return Object.values(out).sort((a, b) => (a.fecha + (a.hora || '')).localeCompare(b.fecha + (b.hora || '')));
}
const jugado = p => p.gf !== '' && p.gf != null && p.gc !== '' && p.gc != null && p.estado !== 'aplazado';
const res = p => !jugado(p) ? null : (+p.gf > +p.gc ? 'w' : +p.gf < +p.gc ? 'l' : 'd');

function stats() {
  const t = {};
  // Los jugadores de la web traen partidos, goles y tarjetas oficiales; a mano se suman asistencias y MVP.
  const oficial = j => j.pj != null && j.goles != null;
  for (const j of jugadores()) t[j.id] = oficial(j)
    ? { j, pj: +j.pj, gol: +j.goles, asist: 0, amarilla: +j.amarillas || 0, roja: +j.rojas || 0, mvp: 0 }
    : { j, pj: 0, gol: 0, asist: 0, amarilla: 0, roja: 0, mvp: 0 };
  for (const p of partidos()) {
    if (!jugado(p)) continue;
    for (const jid of mvpDe(p.id)) if (t[jid]) t[jid].mvp++;
    for (const [jid, v] of Object.entries(p.asistencia || {})) if (v === 'si' && t[jid] && !oficial(t[jid].j)) t[jid].pj++;
    for (const e of p.eventos || []) {
      const x = t[e.jugador];
      if (x && (!oficial(x.j) || e.tipo === 'asist' || e.tipo === 'mvp')) x[e.tipo]++;
    }
  }
  return Object.values(t);
}
function resumen() {
  const ps = partidos().filter(jugado);
  const r = { pj: ps.length, g: 0, e: 0, p: 0, gf: 0, gc: 0 };
  for (const p of ps) {
    r.gf += +p.gf; r.gc += +p.gc;
    r[{ w: 'g', d: 'e', l: 'p' }[res(p)]]++;
  }
  return r;
}

/* ---------- Formato ---------- */
const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
function fFecha(f, h) {
  if (!f) return 'Sin fecha';
  const d = new Date(f + 'T12:00');
  return `${DIAS[d.getDay()]} ${d.getDate()} ${MESES[d.getMonth()]}${h ? ' · ' + h : ''}`;
}
const corto = j => j.apodo || (j.nombre || '').split(' ')[0];
const hoy = () => new Date().toISOString().slice(0, 10);

/* ---------- Vistas ---------- */
/* ---------- Lesiones ---------- */
function vuelta(l) { const d = new Date(l.desde + 'T12:00'); d.setDate(d.getDate() + 7 * l.semanas); return d; }
function lesionesActivas() {
  const h = new Date(hoy() + 'T12:00');
  return local.lesiones.filter(l => vuelta(l) > h).sort((a, b) => vuelta(a) - vuelta(b));
}
function lesionDe(jid) { return lesionesActivas().find(l => l.jugador === jid); }
function enfermeria(conBoton) {
  const ls = lesionesActivas(), js = jugadores(), h = new Date(hoy() + 'T12:00');
  if (!ls.length && !conBoton) return '';
  return `<h2>🩹 Enfermería ${conBoton ? '<button class="btn sm" data-act="nueva-lesion">+ Lesión</button>' : ''}</h2>
    ${ls.length ? ls.map(l => {
      const j = js.find(x => x.id === l.jugador) || { nombre: '¿?' };
      const llevadas = Math.max(0, Math.floor((h - new Date(l.desde + 'T12:00')) / 6048e5));
      const quedan = Math.max(1, Math.ceil((vuelta(l) - h) / 6048e5));
      const pct = Math.min(100, Math.round(llevadas / l.semanas * 100));
      const v = vuelta(l);
      return `<div class="card lesion" data-act="editar-lesion" data-id="${esc(l.id)}">
        <div class="row spread"><div><span class="apodo">${esc(corto(j))}</span> <span class="tag baja">BAJA</span>
          <div class="muted">${esc(l.nota || 'Lesión')} · vuelve aprox. ${fFecha(v.toISOString().slice(0, 10))}</div></div>
          <div style="text-align:right"><div class="big" style="font-size:34px">${quedan}</div><div class="muted">semana${quedan > 1 ? 's' : ''}</div></div></div>
        <div class="barra"><i style="width:${pct}%"></i></div>
        <div class="muted" style="font-size:12px">${llevadas} de ${l.semanas} semanas</div>
      </div>`;
    }).join('') : '<div class="card empty">Nadie lesionado. ¡Así da gusto!</div>'}`;
}
function editarLesion(id) {
  const l = id ? local.lesiones.find(x => x.id === id) : { id: 'l-' + uid(), jugador: '', desde: hoy(), semanas: 2, nota: '' };
  modal(`<h3>${id ? 'Editar lesión' : 'Nueva lesión'}</h3>
    <label>Jugador<select name="jugador" required>${jugadores().map(j => `<option value="${esc(j.id)}" ${l.jugador === j.id ? 'selected' : ''}>${esc(corto(j))}</option>`).join('')}</select></label>
    <div class="grid2"><label>Desde<input type="date" name="desde" required value="${esc(l.desde)}"></label>
      <label>Semanas de baja<input type="number" min="1" max="52" name="semanas" required value="${esc(l.semanas)}"></label></div>
    <label>Qué tiene (opcional)<input name="nota" value="${esc(l.nota || '')}" placeholder="Rodilla, tobillo..."></label>
    <div class="actions">${id ? '<button class="btn danger" value="delete" formnovalidate>Ya está bien</button>' : ''}
      <button class="btn ghost" value="cancel" formnovalidate>Cancelar</button><button class="btn" value="ok">Guardar</button></div>`,
  (fd, accion) => {
    if (accion === 'delete') return store.delLesion(l.id);
    store.setLesion({ id: l.id, jugador: fd.get('jugador'), desde: fd.get('desde'), semanas: +fd.get('semanas'), nota: fd.get('nota').trim() });
  });
}

/* ---------- MVP por votación ---------- */
function votosDe(pid) { return local.votos.filter(v => v.partido === pid); }
function mvpDe(pid) {
  const c = {};
  for (const v of votosDe(pid)) c[v.voto] = (c[v.voto] || 0) + 1;
  const max = Math.max(0, ...Object.values(c));
  return max ? Object.keys(c).filter(k => c[k] === max) : [];
}
function yoId() { try { return localStorage.getItem('lafarga.yo') || ''; } catch (e) { return ''; } }
function votacion(p) {
  if (!jugado(p)) return '';
  const js = jugadores(), yo = yoId(), vs = votosDe(p.id);
  const c = {}; vs.forEach(v => c[v.voto] = (c[v.voto] || 0) + 1);
  const mio = vs.find(v => v.votante === yo);
  const gan = mvpDe(p.id);
  return `<h3>⭐ MVP del partido</h3>
    ${gan.length ? `<p style="margin:0">Va ganando: <b class="apodo" style="font-size:18px">${gan.map(id => esc(corto(js.find(j => j.id === id) || {}))).join(' / ')}</b> <span class="muted">(${vs.length} voto${vs.length !== 1 ? 's' : ''})</span></p>` : '<p class="muted" style="margin:0">Nadie ha votado todavía.</p>'}
    <label>¿Quién eres?<select data-act="soy" >${['<option value="">Elige tu nombre</option>', ...js.map(j => `<option value="${esc(j.id)}" ${yo === j.id ? 'selected' : ''}>${esc(corto(j))}</option>`)].join('')}</select></label>
    ${yo ? `<div class="votos">${js.filter(j => j.id !== yo).map(j => `<button type="button" class="voto ${mio && mio.voto === j.id ? 'on' : ''}" data-act="votar" data-p="${esc(p.id)}" data-v="${esc(j.id)}">${j.foto ? avatar(j, 22) : ''}${esc(corto(j))}${c[j.id] ? ` <small>${c[j.id]}</small>` : ''}</button>`).join('')}</div>
      <p class="muted" style="margin:0;font-size:12px">${mio ? 'Puedes cambiar tu voto cuando quieras.' : 'Toca a quien quieras votar (no puedes votarte a ti).'}</p>` : ''}`;
}

/* ---------- Fotos ---------- */
const GALERIA_FIJA = [
  { partido: 'general', url: 'galeria/foto-equipo.webp', tipo: 'image/webp' },
  { partido: 'general', url: 'galeria/video1.mp4', tipo: 'video/mp4', poster: 'galeria/video1.webp' },
  { partido: 'general', url: 'galeria/video2.mp4', tipo: 'video/mp4', poster: 'galeria/video2.webp' },
];
function galeria(p, titulo = '<h3>📸 Fotos y vídeos</h3>') {
  const fs = [...GALERIA_FIJA.filter(f => f.partido === p.id), ...fotos.filter(f => f.partido === p.id).sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''))];
  if (!fs.length && !assets) return '';
  return `${titulo}
    ${fs.length ? `<div class="galeria">${fs.map(f => f.tipo && f.tipo.startsWith('video')
      ? `<video src="${esc(f.url)}" ${f.poster ? `poster="${esc(f.poster)}"` : ''} controls playsinline preload="${f.poster ? 'none' : 'metadata'}"></video>`
      : `<a href="${esc(f.url)}" target="_blank" rel="noopener"><img src="${esc(f.url)}" alt="Foto del partido" loading="lazy"></a>`).join('')}</div>` : '<p class="muted" style="margin:0">Aún no hay fotos de este partido.</p>'}
    ${assets ? `<label class="btn ghost sm subir">+ Subir foto o vídeo<input type="file" accept="image/*,video/*" multiple data-act="subir" data-p="${esc(p.id)}" hidden></label>` : ''}`;
}
async function subirFotos(pid, files) {
  for (const f of files) {
    try {
      toast('Subiendo…');
      const r = await assets.upload(f);
      await db.doc('fotos/' + r.id).set({ id: r.id, partido: pid, url: r.url, tipo: r.contentType, fecha: new Date().toISOString() });
    } catch (e) {
      toast(e && e.code === 'too_large' ? 'Archivo demasiado grande (máx. 20 MB)' : e && e.code === 'not_uploader' ? 'No tienes permiso para subir' : 'No se ha podido subir');
    }
  }
  toast('¡Subido!');
  if (pid === 'general') render(); else reabrir(pid);
}
function reabrir(pid) { const d = document.getElementById('modal'); if (d.open) d.close(); resumenPartido(pid); }

/* ---------- Equipos y rivales ---------- */
const slug = n => n.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
function logo(n, px = 19) {
  const src = n === EQUIPO ? 'icons/escudo.webp' : `icons/equipos/${slug(n)}.png`;
  return `<img class="logo" src="${src}" alt="" width="${px}" height="${px}" onerror="this.style.visibility='hidden'">`;
}
function formaDe(n) {
  return (web.grupo_partidos || []).filter(p => p.estado === 'jugado' && (p.local === n || p.visitante === n))
    .sort((a, b) => a.fecha.localeCompare(b.fecha)).slice(-5)
    .map(p => { const a = p.local === n ? +p.gf : +p.gc, b = p.local === n ? +p.gc : +p.gf; return a > b ? 'w' : a < b ? 'l' : 'd'; });
}
const claveG = g => `${g.fecha}|${g.local}|${g.visitante}`;
const grupoPorClave = k => (web.grupo_partidos || []).find(g => claveG(g) === k);
const pidDe = g => [g.local, g.visitante].includes(EQUIPO) ? (partidos().find(x => x.fecha === g.fecha && [g.local, g.visitante].includes(x.rival)) || {}).id || '' : '';
// Atributos para que un cuadrito abra la burbuja y, al pulsar, el partido (nuestro o de otros)
function attrsPartido(g, eq) {
  const pid = g && pidDe(g);
  if (pid) return `data-act="ver-ult" data-id="${esc(pid)}" tabindex="0" role="button"`;
  return g ? `data-act="ver-g" data-g="${esc(claveG(g))}" data-eq="${esc(eq || '')}" tabindex="0" role="button"` : '';
}
function formaListaDe(n) {
  return (web.grupo_partidos || []).filter(p => p.estado === 'jugado' && (p.local === n || p.visitante === n))
    .sort((a, b) => a.fecha.localeCompare(b.fecha)).slice(-5).map(g => ({ r: resDe(g, n), g }));
}
const formaHTML = (f, n) => `<div class="form">${f.map(o => `<i class="${o.r} clic" ${attrsPartido(o.g, n)}>${{ w: 'G', d: 'E', l: 'P' }[o.r]}</i>`).join('')}</div>`;
function fichaEquipo(n) {
  document.getElementById('modal').dataset.partido = '';
  const c = (web.clasificacion || []).find(e => e.equipo === n) || {};
  const propio = n === EQUIPO;
  const r = propio
    ? { plantilla: jugadores().filter(j => !j.invitado).map(j => ({ ...j, dorsal: j.camiseta || j.dorsal, nombre: j.apodo ? `${j.apodo} · ${j.nombre || ''}` : j.nombre, pj: j.pj || 0 })) }
    : (web.rivales || {})[n] || { plantilla: [] };
  const gp = (web.grupo_partidos || []).filter(p => p.local === n || p.visitante === n).sort((a, b) => a.fecha.localeCompare(b.fecha));
  const jug = gp.filter(p => p.estado === 'jugado'), pend = gp.filter(p => p.estado !== 'jugado');
  const nuestros = partidos().filter(p => p.rival === n);
  const goleadores = [...r.plantilla].filter(j => j.goles).sort((a, b) => b.goles - a.goles).slice(0, 5);
  const tarjetas = r.plantilla.filter(j => j.amarillas || j.rojas);
  const sanc = (web.sanciones || []).filter(x => x.equipo === n);
  const pjs = c.pj || 0;
  const fila = p => `<tr class="${[p.local, p.visitante].includes(EQUIPO) ? 'me' : ''}"><td class="muted" style="width:56px">${fFecha(p.fecha).replace(/^\S+ /, '')}</td><td>${esc(p.local === n ? p.visitante : p.local)} <span class="muted">${p.local === n ? '(L)' : '(V)'}</span></td>
    <td class="n" style="width:auto;white-space:nowrap"><b>${p.estado === 'jugado' ? (p.local === n ? `${p.gf}-${p.gc}` : `${p.gc}-${p.gf}`) : esc(p.hora || p.estado)}</b></td></tr>`;
  modalFuera = true; modal(`
    <button class="cerrar" value="cancel" formnovalidate aria-label="Cerrar">✕</button>
    <div class="marcador" style="text-align:left">
      <div class="row" style="gap:12px">${logo(n, 56)}<div><div class="eq" style="font-size:26px">${esc(n)}</div>
        <div class="muted">${c.pos ? c.pos + 'º · ' + c.pts + ' pts' : ''}</div></div></div>
      <div style="margin-top:10px">${formaHTML(formaListaDe(n), n)}</div>
    </div>
    <div class="grid3">
      <div class="kpi"><b>${c.g ?? 0}-${c.e ?? 0}-${c.p ?? 0}</b><span>G-E-P</span></div>
      <div class="kpi"><b>${pjs ? (c.gf / pjs).toFixed(1) : '–'}</b><span>Goles/partido</span></div>
      <div class="kpi"><b>${pjs ? (c.gc / pjs).toFixed(1) : '–'}</b><span>Encajados/partido</span></div>
    </div>
    ${propio ? '' : `    <h3>Contra La Farga</h3>
    ${nuestros.length ? nuestros.map(p => `<div class="row spread" style="padding:4px 0"><span>${p.jornada ? 'J' + p.jornada + ' · ' : ''}${fFecha(p.fecha, jugado(p) ? '' : p.hora)} <span class="muted">${p.local === false ? '(fuera)' : '(en casa)'}</span></span>
      <b class="score ${res(p) || ''} clic" data-act="ver-ult" data-id="${esc(p.id)}" tabindex="0" role="button" style="font-size:20px">${jugado(p) ? `${p.gf}-${p.gc}` : p.estado === 'aplazado' ? 'aplaz.' : 'pend.'}</b></div>`).join('') : '<p class="muted" style="margin:0">Sin partidos contra vosotros.</p>'}
    ${rivalesComunes(n)}
`}
    <h3>${propio ? 'Goleadores' : 'Peligro: goleadores'}</h3>
    ${goleadores.length ? `<table><tbody>${goleadores.map(j => `<tr><td class="n">${esc(j.dorsal)}</td><td>${esc(j.nombre)} <span class="muted">${esc(j.posicion || '')}</span></td><td class="n"><b>${j.goles}</b></td></tr>`).join('')}</tbody></table>` : '<p class="muted" style="margin:0">Sin goles registrados.</p>'}
    ${tarjetas.length ? `<p class="muted" style="margin:0">Tarjetas: ${tarjetas.map(j => `${esc(j.nombre.split(' ')[0])} ${'🟨'.repeat(j.amarillas)}${'🟥'.repeat(j.rojas)}`).join(' · ')}</p>` : ''}
    ${sanc.length ? `<p style="margin:0;color:var(--loss)">Sancionados: ${sanc.map(x => `${esc(x.jugador)} (${x.partidos} partido${x.partidos > 1 ? 's' : ''})`).join(', ')}</p>` : ''}
    <h3>Resultados</h3>
    ${jug.length ? `<table><tbody>${jug.map(fila).join('')}</tbody></table>` : '<p class="muted">Aún no han jugado.</p>'}
    <h3>Próximos</h3>
    ${pend.length ? `<table><tbody>${pend.slice(0, 4).map(fila).join('')}</tbody></table>` : '<p class="muted">Nada pendiente.</p>'}
    <h3>Plantilla (${r.plantilla.length})</h3>
    <table><tbody>${r.plantilla.map(j => `<tr><td class="n">${esc(j.dorsal)}</td><td>${esc(j.nombre)}</td><td class="muted" style="font-size:13px">${esc([j.posicion, j.edad ? j.edad + ' a.' : ''].filter(Boolean).join(' · '))}</td><td class="n">${j.pj} PJ</td></tr>`).join('')}</tbody></table>
    <div class="actions">${botonCompartir('e=' + n, `${n} · ficha en la app de La Farga`)}</div>
    <p class="muted" style="margin:0">Datos de Valldor · ${esc(web.actualizado || '')}</p>`, () => {});
  const dlgT = document.getElementById('modal'); dlgT.dataset.tinte = n; if (!propio) tenirFicha(n);
}

/* ---------- Gráficas ---------- */
function evolucion() {
  const gp = (web.grupo_partidos || []).filter(p => p.estado === 'jugado');
  const fechas = [...new Set(gp.map(p => p.fecha))].sort();
  const eqs = (web.clasificacion || []).map(e => e.equipo);
  const acc = Object.fromEntries(eqs.map(e => [e, { pts: 0, dg: 0, gf: 0 }]));
  const puntos = [], ordenes = [];
  for (const f of fechas) {
    for (const p of gp.filter(x => x.fecha === f)) {
      const a = +p.gf, b = +p.gc, L = acc[p.local], Vv = acc[p.visitante];
      if (!L || !Vv) continue;
      L.gf += a; Vv.gf += b; L.dg += a - b; Vv.dg += b - a;
      if (a > b) L.pts += 3; else if (a < b) Vv.pts += 3; else { L.pts++; Vv.pts++; }
    }
    const orden = [...eqs].sort((x, y) => acc[y].pts - acc[x].pts || acc[y].dg - acc[x].dg || acc[y].gf - acc[x].gf);
    puntos.push({ f, pos: orden.indexOf(EQUIPO) + 1, pts: acc[EQUIPO] ? acc[EQUIPO].pts : 0, lider: acc[orden[0]].pts, tercero: orden[2] ? acc[orden[2]].pts : 0 });
    ordenes.push(orden);
  }
  return { puntos, n: eqs.length, ordenes };
}
// Puntos de distancia con el líder y con el 3º, jornada a jornada (0 = La Farga)
function distancia(puntos) {
  if (puntos.length < 2) return '';
  const W = 320, H = 150, px = 30, py = 14;
  const d1 = puntos.map(p => p.pts - p.lider), d3 = puntos.map(p => p.pts - p.tercero);
  const max = Math.max(1, ...d1, ...d3), min = Math.min(-1, ...d1, ...d3);
  const x = i => px + 6 + i * (W - px - 30) / (puntos.length - 1);
  const y = v => py + (max - v) * (H - py * 2) / (max - min);
  const camino = arr => arr.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const ult = puntos[puntos.length - 1], gl = ult.lider - ult.pts, g3 = ult.tercero - ult.pts;
  const marcas = [...new Set([max, 0, min])];
  return `<h2>🎯 Distancia con el líder</h2>
    <div class="card grafica"><svg viewBox="0 0 ${W} ${H + 18}" width="100%" role="img" aria-label="Puntos de diferencia con el líder y el tercero">
      ${marcas.map(v => `<line x1="${px}" x2="${W - 8}" y1="${y(v)}" y2="${y(v)}" stroke="${v === 0 ? 'rgba(242,168,35,.45)' : 'var(--line)'}" stroke-width="1" ${v === 0 ? '' : 'stroke-dasharray="2 4"'}/>
        <text x="${px - 6}" y="${y(v) + 4}" text-anchor="end" font-size="10" fill="var(--muted)">${v > 0 ? '+' + v : v}</text>`).join('')}
      <path class="g-linea" pathLength="1" d="${camino(d3)}" fill="none" stroke="#9aa3ad" stroke-width="2" stroke-linejoin="round" opacity=".8"/>
      <path class="g-linea" pathLength="1" d="${camino(d1)}" fill="none" stroke="var(--loss)" stroke-width="2.5" stroke-linejoin="round"/>
      ${d1.map((v, i) => `<circle class="g-punto" style="--i:${i}" cx="${x(i)}" cy="${y(v)}" r="4" fill="var(--bg)" stroke="var(--loss)" stroke-width="2"><title>${fFecha(puntos[i].f)}: ${-v} pts del líder</title></circle>
        <text x="${x(i)}" y="${H + 14}" text-anchor="middle" font-size="10" fill="var(--muted)">${new Date(puntos[i].f + 'T12:00').getDate()}/${new Date(puntos[i].f + 'T12:00').getMonth() + 1}</text>`).join('')}
      <text x="${W - 8}" y="${y(0) - 5}" text-anchor="end" font-size="10" fill="var(--accent)">LA FARGA</text>
    </svg>
    <div class="row" style="gap:14px;font-size:12px;flex-wrap:wrap"><span><i class="ley" style="background:var(--loss)"></i>Líder: ${gl > 0 ? `a <b>${gl}</b> pts` : gl === 0 ? 'empatados' : `le sacamos ${-gl}`}</span>
      <span><i class="ley" style="background:#9aa3ad"></i>3º: ${g3 > 0 ? `a <b>${g3}</b> pts` : g3 === 0 ? 'empatados' : `le sacamos <b>${-g3}</b>`}</span></div></div>`;
}
function graficas() {
  const { puntos, n } = evolucion();
  if (puntos.length < 2) return '';
  const W = 320, H = 150, px = 30, py = 16;
  const x = i => px + 6 + i * (W - px - 30) / (puntos.length - 1);
  const y = pos => py + (pos - 1) * (H - py * 2) / Math.max(1, n - 1);
  const linea = puntos.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.pos).toFixed(1)}`).join(' ');
  const ps = partidos().filter(jugado);
  const maxG = Math.max(1, ...ps.map(p => Math.max(+p.gf, +p.gc)));
  const bw = Math.min(28, (W - 40) / Math.max(1, ps.length) / 2.4);
  return `<h2>📈 Evolución en la tabla</h2>
    <div class="card grafica"><svg viewBox="0 0 ${W} ${H + 18}" width="100%" role="img" aria-label="Posición de La Farga jornada a jornada">
      ${Array.from({ length: n }, (_, i) => `<line x1="${px}" x2="${W - 8}" y1="${y(i + 1)}" y2="${y(i + 1)}" stroke="var(--line)" stroke-width="1"/>
        <text x="${px - 8}" y="${y(i + 1) + 4}" text-anchor="end" font-size="11" fill="var(--muted)">${i + 1}º</text>`).join('')}
      <path class="g-linea" pathLength="1" d="${linea}" fill="none" stroke="var(--accent)" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>
      ${puntos.map((p, i) => `<circle class="g-punto" style="--i:${i}" cx="${x(i)}" cy="${y(p.pos)}" r="5" fill="var(--bg)" stroke="var(--accent)" stroke-width="2.5"><title>${fFecha(p.f)}: ${p.pos}º con ${p.pts} pts</title></circle>
        <text x="${x(i)}" y="${H + 14}" text-anchor="middle" font-size="10" fill="var(--muted)">${new Date(p.f + 'T12:00').getDate()}/${new Date(p.f + 'T12:00').getMonth() + 1}</text>`).join('')}
    </svg><div class="muted" style="font-size:12px">Posición tras cada viernes de liga. Ahora: ${puntos[puntos.length - 1].pos}º.</div></div>
    ${distancia(puntos)}
    <h2>⚽ Goles por partido</h2>
    <div class="card grafica"><svg viewBox="0 0 ${W} ${H + 18}" width="100%" role="img" aria-label="Goles a favor y en contra por partido">
      <line x1="10" x2="${W - 8}" y1="${H}" y2="${H}" stroke="var(--line)"/>
      ${ps.map((p, i) => { const cx = 20 + (i + .5) * (W - 30) / ps.length, h = v => v / maxG * (H - 24);
        return `<rect class="g-barra" style="--i:${i}" x="${cx - bw - 1}" y="${H - h(+p.gf)}" width="${bw}" height="${h(+p.gf)}" rx="3" fill="var(--accent)"><title>A favor: ${p.gf}</title></rect>
          <rect class="g-barra" style="--i:${i}" x="${cx + 1}" y="${H - h(+p.gc)}" width="${bw}" height="${h(+p.gc)}" rx="3" fill="var(--loss)" opacity=".75"><title>En contra: ${p.gc}</title></rect>
          <text class="g-num" style="--i:${i}" x="${cx - bw / 2 - 1}" y="${H - h(+p.gf) - 4}" text-anchor="middle" font-size="11" fill="var(--text)">${p.gf}</text>
          <text class="g-num" style="--i:${i}" x="${cx + bw / 2 + 1}" y="${H - h(+p.gc) - 4}" text-anchor="middle" font-size="11" fill="var(--text)">${p.gc}</text>
          <text x="${cx}" y="${H + 14}" text-anchor="middle" font-size="10" fill="var(--muted)">${p.jornada ? 'J' + p.jornada : ''}</text>`; }).join('')}
    </svg><div class="row" style="gap:14px;font-size:12px"><span><i class="ley" style="background:var(--accent)"></i>A favor</span><span><i class="ley" style="background:var(--loss)"></i>En contra</span></div></div>`;
}

/* ---------- Liga: goleadores, tarjetas, sanciones ---------- */
function liga() {
  const todos = [];
  for (const j of jugadores()) if (j.goles != null) todos.push({ n: corto(j), eq: EQUIPO, ...j });
  for (const [eq, r] of Object.entries(web.rivales || {})) for (const j of r.plantilla) todos.push({ n: j.nombre, eq, ...j });
  const golTodos = todos.filter(j => j.goles).sort((a, b) => b.goles - a.goles || a.pj - b.pj).map((j, i) => ({ ...j, puesto: i + 1 }));
  const gol = golTodos.filter((j, i) => i < 10 || j.eq === EQUIPO);
  const nuestros = golTodos.filter(j => j.eq === EQUIPO);
  const tar = todos.filter(j => j.amarillas || j.rojas).sort((a, b) => (b.rojas * 3 + b.amarillas) - (a.rojas * 3 + a.amarillas));
  const sanc = web.sanciones || [];
  const fila = (j, i, v) => `<tr class="${j.eq === EQUIPO ? 'me nuestro' : ''} ${j.puesto > 10 ? 'fuera-top' : ''}"><td class="n">${j.puesto || i + 1}</td><td><span class="num">${esc(j.camiseta || j.dorsal || '')}</span> ${esc(j.n)}<div class="muted" style="font-size:12px">${logo(j.eq, 14)} ${esc(j.eq)}</div></td><td class="n"><b>${v}</b></td></tr>`;
  return `<h2>🏆 Pichichi del grupo</h2>
    ${nuestros.length ? `<div class="nuestros-pich">${nuestros.map(j => `<span>${esc(j.n)} <b>${j.puesto}º</b> <small>${j.goles} ⚽</small></span>`).join('')}</div>` : ''}
    <div class="card" style="padding:4px 8px">${gol.length ? `<table><tbody>${gol.map((j, i) => (j.puesto > 10 && gol[i - 1] && gol[i - 1].puesto <= 10 ? '<tr class="sep-pich"><td colspan="3">···</td></tr>' : '') + fila(j, i, j.goles)).join('')}</tbody></table>` : '<div class="empty">Sin goles.</div>'}</div>
    <h2>🟨 Tarjetas del grupo</h2>
    <div class="card" style="padding:4px 8px">${tar.length ? `<table><tbody>${tar.map((j, i) => fila(j, i, '🟨'.repeat(j.amarillas) + '🟥'.repeat(j.rojas))).join('')}</tbody></table>` : '<div class="empty">Nadie ha visto tarjeta todavía.</div>'}</div>
    <h2>⛔ Sanciones</h2>
    <div class="card">${sanc.length ? sanc.map(x => `<div class="row spread"><span><b>${esc(x.jugador)}</b> · ${esc(x.equipo)}</span><span>${x.partidos} partido${x.partidos > 1 ? 's' : ''}</span></div>`).join('') : '<span class="muted">Nadie del grupo está sancionado. 👌</span>'}</div>`;
}

/* ---------- Día de partido ---------- */
function bannerPartido(p) {
  if (!p) return '';
  const d = Math.round((new Date(p.fecha + 'T12:00') - new Date(hoy() + 'T12:00')) / 864e5);
  if (d > 6) return '';
  const t = d === 0 ? '¡HOY JUGAMOS!' : d === 1 ? 'MAÑANA HAY PARTIDO' : `FALTAN ${d} DÍAS`;
  return `<div class="banner">${t}<small>${esc(p.hora || '')} · ${esc(p.campo || '')}</small></div>`;
}

/* ---------- Calendario personalizable ---------- */
const CAPAS = {
  farga: { nombre: 'Partidos de La Farga', color: '#f2a823', emoji: '⚽' },
  grupo: { nombre: 'Resto del grupo', color: '#7a8699', emoji: '🏟️' },
  entreno: { nombre: 'Entrenamientos', color: '#3ccf7a', emoji: '🏃' },
  evento: { nombre: 'Eventos y quedadas', color: '#b57bff', emoji: '🎉' },
  cumple: { nombre: 'Cumpleaños', color: '#ff7ab8', emoji: '🎂' },
  lesion: { nombre: 'Vuelta de lesionados', color: '#ff5a5a', emoji: '🩹' },
};
const TIPOS = { entreno: 'Entrenamiento', evento: 'Evento / quedada', cena: 'Cena / tercer tiempo', otro: 'Otro' };
let calMes = null, calDia = null;
function calPrefs() {
  let p = {};
  try { p = JSON.parse(localStorage.getItem('lafarga.cal')) || {}; } catch (e) { /* sin almacenamiento */ }
  const capas = Object.fromEntries(Object.keys(CAPAS).map(k => [k, k !== 'grupo']));
  return { vista: 'mes', lunes: true, compacto: false, ...p, capas: { ...capas, ...(p.capas || {}) }, colores: { ...(p.colores || {}) } };
}
function guardarPrefs(p) { try { localStorage.setItem('lafarga.cal', JSON.stringify(p)); } catch (e) { /* sin almacenamiento */ } }
const colorCapa = (pr, k) => pr.colores[k] || CAPAS[k].color;
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const MESES_L = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

function eventosEn(desde, hasta, pr) {
  // Devuelve { 'YYYY-MM-DD': [items] } entre dos fechas (incluidas)
  const out = {}, add = (f, it) => { if (f >= desde && f <= hasta) (out[f] = out[f] || []).push(it); };
  if (pr.capas.farga) for (const p of partidos()) if (p.fecha) {
    const r = res(p);
    add(p.fecha, { capa: 'farga', hora: jugado(p) ? '' : p.hora, titulo: `${p.local === false ? '@' : 'vs'} ${p.rival}`,
      extra: jugado(p) ? `${p.gf}-${p.gc}` : p.estado === 'aplazado' ? 'aplazado' : '', res: r, act: 'ver-partido', id: p.id, logo: p.rival });
  }
  if (pr.capas.grupo) for (const p of web.grupo_partidos || []) if (p.fecha && ![p.local, p.visitante].includes(EQUIPO))
    add(p.fecha, { capa: 'grupo', hora: p.hora, titulo: `${p.local} - ${p.visitante}`, extra: p.estado === 'jugado' ? `${p.gf}-${p.gc}` : '', act: 'ver-g', g: claveG(p) });
  for (const ev of local.eventos) {
    const capa = ev.tipo === 'entreno' ? 'entreno' : 'evento';
    if (!pr.capas[capa]) continue;
    const paso = { semanal: 7, quincenal: 14 }[ev.repetir] || 0;
    const fin = ev.repetir && ev.hasta ? ev.hasta : hasta;
    let d = new Date(ev.fecha + 'T12:00'), n = 0;
    while (iso(d) <= hasta && iso(d) <= fin && n < 400) {
      add(iso(d), { capa, hora: ev.hora, titulo: ev.titulo, extra: ev.lugar || '', color: ev.color, act: 'editar-evento', id: ev.id, emoji: ev.emoji });
      if (!paso) break; d.setDate(d.getDate() + paso); n++;
    }
  }
  if (pr.capas.cumple) for (const j of jugadores()) if (j.cumple && !j.invitado) {
    const md = j.cumple.slice(5);
    for (let y = +desde.slice(0, 4); y <= +hasta.slice(0, 4); y++) add(`${y}-${md}`, { capa: 'cumple', titulo: `Cumple de ${corto(j)}`, extra: `${y - +j.cumple.slice(0, 4)} años`, act: 'editar-jugador', id: j.id });
  }
  if (pr.capas.lesion) for (const l of lesionesActivas()) {
    const j = jugadores().find(x => x.id === l.jugador);
    add(iso(vuelta(l)), { capa: 'lesion', titulo: `Vuelve ${j ? corto(j) : '¿?'}`, act: 'editar-lesion', id: l.id });
  }
  for (const k in out) out[k].sort((a, b) => (a.hora || '99').localeCompare(b.hora || '99'));
  return out;
}

function chip(it, pr, largo) {
  const c = it.color || colorCapa(pr, it.capa);
  const emoji = it.emoji || CAPAS[it.capa].emoji;
  if (!largo) return `<span class="chip ${it.res ? 'r-' + it.res : ''}" style="--c:${esc(c)}">${it.capa === 'farga' && it.logo ? logo(it.logo, 12) : emoji}<span>${esc(it.capa === 'farga' ? it.titulo.replace(/^(vs|@) /, '') : it.titulo)}</span></span>`;
  const dataExtra = it.g ? `data-g="${esc(it.g)}" data-eq=""` : it.eq ? `data-eq="${esc(it.eq)}"` : `data-id="${esc(it.id || '')}"`;
  return `<div class="agenda-item" style="--c:${esc(c)}" data-act="${it.act}" ${dataExtra}>
    <span class="hora">${esc(it.hora || '—')}</span>
    <span class="barra-c"></span>
    <div style="flex:1;min-width:0"><b>${it.capa === 'farga' && it.logo ? logo(it.logo, 16) + ' ' : emoji + ' '}${esc(it.titulo)}</b>
      ${it.extra ? `<div class="muted" style="font-size:13px">${esc(it.extra)}</div>` : ''}<div class="muted" style="font-size:11px">${esc(CAPAS[it.capa].nombre)}</div></div>
    ${it.res ? `<span class="score ${it.res}" data-act="ver-ult" data-id="${esc(it.id)}" style="font-size:18px">${{ w: 'G', d: 'E', l: 'P' }[it.res]}</span>` : ''}</div>`;
}

function calendario(pr) {
  const h = hoy();
  if (!calMes) calMes = h.slice(0, 7);
  if (!calDia) calDia = h;
  const [y, m] = calMes.split('-').map(Number);
  let celdas = [], titulo;
  if (pr.vista === 'semana') {
    const d = new Date(calDia + 'T12:00'), dow = (d.getDay() + (pr.lunes ? 6 : 0)) % 7;
    d.setDate(d.getDate() - dow);
    for (let i = 0; i < 7; i++) { celdas.push(iso(d)); d.setDate(d.getDate() + 1); }
    titulo = `Semana del ${fFecha(celdas[0]).replace(/^\S+ /, '')}`;
  } else {
    const primero = new Date(y, m - 1, 1, 12), dow = (primero.getDay() + (pr.lunes ? 6 : 0)) % 7;
    const d = new Date(primero); d.setDate(1 - dow);
    for (let i = 0; i < 42; i++) { celdas.push(iso(d)); d.setDate(d.getDate() + 1); }
    if (celdas.slice(35).every(c => c.slice(0, 7) !== calMes)) celdas = celdas.slice(0, 35);
    titulo = `${MESES_L[m - 1].toLowerCase()} de ${y}`;
  }
  const ev = eventosEn(celdas[0], celdas[celdas.length - 1], pr);
  const dias = pr.lunes ? ['L', 'M', 'X', 'J', 'V', 'S', 'D'] : ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
  const max = pr.compacto ? 0 : 3;
  const delDia = ev[calDia] || [];
  return `
    <div class="card cal">
      <button class="cal-cabecera" data-act="cal-hoy">${new Date(h + "T12:00").toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" })}</button>
      <div class="row spread cal-nav">
        <div class="cal-titulo">${titulo}</div>
        <div class="row" style="gap:4px">
          <button class="icon-btn" data-act="cal-mover" data-v="-1" aria-label="Anterior">▲</button>
          <button class="icon-btn" data-act="cal-mover" data-v="1" aria-label="Siguiente">▼</button>
        </div>
      </div>
      <div class="cal-grid ${pr.vista === 'semana' ? 'semana' : ''}">
        ${dias.map((d, i) => `<div class="cal-dow ${d === 'V' ? 'vie' : ''}">${d}</div>`).join('')}
        ${celdas.map(f => {
          const its = ev[f] || [], fuera = pr.vista === 'mes' && f.slice(0, 7) !== calMes;
          const partido = its.find(i => i.capa === 'farga');
          return `<button class="cal-dia ${fuera ? 'fuera' : ''} ${f === h ? 'hoy' : ''} ${f === calDia ? 'sel' : ''} ${partido ? 'jugamos' : ''} ${partido && partido.res ? 'r-' + partido.res : ''}" data-act="cal-dia" data-v="${f}" ${partido ? `data-pid="${esc(partido.id)}"` : ''}>
            <span class="num-dia">${+f.slice(8)}</span>${partido && partido.res ? `<span class="cal-marc">${esc(partido.extra)}</span>` : ''}
            ${max ? its.slice(0, max).map(i => chip(i, pr)).join('') + (its.length > max ? `<span class="mas">+${its.length - max}</span>` : '')
              : `<span class="puntos">${its.slice(0, 4).map(i => `<i style="background:${esc(i.color || colorCapa(pr, i.capa))}"></i>`).join('')}</span>`}
          </button>`;
        }).join('')}
      </div>
      <div class="cal-leyenda">${Object.keys(CAPAS).filter(k => pr.capas[k]).map(k => `<span><i style="background:${esc(colorCapa(pr, k))}"></i>${CAPAS[k].nombre}</span>`).join('')}</div>
    </div>
    <h2>${fFecha(calDia)} <span class="row" style="gap:6px"><button class="btn ghost sm" data-act="cal-ajustes">🎨 Personalizar</button><button class="btn sm" data-act="nuevo-evento" data-v="${calDia}">+ Evento</button></span></h2>
    <div class="agenda-dia" data-dia="${calDia}">${delDia.length ? delDia.map((i, k) => chip(i, pr, true).replace('class="agenda-item"', `class="agenda-item" style="--k:${k}"`).replace('" style="--k:' + k + '" style="', '" style="--k:' + k + ';')).join('') : '<div class="card empty" style="padding:16px">Nada este día.</div>'}</div>`;
}

function editarEvento(id, fecha) {
  const ev = id ? local.eventos.find(x => x.id === id) : { id: 'e-' + uid(), titulo: '', tipo: 'entreno', fecha: fecha || hoy(), hora: '21:00', lugar: '', color: '', repetir: '', hasta: '', nota: '', emoji: '' };
  if (!ev) return;
  modal(`
    <button class="cerrar" value="cancel" formnovalidate aria-label="Cerrar">✕</button>
    <h3 style="margin-left:34px">${id ? 'Editar evento' : 'Nuevo evento'}</h3>
    <label>Qué es<input name="titulo" required value="${esc(ev.titulo)}" placeholder="Entreno, cena de equipo, torneo..."></label>
    <div class="grid2">
      <label>Tipo<select name="tipo">${Object.entries(TIPOS).map(([k, t]) => `<option value="${k}" ${ev.tipo === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label>Emoji<input name="emoji" maxlength="4" value="${esc(ev.emoji || '')}" placeholder="🍕"></label>
    </div>
    <div class="grid2">
      <label>Fecha<input type="date" name="fecha" required value="${esc(ev.fecha)}"></label>
      <label>Hora<input type="time" name="hora" value="${esc(ev.hora || '')}"></label>
    </div>
    <label>Dónde<input name="lugar" value="${esc(ev.lugar || '')}" placeholder="Sant Ildefons, bar..."></label>
    <div class="grid2">
      <label>Repetir<select name="repetir">${[['', 'No se repite'], ['semanal', 'Cada semana'], ['quincenal', 'Cada 2 semanas']].map(([k, t]) => `<option value="${k}" ${ev.repetir === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label>Hasta<input type="date" name="hasta" value="${esc(ev.hasta || '')}"></label>
    </div>
    <label>Color<input type="color" name="color" value="${esc(ev.color || CAPAS[ev.tipo === 'entreno' ? 'entreno' : 'evento'].color)}"></label>
    <label>Notas<textarea name="nota" rows="2">${esc(ev.nota || '')}</textarea></label>
    <div class="actions">
      ${id ? '<button class="btn danger" value="delete" formnovalidate>Borrar</button>' : ''}
      <button class="btn" value="ok">Guardar</button>
    </div>`, (fd, accion) => {
    if (accion === 'delete') return store.delEvento(ev.id);
    const v = k => (fd.get(k) || '').trim();
    calDia = v('fecha'); calMes = calDia.slice(0, 7);
    store.setEvento({ id: ev.id, titulo: v('titulo'), tipo: v('tipo'), emoji: v('emoji'), fecha: v('fecha'), hora: v('hora'), lugar: v('lugar'),
      repetir: v('repetir'), hasta: v('hasta'), color: v('color'), nota: v('nota') });
  });
}

function ajustesCalendario() {
  const pr = calPrefs();
  modal(`
    <button class="cerrar" value="cancel" formnovalidate aria-label="Cerrar">✕</button>
    <h3 style="margin-left:34px">Personalizar calendario</h3>
    <p class="muted" style="margin:0">Elige qué ver y de qué color. Se guarda en este móvil.</p>
    ${Object.entries(CAPAS).map(([k, c]) => `<div class="row spread capa">
      <label class="row" style="flex-direction:row;gap:10px;color:var(--text);font-size:15px"><input type="checkbox" name="capa_${k}" ${pr.capas[k] ? 'checked' : ''} style="width:20px;height:20px">${c.emoji} ${c.nombre}</label>
      <input type="color" name="color_${k}" value="${esc(colorCapa(pr, k))}" style="width:44px;height:32px;padding:2px"></div>`).join('')}
    <label class="row" style="flex-direction:row;gap:10px;color:var(--text);font-size:15px"><input type="checkbox" name="lunes" ${pr.lunes ? 'checked' : ''} style="width:20px;height:20px">La semana empieza en lunes</label>
    <label class="row" style="flex-direction:row;gap:10px;color:var(--text);font-size:15px"><input type="checkbox" name="compacto" ${pr.compacto ? 'checked' : ''} style="width:20px;height:20px">Vista compacta (solo puntos de color)</label>
    <button type="button" class="btn ghost" id="ics">📲 Pasar los partidos al calendario del móvil</button>
    <div class="actions"><button class="btn ghost" value="reset" formnovalidate>Colores de serie</button><button class="btn" value="ok">Guardar</button></div>`, (fd, accion) => {
    const n = calPrefs();
    if (accion === 'reset') { n.colores = {}; guardarPrefs(n); return render(); }
    for (const k of Object.keys(CAPAS)) { n.capas[k] = fd.get('capa_' + k) === 'on'; const c = fd.get('color_' + k); if (c && c !== CAPAS[k].color) n.colores[k] = c; else delete n.colores[k]; }
    n.lunes = fd.get('lunes') === 'on'; n.compacto = fd.get('compacto') === 'on';
    guardarPrefs(n); render();
  });
  document.getElementById('ics').onclick = () => exportarICS();
}

function exportarICS(soloId) {
  const f = s => s.replace(/[\\,;]/g, m => '\\' + m).replace(/\n/g, '\\n');
  const lin = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//La Farga FC//App//ES', 'X-WR-CALNAME:La Farga FC', 'X-WR-TIMEZONE:Europe/Madrid'];
  const add = (uid_, fecha, hora, titulo, lugar, dur = 60) => {
    if (!fecha) return;
    const d = fecha.replace(/-/g, '');
    lin.push('BEGIN:VEVENT', `UID:${uid_}@lafarga`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`);
    if (/^\d\d:\d\d$/.test(hora || '')) {
      const [hh, mm] = hora.split(':').map(Number), fin = hh * 60 + mm + dur;
      lin.push(`DTSTART;TZID=Europe/Madrid:${d}T${hora.replace(':', '')}00`, `DTEND;TZID=Europe/Madrid:${d}T${String(Math.floor(fin / 60) % 24).padStart(2, '0')}${String(fin % 60).padStart(2, '0')}00`);
    } else lin.push(`DTSTART;VALUE=DATE:${d}`);
    lin.push(`SUMMARY:${f(titulo)}`); if (lugar) lin.push(`LOCATION:${f(lugar)}`);
    lin.push('BEGIN:VALARM', 'TRIGGER:-PT3H', 'ACTION:DISPLAY', `DESCRIPTION:${f(titulo)}`, 'END:VALARM', 'END:VEVENT');
  };
  for (const p of partidos()) if (!jugado(p) && p.estado !== 'aplazado' && (!soloId || p.id === soloId)) add(p.id, p.fecha, p.hora, `⚽ ${p.local === false ? p.rival + ' - La Farga' : 'La Farga - ' + p.rival}`, p.campo, 60);
  if (!soloId) for (const e of local.eventos) if (!e.repetir) add(e.id, e.fecha, e.hora, e.titulo, e.lugar, 90);
  lin.push('END:VCALENDAR');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([lin.join('\r\n')], { type: 'text/calendar' }));
  const uno = soloId && getPartido(soloId); a.download = uno ? `la-farga-${slug(uno.rival)}.ics` : 'la-farga.ics'; document.body.appendChild(a); a.click(); a.remove();
  toast('Abre el archivo para añadirlo a tu calendario');
}

/* ---------- Resumen de partido ---------- */
const ICO = { gol: '⚽', amarilla: '🟨', roja: '🟥', propia: '⚽ (p.p.)', asist: '🅰️', mvp: '⭐' };
// Marcador mecánico: cada cifra es un rodillo que gira hasta su número
const rodillo = t => String(t).split('').map(ch => /\d/.test(ch)
  ? `<span class="rueda" style="--v:${ch}" aria-hidden="true"><span>${'01234567890123456789'.split('').map(d => `<i>${d}</i>`).join('')}</span></span>`
  : `<span class="r-sep">${esc(ch)}</span>`).join('') + `<span class="sr">${esc(t)}</span>`;
function resumenPartido(id) {
  const p = getPartido(id), js = jugadores();
  document.getElementById('modal').dataset.partido = id;
  const nom = jid => { const j = js.find(x => x.id === jid); return j ? corto(j) : '¿?'; };
  const r = res(p);
  const izq = p.local === false ? p.rival : 'La Farga', der = p.local === false ? 'La Farga' : p.rival;
  const marc = jugado(p) ? (p.local === false ? `${p.gc} - ${p.gf}` : `${p.gf} - ${p.gc}`) : (p.estado === 'aplazado' ? 'APLAZADO' : (p.hora || 'vs'));
  const ev = (p.eventos_web || []).map(e => ({ ...e, quien: e.nuestro ? (e.jugador_id ? nom(e.jugador_id) : e.jugador) : e.jugador }));
  const manual = (p.eventos || []).filter(e => !ev.length || e.tipo === 'asist' || e.tipo === 'mvp');
  const goles = ev.filter(e => e.tipo === 'gol' || e.tipo === 'propia').length;
  const nuestrosGoles = ev.filter(e => e.nuestro && e.tipo === 'gol').length;
  const sinAutor = jugado(p) ? +p.gf - nuestrosGoles - manual.filter(e => e.tipo === 'gol').length : 0;
  const conv = (p.convocados || []).map(n => { const j = js.find(x => x.nombre.startsWith(n.split(' ')[0]) && n.split(' ').slice(0, 2).every(w => x.nombre.includes(w))); return j ? corto(j) : n; });
  const noj = (p.no_juegan || []).map(n => { const j = js.find(x => x.nombre.startsWith(n.split(' ')[0]) && n.split(' ').slice(0, 2).every(w => x.nombre.includes(w))); return j ? corto(j) : n; });
  modalFuera = true; modal(`
    <div class="marcador ${r || ''}">
      <div class="muted">${p.jornada ? 'Jornada ' + p.jornada + ' · ' : ''}${fFecha(p.fecha, jugado(p) ? '' : p.hora)}</div>
      <div class="row spread" style="margin-top:8px"><b class="eq">${esc(izq)}</b><span class="res">${jugado(p) ? rodillo(marc) : esc(marc)}</span><b class="eq" style="text-align:right">${esc(der)}</b></div>
      <div class="muted" style="margin-top:6px">${esc(p.campo || '')}</div>
      ${r ? `<div class="veredicto">${{ w: 'VICTORIA', d: 'EMPATE', l: 'DERROTA' }[r]}</div>` : ''}
    </div>
    ${ev.length ? `<h3>Minuto a minuto</h3><div class="timeline">${ev.map(e => `
      <div class="ev-row ${e.lado === 'local' ? 'izq' : 'der'} ${e.nuestro ? 'nos' : ''}">
        <span class="min">${esc(e.min)}'</span><span>${ICO[e.tipo] || e.tipo} ${esc(e.quien)}</span></div>`).join('')}</div>` : ''}
    ${manual.length ? `<h3>Apuntado por el equipo</h3>${manual.map(e => `<div class="row" style="gap:8px">${ICO[e.tipo] || e.tipo} ${esc(nom(e.jugador))}</div>`).join('')}` : ''}
    ${sinAutor > 0 ? `<p class="muted">${sinAutor} gol${sinAutor > 1 ? 'es' : ''} de La Farga sin goleador en el acta.</p>` : ''}
    ${jugado(p) && !ev.length && !manual.length ? '<p class="muted">El acta de Valldor no trae goleadores de este partido.</p>' : ''}
    ${votacion(p)}
    ${notasCard(p)}
    ${zonasCard(p)}
    ${porraResumen(p)}
    ${!jugado(p) && p.estado !== 'aplazado' ? `<button type="button" class="btn ghost sm" style="margin-top:10px" data-act="ics" data-id="${esc(p.id)}">📅 Añadir al calendario del móvil</button>` : ''}
    ${porteroSel(p)}
    ${galeria(p)}
    ${conv.length ? `<h3>Jugaron (${conv.length})</h3><p style="margin:0">${conv.map(esc).join(' · ')}</p>` : ''}
    ${noj.length ? `<p class="muted" style="margin:4px 0 0">No jugaron: ${noj.map(esc).join(' · ')}</p>` : ''}
    ${p.acta ? `<p class="muted" style="margin:0"><a style="color:var(--accent)" target="_blank" rel="noopener" href="https://virtual.fundaciovalldor7.com/cornella-hospitalet-f7-es-26-27/partido/${esc(p.acta)}">Ver acta en Valldor ↗</a></p>` : ''}
    <div class="actions">
      ${botonCompartir('p=' + id, `La Farga vs ${p.rival} · ${fFecha(p.fecha)}`)}
      <button class="btn ghost" value="editar" formnovalidate>Editar / añadir asistencias</button>
      <button class="btn" value="cancel" formnovalidate>Cerrar</button>
    </div>`, (fd, accion) => { if (accion === 'editar') setTimeout(() => editarPartido(id), 0); });
  if (r === 'w' && !resumenPartido.visto?.has(id)) { (resumenPartido.visto ||= new Set()).add(id); setTimeout(confeti, 450); }
}

// Victorias seguidas más recientes de La Farga
const rachaDe = ps => { let n = 0; for (const p of ps.filter(jugado).reverse()) { if (res(p) !== 'w') break; n++; } return n; };
function rachaHTML(ps) {
  const n = rachaDe(ps); if (n < 2) return '';
  return `<div class="card racha"><span class="llamas" aria-hidden="true"><i></i><i></i><i></i></span>
    <div><b><span class="cnt">${n}</span> victorias seguidas</b><span class="muted">La forja está al rojo vivo</span></div></div>`;
}
// Progreso de la temporada: partidos jugados sobre el total del calendario
function temporada(ps) {
  const tot = ps.length, jug = ps.filter(jugado).length; if (!tot) return '';
  const pct = Math.round(jug / tot * 100);
  return `<div class="card temporada"><div class="row spread"><span class="muted">Temporada</span><span><b class="cnt">${jug}</b><span class="muted"> / ${tot} partidos · </span><b>${pct}%</b></span></div>
    <div class="t-barra"><i style="--p:${pct / 100}"></i>${ps.map((p, k) => `<span class="t-marca ${jugado(p) ? res(p) : ''}" style="left:${(k + .5) / tot * 100}%"></span>`).join('')}</div></div>`;
}
// Instalar la app: botón nativo en Android/Chrome, instrucciones en iPhone
let avisoInstalar = null;
const instalada = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const esIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
addEventListener('beforeinstallprompt', e => { e.preventDefault(); avisoInstalar = e; if (tab === 'inicio') render(); });
addEventListener('appinstalled', () => { avisoInstalar = null; if (tab === 'inicio') render(); });
function instalarCard() {
  let oculto = false; try { oculto = localStorage.getItem('lafarga-no-instalar') === '1'; } catch (e) {}
  if (instalada() || oculto || (!avisoInstalar && !esIOS())) return '';
  return `<div class="card instalar"><img src="icons/icon-192.png" alt="" width="44" height="44">
    <div><b>Instala La Farga</b><span class="muted">${avisoInstalar ? 'Ábrela como una app, a pantalla completa y sin navegador.' : 'Toca Compartir <svg viewBox="0 0 24 24" aria-hidden="true" class="ico-compartir"><path d="M12 3v12M7 8l5-5 5 5"/><path d="M5 12v8h14v-8"/></svg> y luego «Añadir a pantalla de inicio».'}</span></div>
    ${avisoInstalar ? '<button class="btn sm" data-act="instalar">Instalar</button>' : ''}
    <button class="cerrar-mini" data-act="no-instalar" aria-label="No mostrar más">✕</button></div>`;
}
// Previa del próximo partido: tiempo a la hora del partido + historial contra el rival
const CAMPOS = { 'UE Sant Ildefons': [41.3566, 2.0748], 'CD Almeda': [41.3537, 2.0905], 'Promosportive': [41.3627, 2.1093] };
const coordsCampo = c => (Object.entries(CAMPOS).find(([k]) => (c || '').includes(k)) || [0, [41.3557, 2.0703]])[1];
const CIELO = [[[0], '☀️', 'Despejado'], [[1, 2], '🌤️', 'Poco nuboso'], [[3], '☁️', 'Nublado'], [[45, 48], '🌫️', 'Niebla'],
  [[51, 53, 55, 56, 57], '🌦️', 'Llovizna'], [[61, 63, 65, 66, 67], '🌧️', 'Lluvia'], [[71, 73, 75, 77, 85, 86], '❄️', 'Nieve'],
  [[80, 81, 82], '🌧️', 'Chubascos'], [[95, 96, 99], '⛈️', 'Tormenta']];
const tiempoCache = {};
function previa(p) {
  const rival = p.rival;
  const previos = [
    ...partidos().filter(x => x.rival === rival && jugado(x) && x.id !== p.id).map(x => ({ fecha: x.fecha, a: +x.gf, b: +x.gc, id: x.id })),
    ...(web.grupo_partidos || []).filter(x => x.estado === 'jugado' && [x.local, x.visitante].includes(EQUIPO) && [x.local, x.visitante].includes(rival))
      .map(x => ({ fecha: x.fecha, a: x.local === EQUIPO ? +x.gf : +x.gc, b: x.local === EQUIPO ? +x.gc : +x.gf, g: x }))
  ].filter((x, i, arr) => arr.findIndex(y => y.fecha === x.fecha) === i).sort((a, b) => b.fecha.localeCompare(a.fecha));
  const bal = { w: 0, d: 0, l: 0 }; previos.forEach(x => bal[x.a > x.b ? 'w' : x.a < x.b ? 'l' : 'd']++);
  const cl = (web.clasificacion || []).find(c => c.equipo === rival);
  setTimeout(() => cargarTiempo(p), 0);
  return `<div class="card previa">
    <div class="tiempo" data-tiempo="${esc(p.id)}"><span class="muted">Consultando el tiempo…</span></div>
    <div class="h2h">
      <div class="row spread"><span class="muted">Contra ${esc(rival)}</span>${cl ? `<span class="muted">${cl.pos}º · ${cl.pts} pts</span>` : ''}</div>
      ${previos.length ? `<div class="row spread" style="margin-top:6px"><b class="h2h-bal"><span class="w">${bal.w}G</span> <span class="d">${bal.d}E</span> <span class="l">${bal.l}P</span></b>
        <span class="h2h-res">${previos.slice(0, 4).map(x => `<i class="${x.a > x.b ? 'w' : x.a < x.b ? 'l' : 'd'} clic" ${x.id ? `data-act="ver-ult" data-id="${esc(x.id)}" tabindex="0" role="button"` : attrsPartido(x.g, EQUIPO)}>${x.a}-${x.b}</i>`).join('')}</span></div>`
        : `<div style="margin-top:6px"><b>Primer enfrentamiento</b> <span class="muted">· aún no hemos jugado contra ellos</span></div>`}
      ${formaDe(rival).length ? `<div class="row spread" style="margin-top:8px"><span class="muted">Su forma</span>${formaHTML(formaListaDe(rival), rival)}</div>` : ''}
    </div>${probabilidad(rival)}${versus(rival)}${peligrosos(rival)}</div>`;
}
// Jugadores del rival a vigilar: goleadores y tarjetas, según Valldor
function peligrosos(rival) {
  const pl = ((web.rivales || {})[rival] || {}).plantilla || [];
  const sanc = (web.sanciones || []).filter(x => x.equipo === rival);
  const gol = pl.filter(j => +j.goles > 0).sort((a, b) => b.goles - a.goles).slice(0, 3);
  const tarj = pl.filter(j => +j.amarillas >= 2 || +j.rojas > 0).sort((a, b) => (b.rojas * 3 + b.amarillas) - (a.rojas * 3 + a.amarillas)).slice(0, 3);
  if (!gol.length && !tarj.length && !sanc.length) return '';
  const nom = j => esc(j.nombre.split(' ').slice(0, 2).join(' '));
  const fila = (j, extra) => `<div class="pel"><span class="pel-d">${esc(j.dorsal || '–')}</span><span class="pel-n">${nom(j)}</span>${extra}</div>`;
  return `<div class="peligro"><div class="muted" style="margin-bottom:6px">⚠️ A vigilar</div>
    ${gol.map(j => fila(j, `<b class="pel-v">${j.goles} ⚽</b><span class="muted pel-x">${j.pj ? (j.goles / j.pj).toFixed(1) + '/p' : ''}</span>`)).join('')}
    ${tarj.filter(j => !gol.includes(j)).map(j => fila(j, `<b class="pel-v">${'🟨'.repeat(Math.min(+j.amarillas, 3))}${'🟥'.repeat(+j.rojas || 0)}</b><span class="muted pel-x">${+j.amarillas >= 4 ? 'cerca de sanción' : ''}</span>`)).join('')}
    ${sanc.map(x => `<div class="pel"><span class="pel-d">⛔</span><span class="pel-n">${esc(x.jugador || x.nombre || '')}</span><span class="muted pel-x">sancionado</span></div>`).join('')}
  </div>`;
}
// Nosotros contra ellos, en barras enfrentadas
function versus(rival) {
  const c = web.clasificacion || [], a = c.find(e => e.equipo === EQUIPO), b = c.find(e => e.equipo === rival);
  if (!a || !b || !a.pj || !b.pj) return '';
  const fp = n => { const f = formaDe(n); return f.length ? f.reduce((s, r) => s + (r === 'w' ? 3 : r === 'd' ? 1 : 0), 0) / f.length : 0; };
  const m = [
    ['Goles por partido', a.gf / a.pj, b.gf / b.pj, true],
    ['Encajados por partido', a.gc / a.pj, b.gc / b.pj, false],
    ['Puntos por partido', a.pts / a.pj, b.pts / b.pj, true],
    ['Forma (últimos 5)', fp(EQUIPO), fp(rival), true],
  ];
  return `<div class="versus"><div class="vs-cab"><span>${logo(EQUIPO, 22)} Nosotros</span><span>Ellos ${logo(rival, 22)}</span></div>
    ${m.map(([t, x, y, masMejor], k) => {
      const max = Math.max(x, y, .01), gana = x === y ? '' : (x > y) === masMejor ? 'nos' : 'ellos';
      return `<div class="vs-fila ${gana}" style="--k:${k}"><b class="vs-n">${x.toFixed(1)}</b>
        <span class="vs-barra izq"><i style="--p:${x / max}"></i></span><span class="vs-t">${t}</span><span class="vs-barra der"><i style="--p:${y / max}"></i></span>
        <b class="vs-n">${y.toFixed(1)}</b></div>`;
    }).join('')}</div>`;
}
async function cargarTiempo(p) {
  const pinta = html => { const el = document.querySelector(`[data-tiempo="${CSS.escape(p.id)}"]`); if (el) el.innerHTML = html; };
  const dias = Math.round((new Date(p.fecha) - new Date(hoy())) / 864e5);
  if (dias > 15) return pinta(`<span class="muted">🌡️ La previsión del tiempo sale ${dias - 15} día${dias - 15 > 1 ? 's' : ''} antes de lo que queda… vuelve más cerca del partido.</span>`);
  const [lat, lon] = coordsCampo(p.campo), key = `${p.fecha}|${lat}`;
  try {
    if (!tiempoCache[key] || Date.now() - tiempoCache[key].t > 36e5) {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m,precipitation_probability,weather_code,wind_speed_10m&timezone=Europe%2FMadrid&start_date=${p.fecha}&end_date=${p.fecha}`;
      const r = await fetch(url); if (!r.ok) throw 0;
      tiempoCache[key] = { t: Date.now(), d: await r.json() };
    }
    const h = tiempoCache[key].d.hourly, hora = (([hh, mm]) => Math.min(23, Math.round(+hh + (+mm || 0) / 60)))((p.hora || '21:00').split(':'));
    const i = Math.max(0, h.time.findIndex(t => +t.slice(11, 13) === hora));
    const c = CIELO.find(x => x[0].includes(h.weather_code[i])) || [0, '🌡️', ''];
    const noche = hora >= 20 || hora < 7, ico = noche && c[1] === '☀️' ? '🌙' : noche && c[1] === '🌤️' ? '☁️' : c[1];
    const lluvia = h.precipitation_probability[i];
    pinta(`<span class="t-ico">${ico}</span><div><b><span class="cnt">${Math.round(h.temperature_2m[i])}</span>°C</b> <span class="muted">${esc(noche && c[1] === '☀️' ? 'Noche despejada' : c[2])} a las ${esc(p.hora || '')}</span>
      <div class="muted" style="font-size:12px">💧 ${lluvia ?? '–'}% lluvia · 💨 ${Math.round(h.wind_speed_10m[i])} km/h${lluvia >= 50 ? ' · <span style="color:var(--accent);font-weight:700">trae chubasquero</span>' : ''}</div></div>`);
    const el = document.querySelector(`[data-tiempo="${CSS.escape(p.id)}"]`); if (el) contar(el);
  } catch (e) { const el = document.querySelector(`[data-tiempo="${CSS.escape(p.id)}"]`); if (el) el.remove(); }
}
// Podio de la temporada: oro, plata y bronce por categoría
let podioCat = 'gol';
const PODIO = [['gol', '⚽ Goles'], ['asist', '🅰️ Asist.'], ['mvp', '⭐ MVP']];
function podio(s = stats()) {
  const top = s.filter(x => x[podioCat]).sort((a, b) => b[podioCat] - a[podioCat]).slice(0, 3);
  const orden = [1, 0, 2].map(i => [i, top[i]]).filter(([, x]) => x);
  return `<div class="card podio-card" id="podio"><div class="seg">${PODIO.map(([k, t]) =>
      `<button data-act="podio" data-v="${k}" class="${podioCat === k ? 'on-cal' : ''}">${t}</button>`).join('')}</div>
    ${top.length ? `<div class="podio">${orden.map(([i, x]) => `<div class="p-col p${i + 1}" style="--k:${[1, 0, 2].indexOf(i)}">
        <div class="p-quien">${avatar(x.j, i ? 46 : 60)}<span class="medalla">${['🥇', '🥈', '🥉'][i]}</span></div>
        <b class="p-nom">${esc(corto(x.j))}</b>
        <div class="p-caja"><b class="cnt">${x[podioCat]}</b><span>${i + 1}º</span></div></div>`).join('')}</div>`
      : '<div class="empty" style="padding:18px 0">Aún no hay datos para el podio.</div>'}</div>`;
}
/* ---------- Porra: cada uno apuesta el marcador antes del partido ---------- */
const porrasDe = pid => local.porras.filter(v => v.partido === pid);
const signo = (a, b) => Math.sign(a - b);
const primerGol = p => { const g = (p.eventos_web || []).filter(e => e.nuestro && e.tipo === 'gol').sort((a, b) => parseInt(a.min, 10) - parseInt(b.min, 10))[0]; return g ? g.jugador_id || '' : ''; };
const puntosPorra = (v, p) => !jugado(p) ? 0 : (+v.gf === +p.gf && +v.gc === +p.gc ? 3 : signo(+v.gf, +v.gc) === signo(+p.gf, +p.gc) ? 1 : 0) + (v.primero && v.primero === primerGol(p) ? 2 : 0);
const empezado = p => Date.now() >= instanteMadrid(p.fecha, p.hora);
let porraBorrador = {};
function porraCard(p) {
  const js = jugadores(), yo = yoId(), vs = porrasDe(p.id), mio = vs.find(v => v.jugador === yo);
  const cerrada = empezado(p);
  const b = porraBorrador[p.id] || (mio ? { gf: +mio.gf, gc: +mio.gc } : { gf: 2, gc: 1 });
  const nom = id => esc(corto(js.find(j => j.id === id) || { nombre: '¿?' }));
  const paso = (lado, v) => `<div class="porra-paso"><button type="button" data-act="porra-mas" data-p="${esc(p.id)}" data-l="${lado}" data-d="-1" ${cerrada ? 'disabled' : ''} aria-label="Menos">−</button>
    <b>${v}</b><button type="button" data-act="porra-mas" data-p="${esc(p.id)}" data-l="${lado}" data-d="1" ${cerrada ? 'disabled' : ''} aria-label="Más">+</button></div>`;
  return `<div class="card porra"><div class="row spread"><b>🎯 Porra</b><span class="muted">${vs.length} apuesta${vs.length !== 1 ? 's' : ''}</span></div>
    ${!yo ? `<label>¿Quién eres?<select data-act="soy"><option value="">Elige tu nombre</option>${js.map(j => `<option value="${esc(j.id)}">${esc(corto(j))}</option>`).join('')}</select></label>`
      : cerrada ? `<p class="muted" style="margin:6px 0 0">Porra cerrada: el partido ya ha empezado.</p>`
      : `<div class="porra-marcador"><div class="porra-eq"><img class="logo" src="icons/escudo.webp" alt="" width="30" height="30"><span>La Farga</span></div>${paso('gf', b.gf)}<em>-</em>${paso('gc', b.gc)}<div class="porra-eq">${logo(p.rival, 30)}<span>${esc(p.rival)}</span></div></div>
        <label class="porra-primero">Primer goleador de La Farga <span class="muted">(+2 pts)</span><select data-porra-primero="${esc(p.id)}"><option value="">Sin elegir</option>${js.filter(j => !j.invitado).map(j => `<option value="${esc(j.id)}" ${mio && mio.primero === j.id ? 'selected' : ''}>${esc(corto(j))}</option>`).join('')}</select></label>
        <div class="row spread"><span class="muted" style="font-size:12px">${mio ? `Tu apuesta: <b>${mio.gf}-${mio.gc}</b>${mio.primero ? ' · marca ' + nom(mio.primero) : ''}` : 'Aún no has apostado'} · 3 pts exacto, 1 ganador</span>
        <button class="btn sm" data-act="porra-guardar" data-p="${esc(p.id)}">${mio ? 'Cambiar' : 'Apostar'}</button></div>`}
    ${vs.length ? `<div class="porra-lista">${vs.map(v => `<span>${nom(v.jugador)} ${cerrada || v.jugador === yo ? `<b>${v.gf}-${v.gc}</b>${v.primero ? ' · ⚽' + nom(v.primero) : ''}` : '<b>🔒</b>'}</span>`).join('')}</div>` : ''}
  </div>`;
}
function porraResumen(p) {
  const vs = porrasDe(p.id); if (!vs.length) return '';
  const js = jugadores(), nom = id => esc(corto(js.find(j => j.id === id) || { nombre: '¿?' }));
  const l = vs.map(v => ({ v, pts: puntosPorra(v, p) })).sort((a, b) => b.pts - a.pts);
  const pg = primerGol(p);
  return `<h3>🎯 Porra</h3>${pg ? `<p class="muted" style="margin:0 0 6px;font-size:12px">Primer gol: <b>${nom(pg)}</b></p>` : ''}<div class="porra-lista">${l.map(({ v, pts }) => `<span class="${pts >= 3 ? 'clavada' : pts ? 'acierto' : ''}">${nom(v.jugador)} <b>${v.gf}-${v.gc}</b>${v.primero ? ` · ⚽${nom(v.primero)}${pg && v.primero === pg ? ' ✓' : ''}` : ''}${jugado(p) ? ` <small>+${pts}</small>` : ''}</span>`).join('')}</div>`;
}
function rankingPorra() {
  const ps = partidos().filter(jugado), t = {};
  for (const p of ps) for (const v of porrasDe(p.id)) {
    const x = t[v.jugador] = t[v.jugador] || { pts: 0, exactos: 0, n: 0 };
    const pts = puntosPorra(v, p); x.pts += pts; x.n++; if (pts === 3) x.exactos++;
  }
  const js = jugadores(), l = Object.entries(t).sort((a, b) => b[1].pts - a[1].pts || b[1].exactos - a[1].exactos);
  if (!l.length) return '';
  return `<h2>🎯 Porra</h2><div class="card" style="padding:4px 8px"><table><tbody>${l.map(([id, x], i) =>
    `<tr><td class="n">${i + 1}</td><td>${esc(corto(js.find(j => j.id === id) || { nombre: '¿?' }))} <span class="muted" style="font-size:12px">${x.exactos} exacto${x.exactos !== 1 ? 's' : ''} · ${x.n} apuesta${x.n !== 1 ? 's' : ''}</span></td><td class="n"><b>${x.pts}</b></td></tr>`).join('')}</tbody></table></div>`;
}

/* ---------- Convocatoria al WhatsApp del equipo ---------- */
function textoConvocatoria(p) {
  const js = jugadores().filter(j => !j.invitado), a = p.asistencia || {};
  const grupo = v => js.filter(j => !lesionDe(j.id) && (v ? a[j.id] === v : !a[j.id])).map(corto);
  const si = grupo('si'), duda = grupo('duda'), no = grupo('no'), nada = grupo('');
  const lugar = (p.campo || '').split('·')[0].trim();
  const t = [
    `⚽ *LA FARGA F.C.* vs *${p.rival}*`,
    `📅 ${fFecha(p.fecha)} · ${p.hora || ''}`,
    lugar ? `📍 ${p.campo}\nhttps://www.google.com/maps/search/?api=1&query=${encodeURIComponent(lugar)}` : '',
    '',
    `✅ Vienen (${si.length}): ${si.join(', ') || '—'}`,
    duda.length ? `❓ Dudas (${duda.length}): ${duda.join(', ')}` : '',
    no.length ? `❌ No vienen (${no.length}): ${no.join(', ')}` : '',
    nada.length ? `⏳ Sin responder: ${nada.join(', ')} 👀` : '',
    si.length < 7 ? `\n⚠️ Faltan ${7 - si.length} para ser 7.` : '',
    '',
    'Confirmad en la app 👉 ' + baseApp(),
  ];
  return t.filter((x, i) => x !== '' || t[i - 1] !== '').join('\n').trim();
}
/* ---------- Simulador de tabla ---------- */
let simTabla = '';
function simular(tabla, p, r) {
  const t = tabla.map(e => ({ ...e }));
  const nos = t.find(e => e.equipo === EQUIPO), riv = t.find(e => e.equipo === p.rival);
  const aplica = (e, res, gf, gc) => {
    if (!e) return; e.sim = true; e.pj = (+e.pj || 0) + 1; e.gf = (+e.gf || 0) + gf; e.gc = (+e.gc || 0) + gc; e.dg = (+e.dg || 0) + gf - gc;
    if (res === 'w') { e.g = (+e.g || 0) + 1; e.pts += 3; } else if (res === 'd') { e.e = (+e.e || 0) + 1; e.pts += 1; } else e.p = (+e.p || 0) + 1;
  };
  const [a, b] = { w: [2, 1], d: [1, 1], l: [1, 2] }[r];
  aplica(nos, r, a, b); aplica(riv, { w: 'l', d: 'd', l: 'w' }[r], b, a);
  t.sort((x, y) => y.pts - x.pts || y.dg - x.dg || (+y.gf || 0) - (+x.gf || 0));
  t.forEach((e, i) => e.pos = i + 1);
  return t;
}
function animarTabla(antes) {
  if (sinMov) return;
  document.querySelectorAll('tr[data-eq]').forEach(tr => {
    const o = antes[tr.dataset.eq]; if (o == null) return;
    const dy = o - tr.getBoundingClientRect().top; if (!dy) return;
    tr.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 700, easing: 'cubic-bezier(.3,.7,.2,1)' });
  });
}

/* ---------- Minutos de los goles ---------- */
function minutosGoles() {
  const ps = partidos().filter(p => jugado(p) && (p.eventos_web || []).length);
  if (!ps.length) return '';
  const tramos = [0, 10, 20, 30, 40].map(d => ({ d, f: 0, c: 0 }));
  for (const p of ps) for (const e of p.eventos_web) {
    if (e.tipo !== 'gol' && e.tipo !== 'propia') continue;
    const m = parseInt(e.min, 10); if (isNaN(m)) continue;
    const t = tramos[Math.min(4, Math.floor(Math.max(0, m - 1) / 10))];
    const nuestro = e.tipo === 'gol' ? e.nuestro : !e.nuestro;
    nuestro ? t.f++ : t.c++;
  }
  const max = Math.max(1, ...tramos.map(t => Math.max(t.f, t.c)));
  return `<h2>⏱️ Cuándo marcamos</h2><div class="card minutos">
    <div class="min-graf">${tramos.map((t, i) => `<div class="min-col" style="--k:${i}">
      <div class="min-arriba">${t.f ? `<span class="min-n">${t.f}</span>` : ''}<i style="--h:${t.f / max}"></i></div>
      <div class="min-eje">${t.d}'</div>
      <div class="min-abajo"><i style="--h:${t.c / max}"></i>${t.c ? `<span class="min-n">${t.c}</span>` : ''}</div></div>`).join('')}</div>
    <div class="row spread" style="margin-top:8px;font-size:12px"><span><i class="ley-f"></i> A favor</span><span><i class="ley-c"></i> En contra</span><span class="muted">${ps.length} acta${ps.length > 1 ? 's' : ''} con minutos</span></div></div>`;
}

/* ---------- Compromiso: quién viene más ---------- */
function compromiso(s = stats()) {
  const tot = partidos().filter(jugado).length; if (!tot) return '';
  const l = s.filter(x => !x.j.invitado).map(x => ({ j: x.j, pj: Math.min(tot, x.pj), pct: Math.round(Math.min(tot, x.pj) / tot * 100) })).sort((a, b) => b.pct - a.pct);
  return `<h2>💪 Compromiso</h2><div class="card compromiso">${l.map((x, i) => `<div class="comp-fila" style="--k:${i}">
    <span class="comp-n">${esc(corto(x.j))}</span>
    <span class="comp-barra"><i style="--p:${x.pct / 100}"></i></span>
    <span class="comp-v"><b>${x.pct}%</b> <span class="muted">${x.pj}/${tot}</span></span>
    ${x.pct === 100 ? '<span class="sello">SIEMPRE</span>' : '<span></span>'}</div>`).join('')}</div>`;
}
/* ---------- Cinta de resultados de la última jornada del grupo ---------- */
function cinta() {
  const jug = (web.grupo_partidos || []).filter(p => p.estado === 'jugado');
  if (!jug.length) return '';
  const ult = jug.reduce((m, p) => p.fecha > m ? p.fecha : m, '');
  const desde = new Date(new Date(ult) - 6 * 864e5).toISOString().slice(0, 10);
  const l = jug.filter(p => p.fecha >= desde);
  const item = p => `<span class="ci-item ${[p.local, p.visitante].includes(EQUIPO) ? 'nos' : ''}">${logo(p.local, 18)}<span class="ci-eq">${esc(abrev(p.local))}</span><b>${p.gf}-${p.gc}</b><span class="ci-eq">${esc(abrev(p.visitante))}</span>${logo(p.visitante, 18)}</span>`;
  const tira = l.map(item).join('<span class="ci-sep">◆</span>');
  return `<div class="cinta" aria-label="Resultados de la última jornada"><span class="ci-tit">Jornada</span><div class="ci-vent"><div class="ci-mov" style="--n:${l.length}">${tira}<span class="ci-sep">◆</span>${tira}<span class="ci-sep">◆</span></div></div></div>`;
}
const abrev = n => n === EQUIPO ? 'LA FARGA' : n.replace(/\b(FC|CF|CD|UE|F\.C\.)\b/g, '').trim().split(/\s+/).slice(0, 2).join(' ').toUpperCase();

/* ---------- Wrapped: resumen de la temporada en pantallas ---------- */
function diapositivasWrapped() {
  const ps = partidos().filter(jugado), r = resumen(), s = stats(), js = jugadores();
  const yo = (web.clasificacion || []).find(c => c.equipo === EQUIPO);
  const d = [];
  d.push(`<img src="icons/escudo.webp" alt="" class="w-escudo"><div class="w-peq">Temporada ${esc((web.temporada || '26/27'))}</div><h2 class="w-gran">El año de<br>La Farga</h2><div class="w-peq">Toca para avanzar</div>`);
  if (!ps.length) { d.push('<h2 class="w-gran">Aún no hay partidos jugados</h2>'); return d; }
  d.push(`<div class="w-peq">Hemos jugado</div><div class="w-num cnt">${ps.length}</div><div class="w-med">partidos</div>
    <div class="w-gep"><span class="w">${r.g} G</span><span class="d">${r.e} E</span><span class="l">${r.p} P</span></div>`);
  d.push(`<div class="w-peq">Hemos metido</div><div class="w-num cnt">${r.gf}</div><div class="w-med">goles</div><div class="w-peq">y encajado ${r.gc} · ${(r.gf / ps.length).toFixed(1)} por partido</div>`);
  const mejor = [...ps].sort((a, b) => (b.gf - b.gc) - (a.gf - a.gc) || b.gf - a.gf)[0];
  if (mejor && +mejor.gf > +mejor.gc) d.push(`<div class="w-peq">El mejor partido</div><div class="w-vs">${VS(mejor.rival)}</div><div class="w-num">${mejor.gf}-${mejor.gc}</div><div class="w-med">${esc(mejor.rival)}</div><div class="w-peq">${fFecha(mejor.fecha)}</div>`);
  const pich = s.filter(x => x.gol).sort((a, b) => b.gol - a.gol)[0];
  if (pich) d.push(`<div class="w-peq">El pichichi</div>${avatar(pich.j, 110)}<h2 class="w-gran">${esc(corto(pich.j))}</h2><div class="w-num cnt">${pich.gol}</div><div class="w-med">goles</div>`);
  const mvp = s.filter(x => x.mvp).sort((a, b) => b.mvp - a.mvp)[0];
  if (mvp) d.push(`<div class="w-peq">El MVP</div>${avatar(mvp.j, 110)}<h2 class="w-gran">${esc(corto(mvp.j))}</h2><div class="w-num cnt">${mvp.mvp}</div><div class="w-med">veces el mejor</div>`);
  let mx = 0, act = 0; for (const p of ps) { act = res(p) === 'w' ? act + 1 : 0; mx = Math.max(mx, act); }
  let inv = 0, ai = 0; for (const p of ps) { ai = res(p) !== 'l' ? ai + 1 : 0; inv = Math.max(inv, ai); }
  d.push(`<div class="w-peq">Mejor racha</div><div class="w-num cnt">${mx}</div><div class="w-med">victoria${mx !== 1 ? 's' : ''} seguida${mx !== 1 ? 's' : ''}</div><div class="w-peq">y ${inv} partido${inv !== 1 ? 's' : ''} sin perder</div>`);
  const tot = ps.length, fijo = s.filter(x => !x.j.invitado).sort((a, b) => b.pj - a.pj)[0];
  if (fijo && fijo.pj) d.push(`<div class="w-peq">El que nunca falla</div>${avatar(fijo.j, 110)}<h2 class="w-gran">${esc(corto(fijo.j))}</h2><div class="w-num cnt">${Math.round(Math.min(tot, fijo.pj) / tot * 100)}%</div><div class="w-med">de los partidos</div>`);
  if (yo) d.push(`<div class="w-peq">Ahora mismo somos</div><div class="w-num cnt">${yo.pos}º</div><div class="w-med">con ${yo.pts} puntos</div><div class="w-peq">${esc(web.grupo || '')}</div>`);
  d.push(`<img src="icons/escudo.webp" alt="" class="w-escudo"><h2 class="w-gran">Esto es el gheto<br>de La Farga</h2><div class="w-peq">🔥 A por la siguiente 🔥</div>`);
  return d;
}
function wrapped() {
  const d = diapositivasWrapped(); let i = 0, t = 0;
  const capa = document.createElement('div'); capa.className = 'wrapped'; capa.setAttribute('role', 'dialog'); capa.setAttribute('aria-label', 'Resumen de la temporada');
  capa.innerHTML = `<div class="w-barras">${d.map(() => '<span><i></i></span>').join('')}</div><button class="w-cerrar" aria-label="Cerrar">✕</button><div class="w-slide"></div>`;
  document.body.appendChild(capa); document.body.style.overflow = 'hidden';
  const DUR = 5200;
  const ir = n => {
    if (n < 0) n = 0; if (n >= d.length) return cerrar();
    i = n; clearTimeout(t);
    capa.querySelectorAll('.w-barras span').forEach((b, k) => { b.className = k < i ? 'hecha' : k === i ? 'activa' : ''; });
    const sl = capa.querySelector('.w-slide'); sl.innerHTML = `<div class="w-cont">${d[i]}</div>`; sl.dataset.k = i % 4;
    contar(sl); vibrar(6);
    t = setTimeout(() => ir(i + 1), DUR);
  };
  const cerrar = () => { clearTimeout(t); capa.classList.add('fuera'); document.body.style.overflow = ''; setTimeout(() => capa.remove(), 300); removeEventListener('keydown', tecla); };
  const tecla = e => { if (e.key === 'Escape') cerrar(); else if (e.key === 'ArrowRight') ir(i + 1); else if (e.key === 'ArrowLeft') ir(i - 1); };
  addEventListener('keydown', tecla);
  capa.addEventListener('click', e => { if (e.target.closest('.w-cerrar')) return cerrar(); ir(e.clientX < innerWidth / 3 ? i - 1 : i + 1); });
  ir(0);
}
/* ================= Tanda BI–CF ================= */
local.notas = local.notas || []; local.animos = local.animos || []; local.jugadas = local.jugadas || []; local.zonas = local.zonas || [];
store.setDoc = async function (col, v) { local[col] = local[col].filter(x => x.id !== v.id).concat(v); save(); if (db) await db.doc(col + '/' + v.id).set(v).catch(fallo); };
store.delDoc = async function (col, id) { local[col] = local[col].filter(x => x.id !== id); save(); if (db) await db.doc(col + '/' + id).delete().catch(fallo); };
const leerLS = (k, def) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? def : v; } catch (e) { return def; } };
const guardarLS = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* sin almacenamiento */ } };
const deNombre = (js, n) => js.find(x => x.nombre.startsWith(n.split(' ')[0]) && n.split(' ').slice(0, 2).every(w => x.nombre.includes(w)));

// Quién jugó un partido (asistencia, convocatoria del acta y eventos); si no se sabe, la plantilla
function jugaronIds(p) {
  const js = jugadores(), s = new Set();
  for (const [jid, v] of Object.entries(p.asistencia || {})) if (v === 'si') s.add(jid);
  for (const n of p.convocados || []) { const j = deNombre(js, n); if (j) s.add(j.id); }
  for (const e of p.eventos_web || []) if (e.nuestro && e.jugador_id) s.add(e.jugador_id);
  for (const e of p.eventos || []) if (e.jugador) s.add(e.jugador);
  const l = js.filter(j => s.has(j.id));
  return l.length ? l : js.filter(j => !j.invitado);
}
// Goles de cada jugador en un partido
function golesEn(p) {
  const c = {}, ev = (p.eventos_web || []).filter(e => e.nuestro && e.tipo === 'gol' && e.jugador_id).map(e => e.jugador_id);
  const l = ev.length ? ev : (p.eventos || []).filter(e => e.tipo === 'gol').map(e => e.jugador);
  for (const j of l) c[j] = (c[j] || 0) + 1;
  return c;
}

/* ---------- BN · Notas del 1 al 10 ---------- */
const notasDe = pid => local.notas.filter(n => n.partido === pid);
function mediaNota(jid, pid) {
  const v = local.notas.filter(n => (!pid || n.partido === pid) && n.n && n.n[jid] != null).map(n => +n.n[jid]);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}
const tonoNota = m => m == null ? '' : m >= 7 ? 'w' : m >= 5 ? 'd' : 'l';
function notasCard(p) {
  if (!jugado(p)) return '';
  const yo = yoId(), vs = notasDe(p.id), mio = vs.find(n => n.autor === yo), js = jugaronIds(p);
  return `<div class="notas-card" data-p="${esc(p.id)}"><h3>📝 Notas del partido <span class="muted nf-cuenta">${vs.length} ${vs.length === 1 ? 'persona ha puntuado' : 'personas han puntuado'}</span></h3>
    ${yo ? '' : '<p class="muted" style="margin:0 0 6px">Elige quién eres en el MVP para poner notas.</p>'}
    <div class="notas">${js.map((j, k) => { const m = mediaNota(j.id, p.id), mia = mio && mio.n[j.id];
      return `<div class="nota-fila" style="--k:${k}"><span class="nf-nom">${j.foto ? avatar(j, 24) : ''}${esc(corto(j))}</span>
        <b class="nf-media ${tonoNota(m)}">${m == null ? '–' : m.toFixed(1)}</b>
        ${yo && yo !== j.id ? `<span class="nf-escala">${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(v => `<button type="button" data-act="nota" data-p="${esc(p.id)}" data-j="${esc(j.id)}" data-v="${v}" class="${mia >= v ? 'on ' + tonoNota(mia) : ''}${mia === v ? ' mia' : ''}" aria-label="${v}">${v}</button>`).join('')}</span>`
          : yo === j.id ? '<span class="muted nf-escala nf-tu">Tu nota te la ponen los demás</span>' : ''}</div>`; }).join('')}</div></div>`;
}
function ponerNota(pid, jid, v) {
  const yo = yoId(); if (!yo) return toast('Primero elige quién eres');
  const id = pid + '-' + yo, prev = local.notas.find(n => n.id === id) || { id, partido: pid, autor: yo, n: {} };
  const n = { ...prev.n }; if (n[jid] === v) delete n[jid]; else n[jid] = v;
  store.setDoc('notas', { ...prev, n, fecha: new Date().toISOString() });
  const c = document.querySelector(`.notas-card[data-p="${CSS.escape(pid)}"]`); const p = getPartido(pid);
  if (c && p) { c.outerHTML = notasCard(p); const b = document.querySelector(`.notas-card [data-j="${CSS.escape(jid)}"][data-v="${v}"]`); if (b && b.animate && !sinMov) b.animate([{ transform: 'scale(1.6)' }, { transform: 'none' }], { duration: 300, easing: 'cubic-bezier(.2,1.6,.4,1)' }); }
  vibrar(8);
}

/* ---------- BJ · Cromo coleccionable y CE · Logros ---------- */
function asistenciaPct(jid) {
  const ps = partidos().filter(p => jugado(p) && Object.keys(p.asistencia || {}).length);
  return ps.length ? Math.round(ps.filter(p => p.asistencia[jid] === 'si').length / ps.length * 100) : null;
}
function mediaCromo(x) {
  const pj = x.pj || 0, n = mediaNota(x.j.id);
  const v = 58 + Math.min(18, pj ? x.gol / pj * 14 : 0) + Math.min(8, x.asist * 2) + Math.min(9, x.mvp * 3) + Math.min(6, pj * .6) + (n != null ? (n - 6) * 3 : 0) - x.roja * 3 - x.amarilla * .5;
  return Math.max(45, Math.min(99, Math.round(v)));
}
function logrosDe(jid, s = stats()) {
  const x = s.find(y => y.j.id === jid) || { pj: 0, gol: 0, asist: 0, mvp: 0, roja: 0, amarilla: 0 };
  const ps = partidos().filter(jugado);
  let maxG = 0, ceros = 0, n8 = false;
  for (const p of ps) {
    maxG = Math.max(maxG, golesEn(p)[jid] || 0);
    if (porteroDe(p) === jid && +p.gc === 0) ceros++;
    const m = mediaNota(jid, p.id); if (m != null && m >= 8) n8 = true;
  }
  const a = asistenciaPct(jid), conLista = ps.filter(p => Object.keys(p.asistencia || {}).length).length;
  const L = [
    ['⚽', 'Primer gol', 'Marcar un gol', x.gol >= 1],
    ['✌️', 'Doblete', '2 goles en un partido', maxG >= 2],
    ['🎩', 'Hat-trick', '3 goles en un partido', maxG >= 3],
    ['🔥', 'Goleador', '5 goles en la temporada', x.gol >= 5],
    ['👑', 'Pichichi', '10 goles en la temporada', x.gol >= 10],
    ['🅰️', 'Asistente', '3 asistencias', x.asist >= 3],
    ['⭐', 'MVP', 'Ser MVP de un partido', x.mvp >= 1],
    ['🌟', 'Estrella', 'Ser MVP 3 veces', x.mvp >= 3],
    ['🏃', 'Fijo', 'Jugar 5 partidos', x.pj >= 5],
    ['🛡️', 'Veterano', 'Jugar 10 partidos', x.pj >= 10],
    ['🧤', 'Muro', 'Dejar la portería a cero', ceros >= 1],
    ['📝', 'Matrícula', 'Nota media de 8 en un partido', n8],
    ['📅', 'Siempre está', 'Venir a todos (mín. 4)', a === 100 && conLista >= 4],
    ['😇', 'Juego limpio', '5 partidos sin tarjetas', x.pj >= 5 && !x.amarilla && !x.roja],
  ];
  const vistos = leerLS('lafarga.logros', {})[jid];
  return L.map(([i, t, d, ok]) => ({ i, t, d, ok, nuevo: ok && Array.isArray(vistos) && !vistos.includes(t) }));
}
function cromo(jid, desde) {
  const s = stats(), x = s.find(y => y.j.id === jid); if (!x) return editarJugador(jid);
  const j = x.j, n = mediaNota(jid), a = asistenciaPct(jid), lg = logrosDe(jid, s), dorsal = j.camiseta || j.dorsal || '';
  const pos = { Portero: 'POR', Defensa: 'DEF', Medio: 'MED', Delantero: 'DEL' }[j.posicion] || 'JUG';
  const d = document.getElementById('modal'); if (d.open) d.close();
  if (desde) zoomDesde = { escudo: desde, r: desde.getBoundingClientRect() };
  modalFuera = true; modal(`<button class="cerrar" value="cancel" formnovalidate aria-label="Cerrar">✕</button>
    <div class="cromo-marco"><div class="cromo ${lesionDe(jid) ? 'baja' : ''}">
      <span class="cr-holo" aria-hidden="true"></span><span class="cr-brillo" aria-hidden="true"></span>
      <div class="cr-top"><div class="cr-media"><b class="cnt">${mediaCromo(x)}</b><span>${pos}</span><img src="icons/escudo.webp" alt=""></div>
        <div class="cr-foto">${j.foto ? `<img src="${esc(j.foto)}" alt="">` : `<span class="cr-dorsal">${esc(dorsal || '?')}</span>`}</div></div>
      <div class="cr-nombre">${esc(corto(j))}</div>
      <div class="cr-sub">${esc(j.nombre || '')}${dorsal ? ' · #' + esc(dorsal) : ''}</div>
      <div class="cr-stats">${[['PJ', x.pj], ['GOL', x.gol], ['ASI', x.asist], ['MVP', x.mvp], ['NOTA', n == null ? '–' : n.toFixed(1)], ['ASIS', a == null ? '–' : a + '%']].map(([k, v]) => `<div><b>${v}</b><span>${k}</span></div>`).join('')}</div>
      <div class="cr-pie">LA FARGA FC · 26/27</div>
    </div></div>
    <h3>🏅 Logros <span class="muted" style="font:500 12px var(--sans, Inter)">${lg.filter(l => l.ok).length} de ${lg.length}</span></h3>
    <div class="logros">${lg.map((l, k) => `<div class="logro ${l.ok ? 'ok' : ''} ${l.nuevo ? 'nuevo' : ''}" style="--k:${k}"><span class="lg-ico">${l.i}</span><b>${esc(l.t)}</b><small>${esc(l.d)}</small></div>`).join('')}</div>
    <div class="actions">
      ${botonCompartir('j=' + jid, `Cromo de ${corto(j)} · La Farga FC`)}
      <button type="button" class="btn ghost" data-act="comparar-con" data-j="${esc(jid)}">Comparar</button>
      <button class="btn ghost" value="editar" formnovalidate>Editar</button>
      <button class="btn" value="cancel" formnovalidate>Cerrar</button>
    </div>`, (fd, acc) => { if (acc === 'editar') setTimeout(() => editarJugador(jid), 0); });
  const c = document.querySelector('#modal .cromo');
  if (c && !sinMov) {
    c.addEventListener('pointermove', e => {
      const r = c.getBoundingClientRect(), px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
      c.style.setProperty('--mx', (px * 100).toFixed(1) + '%'); c.style.setProperty('--my', (py * 100).toFixed(1) + '%');
      c.style.transform = `perspective(800px) rotateY(${((px - .5) * 16).toFixed(2)}deg) rotateX(${((.5 - py) * 16).toFixed(2)}deg)`;
      c.classList.add('mueve');
    });
    c.addEventListener('pointerleave', () => { c.style.transform = ''; c.classList.remove('mueve'); });
  }
  const nuevos = lg.filter(l => l.nuevo);
  if (nuevos.length) { setTimeout(() => { toast(`🏅 ¡Logro desbloqueado: ${nuevos.map(l => l.t).join(', ')}!`); vibrar(30); }, 900); }
  const v = leerLS('lafarga.logros', {}); v[jid] = lg.filter(l => l.ok).map(l => l.t); guardarLS('lafarga.logros', v);
}

/* ---------- BO · Comparador de varios jugadores ---------- */
const COLORES_CMP = ['#f2a823', '#3fc1ff', '#ff5fa2', '#5be37d', '#b18cff', '#ff7a3d'];
let comparados = null;
function comparador(s = stats()) {
  const js = s.filter(x => !x.j.invitado);
  if (js.length < 2) return '';
  if (!comparados) comparados = [...js].sort((a, b) => (b.gol * 2 + b.mvp + b.pj * .1) - (a.gol * 2 + a.mvp + a.pj * .1)).slice(0, 2).map(x => x.j.id);
  comparados = comparados.filter(id => js.some(x => x.j.id === id));
  // solo los ejes con datos de alguien, para que el gráfico no se aplaste
  const ejes = [['Goles', x => x.gol], ['Gol/PJ', x => x.pj ? +(x.gol / x.pj).toFixed(2) : 0], ['Asist.', x => x.asist], ['MVP', x => x.mvp], ['Partidos', x => x.pj], ['Nota', x => mediaNota(x.j.id) || 0, 10], ['Asistencia', x => asistenciaPct(x.j.id) || 0, 100], ['Juego limpio', x => Math.max(0, 10 - x.amarilla * 2 - x.roja * 5), 10]]
    .filter(([, f]) => js.some(x => f(x) > 0));
  const max = ejes.map(([, f, m]) => m || Math.max(1, ...js.map(f)));
  const C = 150, R = 104, ang = i => -Math.PI / 2 + i * 2 * Math.PI / ejes.length;
  const pt = (i, v) => [C + Math.cos(ang(i)) * R * v, C + Math.sin(ang(i)) * R * v];
  const sel = comparados.map((id, k) => ({ x: js.find(y => y.j.id === id), c: COLORES_CMP[k % COLORES_CMP.length] }));
  const fmt = (i, v) => ejes[i][0] === 'Nota' ? (v ? v.toFixed(1) : '–') : ejes[i][0] === 'Asistencia' ? (v ? v + '%' : '–') : v;
  return `<div class="comparador"><h2>🆚 Comparador</h2><div class="card">
    <p class="muted" style="margin:0 0 8px;font-size:12px">Elige hasta 6 jugadores.</p>
    <div class="cmp-chips">${js.map(x => { const k = comparados.indexOf(x.j.id);
      return `<button type="button" class="cmp-chip ${k >= 0 ? 'on' : ''}" style="${k >= 0 ? '--c:' + COLORES_CMP[k % 6] : ''}" data-act="comparar" data-j="${esc(x.j.id)}">${x.j.foto ? avatar(x.j, 20) : ''}${esc(corto(x.j))}</button>`; }).join('')}</div>
    <svg class="radar" viewBox="0 0 300 300" role="img" aria-label="Comparativa de jugadores">
      ${[.25, .5, .75, 1].map(f => `<polygon class="rd-aro" points="${ejes.map((_, i) => pt(i, f).join(',')).join(' ')}"/>`).join('')}
      ${ejes.map((e, i) => { const [x, y] = pt(i, 1), [lx, ly] = pt(i, 1.2); return `<line class="rd-eje" x1="${C}" y1="${C}" x2="${x}" y2="${y}"/><text class="rd-t" x="${lx}" y="${ly + 4}" text-anchor="middle">${e[0]}</text>`; }).join('')}
      ${sel.map((o, k) => `<g class="rd-pol" style="--c:${o.c};--k:${k}"><polygon points="${ejes.map(([, f], i) => pt(i, Math.min(1, f(o.x) / max[i])).join(',')).join(' ')}"/>
        ${ejes.map(([, f], i) => { const [x, y] = pt(i, Math.min(1, f(o.x) / max[i])); return `<circle cx="${x}" cy="${y}" r="3"/>`; }).join('')}</g>`).join('')}
    </svg>
    ${sel.length ? `<div class="cmp-tabla"><div class="cmp-f cmp-cab"><span></span>${sel.map(o => `<b style="color:${o.c}">${esc(corto(o.x.j))}</b>`).join('')}</div>
      ${ejes.map(([t, f], i) => { const vals = sel.map(o => f(o.x)), mx = Math.max(...vals);
        return `<div class="cmp-f"><span class="muted">${t}</span>${vals.map(v => `<b class="${v === mx && v > 0 && sel.length > 1 ? 'mejor' : ''}">${fmt(i, v)}</b>`).join('')}</div>`; }).join('')}</div>` : ''}
  </div></div>`;
}
function pintarComparador() { const c = document.querySelector('.comparador'); if (c) { c.outerHTML = comparador(); } }

/* ---------- CC · Mapa de dónde marcamos ---------- */
let zonaQuien = '', mapaFiltro = '';
function campoMitad(zs, opts = {}) {
  const js = jugadores();
  return `<svg class="campo-mitad ${opts.calor ? 'calor' : ''}" viewBox="0 0 100 70" ${opts.pid ? `data-act="zona-campo" data-p="${esc(opts.pid)}"` : ''} role="img" aria-label="Medio campo">
    <defs><radialGradient id="g-calor"><stop offset="0" stop-color="#ffcf5a" stop-opacity=".9"/><stop offset=".45" stop-color="#f2a823" stop-opacity=".45"/><stop offset="1" stop-color="#f2a823" stop-opacity="0"/></radialGradient></defs>
    <rect class="cm-cesped" x="0" y="0" width="100" height="70"/>
    ${[0, 1, 2, 3, 4, 5, 6].map(i => i % 2 ? `<rect class="cm-franja" x="0" y="${i * 10}" width="100" height="10"/>` : '').join('')}
    <g class="cm-lineas"><rect x="1" y="1" width="98" height="68"/><rect x="24" y="1" width="52" height="18"/><rect x="38" y="1" width="24" height="7"/>
      <path d="M38 19 A12 12 0 0 0 62 19"/><path d="M36 69 A14 14 0 0 1 64 69"/><circle cx="50" cy="13" r=".7" class="cm-punto"/><rect x="43" y="-1.5" width="14" height="2.5" class="cm-porteria"/></g>
    ${opts.calor ? zs.map(z => `<circle class="cm-mancha" cx="${z.x}" cy="${z.y}" r="11" fill="url(#g-calor)"/>`).join('') : ''}
    ${zs.map((z, k) => { const j = js.find(x => x.id === z.jugador); return `<g class="cm-gol" style="--k:${k}"><circle cx="${z.x}" cy="${z.y}" r="2.6"/><text x="${z.x}" y="${z.y + 1.1}" text-anchor="middle">${esc(j ? (j.camiseta || j.dorsal || '') : '')}</text><title>${esc(j ? corto(j) : '')}</title></g>`; }).join('')}
  </svg>`;
}
function zonasCard(p) {
  if (!jugado(p) || !+p.gf) return '';
  const zs = local.zonas.filter(z => z.partido === p.id), gs = golesEn(p), js = jugadores();
  const cand = Object.keys(gs).length ? js.filter(j => gs[j.id]) : jugaronIds(p);
  if (!cand.some(j => j.id === zonaQuien)) zonaQuien = cand[0] ? cand[0].id : '';
  return `<div class="zonas-card" data-p="${esc(p.id)}"><h3>📍 ¿Desde dónde fueron los goles?</h3>
    <p class="muted" style="margin:0 0 6px;font-size:12px">Elige quién marcó y toca el campo · ${zs.length} de ${+p.gf} apuntados</p>
    <div class="votos zc-quien">${cand.map(j => `<button type="button" class="voto ${j.id === zonaQuien ? 'on' : ''}" data-act="zona-quien" data-p="${esc(p.id)}" data-j="${esc(j.id)}">${esc(corto(j))}${gs[j.id] ? ` <small>${gs[j.id]}</small>` : ''}</button>`).join('')}</div>
    ${campoMitad(zs, { pid: p.id })}
    ${zs.length ? `<button type="button" class="btn ghost sm" style="margin-top:6px" data-act="zona-deshacer" data-p="${esc(p.id)}">Deshacer el último</button>` : ''}</div>`;
}
function pintarZonas(pid) { const c = document.querySelector(`.zonas-card[data-p="${CSS.escape(pid)}"]`), p = getPartido(pid); if (c && p) c.outerHTML = zonasCard(p); }
function ponerZona(svg, e) {
  const p = getPartido(svg.dataset.p); if (!p) return;
  const zs = local.zonas.filter(z => z.partido === p.id);
  if (zs.length >= +p.gf) return toast('Ya están todos los goles apuntados');
  if (!zonaQuien) return toast('Elige primero quién marcó');
  const m = svg.getScreenCTM().inverse(), q = new DOMPoint(e.clientX, e.clientY).matrixTransform(m);
  store.setDoc('zonas', { id: p.id + '-' + uid(), partido: p.id, jugador: zonaQuien, x: +Math.max(2, Math.min(98, q.x)).toFixed(1), y: +Math.max(2, Math.min(68, q.y)).toFixed(1), fecha: new Date().toISOString() });
  pintarZonas(p.id); vibrar(10);
}
function mapaGoles() {
  const todos = local.zonas, js = jugadores();
  const con = js.filter(j => todos.some(z => z.jugador === j.id));
  if (mapaFiltro && !con.some(j => j.id === mapaFiltro)) mapaFiltro = '';
  const zs = mapaFiltro ? todos.filter(z => z.jugador === mapaFiltro) : todos;
  const area = zs.filter(z => z.x >= 24 && z.x <= 76 && z.y <= 19).length;
  return `<div class="mapa-goles"><h2>📍 Mapa de goles</h2><div class="card">
    ${todos.length ? `<div class="cmp-chips"><button type="button" class="cmp-chip ${mapaFiltro ? '' : 'on'}" data-act="mapa-filtro" data-j="">Todos</button>${con.map(j => `<button type="button" class="cmp-chip ${mapaFiltro === j.id ? 'on' : ''}" data-act="mapa-filtro" data-j="${esc(j.id)}">${esc(corto(j))}</button>`).join('')}</div>
      ${campoMitad(zs, { calor: true })}
      <div class="row spread" style="margin-top:6px"><span class="muted">${zs.length} gol${zs.length !== 1 ? 'es' : ''} apuntado${zs.length !== 1 ? 's' : ''}</span><span class="muted">${zs.length ? Math.round(area / zs.length * 100) : 0}% dentro del área</span></div>`
      : '<p class="muted" style="margin:0">Abre un partido jugado y toca en el campo desde dónde fue cada gol: aquí saldrá el mapa de calor de la temporada.</p>'}
  </div></div>`;
}

/* ---------- BI · Pizarra táctica ---------- */
let piz = null;
const PIZ_NOS = [[50, 140], [27, 116], [73, 116], [16, 88], [50, 94], [84, 88], [50, 64]];
const PIZ_ELLOS = [[50, 10], [27, 34], [73, 34], [16, 60], [50, 56], [84, 60], [50, 84]];
function pizNueva() {
  const js = jugadores().filter(j => !j.invitado).sort((a, b) => /portero/i.test(b.posicion || '') - /portero/i.test(a.posicion || '')).slice(0, 7);
  const f = {}, et = {};
  PIZ_NOS.forEach((c, i) => { f['n' + i] = [...c]; et['n' + i] = js[i] ? String(js[i].camiseta || js[i].dorsal || i + 1) : String(i + 1); });
  PIZ_ELLOS.forEach((c, i) => { f['r' + i] = [...c]; });
  f.balon = [50, 76];
  return { id: '', nombre: '', et, rivales: true, pasos: [{ f, fl: [] }], i: 0, modo: 'mover' };
}
function pizarra(cargar) {
  if (cargar && cargar !== piz) piz = { ...JSON.parse(JSON.stringify(cargar)), i: 0, modo: 'mover' };
  else if (!piz) piz = pizNueva();
  if (document.querySelector('#modal[open] .piz-campo')) { document.getElementById('modal-form').innerHTML = pizHTML(); pizEventos(); return; }
  const d = document.getElementById('modal'); if (d.open) d.close();
  modal(pizHTML());
  pizEventos();
}
function pizHTML() {
  return `<button class="cerrar" value="cancel" formnovalidate aria-label="Cerrar">✕</button>
    <h3 style="margin-left:34px">🧠 Pizarra táctica</h3>
    <div class="piz-barra">
      <div class="seg piz-modos">${[['mover', '✋ Mover'], ['carrera', '➜ Carrera'], ['pase', '⇢ Pase']].map(([v, t]) => `<button type="button" data-act="piz-modo" data-v="${v}" class="${piz.modo === v ? 'on-cal' : ''}">${t}</button>`).join('')}</div>
      <label class="piz-check"><input type="checkbox" data-act="piz-rivales" ${piz.rivales ? 'checked' : ''}> Rivales</label>
    </div>
    <div class="piz-campo-caja">${pizSVG()}</div>
    <div class="piz-pasos"><span class="muted">Pasos</span><span class="piz-dots">${piz.pasos.map((_, k) => `<button type="button" data-act="piz-paso" data-v="${k}" class="${k === piz.i ? 'on' : ''}">${k + 1}</button>`).join('')}</span>
      <button type="button" class="btn ghost sm" data-act="piz-mas">+ Paso</button><button type="button" class="btn sm" data-act="piz-play">▶ Reproducir</button></div>
    <div class="piz-acc"><button type="button" class="btn ghost sm" data-act="piz-borrar-fl">Borrar flechas</button><button type="button" class="btn ghost sm" data-act="piz-quitar-paso" ${piz.pasos.length < 2 ? 'disabled' : ''}>Quitar paso</button><button type="button" class="btn ghost sm" data-act="piz-nueva">Empezar de cero</button></div>
    <div class="piz-guardar"><input data-piz-nombre maxlength="40" placeholder="Nombre de la jugada (córner, salida…)" value="${esc(piz.nombre)}"><button type="button" class="btn sm" data-act="piz-guardar">Guardar</button>${piz.id ? botonCompartir('jugada=' + piz.id, 'Jugada: ' + (piz.nombre || 'pizarra'), 'btn ghost sm') : ''}</div>
    ${local.jugadas.length ? `<h3>Jugadas guardadas</h3><div class="piz-lista">${[...local.jugadas].sort((a, b) => (b.fecha || '').localeCompare(a.fecha || '')).map(j => `<div class="piz-item ${piz.id === j.id ? 'on' : ''}"><button type="button" data-act="piz-cargar" data-id="${esc(j.id)}">▶ ${esc(j.nombre || 'Sin nombre')} <small class="muted">${j.pasos.length} paso${j.pasos.length !== 1 ? 's' : ''}</small></button><button type="button" class="piz-x" data-act="piz-del" data-id="${esc(j.id)}" aria-label="Borrar">✕</button></div>`).join('')}</div>` : ''}`;
}
function pizSVG() {
  const P = piz.pasos[piz.i];
  const fl = P.fl.map(a => `<line class="piz-fl ${a[4] === 'pase' ? 'pase' : ''}" x1="${a[0]}" y1="${a[1]}" x2="${a[2]}" y2="${a[3]}" marker-end="url(#piz-punta${a[4] === 'pase' ? '-p' : ''})"/>`).join('');
  const ficha = (id, cls, txt, r) => { const [x, y] = P.f[id]; return `<g class="piz-ficha ${cls}" data-f="${id}" transform="translate(${x} ${y})"><circle r="${r}"/>${txt ? `<text y="1.6" text-anchor="middle">${esc(txt)}</text>` : ''}</g>`; };
  return `<svg class="piz-campo" viewBox="0 0 100 150" aria-label="Pizarra">
    <defs><marker id="piz-punta" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0 10 5 0 10z" fill="#f2a823"/></marker>
      <marker id="piz-punta-p" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0 10 5 0 10z" fill="#fff"/></marker></defs>
    <rect class="pz-cesped" width="100" height="150"/>${[1, 3, 5, 7, 9, 11, 13].map(i => `<rect class="pz-franja" y="${i * 10.7}" width="100" height="10.7"/>`).join('')}
    <g class="pz-lineas"><rect x="2" y="2" width="96" height="146"/><line x1="2" y1="75" x2="98" y2="75"/><circle cx="50" cy="75" r="11"/>
      <rect x="26" y="2" width="48" height="18"/><rect x="26" y="130" width="48" height="18"/><rect x="40" y="2" width="20" height="6"/><rect x="40" y="142" width="20" height="6"/></g>
    <g class="piz-flechas">${fl}</g>
    ${piz.rivales ? PIZ_ELLOS.map((_, i) => ficha('r' + i, 'ellos', '', 4)).join('') : ''}
    ${PIZ_NOS.map((_, i) => ficha('n' + i, 'nos', piz.et['n' + i], 4.6)).join('')}
    ${ficha('balon', 'balon', '', 2.2)}
  </svg>`;
}
function pizRepintar() { const c = document.querySelector('.piz-campo-caja'); if (c) { c.innerHTML = pizSVG(); pizEventos(); } }
function pizEventos() {
  const svg = document.querySelector('.piz-campo'); if (!svg) return;
  const pto = e => new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.getScreenCTM().inverse());
  let arr = null, linea = null;
  svg.addEventListener('pointerdown', e => {
    const P = piz.pasos[piz.i], g = e.target.closest('.piz-ficha'), q = pto(e);
    if (piz.modo === 'mover' && g) { arr = { g, id: g.dataset.f, dx: P.f[g.dataset.f][0] - q.x, dy: P.f[g.dataset.f][1] - q.y }; g.classList.add('arrastra'); }
    else if (piz.modo !== 'mover') {
      linea = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      linea.setAttribute('class', 'piz-fl ' + (piz.modo === 'pase' ? 'pase' : '')); linea.setAttribute('marker-end', `url(#piz-punta${piz.modo === 'pase' ? '-p' : ''})`);
      ['x1', 'x2'].forEach(k => linea.setAttribute(k, q.x)); ['y1', 'y2'].forEach(k => linea.setAttribute(k, q.y));
      svg.querySelector('.piz-flechas').appendChild(linea);
    } else return;
    svg.setPointerCapture(e.pointerId); e.preventDefault();
  });
  svg.addEventListener('pointermove', e => {
    const q = pto(e);
    if (arr) { const x = Math.max(3, Math.min(97, q.x + arr.dx)), y = Math.max(3, Math.min(147, q.y + arr.dy)); piz.pasos[piz.i].f[arr.id] = [+x.toFixed(1), +y.toFixed(1)]; arr.g.setAttribute('transform', `translate(${x} ${y})`); }
    else if (linea) { linea.setAttribute('x2', q.x); linea.setAttribute('y2', q.y); }
  });
  const fin = () => {
    if (arr) { arr.g.classList.remove('arrastra'); arr = null; }
    if (linea) {
      const a = ['x1', 'y1', 'x2', 'y2'].map(k => +(+linea.getAttribute(k)).toFixed(1));
      if (Math.hypot(a[2] - a[0], a[3] - a[1]) > 5) piz.pasos[piz.i].fl.push([...a, piz.modo]); else linea.remove();
      linea = null;
    }
  };
  svg.addEventListener('pointerup', fin); svg.addEventListener('pointercancel', fin);
}
function pizPlay() {
  if (piz.pasos.length < 2) return toast('Añade al menos 2 pasos para ver la jugada');
  const svg = document.querySelector('.piz-campo'); if (!svg || piz.play) return;
  piz.play = true; piz.i = 0; pizRepintar();
  const dur = sinMov ? 1 : 1000;
  const paso = k => {
    if (k >= piz.pasos.length - 1) { piz.play = false; marcarPaso(); return; }
    const A = piz.pasos[k].f, B = piz.pasos[k + 1].f, t0 = performance.now();
    const fs = [...document.querySelectorAll('.piz-campo .piz-ficha')];
    const anim = t => {
      const u = Math.min(1, (t - t0) / dur), e = u < .5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
      fs.forEach(g => { const a = A[g.dataset.f], b = B[g.dataset.f]; if (a && b) g.setAttribute('transform', `translate(${a[0] + (b[0] - a[0]) * e} ${a[1] + (b[1] - a[1]) * e})`); });
      if (u < 1) requestAnimationFrame(anim);
      else { piz.i = k + 1; pizRepintar(); marcarPaso(); document.querySelectorAll('.piz-fl').forEach(l => l.classList.add('dibuja')); setTimeout(() => paso(k + 1), sinMov ? 0 : 450); }
    };
    requestAnimationFrame(anim);
  };
  document.querySelectorAll('.piz-fl').forEach(l => l.classList.add('dibuja'));
  setTimeout(() => paso(0), sinMov ? 0 : 500);
}
function marcarPaso() { document.querySelectorAll('.piz-dots button').forEach((b, k) => b.classList.toggle('on', k === piz.i)); }

/* ---------- BP · Posiciones de toda la liga jornada a jornada ---------- */
let bumpSel = EQUIPO;
function posicionesLiga() {
  const { ordenes, n } = evolucion(); if (ordenes.length < 2 || n < 2) return '';
  const eqs = (web.clasificacion || []).map(e => e.equipo), J = ordenes.length;
  const W = 330, padL = 18, padR = 34, top = 14, H = top * 2 + (n - 1) * 26;
  const X = i => padL + i * (W - padL - padR) / (J - 1), Y = pos => top + (pos - 1) * 26;
  const camino = eq => ordenes.map((o, i) => [X(i), Y(o.indexOf(eq) + 1)]).reduce((s, [x, y], i, a) => {
    if (!i) return `M${x} ${y}`; const [px, py] = a[i - 1], mx = (px + x) / 2; return `${s} C${mx} ${py} ${mx} ${y} ${x} ${y}`; }, '');
  const ult = ordenes[J - 1];
  return `<h2>📈 Posiciones jornada a jornada</h2><div class="card grafica bump" data-sel="${esc(bumpSel)}">
    <div class="rl-equipos bump-chips">${eqs.map(e => `<button type="button" class="rl-chip ${e === bumpSel ? 'on' : ''}" data-act="bump" data-eq="${esc(e)}" title="${esc(e)}">${logo(e, 24)}</button>`).join('')}</div>
    <svg viewBox="0 0 ${W} ${H + 16}" class="bump-svg" role="img" aria-label="Posición de cada equipo por jornada">
      ${Array.from({ length: n }, (_, k) => `<text class="bp-pos" x="2" y="${Y(k + 1) + 4}">${k + 1}</text><line class="bp-guia" x1="${padL}" x2="${W - padR}" y1="${Y(k + 1)}" y2="${Y(k + 1)}"/>`).join('')}
      ${ordenes.map((_, i) => `<text class="bp-j" x="${X(i)}" y="${H + 12}" text-anchor="middle">J${i + 1}</text>`).join('')}
      ${eqs.map(e => `<g class="bp-eq ${e === bumpSel ? 'on' : ''} ${e === EQUIPO ? 'nos' : ''}" data-eq="${esc(e)}"><path d="${camino(e)}" pathLength="1"/>
        ${ordenes.map((o, i) => `<circle cx="${X(i)}" cy="${Y(o.indexOf(e) + 1)}" r="3.2"/>`).join('')}
        <image href="${e === EQUIPO ? 'icons/escudo.webp' : `icons/equipos/${slug(e)}.png`}" x="${W - padR + 8}" y="${Y(ult.indexOf(e) + 1) - 10}" width="20" height="20" data-act="bump" data-eq="${esc(e)}"/></g>`).join('')}
    </svg>
    <div class="bp-pie">${bumpTexto()}</div></div>`;
}
function bumpTexto() {
  const { ordenes } = evolucion(), ps = ordenes.map(o => o.indexOf(bumpSel) + 1);
  if (!ps.length) return '';
  const mejor = Math.min(...ps), peor = Math.max(...ps);
  return `${logo(bumpSel, 18)} <b>${esc(bumpSel)}</b> <span class="muted">· ahora ${ps[ps.length - 1]}º · mejor ${mejor}º · peor ${peor}º</span>`;
}
function elegirBump(eq) {
  bumpSel = eq;
  const c = document.querySelector('.bump'); if (!c) return;
  c.querySelectorAll('.bp-eq').forEach(g => g.classList.toggle('on', g.dataset.eq === eq));
  const g = c.querySelector(`.bp-eq[data-eq="${CSS.escape(eq)}"]`); if (g) g.parentNode.appendChild(g);
  c.querySelectorAll('.bump-chips .rl-chip').forEach(b => b.classList.toggle('on', b.dataset.eq === eq));
  c.querySelector('.bp-pie').innerHTML = bumpTexto();
  if (g && !sinMov) { const p = g.querySelector('path'); p.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: 700, easing: 'cubic-bezier(.4,0,.2,1)' }); }
}

/* ---------- BQ · Probabilidad de victoria ---------- */
function probabilidad(rival) {
  const c = web.clasificacion || [], a = c.find(e => e.equipo === EQUIPO), b = c.find(e => e.equipo === rival);
  if (!a || !b || !a.pj || !b.pj) return '';
  const fm = n => { const f = formaDe(n); return f.length ? f.reduce((s, r) => s + (r === 'w' ? 3 : r === 'd' ? 1 : 0), 0) / f.length : 1.4; };
  const k = 1 + (fm(EQUIPO) - fm(rival)) * .06;
  const la = Math.max(.2, (a.gf / a.pj + b.gc / b.pj) / 2 * k), lb = Math.max(.2, (b.gf / b.pj + a.gc / a.pj) / 2 / k);
  const pois = (l, x) => { let p = Math.exp(-l); for (let i = 1; i <= x; i++) p *= l / i; return p; };
  let w = 0, d = 0, l = 0, mejor = [0, 0, 0];
  for (let i = 0; i <= 15; i++) for (let j = 0; j <= 15; j++) { const q = pois(la, i) * pois(lb, j); if (i > j) w += q; else if (i < j) l += q; else d += q; if (q > mejor[2]) mejor = [i, j, q]; }
  const t = w + d + l; let W = Math.round(w / t * 100), D = Math.round(d / t * 100); const L = 100 - W - D;
  return `<div class="prob grafica"><div class="row spread"><span class="muted">Probabilidad</span><span class="muted" style="font-size:11px">según goles y forma de los dos</span></div>
    <div class="prob-barra"><i class="w" style="--p:${W}"></i><i class="d" style="--p:${D}"></i><i class="l" style="--p:${L}"></i></div>
    <div class="prob-leyenda"><span class="w"><b class="cnt">${W}%</b>Ganar</span><span class="d"><b class="cnt">${D}%</b>Empatar</span><span class="l"><b class="cnt">${L}%</b>Perder</span></div>
    <div class="muted" style="font-size:11px;margin-top:4px">Resultado más probable: <b style="color:var(--text)">${mejor[0]}-${mejor[1]}</b></div></div>`;
}

/* ---------- BR · Lo que necesitamos ---------- */
function necesitamos() {
  const c = web.clasificacion || [], gp = web.grupo_partidos || [], yo = c.find(e => e.equipo === EQUIPO);
  if (!yo) return '';
  const quedan = n => gp.filter(p => p.estado !== 'jugado' && [p.local, p.visitante].includes(n));
  const misQ = quedan(EQUIPO).length; if (!misQ) return '';
  const otros = c.filter(e => e.equipo !== EQUIPO), miMax = yo.pts + 3 * misQ, total = 3 * misQ;
  const maxAbs = e => e.pts + 3 * quedan(e.equipo).length;
  const maxSiGanamos = e => e.pts + 3 * quedan(e.equipo).filter(p => ![p.local, p.visitante].includes(EQUIPO)).length;
  const obj = (k, t, ico) => {
    if (otros.length < k) return '';
    const umbral = otros.map(maxAbs).sort((a, b) => b - a)[k - 1];
    const asegurar = Math.max(0, umbral + 1 - yo.pts);
    const posible = otros.filter(e => e.pts > miMax).length < k;
    const depende = otros.map(maxSiGanamos).sort((a, b) => b - a)[k - 1] < miMax;
    const hecho = asegurar === 0;
    const txt = !posible ? 'Ya no es posible matemáticamente' : hecho ? '¡Asegurado!' : asegurar > total ? (depende ? `Si ganamos los ${misQ} partidos que quedan, lo tenemos` : `Aunque lo ganemos todo (${total} pts) hace falta que fallen otros`) : `Con <b>${asegurar}</b> de ${total} puntos está hecho · ${Math.ceil(asegurar / 3)} victoria${Math.ceil(asegurar / 3) !== 1 ? 's' : ''}`;
    const etiqueta = !posible ? 'fuera' : hecho ? 'hecho' : depende ? 'depende' : 'otros';
    return `<div class="nec-fila ${etiqueta}"><div class="row spread"><b class="nec-t">${ico} ${t}</b><span class="nec-tag">${{ fuera: 'Imposible', hecho: 'Conseguido', depende: 'Depende de nosotros', otros: 'Dependemos de otros' }[etiqueta]}</span></div>
      <div class="nec-barra"><i style="--p:${posible ? Math.min(1, hecho ? 1 : asegurar / total) : 0}"></i></div><div class="muted nec-txt">${txt}</div></div>`;
  };
  return `<h2>🧮 Lo que necesitamos</h2><div class="card grafica necesitamos">
    <p class="muted" style="margin:0 0 8px;font-size:12px">Nos quedan ${misQ} partido${misQ !== 1 ? 's' : ''} (${total} pts en juego) · llevamos ${yo.pts}</p>
    ${obj(1, 'Campeones', '🏆')}${obj(3, 'Podio', '🥉')}</div>`;
}

/* ---------- BL · Calendario del móvil ---------- */
// exportarICS ya genera el archivo de toda la temporada; este botón añade solo un partido

/* ---------- CD · Muro de ánimos ---------- */
function burbujasMuro(ms) {
  if (!ms.length) return '<span class="muro-vacio">Sé el primero en animar al equipo 💪</span>';
  const js = jugadores(), dur = Math.max(9, ms.length * 1.4);
  return ms.map((m, k) => { const j = js.find(x => x.id === m.autor), h = [...m.id].reduce((s, c) => s + c.charCodeAt(0), 0);
    return `<span class="mb" style="--x:${8 + h % 64}%;--t:${dur}s;--d:${-(ms.length - 1 - k) / ms.length * dur}s;--w:${(h % 2 ? 1 : -1) * (6 + h % 10)}px">${esc(m.texto)}<small>${esc(j ? corto(j) : 'Anónimo')}</small></span>`; }).join('');
}
function muro(p) {
  const ms = local.animos.filter(m => m.partido === p.id).sort((a, b) => (a.fecha || '').localeCompare(b.fecha || '')).slice(-24);
  return `<div class="card muro" data-p="${esc(p.id)}"><div class="row spread"><b class="muro-t">🔥 Muro de ánimos</b><span class="muted muro-n">${ms.length} mensaje${ms.length !== 1 ? 's' : ''}</span></div>
    <div class="muro-burbujas">${burbujasMuro(ms)}</div>
    <div class="muro-emojis">${['💪', '🔥', '⚽', '🏆', '🙌', '🦁', '⚒️'].map(e => `<button type="button" data-act="animo-emoji" data-v="${e}">${e}</button>`).join('')}</div>
    <div class="muro-form"><input maxlength="60" placeholder="Un mensaje para el viernes…" data-muro aria-label="Mensaje de ánimo"><button type="button" class="btn sm" data-act="animo-enviar">Enviar</button></div></div>`;
}
function pintarMuro() {
  const c = document.querySelector('.muro'); if (!c) return; const p = getPartido(c.dataset.p); if (!p) return;
  const ms = local.animos.filter(m => m.partido === p.id).sort((a, b) => (a.fecha || '').localeCompare(b.fecha || '')).slice(-24);
  c.querySelector('.muro-burbujas').innerHTML = burbujasMuro(ms);
  c.querySelector('.muro-n').textContent = `${ms.length} mensaje${ms.length !== 1 ? 's' : ''}`;
}
function enviarAnimo(texto) {
  const c = document.querySelector('.muro'); texto = (texto || '').trim(); if (!c || !texto) return;
  store.setDoc('animos', { id: uid() + Date.now().toString(36), partido: c.dataset.p, autor: yoId(), texto: texto.slice(0, 60), fecha: new Date().toISOString() });
  const i = c.querySelector('[data-muro]'); if (i && i.value.trim() === texto) i.value = '';
  pintarMuro(); vibrar(10);
  const ult = c.querySelector('.mb:last-child'); if (ult && ult.animate && !sinMov) ult.animate([{ scale: '.3', opacity: 0 }, { scale: '1.15', opacity: 1, offset: .6 }, { scale: '1' }], { duration: 500, easing: 'ease-out', composite: 'add' });
}

/* ---------- CA · Resultado nuevo con vibración ---------- */
function resultadoNuevo() {
  const ps = partidos().filter(jugado); if (!ps.length) return;
  const vistos = leerLS('lafarga.res-vistos', null);
  guardarLS('lafarga.res-vistos', ps.map(p => p.id));
  if (!Array.isArray(vistos)) return;
  const p = ps.filter(x => !vistos.includes(x.id)).pop(); if (!p) return;
  const r = res(p), patron = r === 'w' ? [90, 60, 90, 60, 260] : r === 'd' ? [120, 80, 120] : [220];
  let vibro = false; try { vibro = navigator.vibrate && navigator.vibrate(patron); } catch (e) { /* sin vibración */ }
  const v = document.createElement('div'); v.className = `res-nuevo ${r}`;
  v.innerHTML = `<div class="rn-caja"><button type="button" class="rn-x" aria-label="Cerrar">✕</button>
    <span class="rn-et">Resultado nuevo${p.jornada ? ' · Jornada ' + esc(p.jornada) : ''}</span>
    <div class="rn-vs">${VS(p.rival)}</div>
    <div class="rn-marc">${rodillo(`${p.gf}-${p.gc}`)}</div>
    <b class="rn-ver">${{ w: '¡VICTORIA!', d: 'EMPATE', l: 'DERROTA' }[r]}</b>
    <span class="rn-pista">Toca para ver el partido</span></div>`;
  document.body.appendChild(v);
  const quitar = () => { v.classList.add('fuera'); setTimeout(() => v.remove(), 450); };
  v.addEventListener('pointerdown', () => { if (!vibro) { try { navigator.vibrate && navigator.vibrate(patron); } catch (e) { /* nada */ } vibro = true; } }, { once: true });
  v.addEventListener('click', e => { const caja = v.querySelector('.rn-marc'); if (e.target.closest('.rn-x')) return quitar(); abrirDesde(caja, p.id); quitar(); });
  if (r === 'w') setTimeout(confeti, 700);
  setTimeout(() => { if (v.isConnected) quitar(); }, 9000);
}

/* ---------- CF · Color de cada escudo ---------- */
const coloresEscudo = leerLS('lafarga.colores', {});
function colorEscudo(n) {
  if (coloresEscudo[n]) return Promise.resolve(coloresEscudo[n]);
  return new Promise(ok => {
    const img = new Image(); img.onerror = () => ok('');
    img.onload = () => {
      try {
        const c = document.createElement('canvas'); c.width = c.height = 40; const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0, 40, 40);
        const d = x.getImageData(0, 0, 40, 40).data, cubos = {};
        for (let i = 0; i < d.length; i += 4) {
          if (d[i + 3] < 200) continue; const r = d[i], g = d[i + 1], b = d[i + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b);
          if (mx < 40 || mx - mn < 40) continue; // fuera negros, blancos y grises
          const k = `${r >> 5},${g >> 5},${b >> 5}`; (cubos[k] = cubos[k] || [0, 0, 0, 0]); cubos[k][0] += r; cubos[k][1] += g; cubos[k][2] += b; cubos[k][3]++;
        }
        const m = Object.values(cubos).sort((a, b) => b[3] - a[3])[0];
        const col = m ? `rgb(${Math.round(m[0] / m[3])}, ${Math.round(m[1] / m[3])}, ${Math.round(m[2] / m[3])})` : '';
        coloresEscudo[n] = col; guardarLS('lafarga.colores', coloresEscudo); ok(col);
      } catch (e) { ok(''); }
    };
    img.src = n === EQUIPO ? 'icons/escudo.webp' : `icons/equipos/${slug(n)}.png`;
  });
}
function tenirFicha(n) {
  const dlg = document.getElementById('modal');
  colorEscudo(n).then(c => { if (!c || !dlg.open || dlg.dataset.tinte !== n) return; dlg.style.setProperty('--tinte', c); dlg.classList.add('tinte'); });
}

/* ---------- BT · Escudo que se dibuja al entrar ---------- */
function dibujarEscudo(capa, img, luego) {
  if (sinMov || !img.animate) return luego();
  const linea = img.cloneNode(); linea.className = 'ent-linea'; capa.appendChild(linea);
  capa.classList.add('dibuja');
  setTimeout(() => { capa.classList.add('rellena'); }, 950);
  setTimeout(() => { linea.remove(); luego(); }, 1350);
}

/* ================= Tanda CG–CZ ================= */

/* ---------- CK · Tabla con filtros ---------- */
let filtroTabla = 'real';
function tablaFiltrada(modo) {
  const gp = (web.grupo_partidos || []).filter(p => p.estado === 'jugado');
  const eqs = (web.clasificacion || []).map(e => e.equipo);
  const js = jornadasLiga(), mitad = Math.ceil(js.length / 2), fechas2 = new Set(js.filter(j => j.n > mitad).map(j => j.f));
  const filas = eqs.map(e => {
    let l = gp.filter(p => [p.local, p.visitante].includes(e)).sort((a, b) => a.fecha.localeCompare(b.fecha));
    l = modo === 'ult5' ? l.slice(-5) : l.filter(p => fechas2.has(p.fecha));
    const r = { equipo: e, pj: l.length, g: 0, e: 0, p: 0, gf: 0, gc: 0, pts: 0 };
    for (const p of l) { const x = resDe(p, e); r.gf += p.local === e ? +p.gf : +p.gc; r.gc += p.local === e ? +p.gc : +p.gf; r[{ w: 'g', d: 'e', l: 'p' }[x]]++; r.pts += x === 'w' ? 3 : x === 'd' ? 1 : 0; }
    r.dg = r.gf - r.gc; return r;
  }).sort((a, b) => b.pts - a.pts || b.dg - a.dg || b.gf - a.gf);
  filas.forEach((r, i) => { r.pos = i + 1; });
  return { filas, mitad, vacia: filas.every(r => !r.pj) };
}

/* ---------- CM · Deslizar hacia abajo para cerrar ---------- */
(() => {
  const dlg = document.getElementById('modal'); if (!dlg) return;
  let y0 = 0, dy = 0, activo = false, t0 = 0;
  const hoja = () => matchMedia('(max-width: 599px)').matches;
  dlg.addEventListener('touchstart', e => {
    activo = false;
    if (!hoja() || dlg.scrollTop > 2 || dlg.querySelector('input[name="clave"]')) return;
    if (e.target.closest('input, textarea, select, .piz-campo, .campo-mitad, .nf-escala, .galeria, .cmp-chips, .radar, .vi-pista')) return;
    y0 = e.touches[0].clientY; dy = 0; t0 = Date.now(); activo = true;
  }, { passive: true });
  dlg.addEventListener('touchmove', e => {
    if (!activo) return;
    dy = e.touches[0].clientY - y0;
    if (dy < 0 || dlg.scrollTop > 2) { if (dy < -8) activo = false; dlg.style.transform = ''; return; }
    dlg.getAnimations().forEach(a => a.finish());
    dlg.style.transition = 'none'; dlg.style.transform = `translateY(${dy * (dy > 40 ? 1 : .6)}px)`;
    dlg.style.setProperty('--arrastre', Math.min(1, dy / 260));
  }, { passive: true });
  dlg.addEventListener('touchend', () => {
    if (!activo) return; activo = false;
    const v = dy / Math.max(1, Date.now() - t0);
    if (dy > 130 || (dy > 50 && v > .6)) {
      dlg.style.transition = 'transform .24s cubic-bezier(.4, 0, 1, 1)'; dlg.style.transform = 'translateY(105%)';
      vibrar(8);
      setTimeout(() => {
        dlg.dataset.escudo = ''; dlg.dataset.zoom = ''; dlg.dataset.giro = '';
        if (dlg._escudo) { dlg._escudo.style.visibility = ''; dlg._escudo = null; }
        dlg.close(); dlg.style.transition = ''; dlg.style.transform = ''; dlg.style.removeProperty('--arrastre');
      }, 240);
    } else if (dy > 0) {
      dlg.style.transition = 'transform .32s cubic-bezier(.2, .8, .2, 1)'; dlg.style.transform = ''; dlg.style.removeProperty('--arrastre');
      setTimeout(() => { dlg.style.transition = ''; }, 320);
    }
  });
})();

/* ---------- CS · La temporada de un vistazo ---------- */
function temporadaVistazo() {
  const ps = partidos().filter(p => p.fecha); if (!ps.length) return '';
  const dia = f => Date.UTC(+f.slice(0, 4), +f.slice(5, 7) - 1, +f.slice(8, 10));
  const iso = t => new Date(t).toISOString().slice(0, 10);
  const ini = dia(ps[0].fecha), fin = Math.max(dia(ps[ps.length - 1].fecha), dia(hoy()));
  const semanas = [];
  for (let t = ini, k = 0; t <= fin + 3 * 864e5; t += 7 * 864e5, k++) {
    const p = ps.find(x => Math.abs(dia(x.fecha) - t) <= 3 * 864e5);
    semanas.push({ f: iso(t), p, k });
  }
  const meses = {}; semanas.forEach(s => (meses[s.f.slice(0, 7)] = meses[s.f.slice(0, 7)] || []).push(s));
  const est = s => !s.p ? 'libre' : s.p.estado === 'aplazado' ? 'aplaz' : jugado(s.p) ? res(s.p) : s.p.fecha === hoy() ? 'hoy' : 'pend';
  const c = { w: 0, d: 0, l: 0 }; ps.filter(jugado).forEach(p => c[res(p)]++);
  return `<h2>🗓️ La temporada de un vistazo</h2><div class="card grafica vistazo">
    ${Object.entries(meses).map(([m, l]) => `<div class="vz-mes"><span class="vz-nom">${MESES_L[+m.slice(5) - 1].slice(0, 3)}</span><div class="vz-sem">${l.map(s => {
      const e = est(s), t = s.p ? `${s.p.jornada ? 'J' + s.p.jornada + ' · ' : ''}${s.p.rival}${jugado(s.p) ? ' ' + s.p.gf + '-' + s.p.gc : ''}` : 'Sin partido';
      return `<span class="vz-c ${e}" style="--k:${s.k}" ${s.p ? `data-act="ver-ult" data-id="${esc(s.p.id)}" tabindex="0" role="button"` : ''} aria-label="${esc(fFecha(s.f) + ' · ' + t)}">${s.p && jugado(s.p) ? `<b>${s.p.gf}-${s.p.gc}</b>` : s.p && s.p.jornada ? `<i>J${esc(s.p.jornada)}</i>` : ''}</span>`; }).join('')}</div></div>`).join('')}
    <div class="vz-ley"><span><i class="vz-c w"></i>${c.w} ganado${c.w !== 1 ? 's' : ''}</span><span><i class="vz-c d"></i>${c.d} empatado${c.d !== 1 ? 's' : ''}</span><span><i class="vz-c l"></i>${c.l} perdido${c.l !== 1 ? 's' : ''}</span><span><i class="vz-c pend"></i>por jugar</span></div></div>`;
}

/* ---------- CT · Alarma de convocatoria ---------- */
function alarmaConvocatoria(p) {
  if (!p) return '';
  const dias = Math.round((Date.parse(p.fecha) - Date.parse(hoy())) / 864e5);
  if (dias < 0 || dias > 2) return '';
  const js = jugadores().filter(j => !j.invitado && !lesionDe(j.id)), a = p.asistencia || {};
  const si = js.filter(j => a[j.id] === 'si'), sin = js.filter(j => !a[j.id]), duda = js.filter(j => a[j.id] === 'duda');
  if (si.length >= 8) return '';
  const cuando = dias === 0 ? 'hoy' : dias === 1 ? 'mañana' : 'el ' + fFecha(p.fecha).split(' ')[0];
  return `<div class="card alarma-conv"><div class="ac-cab"><span class="ac-ico">🚨</span><div><b>Faltan jugadores para ${cuando}</b><span>${si.length} de 8 confirmados${si.length < 7 ? ` · ¡no llegamos a 7!` : ''}</span></div></div>
    <div class="ac-puntos">${Array.from({ length: 8 }, (_, k) => `<i class="${k < si.length ? 'on' : ''}" style="--k:${k}"></i>`).join('')}</div>
    ${sin.length ? `<p class="ac-lista"><span class="muted">Sin contestar:</span> ${sin.map(j => esc(corto(j))).join(', ')}</p>` : ''}
    ${duda.length ? `<p class="ac-lista"><span class="muted">En duda:</span> ${duda.map(j => esc(corto(j))).join(', ')}</p>` : ''}
    <a class="btn wa sm" href="https://wa.me/?text=${encodeURIComponent(textoConvocatoria(p))}" target="_blank" rel="noopener">Avisar por WhatsApp</a></div>`;
}

/* ---------- CV · Enlaces directos ---------- */
const baseApp = () => (window.LAFARGA || {}).urlPublica || location.href.split('#')[0];
const enlace = h => baseApp() + '#' + h;
const botonCompartir = (h, t, cls = 'btn ghost') => `<button type="button" class="${cls} compartir" data-act="compartir" data-h="${esc(h)}" data-t="${esc(t)}" aria-label="Compartir"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7 8l5-5 5 5M5 13v7h14v-7"/></svg>Compartir</button>`;
async function compartir(h, titulo) {
  const url = enlace(encodeURIComponent(h).replace(/%3D/g, '='));
  try { if (navigator.share) { await navigator.share({ title: titulo, text: titulo, url }); return; } } catch (e) { if (e && e.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(`${titulo}\n${url}`); toast('Enlace copiado: pégalo en WhatsApp'); }
  catch (e) { window.open('https://wa.me/?text=' + encodeURIComponent(`${titulo}\n${url}`), '_blank', 'noopener'); }
}
let enlacePendiente = '';
function abrirEnlace() {
  const h = enlacePendiente || decodeURIComponent(location.hash.slice(1)); if (!h) return;
  const i = h.indexOf('='), k = i < 0 ? h : h.slice(0, i), v = i < 0 ? '' : h.slice(i + 1);
  enlacePendiente = '';
  const limpiar = () => { try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* sin historial */ } };
  if (k === 'p' && getPartido(v)) resumenPartido(v);
  else if (k === 'j' && jugadores().some(j => j.id === v)) cromo(v);
  else if (k === 'e' && (web.clasificacion || []).some(e => e.equipo === v)) fichaEquipo(v);
  else if (k === 'g' && grupoPorClave(v)) resumenGrupo(v, '');
  else if (k === 't' && V[v]) irA(v);
  else if (k === 'jugada') { const j = local.jugadas.find(x => x.id === v); if (j) { pizarra(j); setTimeout(pizPlay, 400); } else { enlacePendiente = h; return; } }
  else return;
  limpiar();
}
addEventListener('hashchange', abrirEnlace);

/* ---------- CX · Sin conexión: lo apuntado se guarda y se envía al volver ---------- */
const COLA = 'lafarga.cola';
function conCola(base) {
  const cola = () => leerLS(COLA, []);
  let avisado = 0;
  const meter = op => {
    const c = cola().filter(o => o.path !== op.path); c.push(op); guardarLS(COLA, c);
    if (Date.now() - avisado > 4000) { toast('Sin conexión: se enviará al volver la cobertura'); avisado = Date.now(); }
    pintarCola();
  };
  const sinRed = e => !navigator.onLine || /network|fetch|unavailable|timeout|failed/i.test(`${(e && e.code) || ''} ${(e && e.message) || ''}`);
  async function vaciar() {
    const c = cola(); if (!c.length || !navigator.onLine) return;
    const resto = [];
    for (const op of c) { try { if (op.del) await base.doc(op.path).delete(); else await base.doc(op.path).set(op.data); } catch (e) { resto.push(op); } }
    guardarLS(COLA, resto); pintarCola();
    if (c.length > resto.length) toast(`✓ Enviado lo apuntado sin conexión (${c.length - resto.length})`);
  }
  addEventListener('online', vaciar); setTimeout(vaciar, 2500);
  return {
    collection: c => base.collection(c),
    doc(path) {
      const d = base.doc(path);
      return {
        onSnapshot: (...a) => d.onSnapshot(...a),
        async set(data) { if (!navigator.onLine) return meter({ path, data }); try { return await d.set(data); } catch (e) { if (sinRed(e)) return meter({ path, data }); throw e; } },
        async delete() { if (!navigator.onLine) return meter({ path, del: true }); try { return await d.delete(); } catch (e) { if (sinRed(e)) return meter({ path, del: true }); throw e; } },
      };
    },
  };
}
function pintarCola() {
  const n = leerLS(COLA, []).length; let b = document.querySelector('.cola-pend');
  if (!n) { if (b) b.remove(); return; }
  if (!b) { b = document.createElement('div'); b.className = 'cola-pend'; document.body.appendChild(b); }
  b.textContent = `⏳ ${n} cambio${n !== 1 ? 's' : ''} por enviar`;
}

/* ---------- CY · Buscador ampliado ---------- */
function busquedaExtra(q) {
  const out = [], js = jugadores().filter(j => !j.invitado), s = stats();
  // atajos: "goles de marcelo", "notas de bili", "logros de jota"
  const m = q.match(/^(goles|notas?|logros|cromo|stats|asistencias|mvp)\s+(de\s+)?(.+)$/);
  if (m) for (const j of js.filter(j => normal(`${j.apodo} ${j.nombre}`).includes(m[3].trim()))) {
    const x = s.find(y => y.j.id === j.id) || {}, n = mediaNota(j.id), lg = logrosDe(j.id, s).filter(l => l.ok).length;
    const dato = { goles: `⚽ ${x.gol || 0} goles en ${x.pj || 0} partidos`, nota: `📝 Nota media ${n == null ? '–' : n.toFixed(1)}`, notas: `📝 Nota media ${n == null ? '–' : n.toFixed(1)}`, logros: `🏅 ${lg} logros`, asistencias: `🅰️ ${x.asist || 0} asistencias`, mvp: `⭐ ${x.mvp || 0} veces MVP` }[m[1]] || `${x.pj || 0} PJ · ${x.gol || 0} goles · ${x.mvp || 0} MVP`;
    out.push(`<button class="res-busq atajo" data-act="buscar-ir" data-tipo="cromo" data-v="${esc(j.id)}">${avatar(j, 26)}<span><b>${esc(dato)}</b><small>${esc(corto(j))} · toca para ver su cromo</small></span></button>`);
  }
  for (const j of js) for (const l of logrosDe(j.id, s).filter(l => l.ok && normal(l.t + ' ' + l.d).includes(q)))
    out.push(`<button class="res-busq" data-act="buscar-ir" data-tipo="cromo" data-v="${esc(j.id)}"><span class="num">${l.i}</span><span><b>${esc(l.t)} · ${esc(corto(j))}</b><small>Logro: ${esc(l.d)}</small></span></button>`);
  for (const j of local.jugadas.filter(j => normal(j.nombre || '').includes(q)))
    out.push(`<button class="res-busq" data-act="buscar-ir" data-tipo="jugada" data-v="${esc(j.id)}"><span class="num">🧠</span><span><b>${esc(j.nombre)}</b><small>Jugada de pizarra · ${j.pasos.length} pasos</small></span></button>`);
  for (const a of local.animos.filter(a => normal(a.texto).includes(q)).slice(-5)) {
    const j = js.find(x => x.id === a.autor);
    out.push(`<button class="res-busq" data-act="buscar-ir" data-tipo="muro" data-v=""><span class="num">💬</span><span><b>“${esc(a.texto)}”</b><small>${esc(j ? corto(j) : 'Anónimo')} · muro de ánimos</small></span></button>`);
  }
  for (const g of (web.grupo_partidos || []).filter(g => ![g.local, g.visitante].includes(EQUIPO) && normal(`${g.local} ${g.visitante}`).includes(q)).slice(0, 8))
    out.push(`<button class="res-busq" data-act="buscar-ir" data-tipo="grupo" data-v="${esc(claveG(g))}"><span class="c-vs">${logo(g.local, 22)}<em>vs</em>${logo(g.visitante, 22)}</span><span><b>${esc(abrev(g.local))} – ${esc(abrev(g.visitante))}</b><small>${fFecha(g.fecha)}${g.estado === 'jugado' ? ' · ' + g.gf + '-' + g.gc : ''}</small></span></button>`);
  return out;
}
const V = {
  inicio() {
    const ps = partidos();
    const prox = ps.find(p => !jugado(p) && p.estado !== 'aplazado' && p.fecha >= hoy());
    const ult = ps.filter(jugado).slice(-5);
    const yo = (web.clasificacion || []).find(c => c.equipo === EQUIPO);
    const r = resumen();
    const top = stats().filter(s => s.gol).sort((a, b) => b.gol - a.gol)[0];
    return `
      ${cinta()}
      ${novedades()}
      ${prox ? alarmaConvocatoria(prox) : ''}
      ${prox ? avisoVienes(prox) : ''}
      ${avisoTarjetas()}
      ${ultimoResultado(ps)}
      <div class="card hero">
        <div class="row spread">
          <div><div class="muted">Posición</div><div class="big">${yo ? yo.pos + 'º' : '–'}</div></div>
          <span class="escudo-brillo"><img src="icons/escudo.webp" alt="" style="height:92px;filter:drop-shadow(0 4px 14px rgba(242,168,35,.35))"></span>
          <div style="text-align:right"><div class="muted">Puntos</div><div class="big">${yo ? yo.pts : '–'}</div></div>
        </div>
        <div class="muted" style="margin-top:8px">${esc(web.grupo || 'Viernes - B')} · DG ${yo ? (yo.dg > 0 ? '+' : '') + yo.dg : '–'}</div>
      </div>

      ${bannerPartido(prox)}
      <h2>Próximo partido ${prox ? `<button class="btn ghost sm" data-act="ver-equipo" data-eq="${esc(prox.rival)}">Estudiar rival</button>` : ''}</h2>
      ${prox ? matchCard(prox).replace('class="card match"', 'class="card match desliza"') + '<p class="muted pista-desliza" style="text-align:center">Desliza la tarjeta: ← no voy · voy →</p>' + comoLlegar(prox) + previa(prox) : `<div class="card empty">No hay próximo partido.<br><button class="btn sm" style="margin-top:10px" data-act="nuevo-partido">Añadir partido</button></div>`}
      ${prox ? `<div class="ics-fila"><button type="button" class="btn ghost sm" data-act="ics" data-id="${esc(prox.id)}">📅 Añadir al calendario</button><button type="button" class="btn ghost sm" data-act="ics">Toda la temporada</button></div>` : ''}
      ${prox ? muro(prox) : ''}
      ${prox ? porraCard(prox) : ''}
      ${prox ? asistenciaCard(prox) : ''}
      ${enfermeria(false)}

      ${temporada(ps)}
      <h2>Últimos resultados</h2>
      ${rachaHTML(ps)}
      ${ult.length ? `<div class="card row spread"><div class="form">${ult.map((p, k) => `<i class="${res(p)}${k >= ult.length - rachaDe(ps) && rachaDe(ps) >= 2 ? ' fuego' : ''} clic" data-act="ver-ult" data-id="${esc(p.id)}" tabindex="0" role="button" aria-label="${esc(p.rival)} ${p.gf}-${p.gc}">${{ w: 'G', d: 'E', l: 'P' }[res(p)]}</i>`).join('')}</div><span class="muted">${r.g}G ${r.e}E ${r.p}P</span></div>` : `<div class="card empty">Aún no hay resultados guardados.</div>`}

      <div class="grid3">
        <div class="kpi"><b>${r.gf}</b><span>Goles a favor</span></div>
        <div class="kpi"><b>${r.gc}</b><span>En contra</span></div>
        <div class="kpi"><b>${top ? esc(corto(top.j)) : '–'}</b><span>Pichichi${top ? ' · ' + top.gol : ''}</span></div>
      </div>
      <div class="card" style="padding:12px">${galeria({ id: 'general' }, '<h2 style="margin-top:0;display:flex;justify-content:space-between;align-items:center">📸 Galería del equipo <button type="button" class="btn ghost sm" data-act="albumes">Álbumes</button></h2>')}</div>
      ${instalarCard()}
      ${haceCuanto()}
      ${patrocinadores()}
`;
  },

  partidos() {
    const ps = partidos();
    const prox = ps.filter(p => !jugado(p));
    const jug = ps.filter(jugado).reverse();
    const pr = calPrefs();
    return `
      <div class="seg vistas" style="margin-top:8px">${[['mes', '🗓️ Mes'], ['semana', '📆 Semana'], ['lista', '📋 Lista']].map(([v, t]) =>
        `<button data-act="cal-vista" data-v="${v}" class="${pr.vista === v ? 'on-cal' : ''}">${t}</button>`).join('')}</div>
      ${pr.vista !== 'lista' ? calendario(pr) : ''}
      ${pr.vista === 'lista' ? '' : '<h2 style="margin-top:26px">Partidos</h2>'}
      <h2 style="${pr.vista === 'lista' ? '' : 'display:none'}">Calendario <button class="btn sm" data-act="nuevo-partido">+ Partido</button></h2>
      ${prox.length ? `<div class="ics-fila"><button type="button" class="btn ghost sm" data-act="ics">📅 Pasar todos los partidos al calendario del móvil</button></div>` + porMeses(prox) : '<div class="card empty">Sin partidos pendientes.</div>'}
      ${resultadosLiga()}`;
  },

  tabla() {
    const prox = partidos().find(p => !jugado(p) && p.estado !== 'aplazado' && p.fecha >= hoy());
    const real = web.clasificacion || [];
    const filt = filtroTabla !== 'real' ? tablaFiltrada(filtroTabla) : null;
    const c = filt ? filt.filas : simTabla && prox ? simular(real, prox, simTabla) : real;
    const yoR = real.find(e => e.equipo === EQUIPO), yoS = c.find(e => e.equipo === EQUIPO);
    // cuánto ha subido o bajado cada equipo respecto a la jornada anterior
    const { ordenes } = evolucion(), previa = ordenes.length > 1 ? ordenes[ordenes.length - 2] : null;
    const mov = e => {
      if (filt) return '<span class="mov igual">–</span>';
      if (!previa || previa.indexOf(e.equipo) < 0) return '<span class="mov igual">–</span>';
      const d = previa.indexOf(e.equipo) + 1 - e.pos;
      return d > 0 ? `<span class="mov sube" title="Sube ${d}">▲${d > 1 ? d : ''}</span>` : d < 0 ? `<span class="mov baja" title="Baja ${-d}">▼${d < -1 ? -d : ''}</span>` : '<span class="mov igual">–</span>';
    };
    return `
      <h2>${esc(web.grupo || 'Clasificación')}</h2>
      ${!filt && prox && real.length ? `<div class="card simulador"><div class="muted" style="margin-bottom:8px">Si contra <b style="color:var(--text)">${esc(prox.rival)}</b>…</div>
        <div class="seg">${[['', 'Real'], ['w', 'Ganamos'], ['d', 'Empatamos'], ['l', 'Perdemos']].map(([v, t]) =>
          `<button data-act="simular" data-v="${v}" class="${simTabla === v ? 'on-cal' : ''} ${v ? 'sim-' + v : ''}">${t}</button>`).join('')}</div>
        ${simTabla && yoS ? `<div class="sim-res sim-${simTabla}">Quedaríamos <b>${yoS.pos}º</b> con ${yoS.pts} pts <span class="muted">· ahora ${yoR.pos}º${yoS.pos < yoR.pos ? ' · subimos ' + (yoR.pos - yoS.pos) : yoS.pos > yoR.pos ? ' · bajamos ' + (yoS.pos - yoR.pos) : ' · nos quedamos igual'}</span></div>
          <p class="muted" style="margin:6px 0 0;font-size:11px">Por 1 gol de diferencia y sin contar el resto de la jornada.</p>` : ''}</div>` : ''}
      <div class="seg filtro-tabla">${[['real', 'Real'], ['ult5', 'Últimas 5'], ['vuelta2', '2ª vuelta']].map(([v, t]) => `<button data-act="filtro-tabla" data-v="${v}" class="${filtroTabla === v ? 'on-cal' : ''}">${t}</button>`).join('')}</div>
      ${filt ? `<p class="muted filtro-nota">${filtroTabla === 'ult5' ? 'Puntos de los últimos 5 partidos de cada equipo.' : filt.vacia ? `La segunda vuelta empieza en la jornada ${filt.mitad + 1}: aún no hay partidos.` : `Solo partidos desde la jornada ${filt.mitad + 1}.`}</p>` : ''}
      <div class="card" style="padding:4px 8px">
        <table>
          <thead><tr><th class="n">#</th><th>Equipo</th><th class="forma-col">Forma</th><th class="n">PTS</th><th class="n">J</th><th class="n">G</th><th class="n">E</th><th class="n">P</th><th class="n">DG</th></tr></thead>
          <tbody>${c.map(e => `<tr class="${e.equipo === EQUIPO ? 'me' : ''} ${e.sim ? 'sim-cambia' : ''} clic" data-act="ver-equipo" data-eq="${esc(e.equipo)}">
            <td class="n">${e.pos}</td><td><span class="row" style="gap:6px">${mov(e)}${logo(e.equipo)}<span>${esc(e.equipo)}</span></span></td><td class="forma-col"><span class="forma-mini">${formaListaDe(e.equipo).map((o, k) => `<i class="${o.r}" style="--k:${k}" ${attrsPartido(o.g, e.equipo)} aria-label="${{ w: 'Ganó', d: 'Empató', l: 'Perdió' }[o.r]}"></i>`).join('')}</span></td><td class="n"><b>${e.pts}</b></td>
            <td class="n">${e.pj ?? ''}</td><td class="n">${e.g ?? ''}</td><td class="n">${e.e ?? ''}</td><td class="n">${e.p ?? ''}</td>
            <td class="n">${e.dg > 0 ? '+' : ''}${e.dg}</td></tr>`).join('')}</tbody>
        </table>
      </div>
      <p class="muted">Toca un equipo para ver su ficha.</p>${necesitamos()}${posicionesLiga()}${proyeccion(real)}${haceCuanto()}
      ${grupoPorFecha()}`;
  },

  plantilla() {
    // el portero va primero
    const js = jugadores().filter(j => !j.invitado).sort((a, b) => /portero/i.test(b.posicion || '') - /portero/i.test(a.posicion || ''));
    const sPl = stats();
    return `
      ${enfermeria(true)}
      <button type="button" class="card pizarra-btn" data-act="pizarra"><span class="pzb-ico">🧠</span><span><b>Pizarra táctica</b><small class="muted">Mueve fichas, dibuja jugadas y reprodúcelas${local.jugadas.length ? ' · ' + local.jugadas.length + ' guardada' + (local.jugadas.length !== 1 ? 's' : '') : ''}</small></span><span class="muted">›</span></button>
      <h2>Plantilla (${js.length}) <button class="btn sm" data-act="nuevo-jugador">+ Jugador</button></h2>
      ${js.length ? js.map(j => `
        <div class="card player ${j.apodo === 'BLXDY' ? 'yo' : ''}" data-act="cromo" data-id="${esc(j.id)}">
          ${j.foto ? `<div class="dorsal con-foto">${avatar(j, 54)}<span>${esc(j.camiseta || j.dorsal || '')}</span></div>` : `<div class="dorsal">${esc(j.camiseta || j.dorsal || '?')}</div>`}
          <div>${j.apodo ? `<div class="apodo">${esc(j.apodo)}${lesionDe(j.id) ? ' <span class="tag baja">BAJA</span>' : ''}</div>` : ''}${j.nombre !== j.apodo ? `<b style="font-weight:${j.apodo ? 400 : 700}">${esc(j.nombre)}</b>` : ''}
            <div class="muted">${esc(j.posicion || (j.extra ? 'No está en la ficha de Valldor' : 'Sin posición'))}${j.edad ? ' · ' + j.edad + ' años' : ''}${j.camiseta && j.camiseta !== j.dorsal ? ' · ficha #' + esc(j.dorsal) : ''}</div></div>
          <span class="muted pl-der">${j.goles != null ? `${j.pj} PJ · ${j.goles} ⚽` : '›'}${(() => { const n = logrosDe(j.id, sPl).filter(l => l.ok).length; return n ? `<small class="pl-logros">🏅 ${n}</small>` : ''; })()}</span>
        </div>`).join('') : '<div class="card empty">Añade a los 11 de La Farga para llevar goles, asistencias y quién viene cada viernes.</div>'}
      <h2>Equipación</h2>
      <div class="card" style="padding:8px;background:#fff"><img class="kit" src="icons/camiseta.webp" alt="Camiseta de La Farga FC" loading="lazy"></div>
      ${patrocinadores()}`;
  },

  stats() {
    const s = stats();
    const tabla = (campo, titulo) => {
      const l = s.filter(x => x[campo]).sort((a, b) => b[campo] - a[campo]);
      return `<h2>${titulo}</h2><div class="card" style="padding:4px 8px">${l.length ? `<table><tbody>${l.map((x, i) =>
        `<tr><td class="n">${i + 1}</td><td><span class="num">${esc(x.j.camiseta || x.j.dorsal || '')}</span> ${esc(corto(x.j))}</td><td class="n"><b>${x[campo]}</b></td></tr>`).join('')}</tbody></table>` :
        '<div class="empty">Sin datos todavía.</div>'}</div>`;
    };
    const r = resumen();
    return `
      <div class="grid3" style="margin-top:10px">
        <div class="kpi"><b>${r.pj}</b><span>Jugados</span></div>
        <div class="kpi"><b>${r.g}-${r.e}-${r.p}</b><span>G-E-P</span></div>
        <div class="kpi"><b>${r.pj ? (r.gf / r.pj).toFixed(1) : '–'}</b><span>Goles/partido</span></div>
      </div>
      <button class="btn wrapped-btn" data-act="wrapped">▶ Resumen de la temporada</button>
      ${temporadaVistazo()}
      ${podio(s)}
      ${comparador(s)}
      ${graficas()}
      ${mapaGoles()}
      ${minutosGoles()}
      ${porteros()}
      ${hitos()}
      ${compromiso(s)}
      ${contraCadaRival()}
      <h2 style="margin-top:28px;color:var(--text)">LA FARGA</h2>
      ${rankingPorra()}
      ${tabla('gol', '⚽ Goleadores')}
      ${tabla('asist', '🅰️ Asistencias')}
      ${tabla('mvp', '⭐ MVP (partidos ganados)')}
      ${(() => { const l = s.map(x => ({ x, m: mediaNota(x.j.id) })).filter(o => o.m != null).sort((a, b) => b.m - a.m); return l.length ? `<h2>📝 Nota media</h2><div class="card" style="padding:4px 8px"><table><tbody>${l.map((o, i) => `<tr><td class="n">${i + 1}</td><td>${esc(corto(o.x.j))}</td><td class="n"><b class="tono-${tonoNota(o.m)}">${o.m.toFixed(1)}</b></td></tr>`).join('')}</tbody></table></div>` : ''; })()}
      ${tabla('pj', '🏃 Partidos jugados')}
      ${tabla('amarilla', '🟨 Amarillas')}
      ${tabla('roja', '🟥 Rojas')}
      ${liga()}`;
  },
};

function grupoPorFecha() {
  const gp = web.grupo_partidos || [];
  if (!gp.length) return '';
  const fechas = [...new Set(gp.map(p => p.fecha).filter(Boolean))].sort();
  const ultima = fechas.filter(f => gp.some(p => p.fecha === f && p.estado === 'jugado')).pop();
  const siguiente = fechas.find(f => f > (ultima || '') && gp.some(p => p.fecha === f && p.estado !== 'jugado'));
  const bloque = (f, t) => !f ? '' : `<h2>${t} · ${fFecha(f)}</h2><div class="card" style="padding:4px 8px"><table><tbody>${gp.filter(p => p.fecha === f).map(p => `
      <tr class="${[p.local, p.visitante].includes(EQUIPO) ? 'me' : ''}"><td>${esc(p.local)}</td>
      <td class="n" style="width:auto;white-space:nowrap"><b>${p.estado === 'jugado' ? `${p.gf}-${p.gc}` : esc(p.hora || p.estado)}</b></td>
      <td style="text-align:right">${esc(p.visitante)}</td></tr>`).join('')}</tbody></table></div>`;
  return bloque(ultima, 'Última jornada del grupo') + bloque(siguiente, 'Próxima jornada');
}

function patrocinadores() {
  return `<h2>Patrocinadores</h2>
    <div class="sponsors">
      <div class="sponsor wmx"><b>WINAMAX</b><small>POKER</small></div>
      <div class="sponsor rz"><b>RUSTEEZE</b><small>PATROCINADOR OFICIAL</small></div>
      <div class="sponsor mon"><b>MONSTER</b><small>ENERGY</small></div>
      <div class="sponsor bs"><img src="icons/braseria-sants.webp" alt="Braseria Sants" onerror="this.remove()"><b>BRASERIA SANTS</b></div>
    </div>`;
}

// Tras cada partido, 3 días con el resultado en grande en Inicio
function ultimoResultado(ps) {
  const p = ps.filter(jugado).slice(-1)[0]; if (!p) return '';
  const dias = (new Date(hoy()) - new Date(p.fecha)) / 864e5; if (dias < 0 || dias > 3) return '';
  const r = res(p), js = jugadores();
  const gol = (p.eventos_web || []).filter(e => e.nuestro && e.tipo === 'gol').map(e => { const j = e.jugador_id && js.find(x => x.id === e.jugador_id); return j ? corto(j) : e.jugador.split(' ')[0]; });
  const manual = (p.eventos || []).filter(e => e.tipo === 'gol').map(e => corto(js.find(j => j.id === e.jugador) || { nombre: '¿?' }));
  const cuenta = {}; [...gol, ...manual].forEach(n => cuenta[n] = (cuenta[n] || 0) + 1);
  const mvp = mvpDe(p.id).map(id => corto(js.find(j => j.id === id) || { nombre: '' })).filter(Boolean);
  return `<div class="card ultimo ${r}" data-act="ver-partido" data-id="${esc(p.id)}">
    <div class="ul-tit">${{ w: 'VICTORIA', d: 'EMPATE', l: 'DERROTA' }[r]} · ${fFecha(p.fecha)}</div>
    <div class="ul-marc"><div class="ul-eq"><img class="logo" src="icons/escudo.webp" alt="" width="54" height="54"><span>La Farga</span></div>
      <div class="ul-res">${rodillo(`${p.gf}-${p.gc}`)}</div>
      <div class="ul-eq">${logo(p.rival, 54)}<span>${esc(p.rival)}</span></div></div>
    ${Object.keys(cuenta).length ? `<div class="ul-gol">⚽ ${Object.entries(cuenta).map(([n, k]) => esc(n) + (k > 1 ? ` ×${k}` : '')).join(' · ')}</div>` : ''}
    ${mvp.length ? `<div class="ul-gol">⭐ MVP: <b>${mvp.map(esc).join(' / ')}</b></div>` : `<div class="ul-gol muted">Toca para votar al MVP</div>`}
  </div>`;
}
// Dificultad de un rival pendiente: posición en la tabla + forma reciente
function dificultad(rival) {
  const c = web.clasificacion || [], e = c.find(x => x.equipo === rival); if (!e || c.length < 2) return '';
  const f = formaDe(rival), fp = f.length ? f.reduce((a, r) => a + (r === 'w' ? 3 : r === 'd' ? 1 : 0), 0) / (3 * f.length) : .5;
  const v = .6 * (1 - (e.pos - 1) / (c.length - 1)) + .4 * fp;
  const [k, t] = v > .62 ? [3, 'Difícil'] : v < .38 ? [1, 'Fácil'] : [2, 'Medio'];
  return `<span class="dif dif-${k}" title="${e.pos}º en la tabla"><i></i><i></i><i></i>${t}</span>`;
}
// Portero de cada partido: se apunta a mano; si no, el portero de la plantilla que jugó
function porteroDe(p) {
  if (p.portero) return p.portero;
  const js = jugadores(), pos = js.filter(j => /portero/i.test(j.posicion || ''));
  const jugo = j => (p.convocados || []).some(n => j.nombre.startsWith(n.split(' ')[0]) && n.split(' ').slice(0, 2).every(w => j.nombre.includes(w))) || (p.asistencia || {})[j.id] === 'si';
  const k = pos.find(jugo); return k ? k.id : '';
}
function porteroSel(p) {
  if (!jugado(p)) return '';
  const js = jugadores(), pid = porteroDe(p);
  return `<h3>🧤 Portero</h3><label style="margin:0">${p.portero ? '' : '<span class="muted" style="font-size:12px">' + (pid ? 'Deducido por la posición, cámbialo si no fue así' : 'Apunta quién se puso de portero') + '</span>'}
    <select data-act="portero" data-p="${esc(p.id)}"><option value="">Sin apuntar</option>${js.map(j => `<option value="${esc(j.id)}" ${pid === j.id ? 'selected' : ''}>${esc(corto(j))}</option>`).join('')}</select></label>
    ${pid && +p.gc === 0 ? '<span class="sello muro">MURO · PORTERÍA A CERO</span>' : ''}`;
}
function porteros() {
  const ps = partidos().filter(jugado), js = jugadores(), t = {};
  let sin = 0;
  for (const p of ps) { const id = porteroDe(p); if (!id) { sin++; continue; } const x = t[id] = t[id] || { pj: 0, gc: 0, cero: 0 }; x.pj++; x.gc += +p.gc; if (+p.gc === 0) x.cero++; }
  const l = Object.entries(t).sort((a, b) => b[1].cero - a[1].cero || a[1].gc / a[1].pj - b[1].gc / b[1].pj);
  if (!l.length) return `<h2>🧤 Porteros</h2><div class="card empty">Abre un partido jugado y apunta quién fue de portero.</div>`;
  return `<h2>🧤 Porteros</h2><div class="card porteros">${l.map(([id, x]) => { const j = js.find(y => y.id === id) || { nombre: '¿?' };
    return `<div class="por-fila">${avatar(j, 40)}<div class="por-n"><b>${esc(corto(j))}</b><span class="muted">${x.pj} partido${x.pj !== 1 ? 's' : ''} · ${(x.gc / x.pj).toFixed(1)} encajados/p</span></div>
      <div class="por-cero"><b class="cnt">${x.cero}</b><span>a cero</span></div>${x.cero ? '<span class="sello muro">MURO</span>' : ''}</div>`; }).join('')}
    ${sin ? `<p class="muted" style="margin:6px 0 0;font-size:12px">${sin} partido${sin !== 1 ? 's' : ''} sin portero apuntado.</p>` : ''}</div>`;
}
// Tarjetas: aviso si alguno de los nuestros va cargado o está sancionado
function avisoTarjetas() {
  const js = jugadores().filter(j => !j.invitado);
  const sanc = (web.sanciones || []).filter(x => x.equipo === EQUIPO);
  const cargados = js.filter(j => +j.rojas > 0 || +j.amarillas >= 3).sort((a, b) => (b.amarillas || 0) - (a.amarillas || 0));
  if (!sanc.length && !cargados.length) return '';
  return `<div class="card aviso-tarjetas"><b>🟨 Ojo con las tarjetas</b>
    ${sanc.map(x => `<div class="at-fila"><span>⛔</span><span>${esc(x.jugador || x.nombre || '')}</span><b>Sancionado${x.partidos ? ' · ' + esc(x.partidos) + ' partido' + (+x.partidos !== 1 ? 's' : '') : ''}</b></div>`).join('')}
    ${cargados.map(j => `<div class="at-fila"><span>${'🟨'.repeat(Math.min(+j.amarillas || 0, 5))}${'🟥'.repeat(+j.rojas || 0)}</span><span>${esc(corto(j))}</span><b>${+j.amarillas >= 4 ? 'a una de sanción' : 'cargado'}</b></div>`).join('')}
  </div>`;
}
// Aviso para quien aún no ha dicho si viene al próximo partido
function avisoVienes(p) {
  const yo = yoId(); if (!yo || lesionDe(yo) || (p.asistencia || {})[yo]) return '';
  const j = jugadores().find(x => x.id === yo); if (!j) return '';
  return `<div class="card aviso-vienes"><div><b>${esc(corto(j))}, ¿vienes el ${fFecha(p.fecha).split(' ')[0]}?</b><span class="muted">${esc(p.rival)} · ${esc(p.hora || '')}</span></div>
    <div class="av-bot"><button class="btn sm" data-act="vienes" data-p="${esc(p.id)}" data-v="si">Voy</button><button class="btn ghost sm" data-act="vienes" data-p="${esc(p.id)}" data-v="duda">?</button><button class="btn ghost sm" data-act="vienes" data-p="${esc(p.id)}" data-v="no">No voy</button></div></div>`;
}

/* ---------- Visor de fotos a pantalla completa ---------- */
function visor(lista, i) {
  const capa = document.createElement('div'); capa.className = 'visor'; capa.setAttribute('role', 'dialog'); capa.setAttribute('aria-label', 'Fotos');
  capa.innerHTML = `<div class="vi-pista">${lista.map(u => `<div class="vi-item"><img src="${esc(u)}" alt="" draggable="false"></div>`).join('')}</div>
    <button class="vi-cerrar" aria-label="Cerrar">✕</button><span class="vi-cont"></span>
    ${lista.length > 1 ? '<button class="vi-flecha izq" aria-label="Anterior">‹</button><button class="vi-flecha der" aria-label="Siguiente">›</button>' : ''}`;
  document.body.appendChild(capa); document.body.style.overflow = 'hidden';
  const pista = capa.querySelector('.vi-pista'), cont = capa.querySelector('.vi-cont');
  const actual = () => Math.round(pista.scrollLeft / pista.clientWidth);
  const marcar = () => { cont.textContent = `${actual() + 1} / ${lista.length}`; };
  const ir = k => pista.scrollTo({ left: Math.max(0, Math.min(lista.length - 1, k)) * pista.clientWidth, behavior: sinMov ? 'auto' : 'smooth' });
  requestAnimationFrame(() => { pista.scrollLeft = i * pista.clientWidth; marcar(); });
  pista.addEventListener('scroll', marcar, { passive: true });
  const cerrar = () => { capa.classList.add('fuera'); document.body.style.overflow = ''; removeEventListener('keydown', tecla); setTimeout(() => capa.remove(), 250); };
  const tecla = e => { if (e.key === 'Escape') cerrar(); else if (e.key === 'ArrowRight') ir(actual() + 1); else if (e.key === 'ArrowLeft') ir(actual() - 1); e.stopPropagation(); };
  addEventListener('keydown', tecla);
  capa.querySelector('.vi-cerrar').onclick = cerrar;
  capa.querySelectorAll('.vi-flecha').forEach(b => b.onclick = () => ir(actual() + (b.classList.contains('der') ? 1 : -1)));
  // tirar hacia abajo para cerrar
  let y0 = null, x0 = 0, dy = 0;
  pista.addEventListener('touchstart', e => { y0 = e.touches[0].clientY; x0 = e.touches[0].clientX; dy = 0; }, { passive: true });
  pista.addEventListener('touchmove', e => {
    if (y0 == null) return; const ddy = e.touches[0].clientY - y0, ddx = e.touches[0].clientX - x0;
    if (dy === 0 && Math.abs(ddx) > Math.abs(ddy)) { y0 = null; return; }
    dy = Math.max(0, ddy); pista.style.transform = `translateY(${dy}px) scale(${1 - Math.min(dy, 300) / 1500})`; capa.style.setProperty('--fondo', String(1 - Math.min(dy, 300) / 400));
  }, { passive: true });
  pista.addEventListener('touchend', () => {
    if (y0 == null && !dy) return; y0 = null;
    if (dy > 110) return cerrar();
    pista.style.transition = 'transform .25s ease'; pista.style.transform = ''; capa.style.removeProperty('--fondo'); setTimeout(() => pista.style.transition = '', 260); dy = 0;
  });
}
document.addEventListener('click', e => {
  const a = e.target.closest('.galeria a'); if (!a) return;
  e.preventDefault();
  const enlaces = [...a.closest('.galeria').querySelectorAll('a')];
  visor(enlaces.map(x => x.getAttribute('href')), enlaces.indexOf(a));
}, true);
// Línea del tiempo con los hitos del equipo, calculados solos
function hitos() {
  const ps = partidos().filter(jugado).sort((a, b) => a.fecha.localeCompare(b.fecha)), js = jugadores();
  if (!ps.length) return '';
  const h = [], mr = p => `${p.gf}-${p.gc} contra ${p.rival}`;
  h.push({ f: ps[0].fecha, i: '🏁', t: 'Primer partido', d: mr(ps[0]), id: ps[0].id });
  const v1 = ps.find(p => res(p) === 'w'); if (v1) h.push({ f: v1.fecha, i: '🏆', t: 'Primera victoria', d: mr(v1), id: v1.id });
  const goleada = ps.filter(p => res(p) === 'w').sort((a, b) => (b.gf - b.gc) - (a.gf - a.gc) || a.fecha.localeCompare(b.fecha))[0];
  if (goleada && goleada.gf - goleada.gc >= 3) h.push({ f: goleada.fecha, i: '💥', t: 'Mayor goleada', d: mr(goleada), id: goleada.id });
  const masG = [...ps].sort((a, b) => b.gf - a.gf || a.fecha.localeCompare(b.fecha))[0];
  if (masG && masG !== goleada && +masG.gf >= 4) h.push({ f: masG.fecha, i: '⚽', t: `Récord de goles: ${masG.gf}`, d: mr(masG), id: masG.id });
  for (const p of ps) {
    const c = {}; (p.eventos_web || []).filter(e => e.nuestro && e.tipo === 'gol').forEach(e => c[e.jugador_id || e.jugador] = (c[e.jugador_id || e.jugador] || 0) + 1);
    const [quien, n] = Object.entries(c).sort((a, b) => b[1] - a[1])[0] || [];
    if (n >= 3) { const j = js.find(x => x.id === quien); h.push({ f: p.fecha, i: '🎩', t: `${n >= 4 ? 'Póker' : 'Hat-trick'} de ${j ? corto(j) : quien}`, d: mr(p), id: p.id }); break; }
  }
  const cero = ps.find(p => +p.gc === 0); if (cero) h.push({ f: cero.fecha, i: '🧱', t: 'Primera portería a cero', d: mr(cero), id: cero.id });
  const { puntos } = evolucion();
  if (puntos.length) { const mejor = puntos.reduce((m, x) => x.pos < m.pos ? x : m); h.push({ f: mejor.f, i: '📈', t: `Mejor posición: ${mejor.pos}º`, d: `${mejor.pts} puntos en la tabla` }); }
  let r = 0, mx = { n: 0 }; for (const p of ps) { r = res(p) === 'w' ? r + 1 : 0; if (r > mx.n && r >= 2) mx = { n: r, p }; }
  if (mx.p) h.push({ f: mx.p.fecha, i: '🔥', t: `Racha de ${mx.n} victorias`, d: 'la mejor de la temporada', id: mx.p.id });
  h.sort((a, b) => a.f.localeCompare(b.f));
  return `<h2>📜 Hitos de La Farga</h2><div class="card hitos">${h.map((x, k) => `<div class="hito ${x.id ? 'clic' : ''}" style="--k:${k}" ${x.id ? `data-act="ver-partido" data-id="${esc(x.id)}"` : ''}>
    <span class="hi-ico">${x.i}</span><div><span class="hi-f">${fFecha(x.f)}</span><b>${esc(x.t)}</b><span class="muted">${esc(x.d)}</span></div></div>`).join('')}</div>`;
}
// Abre el resumen de un partido naciendo del cuadrito, igual que los equipos desde la tabla
function abrirDesde(el, id) {
  const d = document.getElementById('modal'); if (d.open) d.close();
  zoomDesde = { escudo: el, r: el.getBoundingClientRect() };
  resumenPartido(id);
}
// Ventanita al pasar el ratón por los últimos resultados
let popT = 0;
function ocultarPop(ya) {
  clearTimeout(popT);
  const fuera = () => { const v = document.querySelector('.pop-ult'); if (!v) return; v.classList.add('sale'); setTimeout(() => v.remove(), 160); };
  if (ya) fuera(); else popT = setTimeout(fuera, 140);
}
// Desde qué equipo se lee el resultado: el del cuadrito, el resaltado en la liga o ninguno
function eqDe(el, g) { const e = el.dataset.eq || ([g.local, g.visitante].includes(resaltado) ? resaltado : ''); return [g.local, g.visitante].includes(e) ? e : ''; }
const jornadaDe = f => (jornadasLiga().find(j => j.f === f) || {}).n;
function mostrarPopG(el) {
  const g = grupoPorClave(el.dataset.g); if (!g) return;
  const k = claveG(g), eq = eqDe(el, g), r = resDe(g, eq), jug = g.estado === 'jugado';
  let v = document.querySelector('.pop-ult');
  if (v && v.dataset.id === k + eq) return;
  if (v) v.remove();
  const j = jornadaDe(g.fecha);
  v = document.createElement('div'); v.className = `pop-ult ${r}`; v.dataset.id = k + eq;
  v.innerHTML = `<button type="button" data-act="pop-g" data-g="${esc(k)}" data-eq="${esc(eq)}">
    <div class="pu-vs">${logo(g.local, 34)}<em>vs</em>${logo(g.visitante, 34)}</div>
    <b class="pu-rival">${esc(g.local)} <span class="muted">–</span> ${esc(g.visitante)}</b>
    <div class="pu-res">${jug ? `${g.gf}-${g.gc} <span>${r ? { w: 'GANA', d: 'EMPATA', l: 'PIERDE' }[r] + ' ' + esc(abrev(eq)) : +g.gf > +g.gc ? 'GANA ' + esc(abrev(g.local)) : +g.gf < +g.gc ? 'GANA ' + esc(abrev(g.visitante)) : 'EMPATE'}</span>` : g.estado === 'aplazado' ? '<span>APLAZADO</span>' : `${esc(g.hora || 'vs')} <span>PENDIENTE</span>`}</div>
    <div class="pu-meta">${j ? 'Jornada ' + j + ' · ' : ''}${fFecha(g.fecha)}${g.campo ? '<br>' + esc(g.campo.split('·')[0].trim()) : ''}</div>
    <div class="pu-ver">Toca para ver el partido</div></button>`;
  colocarPop(v, el);
}
function abrirGrupo(el, k, eq) {
  const d = document.getElementById('modal'); if (d.open) d.close();
  const l = el.querySelector && el.querySelector('.logo');
  const base = l || el; zoomDesde = { escudo: base, r: base.getBoundingClientRect() };
  resumenGrupo(k, eq);
}
// Ficha de un partido entre otros equipos del grupo
function resumenGrupo(k, eq) {
  const g = grupoPorClave(k); if (!g) return;
  const jug = g.estado === 'jugado', r = resDe(g, eq), j = jornadaDe(g.fecha);
  const lado = n => `<button type="button" class="rg-eq" data-act="ver-equipo" data-eq="${esc(n)}">${logo(n, 64)}<b>${esc(n)}</b>${(() => { const c = (web.clasificacion || []).find(e => e.equipo === n); return c ? `<span class="muted">${c.pos}º · ${c.pts} pts</span>` : ''; })()}</button>`;
  const misma = (web.grupo_partidos || []).filter(x => x.fecha === g.fecha && claveG(x) !== k);
  const antes = (web.grupo_partidos || []).filter(x => x.estado === 'jugado' && claveG(x) !== k && [x.local, x.visitante].includes(g.local) && [x.local, x.visitante].includes(g.visitante));
  const filaG = x => `<div class="rg-otro clic" ${attrsPartido(x, eq)}>${logo(x.local, 18)}<span>${esc(abrev(x.local))}</span><b>${x.estado === 'jugado' ? `${x.gf}-${x.gc}` : esc(x.hora || '–')}</b><span>${esc(abrev(x.visitante))}</span>${logo(x.visitante, 18)}</div>`;
  const ganador = jug ? (+g.gf > +g.gc ? g.local : +g.gf < +g.gc ? g.visitante : '') : '';
  modalFuera = true; modal(`<button class="cerrar" value="cancel" formnovalidate aria-label="Cerrar">✕</button>
    <div class="marcador ${r}">
      <div class="muted">${j ? 'Jornada ' + j + ' · ' : ''}${fFecha(g.fecha, jug ? '' : g.hora)}</div>
      <div class="rg-cara">${lado(g.local)}<span class="res">${jug ? rodillo(`${g.gf}-${g.gc}`) : g.estado === 'aplazado' ? 'APLAZ.' : 'vs'}</span>${lado(g.visitante)}</div>
      <div class="muted" style="margin-top:6px">${esc(g.campo || '')}</div>
      ${jug ? `<div class="veredicto">${r ? { w: 'VICTORIA', d: 'EMPATE', l: 'DERROTA' }[r] + ' · ' + esc(eq) : ganador ? 'GANA ' + esc(ganador) : 'EMPATE'}</div>` : ''}
    </div>
    ${antes.length ? `<h3>Otros enfrentamientos</h3>${antes.map(filaG).join('')}` : ''}
    ${misma.length ? `<h3>Resto de la jornada${j ? ' ' + j : ''}</h3>${misma.map(filaG).join('')}` : ''}
    <p class="muted" style="font-size:11px;margin-top:12px">Toca un escudo para ver la ficha del equipo.</p>
    <div class="actions">${botonCompartir('g=' + k, `${g.local} – ${g.visitante}${jug ? ' ' + g.gf + '-' + g.gc : ''}`)}</div>`);
}
function colocarPop(v, el) {
  document.body.appendChild(v);
  const o = el.getBoundingClientRect(), w = v.offsetWidth, h = v.offsetHeight;
  const x = Math.max(8, Math.min(innerWidth - w - 8, o.left + o.width / 2 - w / 2));
  const arriba = o.top - h - 10 > 70;
  v.style.left = x + 'px'; v.style.top = (arriba ? o.top - h - 10 : o.bottom + 10) + 'px';
  v.style.setProperty('--fx', (o.left + o.width / 2 - x) + 'px');
  v.classList.add(arriba ? 'arriba' : 'abajo');
  v.addEventListener('mouseenter', () => clearTimeout(popT));
  v.addEventListener('mouseleave', () => ocultarPop());
  v._de = el;
}
function mostrarPop(el) {
  clearTimeout(popT);
  if (el.dataset.act === 'ver-g') return mostrarPopG(el);
  const p = getPartido(el.dataset.id || el.dataset.pid); if (!p) return;
  let v = document.querySelector('.pop-ult');
  if (v && v.dataset.id === p.id) return;
  if (v) v.remove();
  const r = res(p);
  v = document.createElement('div'); v.className = `pop-ult ${r || ''}`; v.dataset.id = p.id;
  v.innerHTML = `<button type="button" data-act="pop-ult" data-id="${esc(p.id)}">
    <div class="pu-vs">${VS(p.rival)}</div>
    <b class="pu-rival">${esc(p.rival)}</b>
    <div class="pu-res">${jugado(p) ? `${p.gf}-${p.gc} <span>${{ w: 'VICTORIA', d: 'EMPATE', l: 'DERROTA' }[r]}</span>` : p.estado === 'aplazado' ? '<span>APLAZADO</span>' : `${esc(p.hora || 'vs')} <span>${p.fecha === hoy() ? 'HOY' : 'PRÓXIMO'}</span>`}</div>
    <div class="pu-meta">${p.jornada ? 'Jornada ' + esc(p.jornada) + ' · ' : ''}${fFecha(p.fecha)}${p.campo ? '<br>' + esc(p.campo.split('·')[0].trim()) : ''}</div>
    <div class="pu-ver">Toca para ver el partido</div></button>`;
  colocarPop(v, el);
}
if (matchMedia('(hover: hover)').matches) {
  document.addEventListener('mouseover', e => { const el = e.target.closest && e.target.closest('[data-act="ver-ult"], [data-act="ver-g"], .cal-dia[data-pid]'); if (el) mostrarPop(el); });
  document.addEventListener('mouseout', e => { const el = e.target.closest && e.target.closest('[data-act="ver-ult"], [data-act="ver-g"], .cal-dia[data-pid]'); if (el && !(e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('.pop-ult'))) ocultarPop(); });
  addEventListener('scroll', () => ocultarPop(true), { passive: true });
}
document.addEventListener('focusin', e => { const el = e.target.closest && e.target.closest('[data-act="ver-ult"], [data-act="ver-g"]'); if (el) mostrarPop(el); });
document.addEventListener('keydown', e => { const el = e.target.closest && e.target.closest('[data-act="ver-ult"], [data-act="ver-g"]'); if (el && el.tagName !== 'BUTTON' && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); ocultarPop(true); el.dataset.act === 'ver-g' ? abrirGrupo(el, el.dataset.g, el.dataset.eq) : abrirDesde(el, el.dataset.id); } }, true);
/* ---------- Resultados de toda la liga por jornadas, con un equipo resaltado ---------- */
let resaltado = EQUIPO;
function jornadasLiga() {
  const gp = web.grupo_partidos || [];
  const fechas = [...new Set(gp.map(p => p.fecha).filter(Boolean))].sort();
  const eqs = (web.clasificacion || []).map(e => e.equipo);
  return fechas.map((f, i) => {
    const ps = gp.filter(p => p.fecha === f);
    const juegan = new Set(ps.flatMap(p => [p.local, p.visitante]));
    return { n: i + 1, f, ps, descansa: eqs.filter(e => !juegan.has(e)), jugada: ps.some(p => p.estado === 'jugado') };
  });
}
const resDe = (p, eq) => { if (p.estado !== 'jugado' || ![p.local, p.visitante].includes(eq)) return ''; const a = p.local === eq ? +p.gf : +p.gc, b = p.local === eq ? +p.gc : +p.gf; return a > b ? 'w' : a < b ? 'l' : 'd'; };
function resumenResaltado(js) {
  const eq = resaltado, ps = js.flatMap(j => j.ps).filter(p => p.estado === 'jugado' && [p.local, p.visitante].includes(eq));
  const c = { w: 0, d: 0, l: 0 }; let gf = 0, gc = 0;
  ps.forEach(p => { c[resDe(p, eq)]++; gf += p.local === eq ? +p.gf : +p.gc; gc += p.local === eq ? +p.gc : +p.gf; });
  const cl = (web.clasificacion || []).find(e => e.equipo === eq);
  return `<div class="rl-resumen">${logo(eq, 34)}<div><b>${esc(eq)}</b><span class="muted">${cl ? cl.pos + 'º · ' + cl.pts + ' pts · ' : ''}${c.w}G ${c.d}E ${c.l}P · ${gf}-${gc}</span></div>
    ${eq !== EQUIPO ? `<button class="btn ghost sm" data-act="resaltar" data-eq="${esc(EQUIPO)}">Volver a La Farga</button>` : ''}</div>`;
}
function resultadosLiga() {
  const js = jornadasLiga(); if (!js.length) return '';
  const eqs = (web.clasificacion || []).map(e => e.equipo);
  const ult = js.filter(j => j.jugada).pop();
  const lado = (eq, der) => `<button type="button" class="rl-eq ${der ? 'der' : ''}" data-act="resaltar" data-eq="${esc(eq)}" data-r="${esc(eq)}">${der ? '' : logo(eq, 22)}<span>${esc(abrev(eq))}</span>${der ? logo(eq, 22) : ''}</button>`;
  const fila = p => {
    const nuestro = [p.local, p.visitante].includes(EQUIPO);
    const pid = nuestro ? (partidos().find(x => x.fecha === p.fecha && [p.local, p.visitante].includes(x.rival)) || {}).id : '';
    const marc = p.estado === 'jugado' ? `${p.gf}-${p.gc}` : esc(p.hora || (p.estado === 'aplazado' ? 'APLAZ.' : '–'));
    return `<div class="rl-fila" data-l="${esc(p.local)}" data-v="${esc(p.visitante)}" data-rl="${esc(resDe(p, p.local))}" data-rv="${esc(resDe(p, p.visitante))}">
      ${lado(p.local)}<button type="button" ${pid ? `data-act="ver-ult" data-id="${esc(pid)}"` : `data-act="ver-g" data-g="${esc(claveG(p))}" data-eq=""`} class="rl-marc ${p.estado === 'jugado' ? '' : 'pend'}">${marc}</button>${lado(p.visitante, true)}
      <i class="rl-tag" ${p.estado === 'jugado' ? (pid ? `data-act="ver-ult" data-id="${esc(pid)}"` : `data-act="ver-g" data-g="${esc(claveG(p))}" data-eq=""`) : ''}></i></div>`;
  };
  return `<h2>Resultados de la liga</h2>
    <div class="rl-equipos">${eqs.map(e => `<button type="button" class="rl-chip" data-act="resaltar" data-eq="${esc(e)}" title="${esc(e)}">${logo(e, 26)}</button>`).join('')}</div>
    <div id="rl-resumen">${resumenResaltado(js)}</div>
    <div class="resultados-liga" id="rl">
      ${js.map(j => `<div class="card rl-jornada ${j.jugada ? '' : 'futura'} ${ult && j.n === ult.n ? 'ultima' : ''}" style="--k:${j.n}">
        <div class="rl-cab"><b>Jornada ${j.n}</b><span class="muted">${fFecha(j.f)}${ult && j.n === ult.n ? ' · última' : ''}</span></div>
        ${j.ps.map(fila).join('')}
        ${j.descansa.length ? `<div class="rl-descansa" data-d="${esc(j.descansa.join('|'))}">Descansa: ${j.descansa.map(e => `<button type="button" data-act="resaltar" data-eq="${esc(e)}" data-r="${esc(e)}">${esc(e)}</button>`).join(', ')}</div>` : ''}
      </div>`).join('')}
    </div>`;
}
// Marca el equipo elegido en todas las jornadas sin redibujar la página
function pintarResaltado(animar) {
  const raiz = document.getElementById('rl'); if (!raiz) return;
  const eq = resaltado;
  raiz.querySelectorAll('.rl-fila').forEach(f => {
    const esL = f.dataset.l === eq, esV = f.dataset.v === eq, r = esL ? f.dataset.rl : esV ? f.dataset.rv : '';
    f.classList.toggle('on', esL || esV);
    f.classList.remove('r-w', 'r-d', 'r-l'); if (r) f.classList.add('r-' + r);
    f.querySelector('.rl-tag').textContent = r ? { w: 'G', d: 'E', l: 'P' }[r] : (esL || esV) ? '·' : '';
  });
  raiz.querySelectorAll('[data-r]').forEach(b => b.classList.toggle('on', b.dataset.r === eq));
  raiz.querySelectorAll('.rl-descansa').forEach(d => d.classList.toggle('on', d.dataset.d.split('|').includes(eq)));
  document.querySelectorAll('.rl-chip').forEach(c => c.classList.toggle('on', c.dataset.eq === eq));
  const res = document.getElementById('rl-resumen'); if (res) res.innerHTML = resumenResaltado(jornadasLiga());
  if (animar && !sinMov) raiz.querySelectorAll('.rl-fila.on').forEach((f, k) => f.animate([{ transform: 'scale(.97)', opacity: .5 }, { transform: 'none', opacity: 1 }], { duration: 380, delay: k * 35, easing: 'cubic-bezier(.3,.7,.2,1)', fill: 'backwards' }));
}
// A este ritmo: puntos por partido de cada uno llevados al total de su calendario
function proyeccion(c) {
  const gp = web.grupo_partidos || []; if (!c.length || !gp.length) return '';
  const l = c.filter(e => e.pj).map(e => {
    const tot = gp.filter(p => [p.local, p.visitante].includes(e.equipo)).length || e.pj;
    return { eq: e.equipo, pos: e.pos, pts: e.pts, fin: Math.round(e.pts / e.pj * tot), tot };
  }).sort((a, b) => b.fin - a.fin || a.pos - b.pos).map((x, i) => ({ ...x, posFin: i + 1 }));
  const yo = l.find(x => x.eq === EQUIPO); if (!yo) return '';
  return `<h2>🔮 A este ritmo…</h2><div class="card proyeccion">
    <div class="pr-yo">Acabaríamos <b class="cnt">${yo.posFin}º</b> con <b class="cnt">${yo.fin}</b> puntos <span class="muted">(${yo.tot} partidos)</span></div>
    ${l.map((x, k) => `<div class="pr-fila ${x.eq === EQUIPO ? 'yo' : ''}" style="--k:${k}"><span class="pr-pos">${x.posFin}º</span>${logo(x.eq, 18)}<span class="pr-eq">${esc(x.eq)}</span>
      <span class="pr-barra"><i style="--p:${x.fin / Math.max(1, l[0].fin)}"></i></span><b>${x.fin}</b>
      <span class="pr-mov">${x.posFin < x.pos ? `<em class="sube">▲${x.pos - x.posFin}</em>` : x.posFin > x.pos ? `<em class="baja">▼${x.posFin - x.pos}</em>` : ''}</span></div>`).join('')}
    <p class="muted" style="margin:6px 0 0;font-size:11px">Proyección con los puntos por partido de cada equipo hasta hoy.</p></div>`;
}
// Balance contra cada rival
function contraCadaRival() {
  const ps = partidos().filter(jugado); if (!ps.length) return '';
  const t = {};
  for (const p of ps) { const x = t[p.rival] = t[p.rival] || { pj: 0, w: 0, d: 0, l: 0, gf: 0, gc: 0 }; x.pj++; x[res(p)]++; x.gf += +p.gf; x.gc += +p.gc; }
  const l = Object.entries(t).sort((a, b) => (b[1].w * 3 + b[1].d) / b[1].pj - (a[1].w * 3 + a[1].d) / a[1].pj || (b[1].gf - b[1].gc) - (a[1].gf - a[1].gc));
  return `<h2>⚔️ Contra cada rival</h2><div class="card" style="padding:4px 8px"><table class="vs-rivales"><thead><tr><th>Rival</th><th class="n">PJ</th><th class="n">G-E-P</th><th class="n">Goles</th></tr></thead><tbody>
    ${l.map(([eq, x]) => { const tono = x.w > x.l ? 'w' : x.l > x.w ? 'l' : 'd';
      return `<tr class="clic" data-act="ver-equipo" data-eq="${esc(eq)}"><td><span class="row" style="gap:6px">${logo(eq, 20)}<span>${esc(eq)}</span></span></td><td class="n">${x.pj}</td>
        <td class="n"><b class="tono-${tono}">${x.w}-${x.d}-${x.l}</b></td><td class="n">${x.gf}-${x.gc}</td></tr>`; }).join('')}
  </tbody></table><p class="muted" style="margin:4px;font-size:11px">Toca un rival para ver su ficha.</p></div>`;
}
// Lista de partidos agrupada por meses con la cabecera pegada arriba
function porMeses(ps) {
  const g = {}; ps.forEach(p => { const k = (p.fecha || '').slice(0, 7); (g[k] = g[k] || []).push(p); });
  return Object.entries(g).map(([k, l]) => `<section class="mes-grupo"><h3 class="mes-pegado">${k ? MESES_L[+k.slice(5) - 1] + ' ' + k.slice(0, 4) : 'Sin fecha'} <span>${l.length} partido${l.length !== 1 ? 's' : ''}</span></h3>${l.map(matchCard).join('')}</section>`).join('');
}

/* ---------- Novedades desde tu última visita ---------- */
function fotoActual() {
  const ps = partidos(), prox = ps.find(p => !jugado(p) && p.estado !== 'aplazado' && p.fecha >= hoy());
  return { t: Date.now(), jugados: ps.filter(jugado).map(p => p.id), fotos: fotos.length, votos: local.votos.length, porras: local.porras.length,
    prox: prox ? prox.id : '', resp: prox ? Object.keys(prox.asistencia || {}).length : 0,
    pos: ((web.clasificacion || []).find(c => c.equipo === EQUIPO) || {}).pos || 0 };
}
let fotoPrevia = null, novedadesFuera = false;
try { fotoPrevia = JSON.parse(localStorage.getItem('lafarga.visita') || 'null'); } catch (e) { /* sin almacenamiento */ }
const guardarVisita = () => { try { if ((partidos() || []).length) localStorage.setItem('lafarga.visita', JSON.stringify(fotoActual())); } catch (e) { /* sin almacenamiento */ } };
addEventListener('pagehide', guardarVisita);
document.addEventListener('visibilitychange', () => { if (document.hidden) guardarVisita(); });
function novedades() {
  if (!fotoPrevia || novedadesFuera) return '';
  const a = fotoActual(), ps = partidos(), js = jugadores(), l = [];
  for (const id of a.jugados.filter(id => !fotoPrevia.jugados.includes(id))) { const p = ps.find(x => x.id === id); if (p) l.push(`<button type="button" data-act="ver-ult" data-id="${esc(p.id)}">⚽ Resultado: <b>La Farga ${p.gf}-${p.gc} ${esc(p.rival)}</b></button>`); }
  if (a.pos && fotoPrevia.pos && a.pos !== fotoPrevia.pos) l.push(`<span>${a.pos < fotoPrevia.pos ? '▲ Subimos' : '▼ Bajamos'} al <b>${a.pos}º</b> (antes ${fotoPrevia.pos}º)</span>`);
  if (a.fotos > fotoPrevia.fotos) l.push(`<span>📸 ${a.fotos - fotoPrevia.fotos} foto${a.fotos - fotoPrevia.fotos > 1 ? 's' : ''} nueva${a.fotos - fotoPrevia.fotos > 1 ? 's' : ''}</span>`);
  if (a.votos > fotoPrevia.votos) l.push(`<span>⭐ ${a.votos - fotoPrevia.votos} voto${a.votos - fotoPrevia.votos > 1 ? 's' : ''} de MVP</span>`);
  if (a.porras > fotoPrevia.porras) l.push(`<span>🎯 ${a.porras - fotoPrevia.porras} apuesta${a.porras - fotoPrevia.porras > 1 ? 's' : ''} nueva${a.porras - fotoPrevia.porras > 1 ? 's' : ''} en la porra</span>`);
  if (a.prox && a.prox === fotoPrevia.prox && a.resp > fotoPrevia.resp) l.push(`<span>🙋 ${a.resp - fotoPrevia.resp} más ha${a.resp - fotoPrevia.resp > 1 ? 'n' : ''} respondido si viene${a.resp - fotoPrevia.resp > 1 ? 'n' : ''}</span>`);
  if (!l.length) return '';
  const h = Math.round((Date.now() - fotoPrevia.t) / 36e5);
  return `<div class="card novedades"><div class="row spread"><b>✨ Desde tu última visita</b><span class="muted">${h < 1 ? 'hace un rato' : h < 48 ? `hace ${h} h` : `hace ${Math.round(h / 24)} días`}</span></div>
    <div class="nov-lista">${l.map((x, k) => `<div style="--k:${k}">${x}</div>`).join('')}</div>
    <button class="cerrar-mini" data-act="novedades-fuera" aria-label="Ocultar">✕</button></div>`;
}

/* ---------- Celebración al subir puestos ---------- */
function comprobarSubida() {
  if (document.querySelector('.res-nuevo')) return void setTimeout(comprobarSubida, 700);
  const yo = (web.clasificacion || []).find(c => c.equipo === EQUIPO); if (!yo || !yo.pos) return;
  let antes = 0; try { antes = +localStorage.getItem('lafarga.pos') || 0; localStorage.setItem('lafarga.pos', yo.pos); } catch (e) { return; }
  if (!antes || yo.pos >= antes) return;
  const c = document.createElement('div'); c.className = 'subida'; c.setAttribute('role', 'status');
  c.innerHTML = `<div class="sb-caja"><span class="sb-flecha">▲</span><b>Subimos al ${yo.pos}º</b><span>antes ${antes}º · ${yo.pts} puntos</span></div>`;
  document.body.appendChild(c); confeti(); vibrar([20, 60, 20]);
  c.addEventListener('click', () => c.remove());
  setTimeout(() => { c.classList.add('fuera'); setTimeout(() => c.remove(), 500); }, 3400);
}

/* ---------- Escudo de Inicio que se inclina en 3D ---------- */
(() => {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  let rx = 0, ry = 0, raf = 0;
  const aplicar = () => { raf = 0; const e = document.querySelector('.escudo-brillo'); if (e) e.style.transform = `perspective(500px) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg)`; };
  const pedir = () => { if (!raf) raf = requestAnimationFrame(aplicar); };
  document.addEventListener('pointermove', e => {
    if (e.pointerType !== 'mouse') return;
    const h = e.target.closest && e.target.closest('.hero'); const esc = document.querySelector('.escudo-brillo');
    if (!esc) return;
    if (!h) { if (rx || ry) { rx = ry = 0; pedir(); } return; }
    const r = esc.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    ry = Math.max(-1, Math.min(1, (e.clientX - cx) / 160)) * 22; rx = -Math.max(-1, Math.min(1, (e.clientY - cy) / 120)) * 18; pedir();
  }, { passive: true });
  addEventListener('deviceorientation', e => {
    if (e.beta == null || tab !== 'inicio') return;
    ry = Math.max(-20, Math.min(20, e.gamma || 0)); rx = Math.max(-18, Math.min(18, (e.beta || 0) - 45)) * -.6; pedir();
  }, { passive: true });
})();
// Comparativa a través de rivales comunes: cómo le fue a cada uno contra el mismo equipo
function rivalesComunes(n) {
  const gp = (web.grupo_partidos || []).filter(p => p.estado === 'jugado');
  const de = (eq, x) => gp.filter(p => [p.local, p.visitante].includes(eq) && [p.local, p.visitante].includes(x))
    .map(p => ({ r: resDe(p, eq), m: p.local === eq ? `${p.gf}-${p.gc}` : `${p.gc}-${p.gf}`, g: p, eq }));
  const eqs = (web.clasificacion || []).map(e => e.equipo).filter(x => x !== n && x !== EQUIPO);
  const l = eqs.map(x => ({ x, nos: de(EQUIPO, x), ellos: de(n, x) })).filter(o => o.nos.length && o.ellos.length);
  if (!l.length) return '';
  const pts = arr => arr.reduce((s, o) => s + (o.r === 'w' ? 3 : o.r === 'd' ? 1 : 0), 0);
  const a = l.reduce((s, o) => s + pts(o.nos), 0), b = l.reduce((s, o) => s + pts(o.ellos), 0);
  const chip = o => `<b class="rc-r ${o.r} clic" ${attrsPartido(o.g, o.eq)}>${o.m}</b>`;
  return `<h3>Rivales comunes</h3><div class="rivales-comunes">
    <div class="rc-fila rc-cab"><span></span><span>Nosotros</span><span>Ellos</span></div>
    ${l.map(o => `<div class="rc-fila"><span class="rc-eq">${logo(o.x, 18)} ${esc(abrev(o.x))}</span><span>${o.nos.map(chip).join(' ')}</span><span>${o.ellos.map(chip).join(' ')}</span></div>`).join('')}
    <div class="rc-total ${a > b ? 'w' : a < b ? 'l' : 'd'}">En esos partidos: nosotros <b>${a} pts</b> · ellos <b>${b} pts</b> — ${a > b ? 'salimos ganando 💪' : a < b ? 'ellos van mejor, ojo' : 'igualados'}</div></div>`;
}

/* ---------- Álbumes de fotos por partido ---------- */
function albumes() {
  const todas = [...GALERIA_FIJA, ...fotos].filter(f => !(f.tipo || '').startsWith('video') || f.poster);
  const g = {}; todas.forEach(f => (g[f.partido] = g[f.partido] || []).push(f));
  const ps = partidos();
  const lista = Object.entries(g).map(([pid, fs]) => ({ pid, fs, p: ps.find(x => x.id === pid) }))
    .sort((a, b) => (b.p ? b.p.fecha : '9') .localeCompare(a.p ? a.p.fecha : '9'));
  modalFuera = true; modal(`<button class="cerrar" value="cancel" formnovalidate aria-label="Cerrar">✕</button>
    <h3 style="margin-left:34px">📸 Álbumes</h3>
    ${lista.length ? `<div class="albumes">${lista.map((a, k) => { const portada = a.fs.find(f => !(f.tipo || '').startsWith('video')) || {}; const src = portada.url || a.fs[0].poster;
      return `<button type="button" class="album" style="--k:${k}" data-act="album" data-p="${esc(a.pid)}">
        <span class="al-portada" style="background-image:url('${esc(src)}')"></span>
        <span class="al-info">${a.p ? `<span class="al-vs">${VS(a.p.rival)}</span><b>${esc(a.p.rival)}</b><small>${jugado(a.p) ? a.p.gf + '-' + a.p.gc + ' · ' : ''}${fFecha(a.p.fecha)}</small>` : '<b>Equipo</b><small>Fotos generales</small>'}</span>
        <span class="al-n">${a.fs.length}</span></button>`; }).join('')}</div>` : '<p class="muted">Aún no hay fotos.</p>'}`);
}
function verAlbum(pid) {
  const fs = [...GALERIA_FIJA, ...fotos].filter(f => f.partido === pid && !(f.tipo || '').startsWith('video'));
  if (fs.length) visor(fs.map(f => f.url), 0); else toast('Este álbum solo tiene vídeos');
}

/* ---------- Deslizar la tarjeta del próximo partido: → voy, ← no voy ---------- */
(() => {
  let c = null, x0 = 0, y0 = 0, dx = 0, horiz = null;
  addEventListener('touchstart', e => { c = e.target.closest('.match.desliza'); if (!c) return; x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; dx = 0; horiz = null; c.style.transition = 'none'; }, { passive: true });
  addEventListener('touchmove', e => {
    if (!c) return; const t = e.touches[0]; dx = t.clientX - x0; const dy = t.clientY - y0;
    if (horiz === null && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) horiz = Math.abs(dx) > Math.abs(dy);
    if (!horiz) return;
    const v = Math.max(-140, Math.min(140, dx));
    c.style.transform = `translateX(${v}px) rotate(${v / 40}deg)`;
    c.classList.toggle('va-si', dx > 60); c.classList.toggle('va-no', dx < -60);
  }, { passive: true });
  addEventListener('touchend', () => {
    if (!c) return; const el = c; c = null;
    el.style.transition = 'transform .35s cubic-bezier(.3,.7,.2,1)'; el.style.transform = '';
    setTimeout(() => el.classList.remove('va-si', 'va-no'), 350);
    if (!horiz || Math.abs(dx) < 90) return;
    const yo = yoId(); if (!yo) { toast('Primero elige quién eres en la porra o en el MVP'); return; }
    marcarAsistencia(el.dataset.id, yo, dx > 0 ? 'si' : 'no'); toast(dx > 0 ? '¡Apuntado! 💪' : 'Apuntado que no vienes');
  });
})();
function matchCard(p) {
  const r = res(p);
  return `
    <div class="card match" data-act="ver-partido" data-id="${esc(p.id)}">
      <div>
        <div><b>${p.local === false ? esc(p.rival) + ' – La Farga' : 'La Farga – ' + esc(p.rival)}</b></div>
        <div class="muted">${fFecha(p.fecha, p.hora)}${p.campo ? ' · ' + esc(p.campo) : ''}</div>
        ${p.jornada ? `<span class="tag">J${p.jornada}</span> ` : ''}${p.estado === 'aplazado' ? '<span class="tag manual">aplazado</span> ' : ''}${p.fuente !== 'web' ? `<span class="tag manual">manual</span>` : `<span class="tag">web</span>`}${!jugado(p) && p.estado !== 'aplazado' ? ' ' + dificultad(p.rival) : ''}
      </div>
      <div class="score ${r || ''}" ${jugado(p) ? `data-act="ver-ult" data-id="${esc(p.id)}"` : ''}>${jugado(p) ? `${p.gf}-${p.gc}` : p.estado === 'aplazado' ? '–' : 'vs'}</div>
    </div>`;
}

function asistenciaCard(p) {
  const js = jugadores().filter(j => !j.invitado);
  if (!js.length) return '';
  const a = p.asistencia || {};
  const si = js.filter(j => a[j.id] === 'si' && !lesionDe(j.id)), n = si.length;
  const portero = si.some(j => /portero/i.test(j.posicion || ''));
  const faltan = js.filter(j => !a[j.id] && !lesionDe(j.id)).length;
  const avisos = [];
  if (n < 7) avisos.push(`⚠️ Somos ${n}: faltan ${7 - n} para llegar a 7.`);
  else avisos.push(`✅ Somos ${n}: hay equipo${n > 7 ? ` y ${n - 7} cambio${n - 7 > 1 ? 's' : ''}` : ', pero sin cambios'}.`);
  if (!portero) avisos.push('🧤 No hay portero confirmado.');
  if (faltan) avisos.push(`${faltan} sin responder.`);
  return `<div class="card"><div class="row spread" style="margin-bottom:8px"><b>¿Quién viene?</b><span class="muted">${n} confirmados</span></div>
    <a class="btn wa" href="https://wa.me/?text=${encodeURIComponent(textoConvocatoria(p))}" target="_blank" rel="noopener"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20l1.3-4A8 8 0 1 1 8 18.7z"/><path d="M9 9.5c0 3 2.5 5.5 5.5 5.5l1.2-1.4-2-1-1 .9c-1-.4-1.8-1.2-2.2-2.2l.9-1-1-2z"/></svg>Mandar convocatoria al WhatsApp</a>
    <p class="muted pista-desliza">Desliza un nombre: → voy · ← no voy</p>
    <div class="aviso ${n >= 7 && portero ? 'ok' : ''}">${avisos.join('<br>')}</div>
    ${js.map(j => lesionDe(j.id) ? `<div class="row spread" style="padding:5px 0;opacity:.6"><span>${esc(corto(j))}</span><span class="tag baja">LESIONADO</span></div>` : `<div class="row spread asis-fila ${a[j.id] ? 'r-' + a[j.id] : ''}" data-p="${esc(p.id)}" data-j="${esc(j.id)}" style="padding:5px 0"><span class="asis-nombre">${esc(corto(j))}</span>
      <div class="seg" style="flex:0 0 150px">${['si', 'duda', 'no'].map(v =>
        `<button data-act="asist" data-p="${esc(p.id)}" data-j="${esc(j.id)}" data-v="${v}" class="${a[j.id] === v ? 'on-' + v : ''}">${{ si: 'Sí', duda: '?', no: 'No' }[v]}</button>`).join('')}</div></div>`).join('')}
  </div>`;
}

/* ---------- Edición ---------- */
function getPartido(id) { return partidos().find(p => p.id === id); }
function guardarPartido(p) {
  const { fuente, ...resto } = p;
  store.setPartido(resto);
}

// Las fichas de solo lectura (equipo, resumen de partido) se cierran al tocar fuera.
let modalFuera = false;
function modal(html, onSubmit) {
  const dlg = document.getElementById('modal');
  dlg.classList.remove('tinte'); dlg.dataset.tinte = ''; dlg.style.removeProperty('--tinte');
  dlg.dataset.fuera = modalFuera ? '1' : ''; modalFuera = false; dlg.dataset.zoom = ''; dlg.dataset.escudo = ''; dlg.style.animation = '';
  if (dlg._escudo) { dlg._escudo.style.visibility = ''; dlg._escudo = null; }
  if (!dlg.dataset.clicFuera) {
    dlg.dataset.clicFuera = '1';
    dlg.addEventListener('click', e => {
      if (dlg.dataset.fuera !== '1' || e.target !== dlg) return;
      const r = dlg.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) cerrarModal(dlg);
    });
  }
  const f = document.getElementById('modal-form');
  f.innerHTML = html;
  f.onsubmit = e => {
    const accion = e.submitter && e.submitter.value;
    if (accion === 'cancel') { if (dlg.dataset.zoom || dlg.dataset.giro || dlg.dataset.escudo) { e.preventDefault(); cerrarModal(dlg); } return; }
    vibrar(12);
    onSubmit(new FormData(f), accion, f);
  };
  dlg.showModal();
  contar(f);
  if (zoomDesde) { zoomDesde.escudo ? nacerDeEscudo(dlg, zoomDesde) : crecerDesde(dlg, zoomDesde); zoomDesde = null; }
}

// La ficha crece desde la fila pulsada hasta ocupar su sitio (y vuelve a ella al cerrarse)
let zoomDesde = null;
// La tarjeta del partido gira como una carta y por detrás aparece el resumen
function girarCarta(carta, abrir) {
  const dlg = document.getElementById('modal');
  if (sinMov || !carta.animate || dlg.open) { if (dlg.open) dlg.close(); return abrir(); }
  const o = carta.getBoundingClientRect();
  carta.style.transformOrigin = '50% 50%';
  carta.animate([{ transform: 'perspective(900px) rotateY(0)' }, { transform: 'perspective(900px) rotateY(90deg)' }],
    { duration: 230, easing: 'cubic-bezier(.5, 0, .9, .4)' }).onfinish = () => {
    abrir();
    if (!dlg.open) return;
    const d = dlg.getBoundingClientRect();
    const dx = (o.left + o.width / 2) - (d.left + d.width / 2), dy = (o.top + o.height / 2) - (d.top + d.height / 2);
    const sx = Math.min(1, o.width / d.width), sy = Math.min(1, o.height / d.height);
    dlg.style.animation = 'none'; dlg.dataset.giro = '1'; dlg.dataset.zoom = '';
    dlg.animate([
      { transform: `translate(${dx}px, ${dy}px) perspective(1400px) rotateY(-90deg) scale(${sx}, ${sy})`, opacity: .7 },
      { transform: `translate(${dx * .25}px, ${dy * .25}px) perspective(1400px) rotateY(-25deg) scale(${(1 + sx) / 2}, ${(1 + sy) / 2})`, opacity: 1, offset: .45 },
      { transform: 'none', opacity: 1 }], { duration: 620, easing: 'cubic-bezier(.2, .7, .2, 1)' });
  };
}
// La ficha nace del escudo de la tabla: minimizada en él, crece girando 360° y al cerrar vuelve girando
function nacerDeEscudo(dlg, z) {
  if (sinMov || !dlg.animate) return;
  dlg.style.animation = 'none'; dlg.dataset.zoom = ''; dlg.dataset.giro = '';
  const d = dlg.getBoundingClientRect(), o = z.r;
  const dx = (o.left + o.width / 2) - (d.left + d.width / 2), dy = (o.top + o.height / 2) - (d.top + d.height / 2);
  const sc = Math.max(.02, Math.min(o.width / d.width, o.height / d.height));
  const desde = { dx, dy, sc };
  dlg.dataset.escudo = JSON.stringify(desde);
  z.escudo.style.visibility = 'hidden'; dlg._escudo = z.escudo;
  dlg.animate([
    { transform: `translate(${dx}px, ${dy}px) scale(${sc}) rotate(0deg)`, opacity: .4, borderColor: 'transparent' },
    { opacity: 1, offset: .25 },
    { transform: 'translate(0, 0) scale(1) rotate(360deg)', opacity: 1 }], { duration: 900, easing: 'cubic-bezier(.45, 0, .2, 1)' })
    .onfinish = () => { if (dlg._escudo && !dlg.dataset.escudo) return; };
  dlg.firstElementChild.animate([{ opacity: 0 }, { opacity: 0, offset: .45 }, { opacity: 1 }], { duration: 900 });
}
function crecerDesde(dlg, o) {
  if (sinMov || !dlg.animate) return;
  const d = dlg.getBoundingClientRect();
  // arranca con la ficha recortada al tamaño de la fila y colocada encima de ella
  const left = Math.max(0, o.left - d.left), right = Math.max(0, d.right - o.right);
  const bottom = Math.max(0, d.height - o.height), dy = o.top - d.top;
  const desde = { clipPath: `inset(0px ${right}px ${bottom}px ${left}px)`, transform: `translateY(${dy}px)` };
  const hasta = { clipPath: 'inset(0px 0px 0px 0px)', transform: 'none' };
  dlg.style.animation = 'none';
  const opts = { duration: 560, easing: 'cubic-bezier(.2, .8, .2, 1)' };
  dlg.animate([{ ...desde, opacity: .6 }, { ...hasta, opacity: 1 }], opts);
  dlg.firstElementChild.animate([{ opacity: 0 }, { opacity: 0, offset: .3 }, { opacity: 1 }], opts);
  dlg.dataset.zoom = JSON.stringify(desde);
}
// Cierre animado (vuelve a la fila) para las fichas abiertas con zoom
function cerrarModal(dlg) {
  if (dlg.dataset.escudo) {
    const { dx, dy, sc } = JSON.parse(dlg.dataset.escudo); dlg.dataset.escudo = '';
    const vuelve = () => { if (dlg._escudo) { dlg._escudo.style.visibility = ''; dlg._escudo = null; } };
    if (sinMov || !dlg.animate) { vuelve(); return dlg.close(); }
    // recoloca por si la tabla se ha movido
    let tx = dx, ty = dy;
    if (dlg._escudo && dlg._escudo.isConnected) {
      const o = dlg._escudo.getBoundingClientRect(), d = dlg.getBoundingClientRect();
      tx = (o.left + o.width / 2) - (d.left + d.width / 2); ty = (o.top + o.height / 2) - (d.top + d.height / 2);
    }
    dlg.firstElementChild.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, fill: 'forwards' });
    dlg.animate([{ transform: 'translate(0, 0) scale(1) rotate(0deg)', opacity: 1 },
      { opacity: 1, offset: .75 },
      { transform: `translate(${tx}px, ${ty}px) scale(${sc}) rotate(360deg)`, opacity: 0 }], { duration: 760, easing: 'cubic-bezier(.6, 0, .4, 1)', fill: 'forwards' })
      .onfinish = e => { dlg.close(); e.target.cancel(); dlg.style.animation = ''; dlg.firstElementChild.getAnimations().forEach(a => a.cancel()); vuelve(); };
    return;
  }
  if (dlg.dataset.giro && !sinMov && dlg.animate) {
    dlg.dataset.giro = '';
    return dlg.animate([{ transform: 'perspective(1400px) rotateY(0)', opacity: 1 }, { transform: 'perspective(1400px) rotateY(90deg) scale(.9)', opacity: .3 }],
      { duration: 300, easing: 'cubic-bezier(.5, 0, .75, 0)' }).onfinish = () => { dlg.close(); dlg.style.animation = ''; };
  }
  const z = dlg.dataset.zoom; dlg.dataset.zoom = '';
  if (!z || sinMov || !dlg.animate) return dlg.close();
  dlg.firstElementChild.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 180, fill: 'forwards' });
  dlg.animate([{ clipPath: 'inset(0px 0px 0px 0px)', transform: 'none', opacity: 1 }, { ...JSON.parse(z), opacity: .4 }], { duration: 340, easing: 'cubic-bezier(.4, 0, .2, 1)' })
    .onfinish = () => { dlg.close(); dlg.style.animation = ''; dlg.firstElementChild.getAnimations().forEach(a => a.cancel()); };
}

function editarPartido(id) {
  const p = id ? getPartido(id) : { id: 'm-' + uid(), fecha: '', hora: '21:00', rival: '', local: true, gf: '', gc: '', eventos: [], asistencia: {} };
  const js = jugadores();
  const rivales = (web.clasificacion || []).map(c => c.equipo).filter(e => e !== EQUIPO);
  const evRow = (e = {}) => `<div class="ev">
      <select name="ev_j">${js.map(j => `<option value="${esc(j.id)}" ${e.jugador === j.id ? 'selected' : ''}>${esc(corto(j))}</option>`).join('')}</select>
      <select name="ev_t">${['gol', 'asist', 'mvp', 'amarilla', 'roja'].map(t => `<option ${e.tipo === t ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <button type="button" class="btn ghost sm" data-rm>✕</button></div>`;
  modal(`
    <h3>${id ? 'Editar partido' : 'Nuevo partido'}</h3>
    ${p.fuente && p.fuente !== 'manual' ? '<p class="muted" style="margin:0">Este partido viene de la web. Lo que cambies aquí tiene prioridad.</p>' : ''}
    <label>Rival<input name="rival" list="rivales" required value="${esc(p.rival)}"></label>
    <datalist id="rivales">${rivales.map(r => `<option value="${esc(r)}">`).join('')}</datalist>
    <div class="grid2">
      <label>Fecha<input type="date" name="fecha" required value="${esc(p.fecha)}"></label>
      <label>Hora<input type="time" name="hora" value="${esc(p.hora || '')}"></label>
    </div>
    <label>Campo<input name="campo" value="${esc(p.campo || '')}" placeholder="Promosportive Hospitalet"></label>
    <div class="grid2">
      <label>Goles La Farga<input type="number" min="0" name="gf" value="${esc(p.gf ?? '')}"></label>
      <label>Goles rival<input type="number" min="0" name="gc" value="${esc(p.gc ?? '')}"></label>
    </div>
    <label><span>Somos</span><select name="local"><option value="1" ${p.local !== false ? 'selected' : ''}>Local</option><option value="0" ${p.local === false ? 'selected' : ''}>Visitante</option></select></label>
    ${js.length ? `<div><div class="row spread"><b>Goles, asistencias y tarjetas</b><button type="button" class="btn ghost sm" id="add-ev">+ Añadir</button></div>
      <div id="evs" style="display:flex;flex-direction:column;gap:6px;margin-top:8px">${(p.eventos || []).map(evRow).join('')}</div></div>` :
      '<p class="muted">Añade jugadores en Plantilla para apuntar goles y asistencias.</p>'}
    <div class="actions">
      ${id ? '<button class="btn danger" value="delete" formnovalidate>Borrar</button>' : ''}
      <button class="btn ghost" value="cancel" formnovalidate>Cancelar</button>
      <button class="btn" value="ok">Guardar</button>
    </div>`, (fd, accion) => {
    if (accion === 'delete') {
      store.delPartido(p.id, p.fuente !== 'manual'); return;
    }
    const jj = fd.getAll('ev_j'), tt = fd.getAll('ev_t');
    guardarPartido({
      ...p, rival: fd.get('rival').trim(), fecha: fd.get('fecha'), hora: fd.get('hora'), campo: fd.get('campo').trim(),
      gf: fd.get('gf'), gc: fd.get('gc'), local: fd.get('local') === '1',
      eventos: jj.map((j, i) => ({ jugador: j, tipo: tt[i] })),
    });
  });
  const evs = document.getElementById('evs');
  if (evs) {
    document.getElementById('add-ev').onclick = () => evs.insertAdjacentHTML('beforeend', evRow());
    evs.onclick = e => { if (e.target.closest('[data-rm]')) e.target.closest('.ev').remove(); };
  }
}

function editarJugador(id) {
  const j = id ? jugadores().find(x => x.id === id) : { id: 'j-' + uid(), nombre: '', dorsal: '', posicion: '' };
  modal(`
    <h3>${id ? 'Editar jugador' : 'Nuevo jugador'}</h3>
    ${id ? `<div class="avatar-edit">${avatar(j, 72)}
      ${assets ? `<label class="btn ghost sm">${j.foto ? 'Cambiar foto' : 'Subir foto de cara'}<input type="file" accept="image/*" data-act="foto-jugador" data-j="${esc(j.id)}" hidden></label>` : '<span class="muted" style="font-size:12px">Las fotos se pueden subir en la versión compartida.</span>'}
      ${j.foto ? `<button type="button" class="btn ghost sm" data-act="quitar-foto" data-j="${esc(j.id)}">Quitar</button>` : ''}</div>` : ''}
    <label>Nombre<input name="nombre" required value="${esc(j.nombre)}"></label>
    <div class="grid2">
      <label>Dorsal<input type="number" min="0" max="99" name="dorsal" value="${esc(j.dorsal)}"></label>
      <label>Posición<select name="posicion">${['', 'Portero', 'Defensa', 'Medio', 'Delantero'].map(o =>
        `<option ${j.posicion === o ? 'selected' : ''}>${o}</option>`).join('')}</select></label>
    </div>
    <div class="grid2"><label>Teléfono (opcional)<input type="tel" name="tel" value="${esc(j.tel || '')}"></label>
      <label>Cumpleaños<input type="date" name="cumple" value="${esc(j.cumple || '')}"></label></div>
    <div class="actions">
      ${id ? '<button class="btn danger" value="delete" formnovalidate>Borrar</button>' : ''}
      <button class="btn ghost" value="cancel" formnovalidate>Cancelar</button>
      <button class="btn" value="ok">Guardar</button>
    </div>`, (fd, accion) => {
    if (accion === 'delete') store.delJugador(j.id);
    else store.setJugador({ ...Object.fromEntries(Object.entries(j).filter(([k]) => k !== 'fuente')), id: j.id, nombre: fd.get('nombre').trim(), dorsal: fd.get('dorsal'), posicion: fd.get('posicion'), tel: fd.get('tel').trim(), cumple: fd.get('cumple') || '' });
  });
}

function ajustes() {
  modal(`
    <h3>Ajustes</h3>
    <p class="muted" style="margin:0">${db ? 'Conectado: lo que metéis a mano lo ve todo el equipo.' : 'Sin conexión a la nube: los datos se guardan solo en este móvil.'}</p>
    <button type="button" class="btn ghost" id="exp">Exportar copia</button>
    <label>Importar copia<input type="file" id="imp" accept="application/json"></label>
    <div class="actions"><button class="btn" value="cancel" formnovalidate>Cerrar</button></div>`, () => {});
  document.getElementById('exp').onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify({ ...local, fotos }, null, 2)], { type: 'application/json' }));
    a.download = `la-farga-${hoy()}.json`; a.click();
  };
  document.getElementById('imp').onchange = async e => {
    try {
      const d = JSON.parse(await e.target.files[0].text());
      if (!d.jugadores || !d.partidos) throw 0;
      for (const j of d.jugadores) await store.setJugador(j);
      for (const p of Object.values(d.partidos)) await store.setPartido(p);
      for (const l of d.lesiones || []) await store.setLesion(l);
      for (const v of d.votos || []) await store.setVoto(v);
      for (const v of d.porras || []) await store.setPorra(v);
      if (db) for (const f of d.fotos || []) await db.doc('fotos/' + f.id).set(f).catch(() => {});
      document.getElementById('modal').close(); toast('Copia importada');
    } catch { toast('Ese archivo no es una copia válida'); }
  };
}

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), 2200);
}

/* ---------- Render y eventos ---------- */
/* ---------- Cuenta atrás hasta el próximo partido (hora de Madrid) ---------- */
// Convierte fecha y hora de Madrid a instante exacto, sea cual sea la zona del móvil
function instanteMadrid(fecha, hora) {
  const [y, m, d] = fecha.split('-').map(Number), [h, mi] = (hora || '22:30').split(':').map(Number);
  const utc = Date.UTC(y, m - 1, d, h, mi);
  const off = t => {
    const pa = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(new Date(t)).map(x => [x.type, x.value]));
    return Date.UTC(+pa.year, pa.month - 1, +pa.day, +pa.hour, +pa.minute, +pa.second) - t;
  };
  let t = utc - off(utc); t = utc - off(t);
  return t;
}
const DURACION = 50 * 60e3;
// Formato fijo de enfrentamiento: escudo de La Farga vs escudo del rival
const VS = rival => `<img class="logo" src="icons/escudo.webp" alt="La Farga" width="34" height="34"><em>vs</em>${logo(rival, 34)}`;
let cuentaObj = null, cuentaT = 0;
function objetivoCuenta() {
  const ahora = Date.now();
  cuentaObj = partidos().filter(p => p.fecha && p.estado !== 'aplazado' && !jugado(p))
    .map(p => ({ p, t: instanteMadrid(p.fecha, p.hora) }))
    .filter(x => x.t + DURACION > ahora).sort((a, b) => a.t - b.t)[0] || null;
}
// Nombre del rival letra a letra, para poder hacerlo desaparecer/aparecer con transición
const letras = n => { const t = [...(n || '')]; return `<span class="c-rival" style="--n:${t.length}">${t.map((ch, k) => `<span style="--k:${k}">${ch === ' ' ? '&nbsp;' : esc(ch)}</span>`).join('')}</span>`; };
// Globito en el icono de la app instalada con los días que faltan
let insigniaPuesta = null;
function insignia(p) {
  if (!('setAppBadge' in navigator)) return;
  const madrid = new Date().toLocaleDateString('sv', { timeZone: 'Europe/Madrid' });
  const d = p ? Math.round((new Date(p.fecha) - new Date(madrid)) / 864e5) : -1;
  if (d === insigniaPuesta) return; insigniaPuesta = d;
  (d > 0 ? navigator.setAppBadge(d) : navigator.clearAppBadge()).catch(() => {});
}
function pintarCuenta() {
  const el = document.getElementById('cuenta'); if (!el) return;
  if (!cuentaObj) { el.hidden = true; el.dataset.key = ''; document.body.classList.remove('dia-partido'); insignia(null); return; }
  const { p, t } = cuentaObj, falta = t - Date.now();
  if (falta + DURACION <= 0) { objetivoCuenta(); return pintarCuenta(); }
  el.hidden = false;
  insignia(p);
  // Modo día de partido: el día del partido (hora de Madrid) la app se viste de gala
  const diaHoy = new Date().toLocaleDateString('sv', { timeZone: 'Europe/Madrid' }) === p.fecha;
  document.body.classList.toggle('dia-partido', diaHoy);
  const vivo = falta <= 0, key = `${p.id}|${vivo}|${diaHoy}`;
  el.classList.toggle('vivo', vivo);
  // la estructura solo se rehace si cambia el partido; cada segundo solo cambian los números
  if (el.dataset.key !== key) {
    el.dataset.key = key;
    const b = (u, l) => `<span class="c-u"><b data-u="${u}">00</b><i>${l}</i></span>`;
    el.innerHTML = vivo
      ? `<span class="c-vivo">● EN JUEGO</span><span class="c-info"><span class="c-vs">${VS(p.rival)}</span>${letras(p.rival)}</span>`
      : `<span class="c-info"><span class="c-vs">${VS(p.rival)}</span>${letras(p.rival)}<span class="c-fecha">${diaHoy ? '<b class="c-hoy">HOY JUGAMOS</b> · ' + esc(p.hora || '') : fFecha(p.fecha) + ' · ' + esc(p.hora || '')}</span></span>
        <span class="c-reloj">${b('d', 'días')}<em>:</em>${b('h', 'h')}<em>:</em>${b('m', 'min')}<em>:</em>${b('s', 'seg')}</span>`;
  }
  if (vivo) return;
  const s = Math.floor(falta / 1000), v = { d: Math.floor(s / 86400), h: Math.floor(s % 86400 / 3600), m: Math.floor(s % 3600 / 60), s: s % 60 };
  el.querySelectorAll('[data-u]').forEach(x => {
    const n = String(v[x.dataset.u]).padStart(2, '0'); if (x.textContent === n) return;
    x.textContent = n;
    if (!sinMov && x.animate) x.animate([{ transform: 'perspective(160px) rotateX(-92deg)', filter: 'brightness(.5)' }, { transform: 'perspective(160px) rotateX(12deg)', offset: .7 }, { transform: 'none', filter: 'none' }],
      { duration: 420, easing: 'cubic-bezier(.3,.6,.3,1)' });
  });
}
// Se ajusta al cambio exacto de cada segundo del reloj
function tickCuenta() { pintarCuenta(); clearTimeout(cuentaT); cuentaT = setTimeout(tickCuenta, 1000 - (Date.now() % 1000) + 5); }
document.addEventListener('visibilitychange', () => { if (!document.hidden) { objetivoCuenta(); tickCuenta(); } });

// Abre Google Maps con el campo del partido (sin el número de pista)
function comoLlegar(p) {
  const lugar = (p.campo || '').split('·')[0].trim();
  if (!lugar) return '';
  const url = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(lugar);
  return `<a class="btn ghost como-llegar" href="${url}" target="_blank" rel="noopener"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>Cómo llegar · ${esc(lugar)}</a>`;
}

/* ---------- Chispas de forja: brasas doradas que suben suaves por la cabecera ---------- */
function chispas() {
  const top = document.querySelector('.top'); if (!top || sinMov || top.querySelector('.chispas')) return;
  const c = document.createElement('div'); c.className = 'chispas'; c.setAttribute('aria-hidden', 'true');
  const r = (a, b) => (a + Math.random() * (b - a)).toFixed(2);
  c.innerHTML = Array.from({ length: 14 }, () =>
    `<i style="left:${r(2, 98)}%;--t:${r(4.5, 9)}s;--d:-${r(0, 9)}s;--x:${r(-18, 18)}px;--s:${r(1.5, 3.2)}px;--o:${r(.35, .9)}"></i>`).join('');
  top.prepend(c);
  // y también por toda la pantalla, por encima de la foto de fondo y por debajo del contenido
  const f = document.createElement('div'); f.className = 'chispas-fondo'; f.setAttribute('aria-hidden', 'true');
  f.innerHTML = Array.from({ length: 26 }, () =>
    `<i style="left:${r(1, 99)}%;--t:${r(9, 18)}s;--d:-${r(0, 18)}s;--x:${r(-40, 40)}px;--s:${r(1.5, 3.4)}px;--o:${r(.3, .85)}"></i>`).join('');
  document.body.prepend(f);
}

/* ---------- Pantalla de entrada: destello dorado y el escudo vuela a la cabecera ---------- */
function entrada() {
  const capa = document.getElementById('entrada'); if (!capa) return;
  const img = capa.querySelector('img'), dest = document.querySelector('.brand img');
  if (sinMov || !img.animate || !dest) { capa.remove(); return; }
  const empezar = () => {
    capa.classList.add('brilla');
    setTimeout(() => {
      const a = img.getBoundingClientRect(), b = dest.getBoundingClientRect();
      const dx = (b.left + b.width / 2) - (a.left + a.width / 2), dy = (b.top + b.height / 2) - (a.top + a.height / 2);
      img.animate([{ transform: 'none' }, { transform: `translate(${dx}px, ${dy}px) scale(${b.height / a.height})` }],
        { duration: 700, easing: 'cubic-bezier(.65, 0, .25, 1)', fill: 'forwards' });
      capa.animate([{ backgroundColor: 'rgba(8,7,6,1)' }, { backgroundColor: 'rgba(8,7,6,0)' }], { duration: 700, easing: 'ease-in', fill: 'forwards' })
        .onfinish = () => capa.remove();
    }, 380);
  };
  const dibuja = () => dibujarEscudo(capa, img, empezar);
  img.complete ? dibuja() : (img.onload = dibuja, img.onerror = () => capa.remove());
}

/* ---------- Aparecer al entrar en pantalla (gráficas, tarjetas) ---------- */
const vistoObs = 'IntersectionObserver' in window ? new IntersectionObserver(es => es.forEach(e => {
  if (e.isIntersecting) { e.target.classList.add('visto'); vistoObs.unobserve(e.target); }
}), { threshold: .25 }) : null;
function observar(raiz, revelar) {
  raiz.querySelectorAll('.grafica').forEach(el => { if (sinMov || !vistoObs) el.classList.add('visto'); else vistoObs.observe(el); });
  // al entrar en una pestaña, lo que queda por debajo de la pantalla aparece suave al llegar con el scroll
  if (!revelar || sinMov || !vistoObs) return;
  const limite = innerHeight - 40;
  raiz.querySelectorAll(':scope > .card, :scope > h2, :scope > .grid2, :scope > .grid3, :scope > .sponsors, :scope > .banner').forEach(el => {
    if (el.getBoundingClientRect().top > limite) { el.classList.add('revela'); vistoObs.observe(el); }
  });
}

/* ---------- Carga: bloques que brillan mientras llegan los datos ---------- */
let cargado = false;
function esqueleto() {
  const b = (h, w = '100%') => `<div class="sk" style="height:${h}px;width:${w}"></div>`;
  return `<div class="esqueleto">${b(150)}<div class="sk-t"></div>${b(96)}${b(120)}<div class="sk-t"></div><div class="grid3">${b(70)}${b(70)}${b(70)}</div>${b(90)}</div>`;
}

/* ---------- Confeti dorado ---------- */
function confeti() {
  if (sinMov || !document.body.animate) return;
  const capa = document.createElement('div'); capa.className = 'confeti';
  const dlg = document.getElementById('modal'); (dlg.open ? dlg : document.body).appendChild(capa); // por encima de la ficha abierta
  const cols = ['#f2a823', '#ffd27a', '#d68a10', '#fff1c9', '#b8860b'];
  for (let i = 0; i < 90; i++) {
    const c = document.createElement('i'), x = Math.random() * 100, d = 1600 + Math.random() * 1600;
    c.style.cssText = `left:${x}vw;background:${cols[i % cols.length]};width:${5 + Math.random() * 6}px;height:${8 + Math.random() * 8}px`;
    capa.appendChild(c);
    c.animate([{ transform: `translate(0,-20px) rotate(0deg)`, opacity: 1 },
      { transform: `translate(${(Math.random() - .5) * 160}px, 105vh) rotate(${(Math.random() - .5) * 900}deg)`, opacity: .9 }],
      { duration: d, delay: Math.random() * 500, easing: 'cubic-bezier(.25,.6,.4,1)', fill: 'both' });
  }
  setTimeout(() => capa.remove(), 3800);
}

/* ---------- Frescura de los datos y conexión ---------- */
function haceCuanto() {
  const ts = web.actualizado_ts ? new Date(web.actualizado_ts) : web.actualizado ? new Date(web.actualizado + 'T10:00') : null;
  if (!ts || isNaN(ts)) return '';
  const min = Math.max(0, Math.round((Date.now() - ts) / 60000));
  const t = min < 1 ? 'ahora mismo' : min < 60 ? `hace ${min} min` : min < 1440 ? `hace ${Math.round(min / 60)} h` : min < 2880 ? 'ayer' : `hace ${Math.round(min / 1440)} días`;
  return `<p class="frescura"><i class="${navigator.onLine === false ? 'off' : 'on'}"></i>Datos de Valldor actualizados ${t}</p>`;
}
function avisoRed() {
  let b = document.getElementById('sin-red');
  if (navigator.onLine !== false) { if (b) { b.classList.add('fuera'); setTimeout(() => b.remove(), 400); } return; }
  if (b) return;
  b = document.createElement('div'); b.id = 'sin-red'; b.textContent = 'Sin conexión · mostrando los datos guardados';
  document.body.appendChild(b);
}
addEventListener('online', () => { avisoRed(); toast('Conexión recuperada'); render(); });
addEventListener('offline', () => { avisoRed(); render(); });

/* ---------- Buscador: jugadores, rivales y partidos ---------- */
const normal = t => (t || '').toString().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
function resultadosBusqueda(q) {
  q = normal(q).trim(); if (q.length < 2) return '<p class="muted">Escribe al menos 2 letras.</p>';
  const out = [];
  for (const j of jugadores().filter(j => !j.invitado))
    if (normal(`${j.apodo} ${j.nombre} ${j.camiseta || j.dorsal}`).includes(q))
      out.push(`<button class="res-busq" data-act="buscar-ir" data-tipo="cromo" data-v="${esc(j.id)}"><span class="num">${esc(j.camiseta || j.dorsal || '')}</span><span><b>${esc(j.apodo || j.nombre)}</b><small>${esc(j.nombre || '')} · La Farga</small></span></button>`);
  for (const e of (web.clasificacion || []))
    if (normal(e.equipo).includes(q))
      out.push(`<button class="res-busq" data-act="buscar-ir" data-tipo="equipo" data-v="${esc(e.equipo)}">${logo(e.equipo, 26)}<span><b>${esc(e.equipo)}</b><small>${e.pos}º · ${e.pts} pts</small></span></button>`);
  for (const [eq, r] of Object.entries(web.rivales || {}))
    for (const j of r.plantilla || [])
      if (normal(j.nombre).includes(q))
        out.push(`<button class="res-busq" data-act="buscar-ir" data-tipo="equipo" data-v="${esc(eq)}">${logo(eq, 26)}<span><b>${esc(j.nombre)}</b><small>#${esc(j.dorsal)} · ${esc(eq)}${j.goles ? ' · ' + j.goles + ' goles' : ''}</small></span></button>`);
  for (const p of partidos())
    if (normal(`${p.rival} j${p.jornada} ${fFecha(p.fecha)}`).includes(q))
      out.push(`<button class="res-busq" data-act="buscar-ir" data-tipo="partido" data-v="${esc(p.id)}"><span class="c-vs">${VS(p.rival)}</span><span><b>${p.jornada ? 'J' + p.jornada + ' · ' : ''}${esc(p.rival)}</b><small>${fFecha(p.fecha)}${jugado(p) ? ' · ' + p.gf + '-' + p.gc : ''}</small></span></button>`);
  const extra = busquedaExtra(q);
  out.unshift(...extra.filter(x => x.includes('atajo'))); out.push(...extra.filter(x => !x.includes('atajo')));
  return out.length ? out.slice(0, 40).join('') : '<p class="muted">Nada con ese nombre. Prueba con "goles de" y un nombre.</p>';
}
function buscar() {
  modalFuera = true;
  modal(`<button class="cerrar" value="cancel" formnovalidate aria-label="Cerrar">✕</button>
    <h3 style="margin-left:34px">Buscar</h3>
    <input id="q-busq" type="search" placeholder="Jugador, rival, logro, jugada… o «goles de Marcelo»" autocomplete="off" enterkeyhint="search">
    <div id="res-busq" class="lista-busq"><p class="muted">Escribe al menos 2 letras.</p></div>`, () => {});
  const i = document.getElementById('q-busq');
  i.oninput = () => { document.getElementById('res-busq').innerHTML = resultadosBusqueda(i.value); };
  i.onkeydown = e => { if (e.key === 'Enter') e.preventDefault(); };
  setTimeout(() => i.focus(), 50);
}
document.getElementById('btn-buscar').onclick = buscar;

/* ---------- Vibración suave (Android) ---------- */
const vibrar = (ms = 12) => { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* sin vibración */ } };

/* ---------- Deslizar en "¿Quién viene?": derecha = voy, izquierda = no voy ---------- */
function marcarAsistencia(pid, jid, v) {
  const p = getPartido(pid); if (!p) return;
  p.asistencia = { ...(p.asistencia || {}), [jid]: v };
  guardarPartido(p); vibrar(v === 'si' ? 15 : [10, 40, 10]);
}
(() => {
  let fila = null, x0 = 0, y0 = 0, dx = 0, horiz = null;
  addEventListener('touchstart', e => {
    fila = e.target.closest('.asis-fila'); if (!fila || e.target.closest('button')) { fila = null; return; }
    x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; dx = 0; horiz = null; fila.style.transition = 'none';
  }, { passive: true });
  addEventListener('touchmove', e => {
    if (!fila) return;
    const t = e.touches[0]; dx = t.clientX - x0;
    if (horiz === null && (Math.abs(dx) > 8 || Math.abs(t.clientY - y0) > 8)) horiz = Math.abs(dx) > Math.abs(t.clientY - y0);
    if (!horiz) return;
    const lim = Math.max(-110, Math.min(110, dx));
    fila.style.transform = `translateX(${lim}px)`;
    fila.classList.toggle('tira-si', dx > 70); fila.classList.toggle('tira-no', dx < -70);
  }, { passive: true });
  addEventListener('touchend', () => {
    if (!fila) return;
    const f = fila; fila = null;
    f.style.transition = ''; f.style.transform = ''; f.classList.remove('tira-si', 'tira-no');
    if (horiz && Math.abs(dx) > 70) marcarAsistencia(f.dataset.p, f.dataset.j, dx > 0 ? 'si' : 'no');
  }, { passive: true });
})();

/* ---------- Tirar hacia abajo para recargar ---------- */
async function recargarDatos() {
  try {
    const r = await fetch('data/liga.json', { cache: 'no-cache' }); const j = await r.json();
    if (!web.actualizado_ts || (j.actualizado_ts || j.actualizado) >= (web.actualizado_ts || web.actualizado)) web = j;
    pintarCabecera(); objetivoCuenta(); render(); toast('Datos actualizados'); vibrar(10);
  } catch (e) { toast('Sin conexión: no se ha podido recargar'); }
}
(() => {
  const ind = document.createElement('div'); ind.id = 'recarga'; ind.innerHTML = '<img src="icons/escudo.webp" alt="">';
  document.body.appendChild(ind);
  let y0 = null, d = 0, ocupado = false;
  addEventListener('touchstart', e => {
    y0 = (scrollY <= 0 && !ocupado && !document.getElementById('modal').open && !e.target.closest('.asis-fila')) ? e.touches[0].clientY : null; d = 0;
  }, { passive: true });
  addEventListener('touchmove', e => {
    if (y0 === null) return;
    d = Math.max(0, e.touches[0].clientY - y0);
    if (scrollY > 0) { y0 = null; d = 0; ind.style.cssText = ''; return; }
    const k = Math.min(1, d / 90);
    ind.style.cssText = `opacity:${k};transform:translate(-50%, ${Math.min(d, 110) * .6}px) rotate(${d * 3}deg) scale(${.6 + .4 * k})`;
    ind.classList.toggle('listo', d > 90);
  }, { passive: true });
  addEventListener('touchend', async () => {
    if (y0 === null) return; y0 = null;
    if (d > 90 && !ocupado) {
      ocupado = true; ind.classList.add('girando'); vibrar(8);
      await Promise.all([recargarDatos(), new Promise(r => setTimeout(r, 800))]);
      ind.classList.remove('girando'); ocupado = false;
    }
    ind.classList.remove('listo'); ind.style.cssText = '';
  }, { passive: true });
})();

/* ---------- Foto de cara de los jugadores ---------- */
function avatar(j, px = 40) {
  return j.foto ? `<img class="avatar" src="${esc(j.foto)}" alt="${esc(corto(j))}" width="${px}" height="${px}" loading="lazy">`
    : `<span class="avatar vacio" style="width:${px}px;height:${px}px">${esc(j.camiseta || j.dorsal || '?')}</span>`;
}
// recorta al centro y reduce a 400 px antes de subir, para que pese poco
function cuadrar(file, lado = 400) {
  return new Promise((ok, ko) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const m = Math.min(img.width, img.height), c = document.createElement('canvas'); c.width = c.height = lado;
      c.getContext('2d').drawImage(img, (img.width - m) / 2, (img.height - m) / 2, m, m, 0, 0, lado, lado);
      URL.revokeObjectURL(url);
      c.toBlob(b => b ? ok(new File([b], 'cara.jpg', { type: 'image/jpeg' })) : ko(new Error('canvas')), 'image/jpeg', .86);
    };
    img.onerror = ko; img.src = url;
  });
}
async function fotoJugador(jid, file) {
  const j = jugadores().find(x => x.id === jid); if (!j || !assets) return;
  try {
    toast('Subiendo foto…');
    const r = await assets.upload(await cuadrar(file));
    await store.setJugador({ ...Object.fromEntries(Object.entries(j).filter(([k]) => k !== 'fuente')), foto: r.url });
    vibrar(15); toast('¡Foto puesta!');
  } catch (e) { toast('No se ha podido subir la foto'); }
  const d = document.getElementById('modal'); if (d.open) d.close(); editarJugador(jid); render();
}

/* ---------- Movimiento ---------- */
const ORDEN = ['inicio', 'partidos', 'tabla', 'plantilla', 'stats'];
const sinMov = matchMedia('(prefers-reduced-motion: reduce)').matches;
let calAnim = 0;

// dir: 1 entra por la derecha, -1 por la izquierda, 0 sin animación (refrescos de datos)
function render(dir = 0) {
  const main = document.getElementById('view');
  const ff = document.querySelector('.fab-foto'); if (ff) ff.hidden = !assets;
  if (!cargado && !web.actualizado) { main.innerHTML = esqueleto(); return; }
  main.innerHTML = V[tab]();
  observar(main, !!dir);
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  liquido(ORDEN.indexOf(tab));
  objetivoCuenta(); if (!cuentaT) tickCuenta(); else pintarCuenta();
  pintarResaltado(false);
  if (tab === 'inicio' && (web.clasificacion || []).length && !comprobarSubida.hecho) { comprobarSubida.hecho = true; setTimeout(resultadoNuevo, 2400); setTimeout(comprobarSubida, 2600); }
  if (calAnim) { const g = main.querySelector('.cal-grid'); if (g) g.classList.add(calAnim > 0 ? 'anim-d' : 'anim-i'); calAnim = 0; }
  contar(main);
  const h = main.querySelector('h2'); if (h) h.classList.add('vt-titulo');
  if (!dir || sinMov || vtActiva) return;
  main.classList.remove('anim-d', 'anim-i', 'sale-d', 'sale-i'); void main.offsetWidth;
  [...main.children].forEach((c, i) => c.style.setProperty('--d', i));
  main.classList.add(dir > 0 ? 'anim-d' : 'anim-i');
}

// Indicador de la barra: se estira como una gota hacia la nueva pestaña y luego se encoge
function liquido(nuevo) {
  const t = document.querySelector('.tabs'); if (!t) return;
  const prev = t.style.getPropertyValue('--i') === '' ? nuevo : +t.style.getPropertyValue('--i');
  t.style.setProperty('--i', nuevo);
  if (prev === nuevo || sinMov || !t.animate) return;
  const a = Math.min(prev, nuevo), w = Math.abs(nuevo - prev) + 1;
  try {
    t.animate([{ transform: `translateX(${prev * 100}%) scaleX(1)` }, { transform: `translateX(${a * 100}%) scaleX(${w})`, offset: .45 }, { transform: `translateX(${nuevo * 100}%) scaleX(1)` }],
      { duration: 620, easing: 'cubic-bezier(.5, 0, .3, 1)', pseudoElement: '::before' });
  } catch (e) { /* navegador sin animación de pseudoelementos */ }
}
let vtActiva = false;
function irA(nuevo) {
  if (!V[nuevo] || nuevo === tab) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
  const dir = ORDEN.indexOf(nuevo) > ORDEN.indexOf(tab) ? 1 : -1;
  tab = nuevo;
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  liquido(ORDEN.indexOf(tab));
  const main = document.getElementById('view');
  clearTimeout(irA.t);
  if (sinMov) { window.scrollTo(0, 0); render(dir); return; }
  if (document.startViewTransition) {
    document.documentElement.dataset.vtDir = dir > 0 ? 'd' : 'i';
    const t = document.startViewTransition(() => { window.scrollTo(0, 0); vtActiva = true; render(dir); vtActiva = false; });
    t.finished.finally(() => { delete document.documentElement.dataset.vtDir; });
    if (navigator.vibrate) navigator.vibrate(6);
    return;
  }
  // primero sale lo que había, luego entra lo nuevo
  main.classList.remove('anim-d', 'anim-i', 'sale-d', 'sale-i'); void main.offsetWidth;
  main.classList.add(dir > 0 ? 'sale-d' : 'sale-i');
  irA.t = setTimeout(() => { main.classList.remove('sale-d', 'sale-i'); window.scrollTo(0, 0); render(dir); }, 240);
  if (navigator.vibrate) navigator.vibrate(6);
}

// Todos los números suben desde 0 cuando aparecen en pantalla
const contados = new WeakSet();
const contarObs = 'IntersectionObserver' in window ? new IntersectionObserver(es => es.forEach(e => {
  if (!e.isIntersecting) return; contarObs.unobserve(e.target); subir(e.target);
}), { threshold: .4 }) : null;
function subir(el) {
  const fin = el.textContent, nums = [...fin.matchAll(/\d+(?:[.,]\d+)?/g)];
  if (!nums.length || nums.every(m => +m[0].replace(',', '.') === 0)) return;
  const t0 = performance.now(), dur = 900;
  const paso = t => {
    const k = Math.min(1, (t - t0) / dur), f = 1 - Math.pow(1 - k, 3);
    el.textContent = fin.replace(/\d+(?:([.,])(\d+))?/g, (m, sep, dec) => {
      const v = +m.replace(',', '.') * f; return dec ? v.toFixed(dec.length).replace('.', sep) : String(Math.round(v));
    });
    if (k < 1) requestAnimationFrame(paso); else el.textContent = fin;
  };
  requestAnimationFrame(paso);
}
function contar(raiz) {
  if (sinMov || !raiz) return;
  raiz.querySelectorAll('.kpi b, .big, .cnt, td.n b, .puntos, .g-num').forEach(el => {
    if (contados.has(el) || el.children.length) return; contados.add(el);
    if (contarObs) contarObs.observe(el); else subir(el);
  });
}

// Deslizar el dedo: en el calendario cambia de mes, en el resto cambia de pestaña
(() => {
  let x0 = 0, y0 = 0, t0 = 0, enCal = false, bloqueado = false;
  addEventListener('touchstart', e => {
    const t = e.touches[0]; x0 = t.clientX; y0 = t.clientY; t0 = Date.now();
    enCal = !!e.target.closest('.cal');
    bloqueado = !!e.target.closest('dialog, input, textarea, select, .galeria, table, .asis-fila, .desliza, .vi-pista, .rl-equipos') || document.getElementById('modal').open;
  }, { passive: true });
  addEventListener('touchend', e => {
    if (bloqueado) return;
    const t = e.changedTouches[0], dx = t.clientX - x0, dy = t.clientY - y0;
    if (Math.abs(dx) < 60 || Math.abs(dy) > Math.abs(dx) * .6 || Date.now() - t0 > 600) return;
    const n = dx < 0 ? 1 : -1;
    if (enCal) { const b = document.querySelector(`[data-act="cal-mover"][data-v="${n}"]`); if (b) b.click(); return; }
    const i = ORDEN.indexOf(tab) + n;
    if (i >= 0 && i < ORDEN.length) irA(ORDEN[i]);
  }, { passive: true });
})();

// Cabecera compacta al bajar
// Altura de la cabecera grande, para reservar su hueco aunque luego se compacte
function medirCabecera() {
  const top = document.querySelector('.top'); if (!top || top.classList.contains('mini')) return;
  document.body.style.setProperty('--cab', top.offsetHeight + 'px');
}
addEventListener('resize', medirCabecera);
addEventListener('load', medirCabecera);
requestAnimationFrame(medirCabecera);
// y el contador pasa de burbuja a la propia cabecera con una transición.
// Al bajar: primero se borra el nombre del rival letra a letra y luego se encaja en la cabecera.
let miniT = 0;
function encajar(top, quiere) {
  const c = document.getElementById('cuenta'), ver = c && !c.hidden && !sinMov && c.animate;
  // cada pieza (escudos, "vs", números y separadores) viaja por separado de su sitio viejo al nuevo
  const piezas = ver ? [...c.querySelectorAll('.c-vs > *, .c-rival, .c-fecha, .c-u b, .c-u i, .c-reloj > em')] : [];
  const marca = document.querySelector('.brand > div');
  const antes = piezas.map(e => e.getBoundingClientRect());
  // el fondo de la burbuja se desvanece en SU sitio (copia fantasma), no en la cabecera
  if (ver && quiere && !top.classList.contains('mini')) {
    const r = c.getBoundingClientRect(), g = document.createElement('div');
    g.className = 'cuenta-fantasma' + (c.classList.contains('vivo') ? ' vivo' : '');
    Object.assign(g.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
    document.body.appendChild(g);
    g.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, easing: 'ease-out', fill: 'forwards' }).onfinish = () => g.remove();
  }
  top.classList.toggle('mini', quiere);
  if (!ver) return;
  const opts = { duration: 820, easing: 'cubic-bezier(.65, 0, .25, 1)' };
  piezas.forEach((e, k) => {
    const a = antes[k], b = e.getBoundingClientRect();
    if (!b.width) return;
    e.getAnimations().forEach(x => x.cancel());
    // al irse a la cabecera, cada pieza da una vuelta completa hacia la derecha mientras viaja
    const giro = quiere ? 360 : -360; // al volver gira al revés
    e.animate([{ transformOrigin: '50% 50%', transform: `translate(${(a.left + a.width / 2) - (b.left + b.width / 2)}px, ${(a.top + a.height / 2) - (b.top + b.height / 2)}px) scale(${a.width / b.width}) rotate(0deg)` },
      { transformOrigin: '50% 50%', transform: `translate(0px, 0px) scale(1) rotate(${giro}deg)` }], opts);
  });
  if (marca && quiere) marca.animate([{ opacity: 0, transform: 'translateX(-14px)' }, { opacity: 1, transform: 'none' }], { duration: 820, easing: 'cubic-bezier(.65, 0, .25, 1)' });
}
// Atajos de teclado (ordenador): 1-5 pestañas, ←/→ moverse, / buscar
addEventListener('keydown', e => {
  if (e.ctrlKey || e.metaKey || e.altKey || document.getElementById('modal').open) return;
  if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable]')) return;
  const n = +e.key;
  if (n >= 1 && n <= ORDEN.length) { e.preventDefault(); irA(ORDEN[n - 1]); }
  else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { const i = ORDEN.indexOf(tab) + (e.key === 'ArrowRight' ? 1 : -1); if (ORDEN[i]) { e.preventDefault(); irA(ORDEN[i]); } }
  else if (e.key === '/') { e.preventDefault(); buscar(); }
});
// La barra de pestañas se esconde al bajar y vuelve al subir
(() => {
  let ultY = scrollY, acum = 0;
  addEventListener('scroll', () => {
    const y = scrollY, d = y - ultY; ultY = y;
    if ((d > 0) !== (acum > 0)) acum = 0; acum += d;
    const fin = innerHeight + y >= document.documentElement.scrollHeight - 4;
    if (y < 80 || acum < -24) document.body.classList.remove('tabs-fuera');
    else if (acum > 24 && !fin && !document.getElementById('fab').classList.contains('abierto')) document.body.classList.add('tabs-fuera');
  }, { passive: true });
})();
// Profundidad: la foto de fondo baja más lenta que el contenido
let parRaf = 0;
addEventListener('scroll', () => {
  if (sinMov || parRaf) return;
  parRaf = requestAnimationFrame(() => { parRaf = 0; document.body.style.setProperty('--par', Math.min(scrollY, 1600).toFixed(0)); });
}, { passive: true });
addEventListener('scroll', () => {
  const top = document.querySelector('.top'), c = document.getElementById('cuenta');
  const mini = top.classList.contains('mini'), yendo = top.dataset.yendo === '1';
  const quiere = scrollY > 0; // arriba del todo = normal; en cuanto se mueve, transición
  if (quiere === (mini || yendo)) return;
  clearTimeout(miniT);
  // todo a la vez: el nombre se borra mientras las piezas viajan y la cabecera se adapta
  top.dataset.yendo = '';
  if (c) c.classList.toggle('sin-nombre', quiere);
  encajar(top, quiere);
}, { passive: true });

document.addEventListener('click', e => {
  if (!e.target.closest('#fab')) document.getElementById('fab')?.classList.remove('abierto');
  const t = e.target.closest('[data-tab]');
  if (t) { irA(t.dataset.tab); return; }
  const a = e.target.closest('[data-act]');
  if (!a) return;
  const act = a.dataset.act;
  if (act === 'nuevo-partido') editarPartido();
  else if (act === 'editar-partido') editarPartido(a.dataset.id);
  else if (act === 'ver-partido') { if (a.classList.contains('agenda-item')) { const l = a.querySelector('.logo'); abrirDesde(l || a, a.dataset.id); } else girarCarta(a, () => resumenPartido(a.dataset.id)); }
  else if (act === 'ver-equipo') { const d = document.getElementById('modal'); if (d.open) d.close(); else { const l = a.querySelector('.logo'); zoomDesde = l ? { escudo: l, r: l.getBoundingClientRect() } : a.getBoundingClientRect(); } fichaEquipo(a.dataset.eq); }
  else if (act === 'votar') {
    const yo = yoId(); if (!yo) return;
    vibrar(15);
    store.setVoto({ id: `${a.dataset.p}__${yo}`, partido: a.dataset.p, votante: yo, voto: a.dataset.v }).then(() => reabrir(a.dataset.p));
  }
  else if (act === 'nueva-lesion') editarLesion();
  else if (act === 'porra-mas') {
    const pid = a.dataset.p, mio = porrasDe(pid).find(v => v.jugador === yoId());
    const b = porraBorrador[pid] = porraBorrador[pid] || (mio ? { gf: +mio.gf, gc: +mio.gc } : { gf: 2, gc: 1 });
    b[a.dataset.l] = Math.max(0, Math.min(20, b[a.dataset.l] + +a.dataset.d));
    a.parentElement.querySelector('b').textContent = b[a.dataset.l]; vibrar(5);
  }
  else if (act === 'porra-guardar') {
    const pid = a.dataset.p, yo = yoId(), p = getPartido(pid); if (!yo || !p) return;
    if (empezado(p)) { toast('La porra ya está cerrada'); return render(); }
    const mio = porrasDe(pid).find(v => v.jugador === yo), b = porraBorrador[pid] || (mio ? { gf: +mio.gf, gc: +mio.gc } : { gf: 2, gc: 1 });
    const sel = document.querySelector(`[data-porra-primero="${CSS.escape(pid)}"]`);
    store.setPorra({ id: `${pid}__${yo}`, partido: pid, jugador: yo, gf: b.gf, gc: b.gc, primero: sel ? sel.value : (mio && mio.primero) || '', fecha: new Date().toISOString() })
      .then(() => { delete porraBorrador[pid]; vibrar(15); toast(`Apostado: ${b.gf}-${b.gc}`); render(); });
  }
  else if (act === 'simular') {
    const antes = {}; document.querySelectorAll('tr[data-eq]').forEach(tr => antes[tr.dataset.eq] = tr.getBoundingClientRect().top);
    simTabla = a.dataset.v; render(); animarTabla(antes); vibrar(8);
  }
  else if (act === 'wrapped') wrapped();
  else if (act === 'vienes') { marcarAsistencia(a.dataset.p, yoId(), a.dataset.v); toast(a.dataset.v === 'si' ? '¡Apuntado! 💪' : a.dataset.v === 'no' ? 'Apuntado que no vienes' : 'Apuntado como duda'); }
  else if (act === 'ver-ult') { ocultarPop(true); abrirDesde(a, a.dataset.id); }
  else if (act === 'filtro-tabla') { const antes = {}; document.querySelectorAll('tr[data-eq]').forEach(tr => antes[tr.dataset.eq] = tr.getBoundingClientRect().top); filtroTabla = a.dataset.v; simTabla = ''; render(); animarTabla(antes); vibrar(8); }
  else if (act === 'compartir') compartir(a.dataset.h, a.dataset.t);
  else if (act === 'cromo') { const ax = a.querySelector('.avatar, .dorsal'); cromo(a.dataset.id, ax); }
  else if (act === 'comparar') { const id = a.dataset.j, k = comparados.indexOf(id); if (k >= 0) comparados.splice(k, 1); else if (comparados.length < 6) comparados.push(id); else toast('Máximo 6 jugadores'); pintarComparador(); }
  else if (act === 'comparar-con') { const id = a.dataset.j; if (!comparados) comparador(); if (!comparados.includes(id)) comparados.push(id); comparados = comparados.slice(-6); const d = document.getElementById('modal'); d.dataset.escudo = ''; d.close(); if (tab !== 'stats') irA('stats'); else render(); setTimeout(() => { const c = document.querySelector('.comparador'); if (c) c.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 700); }
  else if (act === 'nota') ponerNota(a.dataset.p, a.dataset.j, +a.dataset.v);
  else if (act === 'zona-quien') { zonaQuien = a.dataset.j; a.parentNode.querySelectorAll('.voto').forEach(b => b.classList.toggle('on', b === a)); }
  else if (act === 'zona-campo') ponerZona(a, e);
  else if (act === 'zona-deshacer') { const z = local.zonas.filter(x => x.partido === a.dataset.p).sort((x, y) => (x.fecha || '').localeCompare(y.fecha || '')).pop(); if (z) { store.delDoc('zonas', z.id); pintarZonas(a.dataset.p); } }
  else if (act === 'mapa-filtro') { mapaFiltro = a.dataset.j; const c = document.querySelector('.mapa-goles'); if (c) c.outerHTML = mapaGoles(); }
  else if (act === 'bump') elegirBump(a.dataset.eq);
  else if (act === 'ics') exportarICS(a.dataset.id);
  else if (act === 'animo-emoji') enviarAnimo(a.dataset.v);
  else if (act === 'animo-enviar') { const i = a.closest('.muro').querySelector('[data-muro]'); enviarAnimo(i.value); }
  else if (act === 'pizarra') pizarra();
  else if (act === 'piz-modo') { piz.modo = a.dataset.v; a.parentNode.querySelectorAll('button').forEach(b => b.classList.toggle('on-cal', b === a)); }
  else if (act === 'piz-paso') { if (!piz.play) { piz.i = +a.dataset.v; pizRepintar(); marcarPaso(); } }
  else if (act === 'piz-mas') { const P = piz.pasos[piz.i]; piz.pasos.splice(piz.i + 1, 0, { f: JSON.parse(JSON.stringify(P.f)), fl: [] }); piz.i++; pizarra(); }
  else if (act === 'piz-play') pizPlay();
  else if (act === 'piz-borrar-fl') { piz.pasos[piz.i].fl = []; pizRepintar(); }
  else if (act === 'piz-quitar-paso') { if (piz.pasos.length > 1) { piz.pasos.splice(piz.i, 1); piz.i = Math.max(0, piz.i - 1); pizarra(); } }
  else if (act === 'piz-nueva') { piz = pizNueva(); pizarra(); }
  else if (act === 'piz-guardar') { const n = (document.querySelector('[data-piz-nombre]') || {}).value || ''; piz.nombre = n.trim() || 'Jugada ' + (local.jugadas.length + 1); piz.id = piz.id || 'jg-' + uid(); const { i, modo, play, ...doc } = piz; store.setDoc('jugadas', { ...doc, autor: yoId(), fecha: new Date().toISOString() }); toast('Jugada guardada'); pizarra(); }
  else if (act === 'piz-cargar') { const j = local.jugadas.find(x => x.id === a.dataset.id); if (j) { pizarra(j); setTimeout(pizPlay, 350); } }
  else if (act === 'piz-del') { store.delDoc('jugadas', a.dataset.id); if (piz && piz.id === a.dataset.id) piz.id = ''; pizarra(); }
  else if (act === 'ver-g') { ocultarPop(true); const g = grupoPorClave(a.dataset.g); abrirGrupo(a, a.dataset.g, a.dataset.eq || (g && [g.local, g.visitante].includes(resaltado) ? resaltado : '')); }
  else if (act === 'pop-g') { const de = a.closest('.pop-ult')._de; ocultarPop(true); abrirGrupo(de && de.isConnected ? de : a, a.dataset.g, a.dataset.eq); }
  else if (act === 'pop-ult') { const de0 = a.closest('.pop-ult')._de; const o = (de0 && de0.isConnected && (de0.querySelector('.logo') || de0)) || document.querySelector(`.form [data-id="${CSS.escape(a.dataset.id)}"]`) || document.querySelector(`.cal-dia[data-pid="${CSS.escape(a.dataset.id)}"] .logo`) || document.querySelector(`.cal-dia[data-pid="${CSS.escape(a.dataset.id)}"]`); ocultarPop(true); abrirDesde(o || a, a.dataset.id); }
  else if (act === 'resaltar') { resaltado = a.dataset.eq; pintarResaltado(true); vibrar(6); }
  else if (act === 'novedades-fuera') { novedadesFuera = true; const c = a.closest('.novedades'); if (c) c.remove(); guardarVisita(); }
  else if (act === 'albumes') albumes();
  else if (act === 'album') verAlbum(a.dataset.p);
  else if (act === 'podio') { podioCat = a.dataset.v; const c = document.getElementById('podio'); if (c) { c.outerHTML = podio(); contar(document.getElementById('podio')); } vibrar(6); }
  else if (act === 'cal-vista') { const p = calPrefs(); p.vista = a.dataset.v; guardarPrefs(p); render(); }
  else if (act === 'cal-dia') {
    const pid = a.dataset.pid, cambiaMes = calPrefs().vista === 'mes' && a.dataset.v.slice(0, 7) !== calMes;
    calDia = a.dataset.v; if (cambiaMes) calMes = calDia.slice(0, 7);
    if (pid && !cambiaMes) {
      ocultarPop(true);
      const origen = a.querySelector('.logo') || a;
      abrirDesde(origen, pid);
      // marca el día elegido sin redibujar todo (para que el escudo siga en su sitio al cerrar)
      document.querySelectorAll('.cal-dia.sel').forEach(x => x.classList.remove('sel')); a.classList.add('sel');
    } else { render(); const n = document.querySelector('.cal-dia.sel'); if (n && !sinMov) n.animate([{ transform: 'scale(.86)' }, { transform: 'scale(1.06)' }, { transform: 'none' }], { duration: 380, easing: 'cubic-bezier(.3,.7,.2,1)' }); }
  }
  else if (act === 'cal-hoy') { calDia = hoy(); calMes = calDia.slice(0, 7); render(); }
  else if (act === 'cal-mover') {
    const n = +a.dataset.v;
    if (calPrefs().vista === 'semana') { const d = new Date(calDia + 'T12:00'); d.setDate(d.getDate() + 7 * n); calDia = iso(d); calMes = calDia.slice(0, 7); }
    else { const [y, m] = calMes.split('-').map(Number), d = new Date(y, m - 1 + n, 1, 12); calMes = iso(d).slice(0, 7); calDia = calMes === hoy().slice(0, 7) ? hoy() : calMes + '-01'; }
    calAnim = n; render();
  }
  else if (act === 'cal-ajustes') ajustesCalendario();
  else if (act === 'nuevo-evento') editarEvento(null, a.dataset.v);
  else if (act === 'editar-evento') editarEvento(a.dataset.id);
  else if (act === 'editar-lesion') editarLesion(a.dataset.id);
  else if (act === 'nuevo-jugador') editarJugador();
  else if (act === 'editar-jugador') editarJugador(a.dataset.id);
  else if (act === 'quitar-foto') {
    const j = jugadores().find(x => x.id === a.dataset.j);
    if (j) store.setJugador({ ...Object.fromEntries(Object.entries(j).filter(([k]) => k !== 'fuente')), foto: '' }).then(() => { document.getElementById('modal').close(); editarJugador(j.id); render(); });
  }
  else if (act === 'instalar' && avisoInstalar) { avisoInstalar.prompt(); avisoInstalar.userChoice.finally(() => { avisoInstalar = null; render(); }); }
  else if (act === 'no-instalar') { try { localStorage.setItem('lafarga-no-instalar', '1'); } catch (e) {} const c = a.closest('.instalar'); if (c) c.remove(); }
  else if (act === 'fab') { const f = document.getElementById('fab'), on = !f.classList.contains('abierto'); f.classList.toggle('abierto', on); a.setAttribute('aria-expanded', on); vibrar(8); }
  else if (act === 'fab-ir') {
    document.getElementById('fab').classList.remove('abierto');
    const v = a.dataset.v;
    if (v === 'evento') editarEvento(null, hoy()); else if (v === 'partido') editarPartido(); else if (v === 'lesion') editarLesion();
  }
  else if (act === 'buscar-ir') {
    const d = document.getElementById('modal'), t = a.dataset.tipo, v = a.dataset.v; d.close();
    if (t === 'tab') irA(v); else if (t === 'equipo') fichaEquipo(v); else if (t === 'partido') resumenPartido(v);
    else if (t === 'cromo') cromo(v); else if (t === 'grupo') resumenGrupo(v, '');
    else if (t === 'jugada') { const j = local.jugadas.find(x => x.id === v); if (j) { pizarra(j); setTimeout(pizPlay, 400); } }
    else if (t === 'muro') { irA('inicio'); setTimeout(() => { const m = document.querySelector('.muro'); if (m) m.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 700); }
  }
  else if (act === 'asist') marcarAsistencia(a.dataset.p, a.dataset.j, a.dataset.v);
});
document.addEventListener('change', e => {
  const a = e.target.closest('[data-act]');
  if (!a) return;
  if (a.dataset.act === 'soy') {
    try { localStorage.setItem('lafarga.yo', a.value); } catch (er) { /* sin almacenamiento */ }
    const d = document.getElementById('modal'); const id = d.dataset.partido; if (d.open && id) reabrir(id); else render();
  } else if (a.dataset.act === 'portero') {
    const p = getPartido(a.dataset.p); if (!p) return;
    guardarPartido({ ...p, portero: a.value }); vibrar(8); toast('Portero apuntado'); reabrir(p.id);
  } else if (a.dataset.act === 'foto-jugador' && a.files.length) fotoJugador(a.dataset.j, a.files[0]);
  else if (a.dataset.act === 'piz-rivales') { piz.rivales = a.checked; pizRepintar(); }
  else if (a.dataset.act === 'subir' && a.files.length) { document.getElementById('fab')?.classList.remove('abierto'); subirFotos(a.dataset.p, [...a.files]); }
});
document.getElementById('btn-ajustes').onclick = ajustes;
document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches && e.target.matches('[data-muro]')) { e.preventDefault(); enviarAnimo(e.target.value); } });

async function init() {
  entrada(); chispas();
  avisoRed();
  // abre al instante con los últimos datos guardados en el móvil
  if (!web.actualizado) { const wc = leerLS('lafarga.web', null); if (wc && wc.actualizado) web = wc; }
  render(); pintarCola();
  try {
    const r = await fetch('data/liga.json', { cache: 'no-cache' });
    const j = await r.json();
    if (!web.actualizado || j.actualizado >= web.actualizado) web = j;
    guardarLS('lafarga.web', web);
    pintarCabecera();
  } catch (e) { toast('Sin conexión: usando datos guardados'); }
  cargado = true;
  render(1);
  conectarNube();
  setTimeout(abrirEnlace, 1800);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}
init();
