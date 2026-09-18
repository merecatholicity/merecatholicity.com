/* The DM pickers: Forward (the conversations sheet, the re-seal per target) and Members (the directory multi-pick behind New group and Add members), with the avatar cells and the collage.
   Split out of client/dm.ts on 2026-09-16 (the six DM factories); every declaration
   moved verbatim. Names from the boot and the other modules are bound in bind(). */
import type { Boot } from './boot';

export function installDmPickers(B: Boot) {
  /* Names this module takes from the boot — the root's helpers and the other
     modules' exports — bound in bind() once every module is installed, so
     order of installation never matters and every body reads as it did. */
  let API: string;
  let MERECAT_BOT_HASH: string;
  let blockedOut: (d: any) => any;
  let displayName: (hash: any) => any;
  let el: (tag: string, cls?: string | null, text?: string | number | null) => any;
  let fetchRetry: (url: string, opts: RequestInit | undefined, delays: number[], onRetry?: () => void) => Promise<Response>;
  let freshParam: (sep: any) => any;
  let getToken: () => Promise<any>;
  let warmToken: () => void;
  let skelInto: (node: any, kind?: string) => any;
  let state: Record<string, any>;
  let dmLabel: (hash: unknown, nick: unknown) => any;
  let dmMembersLabel: (t: unknown) => any;
  let dmRowLabel: (t: unknown) => any;
  let dmRowTarget: (t: unknown) => any;
  let dmScore: (q: unknown, name: unknown) => any;
  let dmSealFor: (plaintext: unknown, members: unknown) => any;
  let dmWrapText: (text: unknown, reply: unknown, fwd?: unknown) => any;

  /* What the copy carries: the words, or the media envelope with the same
     object; never the quote it answered; the mark. */
  function dmForwardPlain(m: any) {
    if (m.media_key && m._env) {
      var env: any = Object.assign({}, m._env);
      delete env.reply;
      env.fwd = 1;
      return { plain: JSON.stringify(env), media_key: m.media_key };
    }
    return { plain: dmWrapText(String(m.body || ''), null, true), media_key: null };
  }

  /* Seal the copy for each target's current members (their roster read
     without a mark) and post the batch. Resolves to how many were sent. */
  function dmForwardTo(m: any, targets: any[], status: any) {
    var src = dmForwardPlain(m);
    status.textContent = 'Sealing…';
    return getToken().then(function (token) {
      return Promise.all(targets.map(function (t: any) {
        return fetch(API + '/dm/roster', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ key: state.key }, t)) })
          .then(function (r) { return r.json(); })
          .then(function (d) {
            if (!d || !d.ok || !Array.isArray(d.members) || !d.members.length) return null;
            if (d.members.some(function (mm: any) { return !mm.pubkey; })) return null;   // a member without a key: nothing can be sealed to them
            var sealed = dmSealFor(src.plain, d.members);
            var item: any = { body: sealed.body, enc: 3, keys: sealed.keys };
            if (d.thread_id) item.thread_id = d.thread_id; else item.to = t.with;
            if (src.media_key) item.media_key = src.media_key;
            return item;
          })
          .catch(function () { return null; });
      })).then(function (items) {
        var live = items.filter(Boolean);
        if (!live.length) throw new Error('Nobody to forward to — a member may not have set up encryption yet.');
        status.textContent = 'Sending…';
        return fetch(API + '/dm/forward', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: state.key, token: token, items: live }) }).then(function (r) { return r.json(); });
      });
    }).then(function (d) {
      if (blockedOut(d)) return 0;
      if (!d || !d.ok) throw new Error((d && d.error) || 'Could not forward.');
      return (d.results || []).filter(function (r: any) { return r && r.ok; }).length;
    }).finally(function () {
      if (window.turnstile && state.widgetId !== null) turnstile.reset(state.widgetId);
    });
  }

  /* The picker: my conversations (the inbox's first page), a search over the
     directory for anyone else, checkboxes, one Send. A sheet in the shell. */
  function dmForwardPicker(m: any, ctx: any) {
    /* The Send is Turnstile-gated and a press on a bubble focuses no field:
       warm the challenge now, so the token is waiting when they press. */
    warmToken();
    var box = el('div', 'dm-fwd-pick');
    var chosen: Record<string, any> = {};
    var search = el('input', 'key-input dm-fwd-search');
    search.type = 'text'; search.placeholder = 'Find a member…'; search.setAttribute('aria-label', 'Find a member');
    var list = el('div', 'dm-fwd-list');
    var status = el('p', 'form-status');
    var sendBtn = el('button', 'btn btn-send dm-fwd-send', 'Send');
    sendBtn.type = 'button'; sendBtn.disabled = true;
    function paintSend() { var n = Object.keys(chosen).length; sendBtn.disabled = !n; sendBtn.textContent = n ? 'Send to ' + n : 'Send'; }
    function rowFor(key: string, label: string, sub: string, target: any, first?: boolean) {
      if (list.querySelector('[data-key="' + key + '"]')) return;
      var row = el('label', 'dm-fwd-row');
      row.setAttribute('data-key', key);
      var cb = el('input'); cb.type = 'checkbox';
      cb.addEventListener('change', function () { if (cb.checked) chosen[key] = target; else delete chosen[key]; paintSend(); });
      row.appendChild(cb);
      var text = el('span', 'dm-fwd-text');
      text.appendChild(el('span', 'dm-fwd-name', label));
      if (sub) text.appendChild(el('span', 'dm-fwd-sub', sub));
      row.appendChild(text);
      if (first && list.firstChild) list.insertBefore(row, list.firstChild); else list.appendChild(row);
    }
    var dir: any = null, dirT: any = 0;
    function suggest() {
      var q = search.value.trim().toLowerCase();
      if (q.length < 2) return;
      var run = function () {
        dir.filter(function (u: any) { return u.hash !== state.myHash && u.hash !== MERECAT_BOT_HASH; })
          .map(function (u: any) { return { u: u, s: Math.max(dmScore(q, u.nick), dmScore(q, displayName(u.hash))) }; })
          .filter(function (x: any) { return x.s > 0; })
          .sort(function (x: any, y: any) { return y.s - x.s; })
          .slice(0, 5)
          .forEach(function (x: any) { rowFor('h:' + x.u.hash, dmLabel(x.u.hash, x.u.nick), 'member', { with: x.u.hash }, true); });
      };
      if (dir) return run();
      fetch(API + '/dm/directory', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: state.key }) }).then(function (r) { return r.json(); }).then(function (d) { if (d && d.ok) { dir = d.users || []; run(); } }).catch(function () { /* the list alone */ });
    }
    search.addEventListener('input', function () { clearTimeout(dirT); dirT = setTimeout(suggest, 200); });
    box.appendChild(search);
    box.appendChild(list);
    box.appendChild(sendBtn);
    box.appendChild(status);
    skelInto(list);
    fetchRetry(API + '/dm/threads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: state.key, p: 1 }) }, [1000])
      .then(function (r) { return r.json(); })
      .then(function (d) {
        list.textContent = '';
        (d && d.threads || []).forEach(function (t: any) {
          if (ctx && ctx.threadId && Number(t.thread_id || t.id) === ctx.threadId) return;   // not back into this one
          rowFor('t:' + (t.thread_id || t.id), dmRowLabel(t), Number(t.kind) === 1 ? dmMembersLabel(t) : '', dmRowTarget(t));
        });
        if (!list.childNodes.length) list.appendChild(el('p', 'comments-status', 'No other conversations yet — find a member above.'));
      })
      .catch(function () { list.textContent = ''; list.appendChild(el('p', 'comments-status', 'The conversations could not be loaded. Find a member above.')); });
    var close: any = null;
    sendBtn.addEventListener('click', function () {
      if (sendBtn.disabled) return;
      sendBtn.disabled = true;
      var targets = Object.keys(chosen).map(function (k) { return chosen[k]; });
      dmForwardTo(m, targets, status).then(function (n) {
        status.textContent = '';
        if (ctx && ctx.note) ctx.note(n ? 'Forwarded to ' + n + (n === 1 ? ' conversation.' : ' conversations.') : 'Nothing was forwarded.');
        if (close) close();
      }).catch(function (err: any) { status.textContent = (err && err.message) || 'Could not forward.'; sendBtn.disabled = false; });
    });
    if (window.mcSheet) { window.mcSheet.open('Forward to…', box); close = function () { try { window.mcSheet!.close(); } catch (e) { /* closed already */ } }; }
    else {
      /* No shell: the picker folds out under the word, with a way back. */
      var x = el('button', 'btn', 'Cancel'); x.type = 'button';
      x.addEventListener('click', function () { box.remove(); });
      box.appendChild(x);
      close = function () { box.remove(); };
      (ctx && ctx.list ? ctx.list : document.body).appendChild(box);
    }
  }

  /* ---- Members (2026-09-13): the picker behind "New group" and "Add members"
     — a search over the directory, checkboxes, an optional name, one button.
     The create and the add are Turnstile-gated, so the picker warms as it
     opens; the cap is the kernel's (Domain.Dm.maxMembers). ---- */
  function dmMemberPicker(opts: any) {
    warmToken();
    var cap = (window.mcCore && window.mcCore.dmMaxMembers) || 25;
    var exclude: string[] = (opts.exclude || []).map(String);
    var have = Number(opts.count) || 0;   // members already in (the cap counts them)
    var box = el('div', 'dm-fwd-pick');
    var chosen: Record<string, boolean> = {};
    var search = el('input', 'key-input dm-fwd-search');
    search.type = 'text'; search.placeholder = 'Find a member…'; search.setAttribute('aria-label', 'Find a member');
    var list = el('div', 'dm-fwd-list');
    var nameIn: any = null;
    if (opts.nameField) {
      nameIn = el('input', 'key-input dm-group-name');
      nameIn.type = 'text'; nameIn.placeholder = 'Group name (optional)'; nameIn.setAttribute('aria-label', 'Group name');
      nameIn.maxLength = (window.mcCore && window.mcCore.dmGroupNameMax) || 60;
    }
    var status = el('p', 'form-status');
    var okBtn = el('button', 'btn btn-send dm-fwd-send', opts.submitLabel || 'Add');
    okBtn.type = 'button'; okBtn.disabled = true;
    function paint() { var n = Object.keys(chosen).length; okBtn.disabled = !n; okBtn.textContent = (opts.submitLabel || 'Add') + (n ? ' (' + n + ')' : ''); }
    function rowFor(u: any) {
      var key = 'h:' + u.hash;
      if (list.querySelector('[data-key="' + key + '"]')) return;
      var row = el('label', 'dm-fwd-row');
      row.setAttribute('data-key', key);
      var cb = el('input'); cb.type = 'checkbox';
      cb.addEventListener('change', function () {
        if (cb.checked && have + Object.keys(chosen).length + 1 > cap) { cb.checked = false; status.textContent = 'A conversation holds at most ' + cap + ' members.'; return; }
        if (cb.checked) chosen[u.hash] = true; else delete chosen[u.hash];
        status.textContent = ''; paint();
      });
      row.appendChild(cb);
      var text = el('span', 'dm-fwd-text');
      text.appendChild(el('span', 'dm-fwd-name', dmLabel(u.hash, u.nick)));
      row.appendChild(text);
      if (list.firstChild) list.insertBefore(row, list.firstChild); else list.appendChild(row);
    }
    var dir: any = null, dirT: any = 0;
    function suggest() {
      var q = search.value.trim().toLowerCase();
      if (q.length < 2) return;
      var run = function () {
        dir.filter(function (u: any) { return u.hash !== state.myHash && u.hash !== MERECAT_BOT_HASH && exclude.indexOf(u.hash) === -1; })
          .map(function (u: any) { return { u: u, s: Math.max(dmScore(q, u.nick), dmScore(q, displayName(u.hash))) }; })
          .filter(function (x: any) { return x.s > 0; })
          .sort(function (x: any, y: any) { return y.s - x.s; })
          .slice(0, 6)
          .forEach(function (x: any) { rowFor(x.u); });
      };
      if (dir) return run();
      fetch(API + '/dm/directory', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: state.key }) }).then(function (r) { return r.json(); }).then(function (d) { if (d && d.ok) { dir = d.users || []; run(); } }).catch(function () { status.textContent = 'The member list could not be loaded.'; });
    }
    search.addEventListener('input', function () { clearTimeout(dirT); dirT = setTimeout(suggest, 200); });
    if (nameIn) box.appendChild(nameIn);
    box.appendChild(search);
    box.appendChild(el('p', 'key-note', 'Type a nickname or an assigned name, then tick the members.'));
    box.appendChild(list);
    box.appendChild(okBtn);
    box.appendChild(status);
    var close: any = null;
    okBtn.addEventListener('click', function () {
      if (okBtn.disabled) return;
      okBtn.disabled = true; status.textContent = 'Working…';
      Promise.resolve(opts.onDone(Object.keys(chosen), nameIn ? nameIn.value.trim() : '')).then(function () {
        status.textContent = '';
        if (close) close();
      }).catch(function (err: any) { status.textContent = (err && err.message) || 'Could not do that.'; okBtn.disabled = false; });
    });
    if (window.mcSheet) { window.mcSheet.open(opts.title || 'Members', box); close = function () { try { window.mcSheet!.close(); } catch (e) { /* closed already */ } }; }
    else {
      var x = el('button', 'btn', 'Cancel'); x.type = 'button';
      x.addEventListener('click', function () { box.remove(); });
      box.appendChild(x);
      close = function () { box.remove(); };
      (opts.host || document.body).appendChild(box);
    }
    setTimeout(function () { try { search.focus(); } catch (e) { /* fine */ } }, 50);
  }

  /* A member's avatar, small — the sheet's rows, the group's collage. */
  function dmAvatarCell(mm: any, cls: string) {
    var cell = el('span', cls);
    if (mm && mm.avatar) {
      var im = el('img', 'dm-head-img');
      im.src = API + '/avatar?hash=' + mm.hash + '&v=' + encodeURIComponent(mm.avatar);
      im.alt = '';
      cell.appendChild(im);
    } else cell.appendChild(el('span', 'dm-collage-initial', String((mm && (mm.nick || mm.assigned)) || '?').charAt(0).toUpperCase()));
    return cell;
  }

  /* A group's face: up to four of the others, in a 2×2 (the inbox row's and
     the header's collage). */
  function dmCollageInto(host: any, rows: any[]) {
    var pick = rows.slice(0, (window.mcCore && window.mcCore.dmInboxAvatars) || 4);
    host.classList.add('dm-collage', 'dm-collage-' + Math.max(1, pick.length));
    if (!pick.length) { host.appendChild(el('span', 'dm-head-initial', '👥')); return; }
    pick.forEach(function (mm: any) { host.appendChild(dmAvatarCell(mm, 'dm-collage-cell')); });
  }

  function bind() {
    API = B.API;
    MERECAT_BOT_HASH = B.MERECAT_BOT_HASH;
    blockedOut = B.blockedOut;
    displayName = B.displayName;
    el = B.el;
    fetchRetry = B.fetchRetry;
    freshParam = B.freshParam;
    getToken = B.getToken;
    warmToken = B.warmToken;
    skelInto = B.skelInto;
    state = B.state;
    dmLabel = B.dmLabel;
    dmMembersLabel = B.dmMembersLabel;
    dmRowLabel = B.dmRowLabel;
    dmRowTarget = B.dmRowTarget;
    dmScore = B.dmScore;
    dmSealFor = B.dmSealFor;
    dmWrapText = B.dmWrapText;
  }
  function run() { /* nothing of this module ran at the boot's top level */ }
  return { bind, run, exports: { dmAvatarCell, dmCollageInto, dmForwardPicker, dmMemberPicker } };
}
