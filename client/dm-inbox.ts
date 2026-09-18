/* The inbox side of the DMs: the unread cache and badge, the live frame handlers and their dispatcher (run), the conversation labels and search box, and the inbox door.
   Split out of client/dm.ts on 2026-09-16 (the six DM factories); every declaration
   moved verbatim. Names from the boot and the other modules are bound in bind(). */
import type { Boot } from './boot';
import type { DmThreadsRow } from '../app/wire.ts';

export function installDmInbox(B: Boot) {
  /* Names this module takes from the boot — the root's helpers and the other
     modules' exports — bound in bind() once every module is installed, so
     order of installation never matters and every body reads as it did. */
  let API: string;
  let badgeChanged: () => any;
  let blockedOut: (d: any) => any;
  let bootSig: AbortSignal;
  let displayName: (hash: any) => any;
  let el: (tag: string, cls?: string | null, text?: string | number | null) => any;
  let freshParam: (sep: any) => any;
  let getToken: () => Promise<any>;
  let go: (href: string, replace?: boolean) => any;
  let onLiveNotif: () => any;
  let readEase: () => void;
  let readMark: () => void;
  let readThrottled: (d: unknown) => boolean;
  let renderIdentity: () => any;
  let section: HTMLElement;
  let state: Record<string, any>;
  let dmE2eBadge: (other?: unknown, otherPubB64?: unknown) => any;
  let dmMemberPicker: (opts: unknown) => any;
  let playSound: (name: unknown, loop?: unknown) => any;

  function dmSeenLabel(epoch: any) {
    var t = Number(epoch) || 0;
    if (!t) return '';
    var now = Date.now() / 1000, age = now - t;
    if (age < 60) return 'just now';
    if (age < 3600) return Math.max(1, Math.floor(age / 60)) + ' min ago';
    var d = new Date(t * 1000), today = new Date();
    var time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    var yest = new Date(today); yest.setDate(today.getDate() - 1);
    if (d.toDateString() === today.toDateString()) return 'today at ' + time;
    if (d.toDateString() === yest.toDateString()) return 'yesterday at ' + time;
    if (age < 6 * 86400) return d.toLocaleDateString('en-US', { weekday: 'short' }) + ' at ' + time;
    if (d.getFullYear() === today.getFullYear()) return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  /* ---- Unread badge. One localStorage-cached count, refreshed from the
     server at most every ninety seconds, so idle page turns cost nothing.
     Inbox and thread responses refresh the cache for free. ---- */

  var DM_CACHE = 'mc-dm-unread';

  function dmCacheGet() {
    try { return JSON.parse(localStorage.getItem(DM_CACHE) as string) || null; } catch (e) { return null; }
  }

  function dmCacheSet(n: any) {
    try { localStorage.setItem(DM_CACHE, JSON.stringify({ n: n, at: Date.now() })) } catch (e) {}
    renderIdentity();
    badgeChanged();
  }

  var dmAsking = false;
  function dmUnreadCheck(force?: boolean) {
    if (!state.key) return;
    /* The shell's badges own this read where they stand (app/badges.ts): one
       road, one answer. */
    if (window.mcBadges) { window.mcBadges.refresh('dm', force ? 300 : 0); return; }
    var c = dmCacheGet();
    if (!force && c && Date.now() - c.at < 90000) return;
    /* An in-flight flag keeps parallel boots quiet. It used to re-stamp the
       stored count instead, which made last visit's number look fresh — and
       the chrome painted it (2026-09-17). The stamp is when the number was
       LEARNED, and nothing else may move it. */
    if (dmAsking) return;
    dmAsking = true;
    readMark();
    fetch(API + '/dm/unread', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: state.key }),
    }).then(function (r) { return r.json(); }).then(function (d) {
      dmAsking = false;
      if (blockedOut(d)) return;
      if (readThrottled(d)) readEase();
      if (d.ok) dmCacheSet(d.unread);
    }).catch(function () { dmAsking = false; });
  }

  /* ---- Live DMs and notifications (window.mcLive private user scope) ----
     A signed-in member authenticates the board socket and subscribes to its own
     user:<hash> scope; the worker pushes that member's DMs and notifications
     instantly. Here we turn those pushes into the badge tick, the open DM thread
     drop-in, and (for the Lit lists) a self-refresh. No push ⇒ the 90-second
     poll below is the fallback, exactly as before. */
  var dmBadgeT = 0; B.notifBadgeT = 0;

  /* Both are reached ONLY from live socket events (never the 90s polls or page
     boot), so the bell sound obeys the "already on the site" rule for free. */
  function liveDmBadge() {
    if ((window as any).mcBadges) return;   // the shell's badges (app/badges.ts) hear the frame on every page — no second read, no second bell
    playSound('bell'); clearTimeout(dmBadgeT); dmBadgeT = setTimeout(function () { dmUnreadCheck(true); }, 300);
  }

  /* The open conversation a live frame belongs to, if any: by the thread's id
     (every frame carries one since 0016); a pair's room still unmade — no id
     yet — by its other, and the frame's id is adopted. Null: not this one. */
  function forOpen(m: any) {
    var v = state.dmView;
    if (!v || !m) return null;
    var tid = Math.floor(Number(m.thread_id) || 0);
    if (v.threadId) return tid === v.threadId || (!tid && v.other && m.from === v.other) ? v : null;
    if (v.other && m.from === v.other) { if (tid && v.adopt) v.adopt(tid); return v; }
    return null;
  }

  function onLiveDm(m: any) {
    var v = forOpen(m);
    if (v && m.message) v.append(m.message);   // instant in the open conversation
    else liveDmBadge();   // a background thread — ring the badge (McInbox self-refreshes if open)
  }

  /* A member changed the disappearing-message lifetime: update the open
     conversation's expiry note live so everyone always shows the same setting. */
  function onLiveDmTtl(m: any) {
    var v = forOpen(m);
    if (v && v.setTtl) v.setTtl(m.ttl);
  }

  /* A member edited a message: re-render that bubble live. */
  function onLiveDmEdit(m: any) {
    var v = forOpen(m);
    if (v && m.message && v.editMsg) v.editMsg(m.message);
  }

  /* A member deleted a message they sent: replace it with "<redacted>". */
  function onLiveDmRedact(m: any) {
    var v = forOpen(m);
    if (v && m.message && v.redactMsg) v.redactMsg(m.message.id);
  }

  /* A member reacted (or withdrew a reaction) on a message in the open
     conversation: repaint that bubble's pill. Quiet by design — no badge, no sound. */
  function onLiveDmReact(m: any) {
    var v = forOpen(m);
    if (v && m.message && v.reactMsg) v.reactMsg(m.message, m.from);
  }

  /* A member saved (or unsaved) a message in the open conversation: a save is
     for all, so the bubble lights (or dims) here too. */
  function onLiveDmSave(m: any) {
    var v = forOpen(m);
    if (v && m.message && v.saveMsg) v.saveMsg(m.message);
  }

  /* A member opened my messages: flip the open conversation's sent bubbles to
     ✓✓ once every other member has read them. m.reader is who. */
  function onLiveDmRead(m: any) {
    var v = forOpen(m);
    if (v && v.markRead) v.markRead(m.reader, m.at);
  }

  /* A member is (or stopped) typing — the line in the open conversation, and
     the inbox row's. */
  function onLiveTyping(m: any) {
    var v = forOpen(m);
    if (v && v.setTyping) v.setTyping(m.from, m.state !== 'stop');
  }

  /* The roster changed (someone was added, someone left) or the group was
     named: the open conversation follows, so the next word seals to the
     members as they are now. */
  function onLiveDmMembers(m: any) {
    var v = forOpen(m);
    if (v && v.roster) v.roster(m);
  }

  function onLiveDmName(m: any) {
    var v = forOpen(m);
    if (v && v.setName) v.setName(m.name);
  }

  /* A member's online state changed: update the open thread's header dot and any
     inbox row dot. */
  function onLivePresence(m: any) {
    if (state.dmView && state.dmView.other === m.hash && state.dmView.setPresence) state.dmView.setPresence(!!m.online);
    if (state.inboxPresence) state.inboxPresence(m.hash, !!m.online);
    if (state.profilePresence) state.profilePresence(m.hash, !!m.online);
  }

  /* ---- Direct messages ---- */

  function dmLabel(hash: any, nick: any) {
    var assigned = displayName(hash);
    return nick ? nick + ' (' + assigned + ')' : assigned;
  }

  /* Fuzzy score of one candidate string against the lowercased query:
     whole-prefix beats word-prefix beats substring beats subsequence. */
  function dmScore(q: any, name: any) {
    if (!name) return 0;
    var n = String(name).toLowerCase();
    if (n.indexOf(q) === 0) return 100;
    var words = n.split(/[\s-]+/);
    for (var i = 0; i < words.length; i++) if (words[i].indexOf(q) === 0) return 80;
    if (n.indexOf(q) !== -1) return 60;
    var j = 0;
    for (var k = 0; k < n.length && j < q.length; k++) if (n[k] === q[j]) j++;
    return j === q.length ? 30 : 0;
  }

  /* The Send-a-DM box with autocomplete. The member directory is fetched
     once per session at the third character; every keystroke after that is
     scored locally and costs no request. */
  function dmSearchBox() {
    var box = el('div', 'key-box dm-search');
    box.hidden = false;
    box.appendChild(el('p', 'key-note', 'New message: type a name to write to one member, or start a group with several.'));
    var row = el('div', 'key-row');
    var input = el('input', 'key-input');
    input.type = 'text';
    input.placeholder = 'To: a nickname or an assigned name';
    input.setAttribute('aria-label', 'To');
    row.appendChild(input);
    box.appendChild(row);
    var sug = el('div', 'dm-suggest');
    sug.hidden = true;
    box.appendChild(sug);
    var note = el('p', 'form-status');
    box.appendChild(note);
    var dir: any = null;
    var loading = false;
    var current: any[] = [];
    /* the list's index: 0 is the New group row, 1… the matching members */
    var sel = 0;
    var timer: any = null;
    /* New group (2026-09-13; the one list, the owner's ruling on the second
       look): pick the members and a name; the group opens with its first
       line, "You added …". */
    function openNewGroup() {
      dmMemberPicker({ title: 'New group', nameField: true, submitLabel: 'Create', exclude: [state.myHash], count: 1, host: box,
        onDone: function (hashes: string[], name: string) {
          return getToken().then(function (token) {
            return fetch(API + '/dm/groups', { method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ key: state.key, token: token, members: hashes, name: name || null }) }).then(function (r) { return r.json(); });
          }).then(function (d) {
            if (blockedOut(d)) return;
            if (!d || !d.ok) throw new Error((d && d.error) || 'The group could not be started.');
            go('messages.html?t=' + d.thread_id);
          }).finally(function () { if (window.turnstile && state.widgetId !== null) turnstile.reset(state.widgetId); });
        } });
    }
    function ensureDir(cb: any) {
      if (dir) return cb();
      if (loading) return;
      loading = true;
      fetch(API + '/dm/directory' + freshParam('?'))
        .then(function (r) { return r.json(); })
        .then(function (d) { loading = false; if (d.ok) { dir = d.users; cb(); } })
        .catch(function () { loading = false; note.textContent = 'The member list could not be loaded.'; });
    }
    /* ONE list a message starts from (WhatsApp's "New chat"): "New group" is
       its first row — there before a letter is typed and while the matches
       come in — and a member's row opens the pair. Two roads, one door. */
    function groupRow(selected: boolean) {
      var r = el('a', 'dm-suggest-row dm-suggest-group' + (selected ? ' dm-suggest-sel' : ''));
      r.href = '#';
      r.title = 'Start a group: pick several members';
      r.appendChild(el('span', null, '👥 New group'));
      r.appendChild(el('span', 'dm-suggest-go', 'pick members →'));
      r.addEventListener('mousedown', function (e: any) { e.preventDefault(); openNewGroup(); });
      return r;
    }
    function renderSug() {
      sug.textContent = '';
      sug.appendChild(groupRow(sel === 0));
      current.forEach(function (u, i) {
        var r = el('a', 'dm-suggest-row' + (i + 1 === sel ? ' dm-suggest-sel' : ''));
        r.href = 'messages.html?dm=' + u.hash;
        r.title = 'Open the conversation';
        r.appendChild(el('span', null, dmLabel(u.hash, u.nick)));
        r.appendChild(el('span', 'dm-suggest-go', 'message →'));
        r.addEventListener('mousedown', function (e: any) {
          e.preventDefault();
          go('messages.html?dm=' + u.hash);
        });
        sug.appendChild(r);
      });
      sug.hidden = false;
    }
    function suggest() {
      var q = input.value.trim().toLowerCase();
      if (q.length < 3) { current = []; renderSug(); return; }
      ensureDir(function () {
        current = dir
          .filter(function (u: any) { return u.hash !== state.myHash; })
          .map(function (u: any) {
            var s = Math.max(dmScore(q, u.nick), dmScore(q, displayName(u.hash)));
            return { u: u, s: s, label: dmLabel(u.hash, u.nick) };
          })
          .filter(function (x: any) { return x.s > 0; })
          .sort(function (x: any, y: any) { return y.s - x.s || (x.label < y.label ? -1 : 1); })
          .slice(0, 8)
          .map(function (x: any) { return x.u; });
        sel = current.length ? 1 : 0;   // Enter opens the best match; with none, the group
        note.textContent = current.length ? '' : 'No member matches that. Pick from the suggestions.';
        renderSug();
      });
    }
    input.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(suggest, 150);
    });
    input.addEventListener('focus', function () { renderSug(); });   // the list opens with the New group row before a letter is typed
    input.addEventListener('keydown', function (e: any) {
      if (sug.hidden) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(sel + 1, current.length); renderSug(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(sel - 1, 0); renderSug(); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        if (sel === 0) openNewGroup();
        else if (current[sel - 1]) go('messages.html?dm=' + current[sel - 1].hash);
      } else if (e.key === 'Escape') { sug.hidden = true; }
    });
    input.addEventListener('blur', function () {
      setTimeout(function () { sug.hidden = true; }, 200);   // a row's mousedown has run by then
    });
    return box;
  }

  /* An inbox row's name, door, key and target (2026-09-13): a pair by its
     other, a group by its name or its members' names, opened by its id. */
  function dmRowLabel(t: DmThreadsRow) {
    if (Number(t.kind) === 1) {
      if (t.name) return String(t.name);
      var names = (t.members || []).map(function (m: any) { return m.nick || m.assigned || displayName(m.hash); });
      return names.length ? names.join(', ') : 'Group';
    }
    return dmLabel(t.other_hash, t.nick);
  }

  function dmRowTarget(t: DmThreadsRow) { return t.thread_id ? { thread_id: t.thread_id } : { with: t.other_hash }; }

  function dmMembersLabel(t: DmThreadsRow) { var n = Number(t.member_count) || ((t.members || []).length + 1); return n + ' members'; }

  function viewInbox() {
    /* The Lit <mc-inbox> renders into its own subtree without clearing section,
       so a badge prepended here survives above the list. The Lit view is THE screen (2026-09-16): the bundle always stands — docs/nav.js
       injects it on every page and this boot waits for it — so the classic body that
       once stood in for it is gone; only the door remains. */
    section.appendChild(dmE2eBadge());
    return window.mcViews!.inbox(section, window.mcKit);
  }

  function bind() {
    API = B.API;
    badgeChanged = B.badgeChanged;
    blockedOut = B.blockedOut;
    bootSig = B.bootSig;
    displayName = B.displayName;
    el = B.el;
    freshParam = B.freshParam;
    getToken = B.getToken;
    go = B.go;
    onLiveNotif = B.onLiveNotif;
    readEase = B.readEase;
    readMark = B.readMark;
    readThrottled = B.readThrottled;
    renderIdentity = B.renderIdentity;
    section = B.section;
    state = B.state;
    dmE2eBadge = B.dmE2eBadge;
    dmMemberPicker = B.dmMemberPicker;
    playSound = B.playSound;
  }
  function run() {
    document.addEventListener('mc-live', function (ev) {
      var m = (ev as CustomEvent).detail; if (!m) return;
      if (m.t === 'dm') onLiveDm(m);
      else if (m.t === 'dm-ttl') onLiveDmTtl(m);
      else if (m.t === 'dm-edit') onLiveDmEdit(m);
      else if (m.t === 'dm-redact') onLiveDmRedact(m);
      else if (m.t === 'dm-react') onLiveDmReact(m);
      else if (m.t === 'dm-save') onLiveDmSave(m);
      else if (m.t === 'dm-read') onLiveDmRead(m);
      else if (m.t === 'dm-members') onLiveDmMembers(m);
      else if (m.t === 'dm-name') onLiveDmName(m);
      else if (m.t === 'typing') onLiveTyping(m);
      else if (m.t === 'presence') onLivePresence(m);
      else if (m.t === 'notification') onLiveNotif();
      else if (m.t === 'wall-post' || m.t === 'wall-comment') { if (state.onLiveWall) state.onLiveWall(m); }
    }, { signal: bootSig });
  }
  return { bind, run, exports: { DM_CACHE, dmCacheGet, dmCacheSet, dmLabel, dmMembersLabel, dmRowLabel, dmRowTarget, dmScore, dmSearchBox, dmSeenLabel, dmUnreadCheck, liveDmBadge, viewInbox } };
}
