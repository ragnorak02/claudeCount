import { showModal } from '../common/Modal';

const api = window.api;

/**
 * Debug log panel — shows recent log entries and environment info.
 */
export function initDebugPanel() {
  const btn = document.getElementById('btn-debug');
  if (!btn) return;

  btn.addEventListener('click', showDebugModal);
}

async function showDebugModal() {
  const [logs, env] = await Promise.all([
    api.getDebugLog(),
    api.getEnv(),
  ]);

  const content = document.createElement('div');
  content.className = 'debug-panel';
  content.innerHTML = `
    <div class="debug-env">
      <h4>Environment</h4>
      <div class="debug-env-grid">
        <span>Platform:</span><span>${env.platform}</span>
        <span>Arch:</span><span>${env.arch}</span>
        <span>Node:</span><span>${env.nodeVersion}</span>
        <span>Electron:</span><span>${env.electronVersion}</span>
        <span>App:</span><span>${env.appVersion}</span>
      </div>
    </div>
    <div class="debug-logs">
      <h4>Recent Logs (${logs.length})</h4>
      <div class="debug-log-list">
        ${logs.slice(-100).reverse().map(log => `
          <div class="debug-log-entry log-${log.level}">
            <span class="log-time">${new Date(log.time).toLocaleTimeString()}</span>
            <span class="log-level">${log.level}</span>
            <span class="log-msg">${escHtml(log.message)}</span>
            ${log.data ? `<span class="log-data">${escHtml(JSON.stringify(log.data))}</span>` : ''}
          </div>
        `).join('')}
      </div>
    </div>
  `;

  showModal({ title: 'Debug Log', content, width: '700px' });
}

function escHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}
