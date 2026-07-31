/* The Library, re-presented as an app-style drill-down (both breakpoints).
   The MATERIAL is untouched: this parses the page's own static catalog markup
   (the h2 categories, h3 sub-shelves, and ul.library work lists that gen_library.py
   emits) into a model, then renders category cards → drill into one → its works,
   with real back/forward through the browser's history (a hash per category, so the
   app-bar and browser back/forward jump between visited shelves). No-JS / SEO
   readers keep the full flat list; JS readers get the drill-down. Mounted by the
   shell on library.html via mountLibrary() in appchrome. */

import { LitElement, html, nothing } from '../../vendor/lit-all.min.js';

function slug(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/* Parse the static catalog under <main> into { intro, cats: [{ id, name, desc,
   groups: [{ name, id, works: [{ title, links:[{label,href}] }] }] }] }. */
export function parseLibrary(main) {
  const cats = [];
  let intro = '';
  let cat = null, group = null;
  Array.prototype.forEach.call(main.children, function (el) {
    const tag = el.tagName;
    if (tag === 'H1') return;
    if (tag === 'P') {
      if (!cat) { if (!intro) intro = el.textContent.trim(); return; }
      if (!cat._seenUl && !cat.desc) cat.desc = el.textContent.trim();
      return;
    }
    if (tag === 'H2') {
      cat = { id: el.id || slug(el.textContent), name: el.textContent.trim(), desc: '', groups: [], _seenUl: false };
      group = { name: '', id: '', works: [] };
      cat.groups.push(group);
      cats.push(cat);
      return;
    }
    if (tag === 'H3' && cat) {
      if (group && !group.works.length && !group.name) { group.name = el.textContent.trim(); group.id = el.id || slug(el.textContent); }
      else { group = { name: el.textContent.trim(), id: el.id || slug(el.textContent), works: [] }; cat.groups.push(group); }
      return;
    }
    if (tag === 'UL' && el.classList.contains('library') && cat) {
      cat._seenUl = true;
      if (!group) { group = { name: '', id: '', works: [] }; cat.groups.push(group); }
      const g = group;
      Array.prototype.forEach.call(el.children, function (li) {
        if (li.tagName !== 'LI') return;
        const strong = li.querySelector('strong');
        const links = Array.prototype.map.call(li.querySelectorAll('a'), function (a) {
          return { label: a.textContent.trim(), href: a.getAttribute('href') };
        });
        /* any trailing prose after the last link (e.g. "with Scourby's audio") */
        let note = '';
        const last = li.querySelector('a:last-of-type');
        if (last) { let n = last.nextSibling; while (n) { note += n.textContent; n = n.nextSibling; } }
        note = note.replace(/^[\s··]+/, '').trim();
        g.works.push({ title: strong ? strong.textContent.trim() : li.textContent.trim(), links: links, note: note, id: li.id || '' });
      });
      return;
    }
  });
  cats.forEach(function (c) { c.groups = c.groups.filter(function (g) { return g.works.length; }); delete c._seenUl; });
  return { intro: intro, cats: cats };
}

class McLibrary extends LitElement {
  static properties = { cat: { attribute: false } };
  constructor() { super(); this.model = { intro: '', cats: [] }; this.cat = ''; }
  createRenderRoot() { return this; }
  connectedCallback() {
    super.connectedCallback();
    this.cat = this._fromHash();
    this._onPop = () => { this.cat = this._fromHash(); this._top(); };
    window.addEventListener('popstate', this._onPop);
    window.addEventListener('hashchange', this._onPop);
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('popstate', this._onPop);
    window.removeEventListener('hashchange', this._onPop);
  }
  /* Resolve the current hash to a category id: a category id opens it; a sub-shelf
     id opens its parent; anything else is the top-level grid. */
  _fromHash() {
    const h = (location.hash || '').replace(/^#/, '');
    if (!h) return '';
    const cats = this.model.cats;
    if (cats.some(function (c) { return c.id === h; })) return h;
    /* a sub-shelf id or a work id (e.g. #catena on a <li>) opens its parent category */
    const parent = cats.find(function (c) {
      return c.groups.some(function (g) {
        return g.id === h || g.works.some(function (w) { return w.id === h; });
      });
    });
    return parent ? parent.id : '';
  }
  _top() { try { window.scrollTo(0, 0); } catch (e) { /* ignore */ } }
  open(e, id) { e.preventDefault(); history.pushState(null, '', '#' + id); this.cat = id; this._top(); }
  back(e) { e.preventDefault(); history.back(); }
  count(c) { return c.groups.reduce(function (n, g) { return n + g.works.length; }, 0); }
  workTpl(w) {
    return html`<div class="mc-lib-work">
      <span class="mc-lib-work-title">${w.title}</span>
      <span class="mc-lib-work-links">${w.links.map(function (l) {
        return html`<a href=${l.href}>${l.label}</a>`;
      })}${w.note ? html`<span class="mc-lib-work-note">${w.note}</span>` : nothing}</span>
    </div>`;
  }
  render() {
    const cats = this.model.cats;
    const active = cats.find((c) => c.id === this.cat);
    if (!active) {
      return html`<div class="mc-lib">
        <h1 class="mc-lib-title">Library</h1>
        ${this.model.intro ? html`<p class="mc-lib-intro">${this.model.intro}</p>` : nothing}
        <div class="mc-lib-grid">${cats.map((c) => html`
          <a class="mc-lib-card" href=${'#' + c.id} @click=${(e) => this.open(e, c.id)}>
            <span class="mc-lib-card-body">
              <span class="mc-lib-card-name">${c.name}</span>
              <span class="mc-lib-card-meta">${this.count(c)} ${this.count(c) === 1 ? 'work' : 'works'}</span>
            </span>
            <span class="mc-lib-go">›</span>
          </a>`)}</div>
      </div>`;
    }
    return html`<div class="mc-lib">
      <div class="mc-lib-bar">
        <button class="mc-lib-back" @click=${(e) => this.back(e)}>‹ Library</button>
      </div>
      <h1 class="mc-lib-title">${active.name}</h1>
      ${active.desc ? html`<p class="mc-lib-intro">${active.desc}</p>` : nothing}
      ${active.groups.map((g) => html`
        ${g.name ? html`<h2 class="mc-lib-shelf" id=${g.id}>${g.name}</h2>` : nothing}
        <div class="mc-lib-works">${g.works.map((w) => this.workTpl(w))}</div>`)}
    </div>`;
  }
}
customElements.define('mc-library', McLibrary);

/* Called by the shell (appchrome) on the library route: parse the flat catalog,
   remove it from the live DOM (SEO/no-JS readers already have it from the served
   HTML), and drop the drill-down in its place. Idempotent per main render. */
export function mountLibrary(main) {
  if (!main || main.querySelector('mc-library')) return;
  if (!main.querySelector('h2[id] + p, h2[id] + ul.library, ul.library')) return;
  const model = parseLibrary(main);
  if (!model.cats.length) return;
  const node = document.createElement('mc-library');
  node.model = model;
  /* strip the flat catalog (everything the parser consumed) and mount the app view */
  Array.prototype.slice.call(main.children).forEach(function (el) {
    if (/^(H1|H2|H3|P|UL)$/.test(el.tagName)) main.removeChild(el);
  });
  main.insertBefore(node, main.firstChild);
}
