import { createApplication } from './app/Application.js';

const isDevelopment = Boolean(import.meta.env?.DEV);

function showFatalError(error) {
  const message = error instanceof Error ? error.message : String(error || 'Unknown startup error');
  const mount = typeof document !== 'undefined' ? document.getElementById('app') : null;
  if (!mount) return;

  let panel = document.getElementById('startup-fatal-error');
  if (!panel) {
    panel = document.createElement('section');
    panel.id = 'startup-fatal-error';
    panel.className = 'startup-fatal-error';
    panel.setAttribute('role', 'alert');
    mount.appendChild(panel);
  }

  panel.replaceChildren();
  const title = document.createElement('h1');
  title.textContent = 'Delta Replay could not start';
  const detail = document.createElement('p');
  detail.textContent = isDevelopment ? message : 'Please refresh the page. If the problem continues, try again later.';
  panel.append(title, detail);

  if (isDevelopment && error instanceof Error && error.stack) {
    const diagnostics = document.createElement('pre');
    diagnostics.textContent = error.stack;
    panel.appendChild(diagnostics);
  }
}

window.addEventListener('error', (event) => {
  console.error('[Delta Replay] unhandled browser error', event.error || event.message);
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('[Delta Replay] unhandled promise rejection', event.reason);
});

try {
  const app = createApplication();
  app.start();
  window.__DELTA_REPLAY_COMMAND_SURFACE__ = app.commandSurface;
  window.__DELTA_REPLAY_APP__ = app;
} catch (error) {
  console.error('[Delta Replay] startup failed', error);
  showFatalError(error);
}
