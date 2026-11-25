const $ = selector => document.querySelector(selector);
const icons = {
  spark:'M12 2l1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8L12 2ZM19 15v6m-3-3h6',
  home:'m3 10 9-7 9 7v10H3zM9 20v-7h6v7', calendar:'M4 5h16v15H4zM8 3v4m8-4v4M4 10h16',
  check:'M9 11l2 2 4-5M5 4h14v16H5z', heart:'M12 20 4.5 12.5C-1 7 7 2 12 8c5-6 13-1 7.5 4.5z',
  file:'M6 3h8l4 4v14H6zM13 3v5h5M9 12h6m-6 4h6', bell:'M5 17h14l-2-3V9a5 5 0 0 0-10 0v5zm5 3h4',
  plus:'M12 5v14M5 12h14', arrow:'m13 6 6 6-6 6M5 12h14', left:'m11 6-6 6 6 6m-6-6h14',
  x:'m6 6 12 12M18 6 6 18', devices:'M3 4h14v10H3zm3 13h5m3-7h7v10h-7z',
  logout:'M10 4H4v16h6m3-12 4 4-4 4m-5-4h13', clock:'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zm0 4v5l3 2'
};
const icon = name => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + icons[name] + '"/></svg>';
document.querySelectorAll('[data-icon]').forEach(el => el.innerHTML = icon(el.dataset.icon));
const views = {
  home:['Inicio','home'],
  agenda:['Agenda','calendar','Reuniones, clases y entrenamientos en un solo lugar.','meeting'],
  tasks:['Tareas','check','Lleva un registro de tus pendientes y sus fechas de entrega.','task'],
  dates:['Fechas especiales','heart','Cumpleaños, aniversarios y fechas que quieres recordar.','birthday'],
  docs:['Documentos','file','Guarda un enlace, importa el texto y convierte los pendientes en tareas.','document']
};
const labels = {task:'Tarea',meeting:'Reunión',class:'Clase',gym:'Entrenamiento',birthday:'Cumpleaños',anniversary:'Aniversario',event:'Evento',document:'Documento'};
const scheduleKinds = ['meeting','class','gym','event'];
const dateKinds = ['birthday','anniversary'];
const format = options => new Intl.DateTimeFormat('es-PE', {timeZone:'America/Lima', ...options});
const clock = format({hour:'numeric',minute:'2-digit'});
const prettyDate = format({weekday:'long',day:'numeric',month:'long'});
const shortDate = format({day:'numeric',month:'short'});
const day = 86400000;
const local = time => new Date(time - 5 * 3600000).toISOString().slice(0, 16);
const ms = value => Date.parse(value + '-05:00');
const capitalize = str => str[0].toUpperCase() + str.slice(1);
const today = () => local(Date.now()).slice(0,10);
let selectedDay = today();
let month = selectedDay.slice(0,7);
let view = 'home';
let state = {items:[],occurrences:[],notices:[]};
let editing = null;
let toastTimer;
let requestNumber = 0;
let deviceNotificationIds = null;
const nav = $('nav');
for (const [key,[title,glyph]] of Object.entries(views)) {
  nav.insertAdjacentHTML('beforeend', '<button data-view="' + key + '">' + icon(glyph) + title + '</button>');
}
for (const [key,label] of Object.entries(labels)) $('#kind').add(new Option(label,key));

async function api(route, method = 'GET', payload) {
  const response = await fetch(route, {method, ...(payload === undefined ? {} : {headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)})});
  const result = await response.json();
  if (response.status === 401 && route !== '/api/login' && !$('#login').open) {
    for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
    $('#login').showModal();
  }
  if (!response.ok) throw new Error(result.error);
  return result;
}
function toast(message) {
  const element = $('#toast');
  element.textContent = message;
  element.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.hidden = true, 4500);
}
function setError(form, message) {
  const target = form.querySelector('.form-error');
  target.textContent = message;
  target.hidden = !message;
}
function dayStart(value) { return ms(value + 'T00:00'); }
function nextMonth(value, delta) {
  const [y,m] = value.split('-').map(Number);
  return new Date(Date.UTC(y,m - 1 + delta,1)).toISOString().slice(0,7);
}
async function refresh() {
  const id = ++requestNumber;
  const now = Date.now();
  const from = view === 'agenda' ? dayStart(month + '-01') : dayStart(today());
  const to = view === 'agenda' ? dayStart(nextMonth(month,1) + '-01') - 1 : now + (view === 'dates' ? 366 : 95) * day;
  try {
    const result = await api('/api/state?from=' + from + '&to=' + to);
    if (id !== requestNumber) return;
    state = result;
    $('#sync-status').textContent = 'Agenda sincronizada';
    if (!$('#login').open) {
      const latest = state.notices.filter(notice => notice.created > now - day/2 && !deviceNotificationIds?.has(notice.id));
      if (deviceNotificationIds && latest.length) toast(latest[0].title + ' · ' + latest[0].message);
      deviceNotificationIds = new Set(state.notices.map(notice => notice.id));
    }
    render();
  } catch {
    if (id === requestNumber) $('#sync-status').textContent = 'Sin conexión';
  }
}
function empty(text, glyph) {
  const div = document.createElement('div');
  div.className = 'empty';
  div.innerHTML = icon(glyph);
  div.append(text);
  return div;
}
function occurrenceItems() {
  const byId = new Map(state.items.map(item => [item.id,item]));
  return state.occurrences.map(({id,at}) => ({item:byId.get(id),at})).filter(row => row.item && !row.item.done);
}
function documentSteps(notes) {
  return notes.split(/\r?\n/).map(line => line.trim()).filter(line =>
    /^(?:[-*•]\s*)?\[ \]\s*\S|^(?:[-*•]\s*)?(?:pendiente|por hacer|todo)\s*:\s*\S/i.test(line)
  ).map(line => line.replace(/^(?:[-*•]\s*)?(?:\[ \]|(?:pendiente|por hacer|todo)\s*:)\s*/i,'')).slice(0,20);
}
function makeRow(item, at) {
  const row = document.createElement('div');
  row.className = 'row';
  if (item.kind === 'task') {
    const check = document.createElement('input');
    check.type = 'checkbox';
    check.checked = item.done;
    check.className = 'check';
    check.setAttribute('aria-label','Marcar ' + item.title);
    check.onchange = async () => {
      try { await api('/api/items/' + item.id,'PATCH',{done:check.checked}); await refresh(); }
      catch (error) { check.checked = !check.checked; toast(error.message); }
    };
    row.append(check);
  } else {
    const badge = document.createElement('span');
    badge.className = 'row-icon ' + (dateKinds.includes(item.kind) ? 'tone-gold' : item.kind === 'document' ? '' : 'tone-sage');
    badge.innerHTML = icon(dateKinds.includes(item.kind) ? 'heart' : item.kind === 'document' ? 'file' : 'clock');
    row.append(badge);
  }
  const main = document.createElement('button');
  main.className = 'row-main';
  main.onclick = () => openEditor(item.kind,item);
  const title = document.createElement('strong');
  title.textContent = item.title;
  if (item.done) title.className = 'row-done';
  const subtitle = document.createElement('small');
  const when = at ?? (item.start ? ms(item.start) : null);
  const status = item.kind === 'task' && !item.done && when < Date.now() ? 'Vencida' : labels[item.kind];
  subtitle.textContent = [status, ...(when === null ? [] : [shortDate.format(when), clock.format(when)]),
    ...(item.kind === 'document' ? [documentSteps(item.notes).length + ' pendientes en el texto', ...(item.checkedAt ? ['Revisado el ' + shortDate.format(item.checkedAt)] : [])] : [])].join(' · ');
  main.append(title,subtitle);
  row.append(main);
  if (item.kind === 'document' && item.link) {
    const link = document.createElement('a');
    link.href = item.link;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'Abrir';
    row.append(link);
  }
  return row;
}
function list(selector, rows, message, glyph) {
  $(selector).replaceChildren(...(rows.length ? rows.map(({item,at}) => makeRow(item,at)) : [empty(message,glyph)]));
}
function stat(value, label, glyph, tone, target) {
  const button = document.createElement('button');
  button.className = 'stat';
  button.dataset.view = target;
  button.innerHTML = '<span class="stat-icon ' + tone + '">' + icon(glyph) + '</span><span><strong>' + value + '</strong><small>' + label + '</small></span>';
  return button;
}
function render() {
  const now = Date.now();
  const drive = state.drive;
  $('#drive-connect').disabled = !drive?.configured;
  $('#drive-connect').textContent = drive?.connected ? 'Reconectar' : 'Conectar Drive';
  $('#drive-status').textContent = drive?.connected ? 'Conectado · Revisión automática cada 15 minutos' :
    drive?.configured ? 'Conecta tu cuenta para revisar los enlaces que guardes.' : 'La conexión necesita configuración de Google OAuth.';
  const occurrences = occurrenceItems();
  const pending = state.items.filter(item => item.kind === 'task').sort((a,b) => Number(a.done) - Number(b.done) || a.start.localeCompare(b.start));
  const open = pending.filter(item => !item.done);
  const todays = occurrences.filter(({item,at}) => scheduleKinds.includes(item.kind) && local(at).startsWith(today()));
  const allDates = state.items.filter(item => dateKinds.includes(item.kind));
  const dates = occurrences.filter(({item,at}) => dateKinds.includes(item.kind) && at >= dayStart(today()));
  $('#today-label').textContent = capitalize(prettyDate.format(now));
  $('#today-date').textContent = capitalize(prettyDate.format(now));
  $('#greeting').textContent = open.length ? 'Tienes ' + open.length + (open.length === 1 ? ' tarea pendiente.' : ' tareas pendientes.') + ' ¿Qué quieres avanzar hoy?' : 'Aquí tienes un espacio para tus planes, tus pendientes y las fechas que quieres recordar.';
  $('#stats').replaceChildren(stat(todays.length,'En agenda hoy','calendar','','agenda'),stat(open.length,'Tareas pendientes','check','tone-sage','tasks'),stat(allDates.length,'Fechas especiales','heart','tone-gold','dates'));
  list('#today-items', todays, 'Tu agenda de hoy está libre.', 'calendar');
  list('#today-tasks', open.slice(0,4).map(item => ({item})), 'No tienes tareas pendientes.', 'check');
  list('#special-items', dates.slice(0,4), 'No hay fechas especiales en los próximos 95 días.', 'heart');

  if (view !== 'home') {
    let rows;
    if (view === 'agenda') {
      renderCalendar(occurrences);
      rows = occurrences.filter(({item,at}) => local(at).startsWith(selectedDay));
      $('#list-title').textContent = capitalize(prettyDate.format(dayStart(selectedDay)));
    } else {
      const futureById = new Map(dates.slice().reverse().map(row => [row.item.id,row.at]));
      const items = view === 'tasks' ? pending : view === 'dates' ? allDates : state.items.filter(item => item.kind === 'document');
      rows = items.map(item => ({item,at:futureById.get(item.id)}));
      $('#list-title').textContent = views[view][0];
    }
    $('#list-count').textContent = rows.length;
    list('#view-items', rows, 'Aún no hay elementos aquí.', views[view][1]);
  }
  const notices = state.notices.map(notice => {
    const row = document.createElement('div');
    row.className = 'row';
    const text = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = notice.title;
    const detail = document.createElement('small');
    detail.textContent = shortDate.format(notice.created) + ' · ' + notice.message;
    text.append(title,detail);
    row.append(text);
    return row;
  });
  $('#notice-list').replaceChildren(...(notices.length ? notices : [empty('Todavía no tienes recordatorios.', 'bell')]));
}
function renderCalendar(occurrences) {
  const first = dayStart(month + '-01');
  $('#month-label').textContent = capitalize(format({month:'long',year:'numeric'}).format(first));
  const grid = $('#calendar');
  grid.replaceChildren();
  for (const label of ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom']) {
    const head = document.createElement('b');
    head.textContent = label;
    grid.append(head);
  }
  for (let i = 0; i < (new Date(first).getUTCDay() + 6) % 7; i++) grid.append(document.createElement('span'));
  const end = dayStart(nextMonth(month,1) + '-01');
  for (let at = first; at < end; at += day) {
    const date = local(at).slice(0,10);
    const count = occurrences.filter(row => local(row.at).startsWith(date)).length;
    const button = document.createElement('button');
    button.textContent = Number(date.slice(-2));
    button.setAttribute('aria-pressed',String(date === selectedDay));
    button.setAttribute('aria-label',prettyDate.format(at) + ', ' + count + ' eventos');
    if (count) {
      const marker = document.createElement('small');
      marker.textContent = count + (count === 1 ? ' evento' : ' eventos');
      button.append(marker);
    }
    button.onclick = () => { selectedDay = date; render(); };
    grid.append(button);
  }
}
function switchView(target) {
  view = target;
  $('#overview').hidden = view !== 'home';
  $('#details').hidden = view === 'home';
  $('#calendar-panel').hidden = view !== 'agenda';
  $('#drive-panel').hidden = view !== 'docs';
  $('#view-title').textContent = views[view][0];
  $('#view-description').textContent = views[view][2] || '';
  for (const button of nav.querySelectorAll('button')) {
    if (button.dataset.view === view) button.setAttribute('aria-current','page');
    else button.removeAttribute('aria-current');
  }
  render();
  refresh();
}
document.addEventListener('click', event => {
  const target = event.target.closest('[data-view],[data-add],.brand,.close');
  if (!target) return;
  if (target.dataset.view || target.classList.contains('brand')) {
    event.preventDefault();
    switchView(target.dataset.view || 'home');
  } else if (target.dataset.add) openEditor(target.dataset.add);
  else target.closest('dialog').close();
});
for (const [id,delta] of [['prev',-1],['next',1]]) $('#' + id).onclick = () => {
  month = nextMonth(month,delta);
  selectedDay = month + '-01';
  render();
  refresh();
};
const form = $('#item-form');
const fields = form.elements;
const steps = document.createElement('div');
steps.id = 'document-steps';
$('#notes-label').after(steps);
function renderSteps() {
  steps.replaceChildren();
  if (fields.kind.value !== 'document' || !editing) return;
  const saved = state.items.find(item => item.id === editing);
  const suggestions = documentSteps(fields.notes.value);
  for (const text of suggestions) {
    const row = document.createElement('div');
    row.className = 'row';
    const label = document.createElement('small');
    label.textContent = text;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'subtle';
    const exists = state.items.some(item => item.kind === 'task' && item.title === text.slice(0,150) && item.notes.includes('Documento: ' + saved?.title));
    button.textContent = exists ? 'En agenda' : 'Crear tarea';
    button.disabled = exists;
    button.onclick = () => {
      $('#editor').close();
      openEditor('task');
      fields.title.value = text.slice(0,150);
      fields.notes.value = 'Documento: ' + (saved?.title || '') + (saved?.link ? '\n' + saved.link : '');
    };
    row.append(label,button);
    steps.append(row);
  }
}
function showFields(defaults = false) {
  const kind = fields.kind.value;
  const doc = kind === 'document';
  $('#document-fields').hidden = !doc;
  const driveLink = /^(https:\/\/(?:docs|drive)\.google\.com)\//i.test(fields.link.value);
  $('#watch-drive-label').hidden = !doc || !driveLink;
  $('#drive-review').hidden = !doc || !driveLink || !editing || !state.drive?.connected;
  $('#duration-label').hidden = !scheduleKinds.includes(kind);
  fields.date.required = !doc;
  fields.time.required = !doc;
  $('#date-label').firstChild.textContent = dateKinds.includes(kind) ? '¿Qué fecha quieres recordar?' : doc ? 'Fecha de seguimiento (opcional)' : '¿Qué día es?';
  $('#notes-label').firstChild.textContent = doc ? 'Texto del documento (marca «Pendiente:» o «- [ ]»)' : 'Notas o pasos siguientes';
  if (defaults) {
    fields.repeat.value = dateKinds.includes(kind) ? 'annual' : ['class','gym'].includes(kind) ? 'weekly' : 'none';
    fields.reminder.value = dateKinds.includes(kind) ? '1440' : '30';
    if (doc) fields.date.value = '';
  }
  renderSteps();
}
function openEditor(kind = 'task', item) {
  form.reset();
  editing = item?.id || null;
  $('#editor-title').textContent = item ? 'Editar ' + labels[kind].toLowerCase() : 'Añadir a mi agenda';
  $('#delete-item').hidden = !item;
  fields.kind.value = kind;
  fields.title.value = item?.title || '';
  const upcoming = local(Math.ceil((Date.now() + 60000) / 900000) * 900000);
  fields.date.value = item?.start?.slice(0,10) || (kind === 'document' ? '' : view === 'agenda' ? selectedDay : dateKinds.includes(kind) ? today() : upcoming.slice(0,10));
  fields.time.value = item?.start?.slice(11) || (dateKinds.includes(kind) ? '09:00' : upcoming.slice(11));
  fields.duration.value = item?.duration || 60;
  fields.notes.value = item?.notes || '';
  fields.link.value = item?.link || '';
  fields.watchDrive.checked = Boolean(item?.watchDrive);
  if (item) { fields.repeat.value = item.repeat; fields.reminder.value = item.reminder; }
  setError(form,'');
  showFields(!item);
  $('#editor').showModal();
}
fields.kind.onchange = () => {
  if (!fields.date.value && fields.kind.value !== 'document') fields.date.value = today();
  if (dateKinds.includes(fields.kind.value)) fields.time.value = '09:00';
  showFields(true);
};
fields.notes.oninput = renderSteps;
fields.link.oninput = () => showFields();
$('#drive-connect').onclick = async () => {
  try { location.assign((await api('/api/drive/connect','POST')).url); }
  catch (error) { toast(error.message); }
};
$('#drive-review').onclick = async () => {
  const item = state.items.find(item => item.id === editing);
  if (item?.link !== fields.link.value || item?.notes !== fields.notes.value) return setError(form,'Guarda los cambios antes de revisar Drive.');
  const button = $('#drive-review');
  button.disabled = true;
  setError(form,'');
  try {
    const result = await api('/api/drive/items/' + editing,'POST');
    if (editing === result.id && $('#editor').open) {
      fields.notes.value = result.notes;
      await refresh();
      renderSteps();
      toast('Documento revisado.');
    }
  } catch (error) { setError(form,error.message); }
  finally { button.disabled = false; }
};
$('#hero-add').onclick = () => openEditor();
$('#view-add').onclick = () => openEditor(views[view][3]);
$('#doc-file').onchange = async event => {
  const [file] = event.target.files;
  if (!file) return;
  if (file.size > 96000) return setError(form,'El archivo supera el límite de importación.');
  setError(form,'');
  fields.notes.value = (await file.text()).slice(0,24000);
  renderSteps();
};
form.onsubmit = async event => {
  event.preventDefault();
  setError(form,'');
  const values = Object.fromEntries(new FormData(form));
  if (values.date && !values.time) return setError(form,'Indica a qué hora quieres el recordatorio.');
  const start = values.date ? values.date + 'T' + values.time : '';
  const submit = form.querySelector('[type=submit]');
  submit.disabled = true;
  try {
    await api('/api/items' + (editing ? '/' + editing : ''),editing ? 'PATCH' : 'POST',{...values,start,watchDrive:fields.watchDrive.checked,link:values.kind === 'document' ? values.link : ''});
    $('#editor').close();
    await refresh();
    toast('Cambios guardados en tu agenda.');
  } catch (error) { setError(form,error.message); }
  finally { submit.disabled = false; }
};
$('#delete-item').onclick = async () => {
  if (!confirm('¿Eliminar este elemento de tu agenda?')) return;
  try { await api('/api/items/' + editing,'DELETE'); $('#editor').close(); await refresh(); toast('Elemento eliminado.'); }
  catch (error) { setError(form,error.message); }
};
$('#bell').onclick = () => $('#notifications').showModal();
$('#enable-push').onclick = async () => {
  const status = $('#push-status');
  try {
    if (!isSecureContext || !('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      throw new Error('Abre la agenda con HTTPS. En iPhone, añádela primero a la pantalla de inicio desde Safari.');
    }
    if (!state.publicKey) throw new Error('Conéctate a la agenda para activar los avisos.');
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') throw new Error('Permite las notificaciones en los ajustes del navegador.');
    await navigator.serviceWorker.register('/sw.js');
    const worker = await navigator.serviceWorker.ready;
    const key = Uint8Array.from(atob(state.publicKey.replaceAll('-','+').replaceAll('_','/')), c => c.charCodeAt(0));
    const subscription = await worker.pushManager.getSubscription() || await worker.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key});
    await api('/api/subscriptions','POST',subscription);
    status.textContent = 'Avisos activados en este dispositivo.';
  } catch (error) { status.textContent = error.message; }
};
$('#login-form').onsubmit = async event => {
  event.preventDefault();
  const login = event.currentTarget;
  try {
    await api('/api/login','POST',Object.fromEntries(new FormData(login)));
    login.reset();
    setError(login,'');
    $('#login').close();
    await refresh();
  } catch (error) { setError(login,error.message); }
};
$('#login').oncancel = event => event.preventDefault();
$('#logout').onclick = async () => {
  try {
    await api('/api/logout','POST');
    state = {items:[],occurrences:[],notices:[]};
    deviceNotificationIds = null;
    switchView('home');
  } catch (error) { toast(error.message); }
};
window.addEventListener('focus', refresh);
setInterval(refresh, 6000);
const oauthResult = new URLSearchParams(location.search).get('drive');
switchView(oauthResult ? 'docs' : 'home');
if (oauthResult) {
  history.replaceState(null,'','/');
  toast(oauthResult === 'connected' ? 'Google Drive conectado.' : 'No se pudo conectar Google Drive.');
}

if (navigator.userAgent.includes('AmeliaNative')) {
  $('#enable-push').hidden = true;
  $('#push-status').textContent = 'Los avisos de esta aplicación se administran en los ajustes de tu dispositivo.';
}
