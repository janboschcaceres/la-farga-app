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
  db.collection('jugadores').onSnapshot(s => { local.jugadores = s.docs.map(d => d.data()); save(); render(); }, () => {});
  db.collection('partidos').onSnapshot(s => {
    local.partidos = Object.fromEntries(s.docs.map(d => [d.id, d.data()])); save(); render();
  }, () => {});
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
    ${yo ? `<div class="votos">${js.filter(j => j.id !== yo).map(j => `<button type="button" class="voto ${mio && mio.voto === j.id ? 'on' : ''}" data-act="votar" data-p="${esc(p.id)}" data-v="${esc(j.id)}">${esc(corto(j))}${c[j.id] ? ` <small>${c[j.id]}</small>` : ''}</button>`).join('')}</div>
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
const formaHTML = f => `<div class="form">${f.map(r => `<i class="${r}">${{ w: 'G', d: 'E', l: 'P' }[r]}</i>`).join('')}</div>`;
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
      <div style="margin-top:10px">${formaHTML(formaDe(n))}</div>
    </div>
    <div class="grid3">
      <div class="kpi"><b>${c.g ?? 0}-${c.e ?? 0}-${c.p ?? 0}</b><span>G-E-P</span></div>
      <div class="kpi"><b>${pjs ? (c.gf / pjs).toFixed(1) : '–'}</b><span>Goles/partido</span></div>
      <div class="kpi"><b>${pjs ? (c.gc / pjs).toFixed(1) : '–'}</b><span>Encajados/partido</span></div>
    </div>
    ${propio ? '' : `    <h3>Contra La Farga</h3>
    ${nuestros.length ? nuestros.map(p => `<div class="row spread" style="padding:4px 0"><span>${p.jornada ? 'J' + p.jornada + ' · ' : ''}${fFecha(p.fecha, jugado(p) ? '' : p.hora)} <span class="muted">${p.local === false ? '(fuera)' : '(en casa)'}</span></span>
      <b class="score ${res(p) || ''}" style="font-size:20px">${jugado(p) ? `${p.gf}-${p.gc}` : p.estado === 'aplazado' ? 'aplaz.' : 'pend.'}</b></div>`).join('') : '<p class="muted" style="margin:0">Sin partidos contra vosotros.</p>'}
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
    <p class="muted" style="margin:0">Datos de Valldor · ${esc(web.actualizado || '')}</p>`, () => {});
}

/* ---------- Gráficas ---------- */
function evolucion() {
  const gp = (web.grupo_partidos || []).filter(p => p.estado === 'jugado');
  const fechas = [...new Set(gp.map(p => p.fecha))].sort();
  const eqs = (web.clasificacion || []).map(e => e.equipo);
  const acc = Object.fromEntries(eqs.map(e => [e, { pts: 0, dg: 0, gf: 0 }]));
  const puntos = [];
  for (const f of fechas) {
    for (const p of gp.filter(x => x.fecha === f)) {
      const a = +p.gf, b = +p.gc, L = acc[p.local], Vv = acc[p.visitante];
      if (!L || !Vv) continue;
      L.gf += a; Vv.gf += b; L.dg += a - b; Vv.dg += b - a;
      if (a > b) L.pts += 3; else if (a < b) Vv.pts += 3; else { L.pts++; Vv.pts++; }
    }
    const orden = [...eqs].sort((x, y) => acc[y].pts - acc[x].pts || acc[y].dg - acc[x].dg || acc[y].gf - acc[x].gf);
    puntos.push({ f, pos: orden.indexOf(EQUIPO) + 1, pts: acc[EQUIPO] ? acc[EQUIPO].pts : 0 });
  }
  return { puntos, n: eqs.length };
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
    <div class="card"><svg viewBox="0 0 ${W} ${H + 18}" width="100%" role="img" aria-label="Posición de La Farga jornada a jornada">
      ${Array.from({ length: n }, (_, i) => `<line x1="${px}" x2="${W - 8}" y1="${y(i + 1)}" y2="${y(i + 1)}" stroke="var(--line)" stroke-width="1"/>
        <text x="${px - 8}" y="${y(i + 1) + 4}" text-anchor="end" font-size="11" fill="var(--muted)">${i + 1}º</text>`).join('')}
      <path d="${linea}" fill="none" stroke="var(--accent)" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>
      ${puntos.map((p, i) => `<circle cx="${x(i)}" cy="${y(p.pos)}" r="5" fill="var(--bg)" stroke="var(--accent)" stroke-width="2.5"><title>${fFecha(p.f)}: ${p.pos}º con ${p.pts} pts</title></circle>
        <text x="${x(i)}" y="${H + 14}" text-anchor="middle" font-size="10" fill="var(--muted)">${new Date(p.f + 'T12:00').getDate()}/${new Date(p.f + 'T12:00').getMonth() + 1}</text>`).join('')}
    </svg><div class="muted" style="font-size:12px">Posición tras cada viernes de liga. Ahora: ${puntos[puntos.length - 1].pos}º.</div></div>
    <h2>⚽ Goles por partido</h2>
    <div class="card"><svg viewBox="0 0 ${W} ${H + 18}" width="100%" role="img" aria-label="Goles a favor y en contra por partido">
      <line x1="10" x2="${W - 8}" y1="${H}" y2="${H}" stroke="var(--line)"/>
      ${ps.map((p, i) => { const cx = 20 + (i + .5) * (W - 30) / ps.length, h = v => v / maxG * (H - 24);
        return `<rect x="${cx - bw - 1}" y="${H - h(+p.gf)}" width="${bw}" height="${h(+p.gf)}" rx="3" fill="var(--accent)"><title>A favor: ${p.gf}</title></rect>
          <rect x="${cx + 1}" y="${H - h(+p.gc)}" width="${bw}" height="${h(+p.gc)}" rx="3" fill="var(--loss)" opacity=".75"><title>En contra: ${p.gc}</title></rect>
          <text x="${cx - bw / 2 - 1}" y="${H - h(+p.gf) - 4}" text-anchor="middle" font-size="11" fill="var(--text)">${p.gf}</text>
          <text x="${cx + bw / 2 + 1}" y="${H - h(+p.gc) - 4}" text-anchor="middle" font-size="11" fill="var(--text)">${p.gc}</text>
          <text x="${cx}" y="${H + 14}" text-anchor="middle" font-size="10" fill="var(--muted)">${p.jornada ? 'J' + p.jornada : ''}</text>`; }).join('')}
    </svg><div class="row" style="gap:14px;font-size:12px"><span><i class="ley" style="background:var(--accent)"></i>A favor</span><span><i class="ley" style="background:var(--loss)"></i>En contra</span></div></div>`;
}

/* ---------- Liga: goleadores, tarjetas, sanciones ---------- */
function liga() {
  const todos = [];
  for (const j of jugadores()) if (j.goles != null) todos.push({ n: corto(j), eq: EQUIPO, ...j });
  for (const [eq, r] of Object.entries(web.rivales || {})) for (const j of r.plantilla) todos.push({ n: j.nombre, eq, ...j });
  const gol = todos.filter(j => j.goles).sort((a, b) => b.goles - a.goles || a.pj - b.pj).slice(0, 10);
  const tar = todos.filter(j => j.amarillas || j.rojas).sort((a, b) => (b.rojas * 3 + b.amarillas) - (a.rojas * 3 + a.amarillas));
  const sanc = web.sanciones || [];
  const fila = (j, i, v) => `<tr class="${j.eq === EQUIPO ? 'me' : ''}"><td class="n">${i + 1}</td><td><span class="num">${esc(j.camiseta || j.dorsal || '')}</span> ${esc(j.n)}<div class="muted" style="font-size:12px">${logo(j.eq, 14)} ${esc(j.eq)}</div></td><td class="n"><b>${v}</b></td></tr>`;
  return `<h2>🏆 Pichichi del grupo</h2>
    <div class="card" style="padding:4px 8px">${gol.length ? `<table><tbody>${gol.map((j, i) => fila(j, i, j.goles)).join('')}</tbody></table>` : '<div class="empty">Sin goles.</div>'}</div>
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
    add(p.fecha, { capa: 'grupo', hora: p.hora, titulo: `${p.local} - ${p.visitante}`, extra: p.estado === 'jugado' ? `${p.gf}-${p.gc}` : '', act: 'ver-equipo', eq: p.local });
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
  const dataExtra = it.eq ? `data-eq="${esc(it.eq)}"` : `data-id="${esc(it.id || '')}"`;
  return `<div class="agenda-item" style="--c:${esc(c)}" data-act="${it.act}" ${dataExtra}>
    <span class="hora">${esc(it.hora || '—')}</span>
    <span class="barra-c"></span>
    <div style="flex:1;min-width:0"><b>${it.capa === 'farga' && it.logo ? logo(it.logo, 16) + ' ' : emoji + ' '}${esc(it.titulo)}</b>
      ${it.extra ? `<div class="muted" style="font-size:13px">${esc(it.extra)}</div>` : ''}<div class="muted" style="font-size:11px">${esc(CAPAS[it.capa].nombre)}</div></div>
    ${it.res ? `<span class="score ${it.res}" style="font-size:18px">${{ w: 'G', d: 'E', l: 'P' }[it.res]}</span>` : ''}</div>`;
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
          return `<button class="cal-dia ${fuera ? 'fuera' : ''} ${f === h ? 'hoy' : ''} ${f === calDia ? 'sel' : ''} ${partido ? 'jugamos' : ''}" data-act="cal-dia" data-v="${f}">
            <span class="num-dia">${+f.slice(8)}</span>
            ${max ? its.slice(0, max).map(i => chip(i, pr)).join('') + (its.length > max ? `<span class="mas">+${its.length - max}</span>` : '')
              : `<span class="puntos">${its.slice(0, 4).map(i => `<i style="background:${esc(i.color || colorCapa(pr, i.capa))}"></i>`).join('')}</span>`}
          </button>`;
        }).join('')}
      </div>
      <div class="cal-leyenda">${Object.keys(CAPAS).filter(k => pr.capas[k]).map(k => `<span><i style="background:${esc(colorCapa(pr, k))}"></i>${CAPAS[k].nombre}</span>`).join('')}</div>
    </div>
    <h2>${fFecha(calDia)} <span class="row" style="gap:6px"><button class="btn ghost sm" data-act="cal-ajustes">🎨 Personalizar</button><button class="btn sm" data-act="nuevo-evento" data-v="${calDia}">+ Evento</button></span></h2>
    ${delDia.length ? delDia.map(i => chip(i, pr, true)).join('') : '<div class="card empty" style="padding:16px">Nada este día.</div>'}`;
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
  document.getElementById('ics').onclick = exportarICS;
}

function exportarICS() {
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
  for (const p of partidos()) if (!jugado(p) && p.estado !== 'aplazado') add(p.id, p.fecha, p.hora, `⚽ ${p.local === false ? p.rival + ' - La Farga' : 'La Farga - ' + p.rival}`, p.campo, 60);
  for (const e of local.eventos) if (!e.repetir) add(e.id, e.fecha, e.hora, e.titulo, e.lugar, 90);
  lin.push('END:VCALENDAR');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([lin.join('\r\n')], { type: 'text/calendar' }));
  a.download = 'la-farga.ics'; document.body.appendChild(a); a.click(); a.remove();
  toast('Abre el archivo para añadirlo a tu calendario');
}

/* ---------- Resumen de partido ---------- */
const ICO = { gol: '⚽', amarilla: '🟨', roja: '🟥', propia: '⚽ (p.p.)', asist: '🅰️', mvp: '⭐' };
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
      <div class="row spread" style="margin-top:8px"><b class="eq">${esc(izq)}</b><span class="res">${esc(marc)}</span><b class="eq" style="text-align:right">${esc(der)}</b></div>
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
    ${galeria(p)}
    ${conv.length ? `<h3>Jugaron (${conv.length})</h3><p style="margin:0">${conv.map(esc).join(' · ')}</p>` : ''}
    ${noj.length ? `<p class="muted" style="margin:4px 0 0">No jugaron: ${noj.map(esc).join(' · ')}</p>` : ''}
    ${p.acta ? `<p class="muted" style="margin:0"><a style="color:var(--accent)" target="_blank" rel="noopener" href="https://virtual.fundaciovalldor7.com/cornella-hospitalet-f7-es-26-27/partido/${esc(p.acta)}">Ver acta en Valldor ↗</a></p>` : ''}
    <div class="actions">
      <button class="btn ghost" value="editar" formnovalidate>Editar / añadir asistencias</button>
      <button class="btn" value="cancel" formnovalidate>Cerrar</button>
    </div>`, (fd, accion) => { if (accion === 'editar') setTimeout(() => editarPartido(id), 0); });
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
      <div class="card hero">
        <div class="row spread">
          <div><div class="muted">Posición</div><div class="big">${yo ? yo.pos + 'º' : '–'}</div></div>
          <img src="icons/escudo.webp" alt="" style="height:92px;filter:drop-shadow(0 4px 14px rgba(242,168,35,.35))">
          <div style="text-align:right"><div class="muted">Puntos</div><div class="big">${yo ? yo.pts : '–'}</div></div>
        </div>
        <div class="muted" style="margin-top:8px">${esc(web.grupo || 'Viernes - B')} · DG ${yo ? (yo.dg > 0 ? '+' : '') + yo.dg : '–'}</div>
      </div>

      ${bannerPartido(prox)}
      <h2>Próximo partido ${prox ? `<button class="btn ghost sm" data-act="ver-equipo" data-eq="${esc(prox.rival)}">Estudiar rival</button>` : ''}</h2>
      ${prox ? matchCard(prox) : `<div class="card empty">No hay próximo partido.<br><button class="btn sm" style="margin-top:10px" data-act="nuevo-partido">Añadir partido</button></div>`}
      ${prox ? asistenciaCard(prox) : ''}
      ${enfermeria(false)}

      <h2>Últimos resultados</h2>
      ${ult.length ? `<div class="card row spread"><div class="form">${ult.map(p => `<i class="${res(p)}">${{ w: 'G', d: 'E', l: 'P' }[res(p)]}</i>`).join('')}</div><span class="muted">${r.g}G ${r.e}E ${r.p}P</span></div>` : `<div class="card empty">Aún no hay resultados guardados.</div>`}

      <div class="grid3">
        <div class="kpi"><b>${r.gf}</b><span>Goles a favor</span></div>
        <div class="kpi"><b>${r.gc}</b><span>En contra</span></div>
        <div class="kpi"><b>${top ? esc(corto(top.j)) : '–'}</b><span>Pichichi${top ? ' · ' + top.gol : ''}</span></div>
      </div>
      <div class="card" style="padding:12px">${galeria({ id: 'general' }, '<h2 style="margin-top:0">📸 Galería del equipo</h2>')}</div>
      ${patrocinadores()}
      <p class="muted" style="margin-top:18px">Datos de la web actualizados el ${esc(web.actualizado || '–')}.</p>`;
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
      ${prox.length ? prox.map(matchCard).join('') : '<div class="card empty">Sin partidos pendientes.</div>'}
      <h2>Resultados</h2>
      ${jug.length ? jug.map(matchCard).join('') : '<div class="card empty">Sin resultados todavía.</div>'}`;
  },

  tabla() {
    const c = web.clasificacion || [];
    return `
      <h2>${esc(web.grupo || 'Clasificación')}</h2>
      <div class="card" style="padding:4px 8px">
        <table>
          <thead><tr><th class="n">#</th><th>Equipo</th><th class="n">PTS</th><th class="n">J</th><th class="n">G</th><th class="n">E</th><th class="n">P</th><th class="n">DG</th></tr></thead>
          <tbody>${c.map(e => `<tr class="${e.equipo === EQUIPO ? 'me' : ''} clic" data-act="ver-equipo" data-eq="${esc(e.equipo)}">
            <td class="n">${e.pos}</td><td><span class="row" style="gap:6px">${logo(e.equipo)}<span>${esc(e.equipo)}</span></span></td><td class="n"><b>${e.pts}</b></td>
            <td class="n">${e.pj ?? ''}</td><td class="n">${e.g ?? ''}</td><td class="n">${e.e ?? ''}</td><td class="n">${e.p ?? ''}</td>
            <td class="n">${e.dg > 0 ? '+' : ''}${e.dg}</td></tr>`).join('')}</tbody>
        </table>
      </div>
      <p class="muted">Toca un equipo para ver su ficha. Datos de Valldor · ${esc(web.actualizado || '')}</p>
      ${grupoPorFecha()}`;
  },

  plantilla() {
    const js = jugadores().filter(j => !j.invitado);
    return `
      ${enfermeria(true)}
      <h2>Plantilla (${js.length}) <button class="btn sm" data-act="nuevo-jugador">+ Jugador</button></h2>
      ${js.length ? js.map(j => `
        <div class="card player ${j.apodo === 'BLXDY' ? 'yo' : ''}" data-act="editar-jugador" data-id="${esc(j.id)}">
          <div class="dorsal">${esc(j.camiseta || j.dorsal || '?')}</div>
          <div>${j.apodo ? `<div class="apodo">${esc(j.apodo)}${lesionDe(j.id) ? ' <span class="tag baja">BAJA</span>' : ''}</div>` : ''}${j.nombre !== j.apodo ? `<b style="font-weight:${j.apodo ? 400 : 700}">${esc(j.nombre)}</b>` : ''}
            <div class="muted">${esc(j.posicion || (j.extra ? 'No está en la ficha de Valldor' : 'Sin posición'))}${j.edad ? ' · ' + j.edad + ' años' : ''}${j.camiseta && j.camiseta !== j.dorsal ? ' · ficha #' + esc(j.dorsal) : ''}</div></div>
          <span class="muted">${j.goles != null ? `${j.pj} PJ · ${j.goles} ⚽` : '›'}</span>
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
      ${graficas()}
      <h2 style="margin-top:28px;color:var(--text)">LA FARGA</h2>
      ${tabla('gol', '⚽ Goleadores')}
      ${tabla('asist', '🅰️ Asistencias')}
      ${tabla('mvp', '⭐ MVP (partidos ganados)')}
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

function matchCard(p) {
  const r = res(p);
  return `
    <div class="card match" data-act="ver-partido" data-id="${esc(p.id)}">
      <div>
        <div><b>${p.local === false ? esc(p.rival) + ' – La Farga' : 'La Farga – ' + esc(p.rival)}</b></div>
        <div class="muted">${fFecha(p.fecha, p.hora)}${p.campo ? ' · ' + esc(p.campo) : ''}</div>
        ${p.jornada ? `<span class="tag">J${p.jornada}</span> ` : ''}${p.estado === 'aplazado' ? '<span class="tag manual">aplazado</span> ' : ''}${p.fuente !== 'web' ? `<span class="tag manual">manual</span>` : `<span class="tag">web</span>`}
      </div>
      <div class="score ${r || ''}">${jugado(p) ? `${p.gf}-${p.gc}` : p.estado === 'aplazado' ? '–' : 'vs'}</div>
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
    <div class="aviso ${n >= 7 && portero ? 'ok' : ''}">${avisos.join('<br>')}</div>
    ${js.map(j => lesionDe(j.id) ? `<div class="row spread" style="padding:5px 0;opacity:.6"><span>${esc(corto(j))}</span><span class="tag baja">LESIONADO</span></div>` : `<div class="row spread" style="padding:5px 0"><span>${esc(corto(j))}</span>
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
  dlg.dataset.fuera = modalFuera ? '1' : ''; modalFuera = false; dlg.dataset.zoom = ''; dlg.style.animation = '';
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
    if (accion === 'cancel') { if (dlg.dataset.zoom) { e.preventDefault(); cerrarModal(dlg); } return; }
    onSubmit(new FormData(f), accion, f);
  };
  dlg.showModal();
  if (zoomDesde) { crecerDesde(dlg, zoomDesde); zoomDesde = null; }
}

// La ficha crece desde la fila pulsada hasta ocupar su sitio (y vuelve a ella al cerrarse)
let zoomDesde = null;
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
function pintarCuenta() {
  const el = document.getElementById('cuenta'); if (!el) return;
  if (!cuentaObj) { el.hidden = true; el.dataset.key = ''; return; }
  const { p, t } = cuentaObj, falta = t - Date.now();
  if (falta + DURACION <= 0) { objetivoCuenta(); return pintarCuenta(); }
  el.hidden = false;
  const vivo = falta <= 0, key = `${p.id}|${vivo}`;
  el.classList.toggle('vivo', vivo);
  // la estructura solo se rehace si cambia el partido; cada segundo solo cambian los números
  if (el.dataset.key !== key) {
    el.dataset.key = key;
    const b = (u, l) => `<span class="c-u"><b data-u="${u}">00</b><i>${l}</i></span>`;
    el.innerHTML = vivo
      ? `<span class="c-vivo">● EN JUEGO</span><span class="c-info"><span class="c-vs">${VS(p.rival)}</span>${letras(p.rival)}</span>`
      : `<span class="c-info"><span class="c-vs">${VS(p.rival)}</span>${letras(p.rival)}<span class="c-fecha">${fFecha(p.fecha)} · ${esc(p.hora || '')}</span></span>
        <span class="c-reloj">${b('d', 'días')}<em>:</em>${b('h', 'h')}<em>:</em>${b('m', 'min')}<em>:</em>${b('s', 'seg')}</span>`;
  }
  if (vivo) return;
  const s = Math.floor(falta / 1000), v = { d: Math.floor(s / 86400), h: Math.floor(s % 86400 / 3600), m: Math.floor(s % 3600 / 60), s: s % 60 };
  el.querySelectorAll('[data-u]').forEach(x => { const n = String(v[x.dataset.u]).padStart(2, '0'); if (x.textContent !== n) x.textContent = n; });
}
// Se ajusta al cambio exacto de cada segundo del reloj
function tickCuenta() { pintarCuenta(); clearTimeout(cuentaT); cuentaT = setTimeout(tickCuenta, 1000 - (Date.now() % 1000) + 5); }
document.addEventListener('visibilitychange', () => { if (!document.hidden) { objetivoCuenta(); tickCuenta(); } });

/* ---------- Movimiento ---------- */
const ORDEN = ['inicio', 'partidos', 'tabla', 'plantilla', 'stats'];
const sinMov = matchMedia('(prefers-reduced-motion: reduce)').matches;
let calAnim = 0;

// dir: 1 entra por la derecha, -1 por la izquierda, 0 sin animación (refrescos de datos)
function render(dir = 0) {
  const main = document.getElementById('view');
  main.innerHTML = V[tab]();
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  document.querySelector('.tabs').style.setProperty('--i', ORDEN.indexOf(tab));
  objetivoCuenta(); if (!cuentaT) tickCuenta(); else pintarCuenta();
  if (calAnim) { const g = main.querySelector('.cal-grid'); if (g) g.classList.add(calAnim > 0 ? 'anim-d' : 'anim-i'); calAnim = 0; }
  if (!dir || sinMov) return;
  main.classList.remove('anim-d', 'anim-i', 'sale-d', 'sale-i'); void main.offsetWidth;
  [...main.children].forEach((c, i) => c.style.setProperty('--d', i));
  main.classList.add(dir > 0 ? 'anim-d' : 'anim-i');
  contar(main);
}

function irA(nuevo) {
  if (!V[nuevo] || nuevo === tab) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
  const dir = ORDEN.indexOf(nuevo) > ORDEN.indexOf(tab) ? 1 : -1;
  tab = nuevo;
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  document.querySelector('.tabs').style.setProperty('--i', ORDEN.indexOf(tab));
  const main = document.getElementById('view');
  clearTimeout(irA.t);
  if (sinMov) { window.scrollTo(0, 0); render(dir); return; }
  // primero sale lo que había, luego entra lo nuevo
  main.classList.remove('anim-d', 'anim-i', 'sale-d', 'sale-i'); void main.offsetWidth;
  main.classList.add(dir > 0 ? 'sale-d' : 'sale-i');
  irA.t = setTimeout(() => { main.classList.remove('sale-d', 'sale-i'); window.scrollTo(0, 0); render(dir); }, 240);
  if (navigator.vibrate) navigator.vibrate(6);
}

// Los números grandes suben desde 0 al entrar en la pestaña
function contar(raiz) {
  raiz.querySelectorAll('.kpi b, .big').forEach(el => {
    const fin = el.textContent.trim();
    if (!/^\d{1,4}$/.test(fin) || +fin === 0) return;
    const n = +fin, t0 = performance.now(), dur = 600;
    const paso = t => { const k = Math.min(1, (t - t0) / dur); el.textContent = Math.round(n * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(paso); else el.textContent = fin; };
    requestAnimationFrame(paso);
  });
}

// Deslizar el dedo: en el calendario cambia de mes, en el resto cambia de pestaña
(() => {
  let x0 = 0, y0 = 0, t0 = 0, enCal = false, bloqueado = false;
  addEventListener('touchstart', e => {
    const t = e.touches[0]; x0 = t.clientX; y0 = t.clientY; t0 = Date.now();
    enCal = !!e.target.closest('.cal');
    bloqueado = !!e.target.closest('dialog, input, textarea, select, .galeria, table') || document.getElementById('modal').open;
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
    const giro = quiere ? 360 : 0;
    e.animate([{ transformOrigin: '50% 50%', transform: `translate(${(a.left + a.width / 2) - (b.left + b.width / 2)}px, ${(a.top + a.height / 2) - (b.top + b.height / 2)}px) scale(${a.width / b.width}) rotate(0deg)` },
      { transformOrigin: '50% 50%', transform: `translate(0px, 0px) scale(1) rotate(${giro}deg)` }], opts);
  });
  if (marca && quiere) marca.animate([{ opacity: 0, transform: 'translateX(-14px)' }, { opacity: 1, transform: 'none' }], { duration: 820, easing: 'cubic-bezier(.65, 0, .25, 1)' });
}
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
  const t = e.target.closest('[data-tab]');
  if (t) { irA(t.dataset.tab); return; }
  const a = e.target.closest('[data-act]');
  if (!a) return;
  const act = a.dataset.act;
  if (act === 'nuevo-partido') editarPartido();
  else if (act === 'editar-partido') editarPartido(a.dataset.id);
  else if (act === 'ver-partido') resumenPartido(a.dataset.id);
  else if (act === 'ver-equipo') { const d = document.getElementById('modal'); if (d.open) d.close(); else zoomDesde = a.getBoundingClientRect(); fichaEquipo(a.dataset.eq); }
  else if (act === 'votar') {
    const yo = yoId(); if (!yo) return;
    store.setVoto({ id: `${a.dataset.p}__${yo}`, partido: a.dataset.p, votante: yo, voto: a.dataset.v }).then(() => reabrir(a.dataset.p));
  }
  else if (act === 'nueva-lesion') editarLesion();
  else if (act === 'cal-vista') { const p = calPrefs(); p.vista = a.dataset.v; guardarPrefs(p); render(); }
  else if (act === 'cal-dia') { calDia = a.dataset.v; if (calPrefs().vista === 'mes' && calDia.slice(0, 7) !== calMes) calMes = calDia.slice(0, 7); render(); }
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
  else if (act === 'asist') {
    const p = getPartido(a.dataset.p);
    p.asistencia = { ...(p.asistencia || {}), [a.dataset.j]: a.dataset.v };
    guardarPartido(p);
  }
});
document.addEventListener('change', e => {
  const a = e.target.closest('[data-act]');
  if (!a) return;
  if (a.dataset.act === 'soy') {
    try { localStorage.setItem('lafarga.yo', a.value); } catch (er) { /* sin almacenamiento */ }
    const d = document.getElementById('modal'); const id = d.dataset.partido; if (id) reabrir(id);
  } else if (a.dataset.act === 'subir' && a.files.length) subirFotos(a.dataset.p, [...a.files]);
});
document.getElementById('btn-ajustes').onclick = ajustes;

async function init() {
  render();
  try {
    const r = await fetch('data/liga.json', { cache: 'no-cache' });
    const j = await r.json();
    if (!web.actualizado || j.actualizado > web.actualizado) web = j;
    pintarCabecera();
  } catch (e) { toast('Sin conexión: usando datos guardados'); }
  render();
  conectarNube();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}
init();
