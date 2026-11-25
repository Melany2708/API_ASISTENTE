# Amelia

Agenda personal web en español con API, calendario, tareas y recordatorios compartidos entre dispositivos. Las horas se muestran y guardan en la zona de Lima.

## Desarrollo local

Requiere Node.js 24 o superior.

```sh
npm ci --cache /tmp/amelia-npm-cache
npm start
```

Abre `http://localhost:3000`. Si no defines `AGENDA_PASSWORD`, Amelia genera una clave persistente y la muestra en la terminal de arranque. Puedes configurar `PORT` y `DATA_DIR`. El directorio `data/` contiene la agenda, las suscripciones y las claves de Web Push.

## Celular y computadora

Para usar ambos dispositivos, aloja **una sola instancia** detrás de un proxy HTTPS, con almacenamiento persistente y una clave de acceso larga en la variable segura `AGENDA_PASSWORD`. Abre la misma URL e inicia sesión con la misma clave. Los cambios se consultan cada seis segundos y al volver a la ventana. La agenda es de uso personal y comparte todos los datos con quien tenga la clave.

Abre la campana y elige **Activar en este dispositivo** en cada uno. En iPhone, agrega la web a la pantalla de inicio desde Safari y ábrela desde su icono antes de activar los avisos. La entrega depende del permiso del navegador, la conexión al proveedor Web Push y que el servidor permanezca encendido. Configura `VAPID_SUBJECT` con un correo de contacto en formato `mailto:` o un sitio HTTPS real. La instancia necesita salida HTTPS a los proveedores del navegador, como `fcm.googleapis.com`, `updates.push.services.mozilla.com` y `*.web.push.apple.com`.

## Agenda y documentos

- Una reunión ocupa su duración completa. Las clases y los entrenamientos son semanales por defecto. Los cumpleaños y aniversarios se repiten cada año.
- Los recordatorios se generan con la antelación seleccionada y a la hora programada. Las tareas vencidas vuelven a avisar una vez al día durante la primera semana mientras sigan pendientes.
- En **Documentos** puedes guardar un enlace e importar texto desde TXT, Markdown o CSV, o pegarlo. Marca acciones como `Pendiente: enviar informe` o `- [ ] enviar informe`. Después de guardar, vuelve a abrir el documento y pulsa **Crear tarea** en cada pendiente que quieras agendar. Para revisar avances nuevos, actualiza el texto importado.

## API

`GET /health` informa si el servidor responde. `POST /api/login` recibe un objeto JSON con `password` y establece una cookie de sesión. Con esa cookie, `GET /api/state` devuelve los elementos, ocurrencias y recordatorios. `POST /api/items` crea un elemento, y `PATCH /api/items/:id` o `DELETE /api/items/:id` permiten actualizarlo o borrarlo. Un cruce de horarios responde con HTTP 409 e identifica el evento existente.

## Conectar Google Drive

Habilita **Google Drive API** en un proyecto de Google Cloud. Crea un cliente OAuth de tipo aplicación web, registra `https://TU-DOMINIO/api/drive/callback` como URI de redirección autorizado y configura la pantalla de consentimiento. Si la aplicación está en modo de prueba, agrega tu cuenta como usuaria de prueba y considera que la autorización puede expirar.

Configura `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` y `GOOGLE_REDIRECT_URI` en el servidor. Este requiere acceso HTTPS a `oauth2.googleapis.com` y `www.googleapis.com`. Abre **Documentos → Conectar Drive**. Añade un enlace compartido de Google Docs o de un archivo TXT, Markdown o CSV al que tu cuenta tenga acceso y activa la revisión automática. Amelia lee solo los enlaces que guardas. El permiso OAuth es de solo lectura y le permite acceder a los archivos que tu cuenta puede leer.

La revisión busca nuevas líneas marcadas como pendientes cada 15 minutos. Al encontrarlas, Amelia genera un aviso compartido y ofrece convertirlas en tareas con una fecha de entrega. Puedes solicitar una revisión inmediata al editar un documento guardado.

## Instalar Amelia en Android y Windows

Amelia tiene una aplicación para **Android 8 o posterior** y un instalador para **Windows 10 u 11 de 64 bits (x64)**. Ambas se abren desde el sistema y conservan su sesión. La agenda y la conexión de Drive se guardan en un único servidor. Antes de conectar las aplicaciones, ejecuta esta versión de la API en un servidor con HTTPS y almacenamiento persistente. Define una clave segura en `AGENDA_PASSWORD`. Las aplicaciones necesitan la URL HTTPS del servidor y esa clave al iniciar sesión.

- **Android**. Abre `Amelia-Android.apk`. Si Android te pide permiso para instalar desde esa fuente, concédelo únicamente a la app desde la que abriste el archivo. En Amelia, pulsa **Conexión**, pega la URL y permite los avisos. Android decide cuándo ejecuta las consultas en segundo plano, por lo que pueden tardar más de 15 minutos. Si fuerzas la detención, vuelve a abrir Amelia para reactivar las consultas.
- **Windows**. Abre `Amelia-Windows-x64-Setup.exe` y luego busca **Amelia** en Inicio. Pega la misma URL. Cerrar la ventana deja a Amelia en la bandeja del sistema para recibir avisos. En su menú puedes activar **Abrir al iniciar Windows**. **Salir de Amelia** detiene la consulta de avisos. El instalador carece de firma comercial, por lo que Windows puede mostrar un aviso de editor desconocido.

Dentro de la aplicación puedes cambiar la URL desde **Conexión** en Android o desde el menú **Amelia** en Windows. Al conectar Google Drive, la autorización de Google se abre en el navegador del sistema y el resultado se sincroniza con las aplicaciones.

Los proyectos están en `apps/android` y `apps/windows`. Para volver a compilar el APK, usa un JDK completo, Android API 35 y Build Tools 35. Define `ANDROID_JAR`, `ANDROID_BUILD_TOOLS`, `AMELIA_KEYSTORE` y `AMELIA_KEY_PASSWORD`, y ejecuta `bash apps/android/build.sh /ruta/Amelia-Android.apk`. Para actualizar un APK ya instalado, usa la misma clave de firma e incrementa la versión. Conserva el archivo de firma por separado. Para compilar Windows, descomprime la distribución oficial de Electron 45.5.0 para Windows x64, define `ELECTRON_WINDOWS` con esa ruta, instala NSIS y ejecuta `bash apps/windows/build.sh /ruta/Amelia-Windows-x64-Setup.exe`.
