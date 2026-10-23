const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { Server } = require('socket.io');

// ---------- Configuración (.env opcional) ----------
try {
  for (const l of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/)) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* sin .env */ }
const PORT = process.env.PORT || 3000;
// En Render, RENDER_EXTERNAL_URL trae la dirección pública; con dominio propio define APP_URL.
const APP_URL = (process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const PROD = process.env.NODE_ENV === 'production';

const CATEGORIAS = ['oficios', 'hogar', 'clases', 'cuidado', 'tecnologia', 'gastronomia', 'transporte', 'otros'];
const MODALIDADES = ['presencial', 'remoto', 'ambas'];
const TARIFAS = ['a convenir', 'por hora', 'gratis', 'trueque'];
const MODOS_EMPLEO = ['presencial', 'remoto', 'hibrido'];
const CONTRATOS = ['puntual', 'part-time', 'full-time', 'honorarios'];
const MAX_MEDIA = 4;
const DIA = 864e5;

// ---------- Persistencia simple en archivos JSON ----------
// DATA_PATH permite guardar todo en un disco persistente (ej. /var/data en Render).
const BASE = process.env.DATA_PATH || __dirname;
const DATA_DIR = path.join(BASE, 'data');
const UPLOADS = path.join(BASE, 'uploads');
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOADS, { recursive: true });

function almacen(nombre, inicial) {
  const archivo = path.join(DATA_DIR, nombre);
  let datos = inicial;
  try { datos = JSON.parse(fs.readFileSync(archivo, 'utf8')); } catch { /* primer arranque */ }
  let t;
  return {
    datos,
    guardar() { clearTimeout(t); t = setTimeout(() => fs.writeFile(archivo, JSON.stringify(this.datos, null, 2), () => {}), 300); }
  };
}
const db = {
  ofertas: almacen('ofertas.json', []),
  empleos: almacen('empleos.json', []),
  usuarios: almacen('usuarios.json', {}), // id -> { id, email, emailClave, nombre, avatar, creado }
  sesiones: almacen('sesiones.json', {})  // hash(sid) -> { uid, exp }
};
const ofertas = db.ofertas.datos, empleos = db.empleos.datos, usuarios = db.usuarios.datos, sesiones = db.sesiones.datos;
const guardarTodo = () => Object.values(db).forEach(a => a.guardar());
for (const o of ofertas) { o.likes ||= []; o.media ||= []; o.mensajes ||= []; }

// ---------- Utilidades ----------
const limpiar = (v, max) => String(v ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max);
const hash = s => crypto.createHash('sha256').update(s).digest('hex');
const buscar = id => ofertas.find(o => o.id === id);
const buscarEmpleo = id => empleos.find(e => e.id === id);
const urlAvatar = uid => { const a = usuarios[uid]?.avatar; return a ? `/uploads/${a}` : null; };
const nombreDe = uid => usuarios[uid]?.nombre || null;

const cubos = new Map();
function limitado(clave, max, ventanaMs) {
  const ahora = Date.now();
  const lista = (cubos.get(clave) || []).filter(t => ahora - t < ventanaMs);
  const excedido = lista.length >= max;
  if (!excedido) lista.push(ahora);
  cubos.set(clave, lista);
  return excedido;
}

const NOMBRE_RE = /^\p{L}[\p{L}\s'’-]{1,29}$/u;
const EMPRESA_RE = /^[\p{L}\p{N}][\p{L}\p{N}\s.&'’-]{1,59}$/u;
const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]{2,}$/;
// Clave canónica del correo (evita duplicar cuentas con alias de Gmail: a.b+x@gmail.com == ab@gmail.com)
function emailClave(email) {
  let [l, d] = email.toLowerCase().trim().split('@');
  if (d === 'googlemail.com') d = 'gmail.com';
  if (d === 'gmail.com') l = l.split('+')[0].replace(/\./g, '');
  return `${l}@${d}`;
}

function ubicacion(b) {
  const lat = Number(b.lat), lng = Number(b.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  // Privacidad: ~110 m de precisión. Nunca guardamos la ubicación exacta.
  return { lat: Math.round(lat * 1000) / 1000, lng: Math.round(lng * 1000) / 1000 };
}
function whatsappDe(b) {
  const w = String(b.whatsapp || '').replace(/\D/g, '');
  return w.length >= 8 && w.length <= 15 ? w : null;
}

function validarOferta(b) {
  const pos = ubicacion(b);
  if (!pos) return { error: 'Marca tu zona en el mapa.' };
  const titulo = limpiar(b.titulo, 80), descripcion = limpiar(b.descripcion, 500), whatsapp = whatsappDe(b);
  if (titulo.length < 4) return { error: 'El título es muy corto.' };
  if (descripcion.length < 10) return { error: 'Cuenta un poco más en la descripción.' };
  if (!whatsapp) return { error: 'Ingresa un WhatsApp válido, con código de país (ej. 56912345678).' };
  return {
    oferta: {
      titulo, descripcion, whatsapp, ...pos,
      categoria: CATEGORIAS.includes(b.categoria) ? b.categoria : 'otros',
      modalidad: MODALIDADES.includes(b.modalidad) ? b.modalidad : 'presencial',
      tarifa: TARIFAS.includes(b.tarifa) ? b.tarifa : 'a convenir'
    }
  };
}

function validarEmpleo(b) {
  const pos = ubicacion(b);
  if (!pos) return { error: 'Marca la zona del trabajo en el mapa.' };
  const titulo = limpiar(b.titulo, 80), descripcion = limpiar(b.descripcion, 600), whatsapp = whatsappDe(b);
  if (titulo.length < 4) return { error: 'El título es muy corto.' };
  if (descripcion.length < 10) return { error: 'Describe un poco más el trabajo.' };
  if (!whatsapp) return { error: 'Ingresa un WhatsApp válido, con código de país (ej. 56912345678).' };
  let empresa = null;
  if (b.publicaComo === 'empresa') {
    empresa = limpiar(b.empresa, 60);
    if (!EMPRESA_RE.test(empresa)) return { error: 'Escribe el nombre de la empresa (mínimo 2 caracteres).' };
  }
  const dias = [7, 15, 30].includes(Number(b.dias)) ? Number(b.dias) : 30;
  return {
    empleo: {
      titulo, descripcion, whatsapp, empresa, ...pos, vence: Date.now() + dias * DIA,
      categoria: CATEGORIAS.includes(b.categoria) ? b.categoria : 'otros',
      modalidad: MODOS_EMPLEO.includes(b.modalidad) ? b.modalidad : 'presencial',
      contrato: CONTRATOS.includes(b.contrato) ? b.contrato : 'puntual',
      pago: limpiar(b.pago, 40) || 'a convenir'
    }
  };
}

const mediaPublica = o => o.media.map(m => ({ id: m.id, tipo: m.tipo, url: `/uploads/${m.archivo}` }));
// Formas públicas: nunca exponen dueño, lista de likes, correos ni mensajes.
const publicar = (o, uid) => ({
  id: o.id, creada: o.creada, titulo: o.titulo, descripcion: o.descripcion, whatsapp: o.whatsapp,
  categoria: o.categoria, modalidad: o.modalidad, tarifa: o.tarifa, lat: o.lat, lng: o.lng,
  likes: o.likes.length, liked: !!uid && o.likes.includes(uid), media: mediaPublica(o),
  avatar: urlAvatar(o.propietario), nombre: nombreDe(o.propietario), mia: !!uid && o.propietario === uid
});
const quienPublica = e => e.empresa || nombreDe(e.propietario);
const publicarEmpleo = (e, uid) => ({
  id: e.id, creada: e.creada, vence: e.vence, titulo: e.titulo, descripcion: e.descripcion, whatsapp: e.whatsapp,
  categoria: e.categoria, modalidad: e.modalidad, contrato: e.contrato, pago: e.pago, lat: e.lat, lng: e.lng,
  publica: quienPublica(e), empresa: !!e.empresa, logo: e.logo ? `/uploads/${e.logo}` : null, mia: !!uid && e.propietario === uid
});
const mensajePublico = ({ id, autor, texto, creado, dueno }) => ({ id, autor, texto, creado, dueno });

// ---------- Validación de archivos (por contenido, no por lo que declare el navegador) ----------
function detectar(buf) {
  const h = (i, ...b) => b.every((v, k) => buf[i + k] === v);
  if (h(0, 0xff, 0xd8, 0xff)) return { tipo: 'imagen', ext: 'jpg', max: 5e6 };
  if (h(0, 0x89, 0x50, 0x4e, 0x47)) return { tipo: 'imagen', ext: 'png', max: 5e6 };
  if (h(0, 0x52, 0x49, 0x46, 0x46) && h(8, 0x57, 0x45, 0x42, 0x50)) return { tipo: 'imagen', ext: 'webp', max: 5e6 };
  if (h(4, 0x66, 0x74, 0x79, 0x70) && !/^(hei|mif|msf)/.test(buf.toString('latin1', 8, 12))) return { tipo: 'video', ext: 'mp4', max: 20e6 };
  if (h(0, 0x1a, 0x45, 0xdf, 0xa3)) return { tipo: 'video', ext: 'webm', max: 20e6 };
  return null;
}
const recibir = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024, files: 1 } }).single('archivo');
const borrarArchivo = nombre => fs.unlink(path.join(UPLOADS, path.basename(nombre)), () => {});

// ---------- Correo: Brevo (API), Resend (API) o SMTP; sin nada, modo prueba solo fuera de producción ----------
const MAIL_FROM = process.env.MAIL_FROM || process.env.SMTP_USER || '';
const proveedor = process.env.BREVO_API_KEY ? 'brevo' : process.env.RESEND_API_KEY ? 'resend' : process.env.SMTP_HOST ? 'smtp' : null;
let transporte = null;
if (proveedor === 'smtp') {
  const port = Number(process.env.SMTP_PORT || 587);
  transporte = require('nodemailer').createTransport({
    host: process.env.SMTP_HOST, port, secure: port === 465,
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined
  });
}
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function plantillaCorreo(link) {
  const asunto = 'Tu enlace para ingresar a Vecinos con oficio';
  const texto = `Hola,\n\nConfirma tu correo e ingresa con este enlace (vale 15 minutos y se usa una sola vez):\n${link}\n\nSi no lo pediste tú, ignora este mensaje: nadie podrá entrar a tu cuenta sin este enlace.\n\nVecinos con oficio`;
  const html = `<!doctype html><html lang="es"><body style="margin:0;padding:24px;background:#eef4f4;font-family:Arial,Helvetica,sans-serif;color:#12343b">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center">
<table role="presentation" width="480" cellspacing="0" cellpadding="0" style="max-width:480px;background:#ffffff;border-radius:14px;padding:28px">
<tr><td><h1 style="margin:0 0 12px;font-size:22px">Vecinos con oficio</h1>
<p style="margin:0 0 18px;font-size:16px;line-height:1.5">Confirma tu correo e ingresa. El enlace vale 15 minutos y se usa una sola vez.</p>
<p style="margin:0 0 22px"><a href="${esc(link)}" style="display:inline-block;padding:12px 22px;background:#1f6f78;color:#ffffff;text-decoration:none;font-weight:bold;border-radius:10px">Ingresar</a></p>
<p style="margin:0 0 6px;font-size:13px;color:#4a6a6f">Si el botón no funciona, copia este enlace en tu navegador:</p>
<p style="margin:0 0 18px;font-size:13px;word-break:break-all"><a href="${esc(link)}" style="color:#1f6f78">${esc(link)}</a></p>
<p style="margin:0;font-size:13px;color:#4a6a6f">Si no lo pediste tú, ignora este mensaje: nadie podrá entrar a tu cuenta sin este enlace.</p>
</td></tr></table></td></tr></table></body></html>`;
  return { asunto, texto, html };
}

async function enviarEnlace(email, link) {
  if (!proveedor) {
    if (PROD) throw new Error('sin_correo'); // en producción jamás se imprimen enlaces de acceso en los registros
    console.log(`\n[MODO PRUEBA] Enlace de acceso para ${email}:\n${link}\n`);
    return;
  }
  const { asunto, texto, html } = plantillaCorreo(link);
  if (proveedor === 'smtp') {
    await transporte.sendMail({ from: MAIL_FROM, to: email, subject: asunto, text: texto, html });
    return;
  }
  const m = MAIL_FROM.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  const remitente = m ? { name: m[1].trim() || 'Vecinos con oficio', email: m[2].trim() } : { name: 'Vecinos con oficio', email: MAIL_FROM };
  let r;
  if (proveedor === 'brevo') {
    r = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': process.env.BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ sender: remitente, to: [{ email }], subject: asunto, htmlContent: html, textContent: texto }),
      signal: AbortSignal.timeout(10000)
    });
  } else {
    r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: MAIL_FROM, to: [email], subject: asunto, html, text: texto }),
      signal: AbortSignal.timeout(10000)
    });
  }
  if (!r.ok) throw new Error(`${proveedor} respondió ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

// ---------- Sesiones ----------
const tokens = new Map(); // hash(token) -> { email, clave, exp }
const leerCookie = (req, n) => {
  const c = (req.headers.cookie || '').split(/;\s*/).find(x => x.startsWith(n + '='));
  return c ? c.slice(n.length + 1) : null;
};
function crearSesion(res, uid) {
  const sid = crypto.randomBytes(32).toString('hex');
  sesiones[hash(sid)] = { uid, exp: Date.now() + 30 * DIA };
  db.sesiones.guardar();
  res.setHeader('Set-Cookie', `sid=${sid}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${30 * 86400}${PROD ? '; Secure' : ''}`);
}
const borrarCookie = res => res.setHeader('Set-Cookie', 'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
function usuarioDe(req) {
  const sid = leerCookie(req, 'sid');
  const s = sid && sesiones[hash(sid)];
  if (!s || s.exp < Date.now()) return null;
  return usuarios[s.uid] || null;
}
const requiere = (req, res, next) =>
  req.usuario ? next() : res.status(401).json({ error: 'Ingresa con tu correo para hacer esto.' });
const conNombre = (req, res, next) =>
  req.usuario.nombre ? next() : res.status(400).json({ error: 'Escribe tu nombre de pila en el panel primero.' });

// ---------- App ----------
const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Detrás del proxy de Render hay que leer la IP real del visitante (límites de uso por IP).
// TRUST_PROXY = cantidad de proxys delante de la app (en Render: 2).
if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY));
else if (PROD) app.set('trust proxy', 1);
app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'X-Frame-Options': 'SAMEORIGIN' });
  if (PROD) res.set('Strict-Transport-Security', 'max-age=15552000');
  next();
});
app.get('/healthz', (req, res) => res.type('text').send('ok')); // verificación de salud para Render
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: false, limit: '2kb' }));
app.use((req, res, next) => { req.usuario = usuarioDe(req); next(); });
// Protección CSRF básica: las acciones que modifican datos exigen este encabezado propio
// (un formulario de otro sitio no puede enviarlo).
app.use('/api', (req, res, next) => {
  if (!['GET', 'HEAD'].includes(req.method) && req.get('x-requested-with') !== 'fetch') {
    return res.status(403).json({ error: 'Solicitud no permitida.' });
  }
  next();
});
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOADS, { maxAge: '7d', setHeaders: r => r.setHeader('X-Content-Type-Options', 'nosniff') }));

// ---------- Cuenta: ingreso por enlace al correo (sin contraseñas) ----------
app.post('/api/auth/solicitar', async (req, res) => {
  const email = limpiar(req.body?.email, 120);
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Escribe un correo válido.' });
  const clave = emailClave(email);
  if (limitado('e:' + req.ip, 10, 3600e3) || limitado('c:' + clave, 3, 15 * 60e3)) {
    return res.status(429).json({ error: 'Pediste muchos enlaces. Espera unos minutos.' });
  }
  const token = crypto.randomBytes(32).toString('hex');
  tokens.set(hash(token), { email, clave, exp: Date.now() + 15 * 60e3 });
  try {
    await enviarEnlace(email, `${APP_URL}/auth/verificar?token=${token}`);
  } catch (e) {
    tokens.delete(hash(token));
    console.error('Error enviando correo:', e.message);
    if (e.message === 'sin_correo') return res.status(503).json({ error: 'El envío de correos no está configurado. Avisa a quien administra el sitio.' });
    return res.status(500).json({ error: 'No pude enviar el correo. Intenta más tarde.' });
  }
  res.json({ ok: true, prueba: !proveedor });
});

// El enlace del correo solo muestra un botón; el ingreso ocurre al pulsarlo (POST).
// Así los antivirus y vistas previas de correo que "abren" enlaces no gastan el enlace de un solo uso.
const TOKEN_RE = /^[a-f0-9]{64}$/;
const paginaConfirmar = token => `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Confirma tu ingreso</title><style>body{font-family:system-ui,Arial,sans-serif;display:grid;place-items:center;min-height:100dvh;margin:0;background:#eef4f4;color:#12343b}main{max-width:380px;margin:16px;padding:28px;background:#fff;border-radius:16px;box-shadow:0 4px 18px rgb(18 52 59 / 25%);text-align:center}h1{margin:0 0 8px}button{margin-top:12px;padding:12px 24px;font:inherit;font-weight:700;color:#fff;background:#1f6f78;border:0;border-radius:10px;cursor:pointer}</style></head><body><main><h1>Vecinos con oficio</h1><p>Confirma que quieres ingresar con tu correo.</p><form method="post" action="/auth/confirmar"><input type="hidden" name="token" value="${token}"><button type="submit">Ingresar</button></form></main></body></html>`;

app.get('/auth/verificar', (req, res) => {
  const token = String(req.query.token || '');
  const t = TOKEN_RE.test(token) && tokens.get(hash(token));
  res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });
  if (!t || t.exp < Date.now()) return res.redirect('/?auth=expirado');
  res.type('html').send(paginaConfirmar(token));
});

app.post('/auth/confirmar', (req, res) => {
  const token = String(req.body?.token || '');
  const h = hash(token);
  const t = TOKEN_RE.test(token) && tokens.get(h);
  tokens.delete(h); // un solo uso
  if (!t || t.exp < Date.now()) return res.redirect(303, '/?auth=expirado');
  let u = Object.values(usuarios).find(x => x.emailClave === t.clave);
  if (!u) {
    u = { id: crypto.randomUUID(), email: t.email, emailClave: t.clave, nombre: null, avatar: null, creado: Date.now() };
    usuarios[u.id] = u;
    db.usuarios.guardar();
  }
  crearSesion(res, u.id);
  res.redirect(303, '/?auth=ok');
});

app.post('/api/auth/salir', (req, res) => {
  const sid = leerCookie(req, 'sid');
  if (sid) { delete sesiones[hash(sid)]; db.sesiones.guardar(); }
  borrarCookie(res);
  res.json({ ok: true });
});

app.get('/api/yo', (req, res) => {
  const u = req.usuario;
  res.json({ usuario: u ? { email: u.email, nombre: u.nombre, avatar: urlAvatar(u.id) } : null });
});

app.put('/api/nombre', requiere, (req, res) => {
  if (limitado('n:' + req.ip, 20, 3600e3)) return res.status(429).json({ error: 'Cambiaste el nombre muchas veces. Intenta más tarde.' });
  const nombre = limpiar(req.body?.nombre, 30);
  if (!NOMBRE_RE.test(nombre)) return res.status(400).json({ error: 'Usa solo letras en tu nombre (mínimo 2).' });
  req.usuario.nombre = nombre;
  db.usuarios.guardar();
  ofertas.filter(o => o.propietario === req.usuario.id).forEach(o => io.emit('oferta:nombre', { id: o.id, nombre }));
  empleos.filter(e => e.propietario === req.usuario.id && !e.empresa).forEach(e => io.emit('empleo:nombre', { id: e.id, publica: nombre }));
  res.json({ nombre });
});

const emitirAvatar = uid => ofertas.filter(o => o.propietario === uid)
  .forEach(o => io.emit('oferta:avatar', { id: o.id, avatar: urlAvatar(uid) }));

app.post('/api/avatar', requiere, (req, res) => {
  if (limitado('a:' + req.ip, 10, 3600e3)) return res.status(429).json({ error: 'Cambiaste la foto muchas veces. Intenta más tarde.' });
  recibir(req, res, err => {
    if (err || !req.file) return res.status(400).json({ error: 'No pude recibir la imagen.' });
    const t = detectar(req.file.buffer);
    if (!t || t.tipo !== 'imagen') return res.status(400).json({ error: 'Usa una imagen JPG, PNG o WEBP.' });
    if (req.file.size > 1e6) return res.status(400).json({ error: 'La foto pesa demasiado (máx. 1 MB).' });
    const archivo = `${crypto.randomUUID()}.${t.ext}`;
    fs.writeFile(path.join(UPLOADS, archivo), req.file.buffer, e => {
      if (e) return res.status(500).json({ error: 'No pude guardar la foto.' });
      const u = req.usuario;
      if (u.avatar) borrarArchivo(u.avatar);
      u.avatar = archivo;
      db.usuarios.guardar();
      emitirAvatar(u.id);
      res.status(201).json({ avatar: urlAvatar(u.id) });
    });
  });
});

app.delete('/api/avatar', requiere, (req, res) => {
  const u = req.usuario;
  if (u.avatar) { borrarArchivo(u.avatar); u.avatar = null; db.usuarios.guardar(); emitirAvatar(u.id); }
  res.json({ avatar: null });
});

// Derecho a eliminar los propios datos: borra cuenta, ofertas, empleos, archivos, likes y mensajes.
app.delete('/api/yo', requiere, (req, res) => {
  const u = req.usuario;
  for (const o of ofertas.filter(x => x.propietario === u.id)) {
    ofertas.splice(ofertas.indexOf(o), 1);
    o.media.forEach(m => borrarArchivo(m.archivo));
    io.emit('oferta:eliminada', o.id);
  }
  for (const e of empleos.filter(x => x.propietario === u.id)) {
    empleos.splice(empleos.indexOf(e), 1);
    if (e.logo) borrarArchivo(e.logo);
    io.emit('empleo:eliminado', e.id);
  }
  for (const o of ofertas) {
    const i = o.likes.indexOf(u.id);
    if (i !== -1) { o.likes.splice(i, 1); io.emit('oferta:likes', { id: o.id, likes: o.likes.length }); }
    o.mensajes = o.mensajes.filter(m => m.uid !== u.id);
  }
  if (u.avatar) borrarArchivo(u.avatar);
  delete usuarios[u.id];
  for (const h of Object.keys(sesiones)) if (sesiones[h].uid === u.id) delete sesiones[h];
  guardarTodo();
  borrarCookie(res);
  res.json({ ok: true });
});

// ---------- Ofertas de habilidades ----------
app.get('/api/ofertas', (req, res) => {
  res.json(ofertas.slice(-500).map(o => publicar(o, req.usuario?.id)));
});

app.post('/api/ofertas', requiere, conNombre, (req, res) => {
  const uid = req.usuario.id;
  if (limitado('p:' + req.ip, 10, 3600e3)) return res.status(429).json({ error: 'Publicaste mucho en poco tiempo. Intenta más tarde.' });
  if (ofertas.filter(o => o.propietario === uid).length >= 5) {
    return res.status(400).json({ error: 'Puedes tener hasta 5 ofertas activas. Elimina una para publicar otra.' });
  }
  const { error, oferta } = validarOferta(req.body || {});
  if (error) return res.status(400).json({ error });
  const nueva = { id: crypto.randomUUID(), propietario: uid, creada: Date.now(), ...oferta, likes: [], media: [], mensajes: [] };
  ofertas.push(nueva);
  db.ofertas.guardar();
  io.emit('oferta:nueva', publicar(nueva, null));
  res.status(201).json(publicar(nueva, uid));
});

app.delete('/api/ofertas/:id', requiere, (req, res) => {
  const o = buscar(req.params.id);
  if (!o) return res.status(404).json({ error: 'La oferta ya no existe.' });
  if (o.propietario !== req.usuario.id) return res.status(403).json({ error: 'Solo quien la publicó puede eliminarla.' });
  ofertas.splice(ofertas.indexOf(o), 1);
  o.media.forEach(m => borrarArchivo(m.archivo));
  db.ofertas.guardar();
  io.emit('oferta:eliminada', o.id);
  res.json({ ok: true });
});

// Un like por persona (cuenta verificada); no se puede dar like a la propia oferta.
app.post('/api/ofertas/:id/like', requiere, (req, res) => {
  if (limitado('l:' + req.ip, 60, 600e3)) return res.status(429).json({ error: 'Vas muy rápido. Espera un momento.' });
  const o = buscar(req.params.id);
  if (!o) return res.status(404).json({ error: 'La oferta ya no existe.' });
  const uid = req.usuario.id;
  if (o.propietario === uid) return res.status(400).json({ error: 'No puedes darle me gusta a tu propia oferta.' });
  const i = o.likes.indexOf(uid);
  if (i === -1) o.likes.push(uid); else o.likes.splice(i, 1);
  db.ofertas.guardar();
  io.emit('oferta:likes', { id: o.id, likes: o.likes.length });
  res.json({ likes: o.likes.length, liked: i === -1 });
});

// ---------- Consultas (chat por oferta; escribir requiere cuenta) ----------
app.get('/api/ofertas/:id/mensajes', (req, res) => {
  const o = buscar(req.params.id);
  if (!o) return res.status(404).json({ error: 'La oferta ya no existe.' });
  res.json(o.mensajes.map(mensajePublico));
});

app.post('/api/ofertas/:id/mensajes', requiere, conNombre, (req, res) => {
  if (limitado('m:' + req.ip, 30, 600e3)) return res.status(429).json({ error: 'Enviaste muchos mensajes. Espera unos minutos.' });
  const o = buscar(req.params.id);
  if (!o) return res.status(404).json({ error: 'La oferta ya no existe.' });
  const texto = limpiar(req.body?.texto, 300);
  if (!texto) return res.status(400).json({ error: 'Escribe un mensaje.' });
  const m = { id: crypto.randomUUID(), uid: req.usuario.id, autor: req.usuario.nombre, texto, creado: Date.now(), dueno: req.usuario.id === o.propietario };
  o.mensajes.push(m);
  if (o.mensajes.length > 100) o.mensajes.shift();
  db.ofertas.guardar();
  const pub = mensajePublico(m);
  io.to('o:' + o.id).emit('chat:nuevo', { ofertaId: o.id, mensaje: pub });
  res.status(201).json(pub);
});

// ---------- Fotos y videos (HTTP multipart, solo quien publicó) ----------
app.post('/api/ofertas/:id/media', requiere, (req, res) => {
  const o = buscar(req.params.id);
  if (!o) return res.status(404).json({ error: 'La oferta ya no existe.' });
  if (o.propietario !== req.usuario.id) return res.status(403).json({ error: 'Solo quien publicó puede agregar archivos.' });
  if (limitado('u:' + req.ip, 20, 3600e3)) return res.status(429).json({ error: 'Subiste muchos archivos. Intenta más tarde.' });
  if (o.media.length >= MAX_MEDIA) return res.status(400).json({ error: `Máximo ${MAX_MEDIA} archivos por oferta.` });

  recibir(req, res, err => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? 'El archivo pesa demasiado (máx. 5 MB fotos, 20 MB videos).' : 'No pude recibir el archivo.';
      return res.status(400).json({ error: msg });
    }
    if (!req.file) return res.status(400).json({ error: 'No llegó ningún archivo.' });
    const t = detectar(req.file.buffer);
    if (!t) return res.status(400).json({ error: 'Formato no permitido. Usa JPG, PNG, WEBP, MP4 o WEBM.' });
    if (req.file.size > t.max) return res.status(400).json({ error: `Ese ${t.tipo} pesa demasiado (máx. ${t.max / 1e6} MB).` });
    if (o.media.length >= MAX_MEDIA) return res.status(400).json({ error: `Máximo ${MAX_MEDIA} archivos por oferta.` });
    const archivo = `${crypto.randomUUID()}.${t.ext}`;
    fs.writeFile(path.join(UPLOADS, archivo), req.file.buffer, e => {
      if (e) return res.status(500).json({ error: 'No pude guardar el archivo.' });
      o.media.push({ id: crypto.randomUUID(), tipo: t.tipo, archivo });
      db.ofertas.guardar();
      io.emit('oferta:media', { id: o.id, media: mediaPublica(o) });
      res.status(201).json({ media: mediaPublica(o) });
    });
  });
});

app.delete('/api/ofertas/:id/media/:mid', requiere, (req, res) => {
  const o = buscar(req.params.id);
  if (!o) return res.status(404).json({ error: 'La oferta ya no existe.' });
  if (o.propietario !== req.usuario.id) return res.status(403).json({ error: 'Solo quien publicó puede quitar archivos.' });
  const i = o.media.findIndex(m => m.id === req.params.mid);
  if (i === -1) return res.status(404).json({ error: 'El archivo ya no existe.' });
  const [m] = o.media.splice(i, 1);
  borrarArchivo(m.archivo);
  db.ofertas.guardar();
  io.emit('oferta:media', { id: o.id, media: mediaPublica(o) });
  res.json({ media: mediaPublica(o) });
});

// ---------- Ofertas de trabajo (vecinos o empresas) ----------
app.get('/api/empleos', (req, res) => {
  const ahora = Date.now();
  res.json(empleos.filter(e => e.vence > ahora).slice(-500).map(e => publicarEmpleo(e, req.usuario?.id)));
});

app.post('/api/empleos', requiere, conNombre, (req, res) => {
  const uid = req.usuario.id;
  if (limitado('j:' + req.ip, 10, 3600e3)) return res.status(429).json({ error: 'Publicaste mucho en poco tiempo. Intenta más tarde.' });
  if (empleos.filter(e => e.propietario === uid && e.vence > Date.now()).length >= 5) {
    return res.status(400).json({ error: 'Puedes tener hasta 5 ofertas de trabajo vigentes. Cierra una para publicar otra.' });
  }
  const { error, empleo } = validarEmpleo(req.body || {});
  if (error) return res.status(400).json({ error });
  const nuevo = { id: crypto.randomUUID(), propietario: uid, creada: Date.now(), ...empleo, logo: null };
  empleos.push(nuevo);
  db.empleos.guardar();
  io.emit('empleo:nuevo', publicarEmpleo(nuevo, null));
  res.status(201).json(publicarEmpleo(nuevo, uid));
});

app.delete('/api/empleos/:id', requiere, (req, res) => {
  const e = buscarEmpleo(req.params.id);
  if (!e) return res.status(404).json({ error: 'La oferta de trabajo ya no existe.' });
  if (e.propietario !== req.usuario.id) return res.status(403).json({ error: 'Solo quien la publicó puede cerrarla.' });
  empleos.splice(empleos.indexOf(e), 1);
  if (e.logo) borrarArchivo(e.logo);
  db.empleos.guardar();
  io.emit('empleo:eliminado', e.id);
  res.json({ ok: true });
});

// Logo o imagen del marcador de un trabajo (solo imágenes, solo quien lo publicó)
app.post('/api/empleos/:id/logo', requiere, (req, res) => {
  const e = buscarEmpleo(req.params.id);
  if (!e) return res.status(404).json({ error: 'La oferta de trabajo ya no existe.' });
  if (e.propietario !== req.usuario.id) return res.status(403).json({ error: 'Solo quien la publicó puede cambiar el logo.' });
  if (limitado('g:' + req.ip, 20, 3600e3)) return res.status(429).json({ error: 'Cambiaste el logo muchas veces. Intenta más tarde.' });
  recibir(req, res, err => {
    if (err || !req.file) return res.status(400).json({ error: 'No pude recibir la imagen.' });
    const t = detectar(req.file.buffer);
    if (!t || t.tipo !== 'imagen') return res.status(400).json({ error: 'Usa una imagen JPG, PNG o WEBP.' });
    if (req.file.size > 1e6) return res.status(400).json({ error: 'El logo pesa demasiado (máx. 1 MB).' });
    const archivo = `${crypto.randomUUID()}.${t.ext}`;
    fs.writeFile(path.join(UPLOADS, archivo), req.file.buffer, w => {
      if (w) return res.status(500).json({ error: 'No pude guardar el logo.' });
      if (e.logo) borrarArchivo(e.logo);
      e.logo = archivo;
      db.empleos.guardar();
      const logo = `/uploads/${archivo}`;
      io.emit('empleo:logo', { id: e.id, logo });
      res.status(201).json({ logo });
    });
  });
});

app.delete('/api/empleos/:id/logo', requiere, (req, res) => {
  const e = buscarEmpleo(req.params.id);
  if (!e) return res.status(404).json({ error: 'La oferta de trabajo ya no existe.' });
  if (e.propietario !== req.usuario.id) return res.status(403).json({ error: 'Solo quien la publicó puede quitar el logo.' });
  if (e.logo) { borrarArchivo(e.logo); e.logo = null; db.empleos.guardar(); io.emit('empleo:logo', { id: e.id, logo: null }); }
  res.json({ logo: null });
});

// ---------- Mantenimiento: ofertas de trabajo vencidas, sesiones y enlaces caducados ----------
function mantenimiento() {
  const ahora = Date.now();
  for (const e of empleos.filter(x => x.vence <= ahora)) {
    empleos.splice(empleos.indexOf(e), 1);
    if (e.logo) borrarArchivo(e.logo);
    io.emit('empleo:eliminado', e.id);
    db.empleos.guardar();
  }
  for (const h of Object.keys(sesiones)) if (sesiones[h].exp < ahora) { delete sesiones[h]; db.sesiones.guardar(); }
  for (const [h, t] of tokens) if (t.exp < ahora) tokens.delete(h);
}
mantenimiento();
setInterval(mantenimiento, 3600e3).unref();

// ---------- Tiempo real ----------
const conectados = () => io.of('/').sockets.size;
io.on('connection', socket => {
  io.emit('conectados', conectados());
  socket.on('unirse', id => { if (typeof id === 'string' && id.length < 64) socket.join('o:' + id); });
  socket.on('salir', id => { if (typeof id === 'string' && id.length < 64) socket.leave('o:' + id); });
  socket.on('disconnect', () => io.emit('conectados', conectados()));
});

server.listen(PORT, () => {
  console.log(`Mapa de vecinos en ${APP_URL}`);
  console.log(`Datos en: ${BASE}`);
  console.log(`Correo: ${proveedor ? proveedor.toUpperCase() : PROD ? 'SIN CONFIGURAR (nadie podrá ingresar)' : 'modo prueba (los enlaces se imprimen aquí)'}`);
  if (proveedor && !MAIL_FROM) console.warn('Falta MAIL_FROM: define el remitente de los correos.');
  if (proveedor === 'smtp') transporte.verify().then(() => console.log('SMTP listo.'), e => console.error('SMTP no responde:', e.message));
});
