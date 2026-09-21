import { terminalMarkup } from './rebuildMarkup.js';

export function renderTerminalLayout(mount) {
  if (!mount) throw new Error('Terminal UI mount is required');
  mount.replaceChildren();
  mount.insertAdjacentHTML('afterbegin', terminalMarkup());
  const pageHost = mount.querySelector('#page-host');
  if (!pageHost || !mount.querySelector('#chart-container')) throw new Error('Terminal UI layout failed to mount');
  return pageHost;
}