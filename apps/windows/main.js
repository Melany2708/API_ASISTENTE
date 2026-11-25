const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, ipcMain, Menu, Notification, Tray, session, shell } = require('electron');

const component = 'AmeliaNativeWindows/1.0';
const applicationId = 'com.amelia.agenda';
const toastActivator = '{56CCDE24-F92B-4858-BCF4-7325F3A52A7D}';
const icon = path.join(__dirname, 'icon.png');
const file = () => path.join(app.getPath('userData'), 'agenda-settings.json');
const settingsPage = path.join(__dirname, 'connection.html');
let settings = { server: '', seen: [] };
let agenda;
let connection;
let tray;
let polling = false;
let quitting = false;

function normalize(input) {
  const url = new URL(String(input).trim());
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Escribe una dirección HTTPS válida.');
  return url.origin;
}
function save() {
  const temp = file() + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(settings));
  fs.renameSync(temp, file());
}
function currentServer() { return settings.server; }
function openExternal(value) {
  try {
    if (['http:', 'https:'].includes(new URL(value).protocol)) shell.openExternal(value).catch(() => {});
  } catch {}
}
function constrain(window) {
  window.webContents.setWindowOpenHandler(({url}) => {
    if (new URL(url).origin === currentServer()) window.loadURL(url);
    else openExternal(url);
    return {action:'deny'};
  });
  const inspect = (event, value) => {
    const url = typeof value === 'string' ? value : value.url;
    if (new URL(url).origin !== currentServer()) {
      event.preventDefault();
      openExternal(url);
    }
  };
  window.webContents.on('will-navigate', inspect);
  window.webContents.on('will-redirect', inspect);
}
function showAgenda(target = '/') {
  if (!currentServer()) return showConnection();
  if (!agenda) {
    agenda = new BrowserWindow({
      title:'Amelia', width:1180, height:820, minWidth:440, minHeight:520,
      icon, backgroundColor:'#fbf8f5',
      webPreferences:{sandbox:true, contextIsolation:true, nodeIntegration:false}
    });
    agenda.webContents.setUserAgent(agenda.webContents.getUserAgent() + ' ' + component);
    constrain(agenda);
    agenda.on('close', event => {
      if (!quitting) { event.preventDefault(); agenda.hide(); }
    });
    agenda.on('closed', () => agenda = undefined);
    target = target || '/';
  }
  if (target) agenda.loadURL(new URL(target, currentServer()).href).catch(error => {
    if (!String(error).includes('ERR_ABORTED')) showConnection('Amelia no pudo abrir el servidor. Comprueba tu conexión y la dirección.');
  });
  if (agenda.isMinimized()) agenda.restore();
  agenda.show();
  agenda.focus();
}
function showConnection(message = '') {
  if (connection) { connection.focus(); return; }
  connection = new BrowserWindow({
    title:'Conectar Amelia', width:460, height:350, minWidth:380, icon,
    autoHideMenuBar:true, resizable:false, backgroundColor:'#fbf8f5',
    webPreferences:{preload:path.join(__dirname,'preload.js'),sandbox:true,contextIsolation:true,nodeIntegration:false}
  });
  connection.setMenu(null);
  connection.webContents.setWindowOpenHandler(() => ({action:'deny'}));
  connection.webContents.on('will-navigate', event => event.preventDefault());
  connection.on('closed', () => connection = undefined);
  connection.loadFile(settingsPage, {query:{server:currentServer(),message}});
}

function registerSettings() {
  ipcMain.handle('save-server', async (event, input) => {
    if (!connection || event.sender !== connection.webContents || event.senderFrame !== connection.webContents.mainFrame) {
      return {error:'No se pudo cambiar la conexión.'};
    }
    try {
      const server = normalize(input);
      const response = await fetch(server + '/health',{redirect:'error', signal:AbortSignal.timeout(8000)});
      if (!response.ok || (await response.json()).ok !== true) throw new Error('El servidor no respondió como una instancia de Amelia.');
      settings = {server, seen:settings.server === server ? settings.seen : []};
      save();
      setImmediate(() => { connection?.close(); showAgenda(); poll(); });
      return {ok:true};
    } catch { return {error:'No pude conectar. Revisa que la dirección HTTPS del servidor de Amelia sea correcta.'}; }
  });
}

async function poll() {
  const base = currentServer();
  if (!base || polling || !Notification.isSupported()) return;
  polling = true;
  try {
    const cookies = await session.defaultSession.cookies.get({url:base,name:'agenda'});
    if (!cookies.length) return;
    const cookie = cookies.map(item => item.name + '=' + item.value).join('; ');
    const response = await fetch(base + '/api/notices',{
      headers:{Cookie:cookie},redirect:'error',signal:AbortSignal.timeout(8000)
    });
    if (!response.ok) return;
    const {notices} = await response.json();
    if (currentServer() !== base || !Array.isArray(notices)) return;
    const seen = new Set(settings.seen);
    const recent = Date.now() - 86400000;
    for (const notice of [...notices].reverse()) {
      if (seen.has(notice.id) || notice.created < recent) continue;
      const alert = new Notification({title:notice.title,body:notice.message,icon});
      alert.on('click', () => showAgenda(null));
      alert.show();
    }
    const ids = notices.map(notice => notice.id);
    if (JSON.stringify(ids) !== JSON.stringify(settings.seen)) {
      settings.seen = ids;
      save();
    }
  } catch (error) {
    console.debug('Los avisos se volverán a consultar.', error.name);
  } finally {
    polling = false;
  }
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => showAgenda(null));
  app.on('before-quit', () => { quitting = true; });
  app.on('window-all-closed', () => {});
  app.whenReady().then(() => {
    app.setAppUserModelId(applicationId);
    try {
      const persisted = JSON.parse(fs.readFileSync(file(),'utf8'));
      settings = {server:normalize(persisted.server),seen:Array.isArray(persisted.seen) ? persisted.seen : []};
    } catch {}
    const shortcut = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Amelia.lnk');
    if (process.platform === 'win32' && fs.existsSync(shortcut)) {
      shell.writeShortcutLink(shortcut,'update',{appUserModelId:applicationId,toastActivatorClsid:toastActivator});
    }
    session.defaultSession.setPermissionRequestHandler((_contents,_permission,callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    registerSettings();
    const menu = [
      {label:'Abrir Amelia',click:() => showAgenda(null)},
      {label:'Cambiar conexión',click:() => showConnection()},
      ...(process.platform !== 'win32' ? [] : [{label:'Abrir al iniciar Windows',type:'checkbox',checked:app.getLoginItemSettings().openAtLogin,
        click:item => app.setLoginItemSettings({openAtLogin:item.checked})}]),
      {label:'Salir de Amelia',click:() => app.quit()}
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate([{label:'Amelia',submenu:menu}]));
    tray = new Tray(icon);
    tray.setToolTip('Amelia · Tu agenda personal');
    tray.setContextMenu(Menu.buildFromTemplate(menu));
    tray.on('click', () => showAgenda(null));
    showAgenda();
    setInterval(poll,12000);
    poll();
  });
}
