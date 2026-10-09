/* app/home.ts — the Home launcher, painted by the HTML and adopted by the app
   (2026-10-08).

   The launcher used to exist only once app.js and its chunks had landed and Lit
   had rendered it; until then html.mc-home-boot hid everything else in <main>.
   On a cold phone that made the launcher the page's first contentful paint AND
   its largest, both waiting on ~100 KB of script (Lighthouse mobile: FCP 1.8s,
   LCP 2.6s, "element render delay 1,280 ms"). The launcher is static (a handful
   of links), so it is now in docs/index.html itself and paints with the
   stylesheet; the element only adopts what it finds.

   ONE structure, two renderers, so the two can never drift:
     · homeTree(), plain data: the launcher's whole shape;
     · toHtml(), the string scripts/home_prerender.mjs writes into
       docs/index.html (`tests/js/home_prerender.test.mjs` fails when the page
       is stale);
     · toDom(), the nodes the element builds when it arrives EMPTY (a page from
       an older cache, or a swap that did not carry it). It makes no HTML or code
       sinks — createElement, setAttribute and text only.

   The one per-reader part is "Continue reading" (the newest mc-readpos:* entry
   that deeplink.js stores). The page always carries the row, hidden. The head
   script sets html.mc-cont before first paint when a position exists, so the
   row holds its place from the first frame. fillCont() then supplies the
   title and the link, and nothing below it moves. */

export interface HNode { t: string; c?: string; a?: Record<string, string>; k?: (HNode | string)[] }

/* The Home launcher: standout BROWSE features first, then the reading shelf
   (mirrors scripts/nav.yml). Static links only — the shell adds no API traffic
   here. P3-e: these deliberately do NOT repeat the rail / tab-bar destinations
   (Community, Ask Merecat, Inbox, Profile) — the rail is the quick-switch, the
   launcher is browse — and no item appears both here and in HOME_SECTIONS. */
export const HOME_FEATURES = [
  { icon: '🧭', title: 'Where to begin', sub: 'New here? Start here.', href: 'where-to-begin.html' },
  { icon: '📖', title: 'The Book', sub: 'Mere Catholicity — read, download, or buy', href: 'the-book.html' },
  { icon: '📚', title: 'Library', sub: 'The whole hosted corpus', href: 'library.html' },
  { icon: '🎧', title: 'The audio Bible', sub: 'The King James Version read aloud, chapter by chapter', href: 'kjv.html' },
  { icon: '📰', title: 'Journal', sub: 'The Mere Catholicity Journal', href: 'journal.html' },
];

/* The reading shelf, grouped the way a newcomer reads it. Surfaces the rest of
   the site nav (Contact lives only in the footer, kept quiet by design — not
   here; Library + Journal are up in the feature cards, not repeated here). */
export const HOME_SECTIONS = [
  { heading: 'Start here', items: [
    { title: 'Credo', sub: 'What we believe, clause by clause', href: 'credo.html' },
    { title: 'Lex orandi, lex credendi', sub: 'The rule of prayer', href: 'lex-orandi.html' },
  ] },
  { heading: 'The papers', items: [
    { title: 'Charting: the historic communions', sub: 'Rome, the Orthodox, the confessional churches', href: 'charting-communions.html' },
    { title: 'Charting: the free churches', sub: 'The same rule, turned around', href: 'free-churches.html' },
    { title: 'The top fifty objections', sub: 'Answered one by one', href: 'objections.html' },
    { title: 'The bishop and the presbyter', sub: 'Companion paper', href: 'bishop-presbyter.html' },
  ] },
  { heading: 'Explore', items: [
    { title: 'Sources', sub: 'The primary texts, Newman included', href: 'resources.html' },
    { title: 'About', sub: 'The project', href: 'about.html' },
  ] },
];

/* The prefix deeplink.js stores reading positions under — and the head script
   (scripts/inject_social.py) looks for, to set html.mc-cont. */
export const READPOS_PREFIX = 'mc-readpos:';

/* The reader's way back into whatever they were last reading: the most recent
   position becomes the "Continue reading" row atop the launcher. */
export function lastReadPos(store: Pick<Storage, 'length' | 'key' | 'getItem'>): { href: string; title: string } | null {
  try {
    let best: { at: number; href: string; title: string } | null = null;
    for (let i = 0; i < store.length; i += 1) {
      const k = store.key(i) || '';
      if (k.indexOf(READPOS_PREFIX) !== 0) continue;
      let v;
      try { v = JSON.parse(store.getItem(k) as string); } catch (e) { continue; /* one bad entry, not the rest */ }
      if (!v || !v.at) continue;
      const path = k.slice(READPOS_PREFIX.length);
      const title = String(v.title || '').split(/\s+[|—–]\s+/)[0].trim() || path;
      if (!best || v.at > best.at) best = { at: v.at, href: path + (v.id ? '#' + v.id : ''), title };
    }
    return best ? { href: best.href, title: best.title } : null;
  } catch (e) { return null; }
}

const go: HNode = { t: 'span', c: 'mc-home-go', k: ['›'] };

function feat(icon: string, title: string, sub: string, href: string, extra?: string): HNode {
  return { t: 'a', c: 'mc-home-feat' + (extra ? ' ' + extra : ''), a: { href }, k: [
    { t: 'span', c: 'mc-home-feat-ico', k: [icon] },
    { t: 'span', c: 'mc-home-feat-txt', k: [{ t: 'strong', k: [title] }, { t: 'small', k: [sub] }] },
    go,
  ] };
}

/* The whole launcher. The Continue row is always present and starts hidden
   (.mc-home-cont, shown by html.mc-cont or .mc-on): its link and title are the
   placeholders fillCont() replaces. */
export function homeTree(): HNode {
  const shelf: HNode[] = [];
  HOME_SECTIONS.forEach((sec) => {
    shelf.push({ t: 'h2', c: 'mc-home-sec', k: [sec.heading] });
    shelf.push({ t: 'div', c: 'mc-home-shelf', k: sec.items.map((s): HNode => ({ t: 'a', c: 'mc-home-row', a: { href: s.href }, k: [
      { t: 'span', c: 'mc-home-row-txt', k: s.sub ? [{ t: 'strong', k: [s.title] }, { t: 'small', k: [s.sub] }] : [{ t: 'strong', k: [s.title] }] },
      go,
    ] })) });
  });
  const head: HNode[] = [
    { t: 'div', c: 'mc-home-hero', k: [{ t: 'span', c: 'mc-home-cross', k: ['✝'] }, { t: 'p', k: ['One, holy, catholic, and apostolic.'] }] },
    { t: 'hr', c: 'mc-home-rule' },
    { t: 'div', c: 'mc-home-feats', k: [feat('📖', 'Continue reading', '\u00a0', 'library.html', 'mc-home-cont')]
      .concat(HOME_FEATURES.map((f) => feat(f.icon, f.title, f.sub, f.href))) },
  ];
  return { t: 'div', c: 'mc-home', k: head.concat(shelf) };
}

const VOID = { hr: true, br: true, img: true } as Record<string, boolean>;
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\u00a0/g, '&nbsp;');
}

export function toHtml(n: HNode | string): string {
  if (typeof n === 'string') return esc(n);
  let open = '<' + n.t + (n.c ? ' class="' + esc(n.c) + '"' : '');
  Object.keys(n.a || {}).forEach((k) => { open += ' ' + k + '="' + esc(n.a![k]) + '"'; });
  if (VOID[n.t]) return open + '>';
  return open + '>' + (n.k || []).map(toHtml).join('') + '</' + n.t + '>';
}

export function toDom(n: HNode | string, doc: Document): Node {
  if (typeof n === 'string') return doc.createTextNode(n);
  const el = doc.createElement(n.t);
  if (n.c) el.className = n.c;
  Object.keys(n.a || {}).forEach((k) => el.setAttribute(k, n.a![k]));
  (n.k || []).forEach((c) => el.appendChild(toDom(c, doc)));
  return el;
}

/* Point the Continue row at the reader's place, or take it away when there is
   none (a stray class with no position behind it would show a dead row). */
export function fillCont(root: Element, cont: { href: string; title: string } | null): void {
  const row = root.querySelector('.mc-home-cont');
  if (!row) return;
  if (!cont) { row.remove(); return; }
  row.setAttribute('href', cont.href);
  const small = row.querySelector('small');
  if (small) small.textContent = cont.title;
  row.classList.add('mc-on');
}

/* What <mc-home> does on connect: adopt the painted launcher when it is there,
   build it when it is not, then point the Continue row. */
export function mountLauncher(host: Element, cont: { href: string; title: string } | null): void {
  if (!host.querySelector(':scope > .mc-home')) {
    host.replaceChildren(toDom(homeTree(), host.ownerDocument));
  }
  fillCont(host, cont);
}
