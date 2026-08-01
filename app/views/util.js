/* Shared Lit view helpers (interior campaign): the page-bar windowing and
   the breadcrumb, pure and template-returning, one source for every board
   view. The pager mirrors comments.js pageBar() exactly — show 1, the
   active page's neighbours, and the last; a one-page gap shows that page, a
   wider gap an ellipsis. */

import { html, nothing } from 'lit';

export function pagerPages(total, per, active) {
  const pages = Math.ceil(total / per);
  if (pages < 2) return null;
  const shown = [];
  for (let n = 1; n <= pages; n++) {
    if (n === 1 || n === pages || Math.abs(n - active) <= 1) shown.push(n);
  }
  const out = [];
  let prev = 0;
  shown.forEach((n) => {
    if (prev) {
      if (n - prev === 2) out.push({ n: prev + 1 });
      else if (n - prev > 2) out.push({ gap: true });
    }
    out.push({ n, active: n === active });
    prev = n;
  });
  return out;
}

export function pagerTpl(total, per, active, hrefFor, cls) {
  const items = pagerPages(total, per, active);
  if (!items) return nothing;
  return html`<p class=${cls || 'board-pages'}>${items.map((it) =>
    it.gap ? html` … ` : it.active
      ? html` <strong>${it.n}</strong> `
      : html` <a href=${hrefFor(it.n)}>${it.n}</a> `)}</p>`;
}

/* parts: array of [text] or [text, href]. Mirrors comments.js crumb(). */
export function crumbTpl(parts) {
  return html`<p class="board-crumb">${parts.map((part, i) => html`${i ? ' › ' : nothing}${part[1]
    ? html`<a href=${part[1]}>${part[0]}</a>`
    : html`<span>${part[0]}</span>`}`)}</p>`;
}
