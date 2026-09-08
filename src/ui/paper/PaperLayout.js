import { paperMarkup } from '../paperMarkup.js';

export function renderPaperLayout(mount) {
  if (!mount) throw new Error('Paper UI mount is required');
  if (mount.querySelector?.('#page-replay')) return mount.firstElementChild;
  mount.innerHTML = paperMarkup();
  return mount.firstElementChild;
}
