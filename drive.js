const crypto = require('node:crypto');

const driveHost = 'https://www.googleapis.com/drive/v3/files/';
const tokenUrl = 'https://oauth2.googleapis.com/token';
const scope = 'https://www.googleapis.com/auth/drive.readonly';

function documentSteps(notes) {
  return [...new Set(notes.split(/\r?\n/).map(line => line.trim()).filter(line =>
    /^(?:[-*•]\s*)?\[ \]\s*\S|^(?:[-*•]\s*)?(?:pendiente|por hacer|todo)\s*:\s*\S/i.test(line)
  ).map(line => line.replace(/^(?:[-*•]\s*)?(?:\[ \]|(?:pendiente|por hacer|todo)\s*:)\s*/i,'')))];
}
function fileId(link) {
  if (!link) return null;
  const url = new URL(link);
  if (url.protocol !== 'https:' || !['docs.google.com','drive.google.com'].includes(url.hostname)) return null;
  const id = url.pathname.match(/\/d\/([\w-]+)(?:\/|$)/)?.[1] || url.searchParams.get('id');
  return id && /^[\w-]{10,150}$/.test(id) ? id : null;
}
function createDrive(db, config = process.env, request = fetch) {
  const enabled = Boolean(config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET && config.GOOGLE_REDIRECT_URI);
  const get = key => {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? JSON.parse(row.value) : null;
  };
  const set = (key, value) => db.prepare('INSERT OR REPLACE INTO settings VALUES (?, ?)').run(key, JSON.stringify(value));
  let access;
  let refreshing;
  async function token(parameters) {
    const response = await request(tokenUrl, {
      method:'POST',
      body:new URLSearchParams({client_id:config.GOOGLE_CLIENT_ID,client_secret:config.GOOGLE_CLIENT_SECRET,...parameters}),
      signal:AbortSignal.timeout(10000)
    });
    if (!response.ok) throw new Error('Google rechazó la autorización. Vuelve a conectar Drive.');
    return response.json();
  }
  async function getAccess() {
    if (access?.expires > Date.now() + 60000) return access.value;
    const refresh = get('google-refresh');
    if (!enabled || !refresh) throw new Error('Conecta Google Drive para revisar este documento.');
    if (!refreshing) refreshing = token({refresh_token:refresh,grant_type:'refresh_token'})
      .then(data => {
        access = {value:data.access_token,expires:Date.now() + data.expires_in * 1000};
        return access.value;
      }).finally(() => refreshing = null);
    return refreshing;
  }
  return {
    status: () => ({ configured:enabled, connected:enabled && Boolean(get('google-refresh')) }),
    authorize() {
      if (!enabled) throw new Error('Configura las credenciales de Google OAuth en el servidor.');
      const value = crypto.randomBytes(32).toString('hex');
      set('google-oauth-state',{value,until:Date.now()+600000});
      const params = new URLSearchParams({
        client_id:config.GOOGLE_CLIENT_ID, redirect_uri:config.GOOGLE_REDIRECT_URI,
        response_type:'code', state:value, scope, access_type:'offline', prompt:'consent'
      });
      return 'https://accounts.google.com/o/oauth2/v2/auth?' + params;
    },
    async callback(params) {
      const expected = get('google-oauth-state');
      if (!enabled || !expected || expected.value !== params.get('state') || expected.until < Date.now()) throw new Error('La autorización expiró.');
      set('google-oauth-state',null);
      if (!params.get('code')) throw new Error('Se canceló la autorización.');
      const data = await token({code:params.get('code'),grant_type:'authorization_code',redirect_uri:config.GOOGLE_REDIRECT_URI});
      if (!data.refresh_token) throw new Error('Google no concedió acceso continuo.');
      set('google-refresh',data.refresh_token);
      access = {value:data.access_token,expires:Date.now() + data.expires_in * 1000};
    },
    async read(link) {
      const id = fileId(link);
      if (!id) throw new Error('Usa el enlace compartido de un archivo de Google Drive.');
      const headers = {Authorization:'Bearer '+await getAccess()};
      const signal = AbortSignal.timeout(12000);
      const metadata = await request(driveHost+id+'?fields=mimeType,size&supportsAllDrives=true',{headers,signal});
      if (!metadata.ok) throw new Error('Google Drive no pudo abrir este archivo. Revisa sus permisos y el enlace.');
      const {mimeType,size} = await metadata.json();
      const googleDoc = mimeType === 'application/vnd.google-apps.document';
      if (!googleDoc && !['text/plain','text/markdown','text/csv'].includes(mimeType)) throw new Error('Se admiten Documentos de Google y archivos de texto.');
      if (Number(size) > 100000) throw new Error('El documento supera el límite de revisión.');
      const suffix = googleDoc ? '/export?mimeType=text%2Fplain' : '?alt=media&supportsAllDrives=true';
      const response = await request(driveHost+id+suffix,{headers,signal});
      if (!response.ok) throw new Error('Google Drive no pudo descargar el texto.');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let text = '';
      while (text.length < 24000) {
        const {done,value} = await reader.read();
        if (done) return (text + decoder.decode()).slice(0,24000);
        text += decoder.decode(value,{stream:true});
      }
      await reader.cancel();
      return text.slice(0,24000);
    }
  };
}
module.exports = { createDrive, documentSteps, fileId };
