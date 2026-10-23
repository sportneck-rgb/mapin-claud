# Vecinos con oficio

Mapa colaborativo (Leaflet + Node + Socket.io) donde vecinos ofrecen sus habilidades y vecinos o empresas publican trabajos. Ingreso por enlace al correo, sin contraseñas.

## Probar en tu computador

```bash
npm install
npm start
```

Abre http://localhost:3000. Sin correo configurado, el enlace de ingreso aparece en la terminal (`[MODO PRUEBA]`).
Para probar likes y grados necesitas dos cuentas (usa una ventana de incógnito).

---

## Publicar en internet (GitHub + Render)

### 1. Subir el proyecto a GitHub

Con la web de GitHub:
1. Crea un repositorio nuevo (privado está bien) en https://github.com/new, sin README.
2. Pulsa **uploading an existing file** y arrastra **el contenido** de esta carpeta (no la carpeta misma): `server.js`, `package.json`, `render.yaml`, `public/`, `.gitignore`, etc.
3. No subas `node_modules`, `data`, `uploads` ni `.env` (el `.gitignore` los excluye cuando usas Git).

Con Git en la terminal (dentro de la carpeta):
```bash
git init
git add .
git commit -m "Primera versión"
git branch -M main
git remote add origin https://github.com/TU-USUARIO/TU-REPO.git
git push -u origin main
```

### 2. Configurar el correo (Brevo, plan gratis)

Brevo se usa por API, así que funciona en cualquier hosting. (Los nombres de los menús pueden cambiar.)

1. Crea una cuenta en https://www.brevo.com.
2. En **Senders, domains & dedicated IPs** agrega y verifica el remitente. Lo ideal es un correo de un **dominio propio** (por ejemplo `no-responder@tu-dominio.cl`) y autenticar el dominio (SPF/DKIM/DMARC) con las instrucciones de Brevo; así los correos no caen en spam. Un correo de Gmail también se puede verificar, pero es más probable que llegue a spam.
3. En **SMTP & API → API Keys** crea una clave y cópiala (empieza con `xkeysib-`).
4. Guarda estos dos datos para el paso siguiente:
   - `BREVO_API_KEY` = la clave
   - `MAIL_FROM` = `Vecinos con oficio <no-responder@tu-dominio.cl>`

El plan gratis de Brevo permite 300 correos por día; cada ingreso es un correo.
Alternativas: `RESEND_API_KEY` (requiere dominio verificado) o SMTP (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`). Ojo: Render bloquea los puertos de correo en el plan gratis y Railway Hobby los bloquea siempre; por eso se recomienda la API.

### 3. Crear el servicio en Render

1. En https://dashboard.render.com elige **New → Blueprint** y conecta tu repositorio de GitHub.
2. Render lee `render.yaml` y crea el servicio web (plan **Starter**) con un disco persistente de 1 GB.
3. Cuando pida las variables, completa `MAIL_FROM` y `BREVO_API_KEY`. Deja `APP_URL` vacío si usarás la dirección `onrender.com` (se detecta sola).
4. Pulsa **Apply** y espera el despliegue. Tu sitio queda en una dirección `https://...onrender.com`.

Costo aproximado: el plan Starter más 1 GB de disco. Confirma los precios actuales en https://render.com/pricing.

### 4. Probar que todo funciona

1. Abre `https://TU-SITIO/healthz`: debe responder `ok`.
2. Entra al sitio, pulsa **Ingresar con mi correo** y usa tu correo real.
3. Llega un correo con el botón **Ingresar** → te lleva a una página con otro botón **Ingresar** → quedas dentro.
4. Escribe tu nombre de pila en el panel y publica una oferta de prueba.
5. Reinicia el servicio desde Render (**Manual Deploy**) y comprueba que la oferta sigue ahí: eso confirma que el disco funciona.

Si el correo no llega: revisa spam, que el remitente esté verificado en Brevo y los registros (**Logs**) en Render. Si Brevo rechaza el envío, el mensaje de error aparece ahí.

### 5. Dominio propio (opcional)

En Render: **Settings → Custom Domains**. Luego agrega la variable `APP_URL` con `https://tu-dominio.cl` para que los enlaces del correo usen ese dominio.

---

## Cosas a tener en cuenta

- **Un solo servidor:** los datos viven en archivos JSON en el disco de Render. Es suficiente para empezar; si el sitio crece, el siguiente paso es una base de datos (PostgreSQL).
- **Respaldos:** el disco es la única copia de tus datos. Descarga una copia de vez en cuando.
- **Cada vez que despliegas** hay unos segundos de corte (los servicios con disco no hacen despliegues sin interrupción).
- **Privacidad:** completa y revisa `public/privacidad.html` antes de abrir el sitio al público.
- **Límites por IP:** dependen de `TRUST_PROXY` (en Render, 2). Los límites por correo funcionan igual aunque la IP no se detecte bien.
