/* Shared Lit view helpers (interior campaign): the page-bar renderer and the
   breadcrumb, template-returning, one source for every board view. The windowing
   itself — show 1, the active page's neighbours, and the last; a one-page gap
   shows that page, a wider gap an ellipsis — is single-sourced in Domain.Pager
   (Core.pagerItems); this file only renders the returned cells. (The classic
   comments.js pageBar uses a wider first-three window, deliberately distinct.) */

import { html, nothing } from 'lit';
import { pagerItems } from '../core.js';

export function pagerTpl(total, per, active, hrefFor, cls) {
  const items = pagerItems(total, per, active);
  if (!items.length) return nothing;
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
