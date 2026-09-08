import { createApplication } from './app/Application.js';

function showFatalError(error) {
  const message = error instanceof Error ? error.message : String(error || 'Unknown startup error');
  const stack = error instanceof Error && error.stack ? error.stack : '';
  const mount = typeof document !== 'undefined' ? document.getElementById('app') : null;
  if (!mount) return;

  let panel = document.getElementById('startup-fatal-error');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'startup-fatal-error';
    panel.style.cssText = [
      'position:fixed', 'inset:16px', 'z-index:99999', 'padding:20px',
      'background:#180d0f', 'border:1px solid #7f1d1d', 'border-radius:12px',
      'color:#fee2e2', 'font:14px/1.5 system-ui,sans-serif',
      'overflow:auto', 'box-shadow:0 20px 80px #0008'
    ].join(';');
    mount.appendChild(panel);
  }

  panel.innerHTML = '';
  const title = document.createElement('div');
  title.textContent = 'DELTA REPLAY STARTUP ERROR';
  title.style.cssText = 'font-weight:800;font-size:16px;margin-bottom:10px';

  const detail = document.createElement('pre');
  detail.textContent = `${message}${stack ? `\n\n${stack}` : ''}`;
  detail.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere;margin:0;color:#fecaca';

  panel.append(title, detail);
}

window.addEventListener('error', (event) => {
  showFatalError(event.error || event.message || 'Unhandled browser error');
});

window.addEventListener('unhandledrejection', (event) => {
  showFatalError(event.reason || 'Unhandled promise rejection');
});

try {
  const app = createApplication();
  app.start();
  window.__DELTA_REPLAY_APP__ = app;
} catch (error) {
  console.error('[Delta Replay] startup failed', error);
  showFatalError(error);
}
