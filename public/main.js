(() => {
  'use strict';

  const CATS = {
    oficios: ['🛠️', 'Oficios'], hogar: ['🏡', 'Hogar'], clases: ['📚', 'Clases'], cuidado: ['🤝', 'Cuidado'],
    tecnologia: ['💻', 'Tecnología'], gastronomia: ['🍲', 'Gastronomía'], transporte: ['🚚', 'Transporte'], otros: ['✨', 'Otros']
  };
  const CONTRATOS = { puntual: 'trabajo puntual', 'part-time': 'part-time', 'full-time': 'full-time', honorarios: 'a honorarios' };
  const MODOS = { presencial: 'presencial', remoto: 'remoto', hibrido: 'híbrido' };
  const catTxt = c => (CATS[c] || CATS.otros).join(' ');

  // ---------- Utilidades ----------
  const $ = s => document.querySelector(s);
  // Todo texto de usuarios se inserta con textContent: nunca como HTML.
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  const norm = s => s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
  function aviso(msg) {
    const a = $('#aviso');
    a.textContent = msg; a.hidden = false;
    clearTimeout(aviso.t);
    aviso.t = setTimeout(() => (a.hidden = true), 4500);
  }

  // ---------- API y sesión ----------
  let yo = null; // { email, nombre, avatar } o null
  async function api(url, { method = 'GET', json, form } = {}) {
    const opts = { method, headers: { 'x-requested-with': 'fetch' }, credentials: 'same-origin' };
    if (json !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(json); }
    if (form) opts.body = form;
    const r = await fetch(url, opts);
    let j = {};
    try { j = await r.json(); } catch { /* sin cuerpo */ }
    if (r.status === 401) { abrirLogin(j.error); throw new Error(j.error || 'Debes ingresar.'); }
    if (!r.ok) throw new Error(j.error || 'Algo salió mal.');
    return j;
  }
  function abrirLogin(msg) {
    $('#login-msg').textContent = msg || '';
    const d = $('#dlg-login');
    if (!d.open) d.showModal();
  }
  // Acciones que requieren cuenta y nombre de pila
  function exigirCuenta() {
    if (!yo) { abrirLogin('Ingresa para continuar.'); return false; }
    if (!yo.nombre) { $('#mi-nombre').focus(); aviso('Primero escribe tu nombre de pila en el panel.'); return false; }
    return true;
  }

  // ---------- Mapa ----------
  const map = L.map('map', { zoomControl: false }).setView([-36.818, -73.0634], 14);
  L.control.zoom({ position: 'topright' }).addTo(map);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  }).addTo(map);
  const nuevoGrupo = () => L.markerClusterGroup({ showCoverageOnHover: false, maxClusterRadius: 50 });
  const cluster = nuevoGrupo().addTo(map); // oficios
  const clusterEmp = nuevoGrupo();         // empleos (se muestra en su pestaña)
  map.locate({ setView: true, maxZoom: 15 }); // si falla, queda el centro por defecto

  let pestana = 'oficios';
  const datos = new Map(), pines = new Map();       // oficios
  const empleos = new Map(), pinesEmp = new Map();  // empleos

  // ---------- Marcadores: avatar, corazón de likes e insignia de grado ----------
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const sv = (tag, attrs = {}) => {
    const n = document.createElementNS(SVG_NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  };
  const TONOS = {
    bronce: { fondo: '#7a4a1d', glifo: '#ffe0a3' },
    plata: { fondo: '#4f5b63', glifo: '#ffffff' },
    oro: { fondo: '#8a5f00', glifo: '#ffe680' },
    rojo: { fondo: '#8b1a1a', glifo: '#ffd966' }
  };
  const estrella = (cx, cy, R) => {
    const p = [];
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? R * 0.42 : R, a = -Math.PI / 2 + (i * Math.PI) / 5;
      p.push(`${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`);
    }
    return p.join(' ');
  };
  function insignia(r) {
    const t = TONOS[r.tono];
    const s = sv('svg', { viewBox: '0 0 24 24', width: 26, height: 26, role: 'img', 'aria-label': r.nombre });
    s.append(sv('circle', { cx: 12, cy: 12, r: 10.5, fill: t.fondo, stroke: r.aro ? t.glifo : '#fff', 'stroke-width': 2 }));
    for (let i = 0; i < r.chev; i++) { // galones, de abajo hacia arriba
      const y = 12 - ((r.chev - 1) * 3) / 2 + i * 3;
      s.append(sv('polyline', { points: `6.5,${y + 2.2} 12,${y - 2.2} 17.5,${y + 2.2}`, fill: 'none', stroke: t.glifo, 'stroke-width': 1.8 }));
    }
    const n = r.estrellas, R = n === 1 ? 6 : n === 2 ? 4.4 : 3.4, sep = n === 2 ? 8.4 : 6.8;
    for (let i = 0; i < n; i++) s.append(sv('polygon', { points: estrella(12 + (i - (n - 1) / 2) * sep, 12.3, R), fill: t.glifo }));
    return s;
  }
  function corazon(n) {
    const s = sv('svg', { viewBox: '0 0 28 26', width: 30, height: 28, role: 'img', 'aria-label': `${n} me gusta` });
    s.append(sv('path', {
      d: 'M14 24.5C14 24.5 2 17 2 9.2 2 5.1 5 2.5 8.4 2.5c2.3 0 4.2 1.2 5.6 3.2 1.4-2 3.3-3.2 5.6-3.2C23 2.5 26 5.1 26 9.2 26 17 14 24.5 14 24.5z',
      fill: '#e53935', stroke: '#fff', 'stroke-width': 1.5
    }));
    const t = sv('text', {
      x: 14, y: 12.5, 'text-anchor': 'middle', 'dominant-baseline': 'central', fill: '#fff',
      'font-weight': 700, 'font-size': n > 99 ? 8 : n > 9 ? 10 : 12, 'font-family': 'system-ui, sans-serif'
    });
    t.textContent = n > 99 ? '99+' : String(n);
    s.append(t);
    return s;
  }
  const divIcono = wrap => L.divIcon({ className: '', html: wrap, iconSize: [46, 46], iconAnchor: [23, 23], popupAnchor: [0, -26] });

  function icono(o) {
    const wrap = el('div', 'marca');
    const pin = el('div', 'pin');
    if (o.avatar) { const im = el('img'); im.src = o.avatar; im.alt = ''; pin.append(im); }
    else pin.textContent = (CATS[o.categoria] || CATS.otros)[0];
    wrap.append(pin);
    if (o.likes > 0) { const c = el('span', 'marca-like'); c.append(corazon(o.likes)); wrap.append(c); }
    const r = rangoDe(o.likes);
    if (r) { const g = el('span', 'marca-rango'); g.title = r.nombre; g.append(insignia(r)); wrap.append(g); }
    return divIcono(wrap);
  }
  function iconoEmpleo(e) {
    const wrap = el('div', 'marca');
    const pin = el('div', 'pin empleo');
    if (e.logo) { const im = el('img'); im.src = e.logo; im.alt = ''; pin.append(im); }
    else pin.textContent = '💼';
    wrap.append(pin);
    return divIcono(wrap);
  }
  function textoRango(o) {
    const r = rangoDe(o.likes), sig = siguienteRango(o.likes);
    if (!r) return `Con ${INICIO - o.likes} ♥ más obtiene su primer grado: ${RANGOS[0].nombre}.`;
    return `Grado: ${r.nombre}` + (sig ? `. Faltan ${sig.faltan} ♥ para ${sig.nombre}.` : '. Es el grado máximo.');
  }
  // "Carlos, Programador": nombre de pila, coma y oficio
  const etiqueta = o => (o.nombre ? `${o.nombre}, ${o.titulo}` : o.titulo);

  // ---------- Likes (un like por persona verificada) ----------
  function pintarLike(b, o) {
    b.textContent = `${o.liked ? '♥' : '♡'} ${o.likes}`;
    b.setAttribute('aria-pressed', String(o.liked));
    b.setAttribute('aria-label', o.mia ? 'No puedes dar me gusta a tu propia oferta' : o.liked ? 'Quitar me gusta' : 'Me gusta');
    b.disabled = !!o.mia;
  }
  function pintarLikes(id) {
    const o = datos.get(id);
    document.querySelectorAll(`[data-like="${id}"]`).forEach(b => pintarLike(b, o));
    document.querySelectorAll(`[data-rango="${id}"]`).forEach(p => { p.textContent = textoRango(o); });
    pines.get(id)?.setIcon(icono(o));
  }
  async function alternarLike(id) {
    try {
      const j = await api(`/api/ofertas/${id}/like`, { method: 'POST' });
      Object.assign(datos.get(id), { likes: j.likes, liked: j.liked });
      pintarLikes(id); pintarLista();
    } catch (e) { aviso(e.message); }
  }

  // ---------- Consultas (chat por oferta) ----------
  function agregarMensaje(id, m) {
    const ul = document.querySelector(`ul[data-chat="${id}"]`);
    if (!ul || ul.querySelector(`[data-id="${m.id}"]`)) return;
    const li = el('li'); li.dataset.id = m.id;
    const cab = el('strong', null, m.autor);
    if (m.dueno) cab.append(el('span', 'insignia', 'publicó la oferta'));
    li.append(cab, el('p', null, m.texto),
      el('small', null, new Date(m.creado).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' })));
    ul.append(li);
    ul.scrollTop = ul.scrollHeight;
  }
  function bloqueChat(o) {
    const det = el('details', 'chat');
    det.append(el('summary', null, 'Consultas públicas'));
    const ul = el('ul', 'mensajes'); ul.dataset.chat = o.id;
    const f = el('form', 'chat-form');
    const texto = el('input'); texto.placeholder = 'Escribe tu consulta'; texto.maxLength = 300; texto.required = true;
    texto.setAttribute('aria-label', 'Tu consulta');
    const enviar = el('button', 'btn primario', 'Enviar'); enviar.type = 'submit';
    f.append(texto, enviar);
    det.append(ul, f);

    det.addEventListener('toggle', async () => {
      if (!det.open || det.dataset.cargado) return;
      det.dataset.cargado = '1';
      try { (await api(`/api/ofertas/${o.id}/mensajes`)).forEach(m => agregarMensaje(o.id, m)); }
      catch { aviso('No pude cargar las consultas.'); }
    });
    f.addEventListener('submit', async e => {
      e.preventDefault();
      if (!exigirCuenta()) return;
      try {
        const m = await api(`/api/ofertas/${o.id}/mensajes`, { method: 'POST', json: { texto: texto.value } });
        texto.value = '';
        agregarMensaje(o.id, m);
      } catch (err) { aviso(err.message); }
    });
    return det;
  }

  // ---------- Fotos y videos ----------
  function verMedia(m) { $('#visor-img').src = m.url; $('#visor').showModal(); }
  $('#visor-cerrar').addEventListener('click', () => $('#visor').close());
  $('#visor').addEventListener('click', e => { if (e.target === e.currentTarget) e.currentTarget.close(); });
  const refrescarPopup = (mapa, id) => { const p = mapa.get(id)?.getPopup(); if (p?.isOpen()) p.update(); };

  async function subir(id, archivos) {
    for (const f of archivos) {
      const fd = new FormData();
      fd.append('archivo', f);
      try {
        const j = await api(`/api/ofertas/${id}/media`, { method: 'POST', form: fd });
        datos.get(id).media = j.media;
        refrescarPopup(pines, id);
      } catch (e) { aviso(`${f.name}: ${e.message}`); }
    }
  }
  async function quitarMedia(id, mid) {
    try {
      const j = await api(`/api/ofertas/${id}/media/${mid}`, { method: 'DELETE' });
      datos.get(id).media = j.media;
      refrescarPopup(pines, id);
    } catch (e) { aviso(e.message); }
  }
  function galeria(o) {
    const gal = el('div', 'galeria');
    for (const m of o.media) {
      const item = el('div', 'item');
      if (m.tipo === 'imagen') {
        const img = el('img'); img.src = m.url; img.alt = `Foto de ${o.titulo}`; img.loading = 'lazy';
        img.addEventListener('click', () => verMedia(m));
        item.append(img);
      } else {
        const v = el('video'); v.src = m.url; v.controls = true; v.preload = 'metadata';
        item.append(v);
      }
      if (o.mia) {
        const x = el('button', 'quitar', '×'); x.type = 'button'; x.setAttribute('aria-label', 'Quitar archivo');
        x.addEventListener('click', () => quitarMedia(o.id, m.id));
        item.append(x);
      }
      gal.append(item);
    }
    return gal;
  }

  // ---------- Tarjetas (popups) ----------
  const linkWhatsapp = (num, texto) => {
    const a = el('a', 'btn primario');
    a.href = `https://wa.me/${num}?text=${encodeURIComponent(texto)}`;
    a.target = '_blank'; a.rel = 'noopener noreferrer';
    return a;
  };

  function tarjeta(o) {
    const box = el('div', 'tarjeta');
    if (o.media.length) box.append(galeria(o));
    box.append(el('h3', null, etiqueta(o)));
    box.append(el('p', 'meta', `${catTxt(o.categoria)}, ${o.modalidad}, tarifa ${o.tarifa}`));
    const info = el('p', 'meta', textoRango(o)); info.dataset.rango = o.id;
    box.append(info, el('p', null, o.descripcion));

    const acc = el('div', 'acciones');
    const like = el('button', 'btn like'); like.type = 'button'; like.dataset.like = o.id;
    pintarLike(like, o);
    like.addEventListener('click', () => { if (!yo) return abrirLogin('Ingresa para dar me gusta.'); alternarLike(o.id); });
    acc.append(like);

    const wa = linkWhatsapp(o.whatsapp, `Hola, vi tu oferta "${o.titulo}" en el mapa de vecinos.`);
    wa.textContent = 'Escribir por WhatsApp';
    acc.append(wa);

    if (o.mia) {
      if (o.media.length < 4) {
        const inp = el('input'); inp.type = 'file'; inp.multiple = true; inp.hidden = true;
        inp.accept = 'image/jpeg,image/png,image/webp,video/mp4,video/webm';
        inp.addEventListener('change', () => subir(o.id, [...inp.files].slice(0, 4 - o.media.length)));
        const b = el('button', 'btn', 'Agregar foto o video'); b.type = 'button';
        b.addEventListener('click', () => inp.click());
        acc.append(b, inp);
      }
      const del = el('button', 'btn peligro', 'Eliminar mi oferta'); del.type = 'button';
      del.addEventListener('click', () => eliminar(o.id));
      acc.append(del);
    }
    box.append(acc, bloqueChat(o));
    return box;
  }

  function tarjetaEmpleo(e) {
    const box = el('div', 'tarjeta');
    if (e.logo) { const im = el('img', 'logo-popup'); im.src = e.logo; im.alt = `Logo de ${e.publica || 'la empresa'}`; box.append(im); }
    box.append(el('h3', null, e.titulo));
    box.append(el('p', 'publica', `${e.empresa ? 'Empresa' : 'Vecino/a'}: ${e.publica || 'Anónimo'}`));
    box.append(el('p', 'meta', `${catTxt(e.categoria)}, ${MODOS[e.modalidad] || e.modalidad}, ${CONTRATOS[e.contrato] || e.contrato}`));
    box.append(el('p', 'meta', `Pago: ${e.pago}. Vigente hasta el ${new Date(e.vence).toLocaleDateString('es-CL')}.`));
    box.append(el('p', null, e.descripcion));
    const acc = el('div', 'acciones');
    const wa = linkWhatsapp(e.whatsapp, `Hola, vi tu oferta de trabajo "${e.titulo}" en el mapa de vecinos y quiero postular.`);
    wa.textContent = 'Postular por WhatsApp';
    acc.append(wa);
    if (e.mia) {
      const inp = el('input'); inp.type = 'file'; inp.hidden = true; inp.accept = 'image/jpeg,image/png,image/webp';
      inp.addEventListener('change', () => { if (inp.files[0]) subirLogo(e.id, inp.files[0]); });
      const cambiar = el('button', 'btn', e.logo ? 'Cambiar logo' : 'Agregar logo'); cambiar.type = 'button';
      cambiar.addEventListener('click', () => inp.click());
      acc.append(cambiar, inp);
      if (e.logo) {
        const q = el('button', 'btn', 'Quitar logo'); q.type = 'button';
        q.addEventListener('click', () => quitarLogo(e.id));
        acc.append(q);
      }
      const del = el('button', 'btn peligro', 'Cerrar oferta (ya está cubierta)'); del.type = 'button';
      del.addEventListener('click', () => eliminarEmpleo(e.id));
      acc.append(del);
    }
    box.append(acc);
    return box;
  }

  // ---------- Altas y bajas de oficios ----------
  function agregar(o) {
    if (datos.has(o.id)) return;
    datos.set(o.id, o);
    pines.set(o.id, L.marker([o.lat, o.lng], { icon: icono(o), title: etiqueta(o) })
      .bindPopup(() => tarjeta(o), { minWidth: 240, maxWidth: 300, ofertaId: o.id }));
  }
  function quitar(id) { datos.delete(id); pines.delete(id); refrescar(); }
  async function eliminar(id) {
    try { await api(`/api/ofertas/${id}`, { method: 'DELETE' }); quitar(id); aviso('Oferta eliminada.'); }
    catch (e) { aviso(e.message); }
  }

  // ---------- Altas y bajas de empleos ----------
  function agregarEmpleo(e) {
    if (empleos.has(e.id)) return;
    empleos.set(e.id, e);
    pinesEmp.set(e.id, L.marker([e.lat, e.lng], { icon: iconoEmpleo(e), title: e.titulo })
      .bindPopup(() => tarjetaEmpleo(e), { minWidth: 240, maxWidth: 300 }));
  }
  function quitarEmpleo(id) { empleos.delete(id); pinesEmp.delete(id); refrescar(); }
  async function eliminarEmpleo(id) {
    try { await api(`/api/empleos/${id}`, { method: 'DELETE' }); quitarEmpleo(id); aviso('Oferta de trabajo cerrada.'); }
    catch (e) { aviso(e.message); }
  }

  // Logo del marcador de un trabajo
  function aplicarLogo(id, logo) {
    const e = empleos.get(id);
    if (!e) return;
    e.logo = logo;
    pinesEmp.get(id)?.setIcon(iconoEmpleo(e));
    refrescarPopup(pinesEmp, id);
  }
  async function subirLogo(id, file) {
    try {
      const fd = new FormData();
      fd.append('archivo', await aLogo(file), 'logo.jpg');
      const j = await api(`/api/empleos/${id}/logo`, { method: 'POST', form: fd });
      aplicarLogo(id, j.logo);
    } catch (e) { aviso(e.message); }
  }
  async function quitarLogo(id) {
    try { await api(`/api/empleos/${id}/logo`, { method: 'DELETE' }); aplicarLogo(id, null); }
    catch (e) { aviso(e.message); }
  }

  // ---------- Filtros, mapa y lista ----------
  const coincide = (o, extra) => {
    const q = norm($('#buscar').value), c = $('#filtro-cat').value;
    return (!c || o.categoria === c) && (!q || norm(`${extra} ${o.titulo} ${o.descripcion}`).includes(q));
  };
  function refrescar() {
    cluster.clearLayers(); clusterEmp.clearLayers();
    for (const o of datos.values()) if (coincide(o, o.nombre || '')) cluster.addLayer(pines.get(o.id));
    for (const e of empleos.values()) if (coincide(e, e.publica || '')) clusterEmp.addLayer(pinesEmp.get(e.id));
    pintarLista();
  }
  function pintarLista() {
    const centro = map.getCenter(), lim = map.getBounds(), esOficio = pestana === 'oficios';
    const fuente = esOficio ? [...datos.values()] : [...empleos.values()];
    const visibles = fuente
      .filter(o => coincide(o, esOficio ? o.nombre || '' : o.publica || '') && lim.contains([o.lat, o.lng]))
      .sort((a, b) => centro.distanceTo([a.lat, a.lng]) - centro.distanceTo([b.lat, b.lng]))
      .slice(0, 50);
    const ul = $('#lista');
    ul.replaceChildren();
    if (!visibles.length) {
      ul.append(el('li', 'vacio', esOficio
        ? 'No hay ofertas en esta zona. Mueve el mapa o sé la primera persona en ofrecer algo.'
        : 'No hay trabajos publicados en esta zona. Mueve el mapa o publica el primero.'));
      return;
    }
    for (const o of visibles) {
      const li = el('li'), b = el('button');
      b.type = 'button';
      if (esOficio) {
        const r = rangoDe(o.likes);
        b.append(el('strong', null, etiqueta(o)), el('small', null, `${catTxt(o.categoria)}, ${o.tarifa}, ♥ ${o.likes}${r ? ', ' + r.nombre : ''}`));
        b.addEventListener('click', () => cluster.zoomToShowLayer(pines.get(o.id), () => pines.get(o.id).openPopup()));
      } else {
        b.append(el('strong', null, o.titulo), el('small', null, `${o.publica || 'Anónimo'}, ${CONTRATOS[o.contrato] || o.contrato}, ${o.pago}`));
        b.addEventListener('click', () => clusterEmp.zoomToShowLayer(pinesEmp.get(o.id), () => pinesEmp.get(o.id).openPopup()));
      }
      li.append(b); ul.append(li);
    }
  }
  map.on('moveend', pintarLista);

  const selFiltro = $('#filtro-cat'), selForm = $('#sel-cat'), selEmp = $('#sel-cat-emp');
  selFiltro.append(new Option('Todas las categorías', ''));
  for (const [k, [emo, nom]] of Object.entries(CATS)) {
    selFiltro.append(new Option(`${emo} ${nom}`, k));
    selForm.append(new Option(`${emo} ${nom}`, k));
    selEmp.append(new Option(`${emo} ${nom}`, k));
  }
  $('#buscar').addEventListener('input', refrescar);
  selFiltro.addEventListener('change', refrescar);

  // ---------- Pestañas ----------
  function cambiarPestana(p) {
    pestana = p;
    const oficios = p === 'oficios';
    $('#tab-oficios').setAttribute('aria-selected', String(oficios));
    $('#tab-empleos').setAttribute('aria-selected', String(!oficios));
    map.closePopup();
    if (oficios) { map.removeLayer(clusterEmp); map.addLayer(cluster); } else { map.removeLayer(cluster); map.addLayer(clusterEmp); }
    $('#btn-ofrecer').textContent = oficios ? 'Ofrecer mi habilidad' : 'Publicar un trabajo';
    pintarLista();
  }
  $('#tab-oficios').addEventListener('click', () => cambiarPestana('oficios'));
  $('#tab-empleos').addEventListener('click', () => cambiarPestana('empleos'));

  // ---------- Zona (compartida por los dos formularios) ----------
  const TXT_SIN_ZONA = 'Sin marcar. En el mapa solo se verá una zona aproximada.';
  let ubic = null, zona = null;
  const textoZona = t => document.querySelectorAll('.ubic-estado').forEach(p => { p.textContent = t; });
  function setUbic(ll) {
    ubic = ll;
    zona?.remove();
    zona = L.circle(ll, { radius: 300, color: '#1f6f78', weight: 2, fillOpacity: 0.15 }).addTo(map);
    textoZona('Zona marcada. Se mostrará de forma aproximada.');
  }
  function limpiarUbic() { zona?.remove(); zona = null; ubic = null; textoZona(TXT_SIN_ZONA); }

  document.addEventListener('click', e => {
    const gps = e.target.closest('.usar-gps'), mar = e.target.closest('.marcar');
    if (gps) {
      navigator.geolocation.getCurrentPosition(
        p => { const ll = L.latLng(p.coords.latitude, p.coords.longitude); setUbic(ll); map.flyTo(ll, 15); },
        () => aviso('No pude obtener tu ubicación. Márcala en el mapa.'),
        { enableHighAccuracy: true, timeout: 10000 }
      );
    }
    if (mar) {
      const d = mar.closest('dialog');
      d.close();
      document.body.classList.add('eligiendo');
      aviso('Toca el mapa para marcar la zona.');
      map.once('click', ev => { document.body.classList.remove('eligiendo'); setUbic(ev.latlng); d.showModal(); });
    }
  });

  // ---------- Botón principal y formularios ----------
  const dlg = $('#dlg'), form = $('#form-oferta'), dlgEmp = $('#dlg-empleo'), formEmp = $('#form-empleo');
  $('#btn-ofrecer').addEventListener('click', () => {
    if (!exigirCuenta()) return;
    (pestana === 'oficios' ? dlg : dlgEmp).showModal();
  });
  $('#cancelar').addEventListener('click', () => dlg.close());
  $('#cancelar-emp').addEventListener('click', () => dlgEmp.close());
  $('#publica-como').addEventListener('change', e => { $('#campo-empresa').hidden = e.target.value !== 'empresa'; });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (!ubic) return aviso('Marca tu zona en el mapa antes de publicar.');
    const body = Object.fromEntries(new FormData(form));
    delete body.archivos;
    const archivos = [...$('#archivos').files].slice(0, 4);
    body.lat = ubic.lat; body.lng = ubic.lng;
    try {
      const j = await api('/api/ofertas', { method: 'POST', json: body });
      if (datos.has(j.id)) datos.get(j.id).mia = true; else agregar(j); // el socket pudo llegar antes
      refrescar();
      form.reset(); limpiarUbic(); dlg.close();
      map.flyTo([j.lat, j.lng], 16);
      aviso(archivos.length ? 'Oferta publicada. Subiendo archivos…' : 'Oferta publicada.');
      if (archivos.length) await subir(j.id, archivos);
    } catch (err) { aviso(err.message); }
  });

  formEmp.addEventListener('submit', async e => {
    e.preventDefault();
    if (!ubic) return aviso('Marca la zona del trabajo en el mapa antes de publicar.');
    const body = Object.fromEntries(new FormData(formEmp));
    if (body.publicaComo !== 'empresa') delete body.empresa;
    const logo = $('#logo-empleo').files[0];
    body.lat = ubic.lat; body.lng = ubic.lng;
    try {
      const j = await api('/api/empleos', { method: 'POST', json: body });
      if (empleos.has(j.id)) empleos.get(j.id).mia = true; else agregarEmpleo(j);
      refrescar();
      formEmp.reset(); $('#campo-empresa').hidden = true; limpiarUbic(); dlgEmp.close();
      map.flyTo([j.lat, j.lng], 16);
      aviso(logo ? 'Trabajo publicado. Subiendo logo…' : 'Trabajo publicado.');
      if (logo) await subirLogo(j.id, logo);
    } catch (err) { aviso(err.message); }
  });

  // ---------- Cuenta: ingreso por enlace, perfil y foto ----------
  function pintarCuenta() {
    $('#btn-ingresar').hidden = !!yo;
    $('#perfil').hidden = !yo;
    if (!yo) return;
    $('#mi-correo').textContent = yo.email;
    $('#mi-nombre').value = yo.nombre || '';
    const im = $('#mi-avatar');
    im.hidden = !yo.avatar;
    if (yo.avatar) im.src = yo.avatar;
    $('#quitar-avatar').hidden = !yo.avatar;
    $('#btn-avatar').textContent = yo.avatar ? 'Cambiar foto' : 'Poner mi foto';
  }

  $('#btn-ingresar').addEventListener('click', () => abrirLogin(''));
  $('#login-cancelar').addEventListener('click', () => $('#dlg-login').close());
  $('#form-login').addEventListener('submit', async e => {
    e.preventDefault();
    const msg = $('#login-msg');
    msg.textContent = 'Enviando…';
    try {
      const j = await api('/api/auth/solicitar', { method: 'POST', json: { email: e.target.email.value } });
      msg.textContent = j.prueba
        ? 'Modo prueba: el enlace de acceso apareció en la terminal donde corre el servidor. Ábrelo en este navegador.'
        : 'Listo. Te enviamos un enlace a tu correo (vale 15 minutos). Revisa también la carpeta de spam.';
    } catch (err) { msg.textContent = err.message; }
  });

  $('#btn-salir').addEventListener('click', async () => {
    try { await api('/api/auth/salir', { method: 'POST' }); location.reload(); } catch (e) { aviso(e.message); }
  });
  $('#btn-eliminar').addEventListener('click', async () => {
    if (!confirm('Se borrarán tu cuenta, tus ofertas, tus fotos y tus mensajes. Esto no se puede deshacer. ¿Continuar?')) return;
    try { await api('/api/yo', { method: 'DELETE' }); location.reload(); } catch (e) { aviso(e.message); }
  });

  $('#mi-nombre').addEventListener('change', async e => {
    const v = e.target.value.trim();
    if (!v) { e.target.value = yo?.nombre || ''; return; }
    try {
      const j = await api('/api/nombre', { method: 'PUT', json: { nombre: v } });
      yo.nombre = j.nombre; e.target.value = j.nombre;
      aviso('Nombre guardado.');
    } catch (err) { aviso(err.message); e.target.value = yo?.nombre || ''; }
  });

  // Recorta al cuadrado y reduce a 160 px: la foto pesa poco y se pierden los metadatos (incluida la ubicación).
  function aCuadrado(file, lado = 160) {
    return new Promise((ok, mal) => {
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = c.height = lado;
        const m = Math.min(img.width, img.height);
        c.getContext('2d').drawImage(img, (img.width - m) / 2, (img.height - m) / 2, m, m, 0, 0, lado, lado);
        URL.revokeObjectURL(url);
        c.toBlob(b => (b ? ok(b) : mal(new Error('No pude procesar la imagen.'))), 'image/jpeg', 0.85);
      };
      img.onerror = () => { URL.revokeObjectURL(url); mal(new Error('No pude leer esa imagen.')); };
      img.src = url;
    });
  }
  // Ajusta el logo completo (sin recortarlo) dentro de un cuadrado blanco de 160 px
  function aLogo(file, lado = 160) {
    return new Promise((ok, mal) => {
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = c.height = lado;
        const x = c.getContext('2d');
        x.fillStyle = '#fff'; x.fillRect(0, 0, lado, lado);
        const k = Math.min(lado / img.width, lado / img.height), w = img.width * k, h = img.height * k;
        x.drawImage(img, (lado - w) / 2, (lado - h) / 2, w, h);
        URL.revokeObjectURL(url);
        c.toBlob(b => (b ? ok(b) : mal(new Error('No pude procesar la imagen.'))), 'image/jpeg', 0.9);
      };
      img.onerror = () => { URL.revokeObjectURL(url); mal(new Error('No pude leer esa imagen.')); };
      img.src = url;
    });
  }
  $('#btn-avatar').addEventListener('click', () => $('#archivo-avatar').click());
  $('#archivo-avatar').addEventListener('change', async e => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      const fd = new FormData();
      fd.append('archivo', await aCuadrado(f), 'avatar.jpg');
      const j = await api('/api/avatar', { method: 'POST', form: fd });
      yo.avatar = j.avatar; pintarCuenta(); aviso('Foto actualizada. Recuerda que será pública en el mapa.');
    } catch (err) { aviso(err.message); }
  });
  $('#quitar-avatar').addEventListener('click', async () => {
    try {
      await api('/api/avatar', { method: 'DELETE' });
      yo.avatar = null; pintarCuenta(); aviso('Foto quitada. Tu marcador vuelve al ícono de la categoría.');
    } catch (err) { aviso(err.message); }
  });

  // ---------- Tiempo real ----------
  const socket = io();
  socket.on('oferta:nueva', o => { agregar(o); refrescar(); });
  socket.on('oferta:eliminada', quitar);
  socket.on('oferta:likes', ({ id, likes }) => { const o = datos.get(id); if (o) { o.likes = likes; pintarLikes(id); pintarLista(); } });
  socket.on('oferta:media', ({ id, media }) => { const o = datos.get(id); if (o) { o.media = media; refrescarPopup(pines, id); } });
  socket.on('oferta:nombre', ({ id, nombre }) => {
    const o = datos.get(id);
    if (!o) return;
    o.nombre = nombre;
    const m = pines.get(id);
    if (m) { m.options.title = etiqueta(o); m.setIcon(icono(o)); }
    refrescarPopup(pines, id); pintarLista();
  });
  socket.on('oferta:avatar', ({ id, avatar }) => { const o = datos.get(id); if (o) { o.avatar = avatar; pines.get(id)?.setIcon(icono(o)); } });
  socket.on('chat:nuevo', ({ ofertaId, mensaje }) => agregarMensaje(ofertaId, mensaje));
  socket.on('empleo:nuevo', e => { agregarEmpleo(e); refrescar(); });
  socket.on('empleo:eliminado', quitarEmpleo);
  socket.on('empleo:logo', ({ id, logo }) => aplicarLogo(id, logo));
  socket.on('empleo:nombre', ({ id, publica }) => { const e = empleos.get(id); if (e) { e.publica = publica; refrescarPopup(pinesEmp, id); pintarLista(); } });
  socket.on('conectados', n => { $('#conectados').textContent = n === 1 ? '1 persona en el mapa' : `${n} personas en el mapa`; });

  let abierta = null; // oferta cuyo popup está abierto (sala de chat)
  map.on('popupopen', e => { abierta = e.popup.options.ofertaId || null; if (abierta) socket.emit('unirse', abierta); });
  map.on('popupclose', e => { const id = e.popup.options.ofertaId; if (id) socket.emit('salir', id); if (abierta === id) abierta = null; });
  socket.on('connect', () => { if (abierta) socket.emit('unirse', abierta); });

  // ---------- Arranque ----------
  const auth = new URLSearchParams(location.search).get('auth');
  if (auth) {
    history.replaceState(null, '', location.pathname);
    aviso(auth === 'ok' ? 'Ingresaste correctamente.' : 'El enlace venció o ya se usó. Pide uno nuevo.');
  }
  (async () => {
    try {
      const [sesion, listaOficios, listaEmpleos] = await Promise.all([api('/api/yo'), api('/api/ofertas'), api('/api/empleos')]);
      yo = sesion.usuario; pintarCuenta();
      listaOficios.forEach(agregar); listaEmpleos.forEach(agregarEmpleo);
      refrescar();
      if (yo && !yo.nombre) aviso('Escribe tu nombre de pila en el panel para poder publicar.');
    } catch { aviso('No pude cargar los datos. Recarga la página.'); }
  })();
})();
