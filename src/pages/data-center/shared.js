export function escapeText(value) {
  return String(value ?? '').replace(/[&<>\"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', "'": '&#39;' }[c]));
}

export function setPage(element, html) {
  if (!element) throw new Error('Data page element is required');
  const documentRef = element.ownerDocument;
  const template = documentRef.createElement('template');
  template.innerHTML = html;
  element.replaceChildren(template.content.cloneNode(true));
}

export function header(eyebrow, title, description) {
  return `<header class="data-page-header"><div><span class="data-eyebrow">${eyebrow}</span><h1>${title}</h1><p>${description}</p></div></header>`;
}

export function card(label, value) {
  return `<article class="data-card"><span>${label}</span><strong>${value}</strong></article>`;
}
