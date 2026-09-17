import { paperMarkup } from '../paperMarkup.js';

const PAPER_LAYOUT_SELECTOR = '#page-replay[data-paper-layout="1"] #chart-container';

export function renderPaperLayout(mount) {
  if (!mount) throw new Error('Paper UI mount is required');

  const existing = mount.querySelector?.(PAPER_LAYOUT_SELECTOR);
  if (existing) return mount.querySelector('#page-host') || mount.firstElementChild;

  mount.replaceChildren();
  mount.insertAdjacentHTML('afterbegin', paperMarkup());
  const pageHost = mount.querySelector('#page-host');
  if (!pageHost) throw new Error('Paper UI page host was not created');
  if (!mount.querySelector(PAPER_LAYOUT_SELECTOR)) throw new Error('Paper UI replay workspace was not created');
  return pageHost;
}
