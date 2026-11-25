const input = document.querySelector('input');
const status = document.querySelector('[role=status]');
const button = document.querySelector('button');
const query = new URLSearchParams(location.search);
input.value = query.get('server') || '';
status.textContent = query.get('message') || '';
document.querySelector('form').onsubmit = async event => {
  event.preventDefault();
  button.disabled = true;
  status.textContent = 'Comprobando la conexión…';
  try {
    const result = await window.amelia.saveServer(input.value);
    status.textContent = result.ok ? 'Conectado.' : result.error;
  } catch { status.textContent = 'No se pudo guardar la conexión.'; }
  finally { button.disabled = false; }
};
