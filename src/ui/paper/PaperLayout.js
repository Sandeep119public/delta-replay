import { paperMarkup } from '../paperMarkup.js';
export function renderPaperLayout(mount) {
  if (!mount) throw new Error('Paper UI mount is required');
  mount.innerHTML = paperMarkup();
}
