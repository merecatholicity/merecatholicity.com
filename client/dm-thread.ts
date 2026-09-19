/* The chat screen: viewDm — the conversation, its header, the ⓘ sheet, the composer, reading back — and the 1v1 call button.
   Split out of client/dm.ts on 2026-09-16 (the six DM factories); every declaration
   moved verbatim. Names from the boot and the other modules are bound in bind(). */
import type { Boot } from './boot';

export function installDmThread(B: Boot) {
  /* Names this module takes from the boot — the root's helpers and the other
     modules' exports — bound in bind() once every module is installed, so
     order of installation never matters and every body reads as it did. */
  let API: string;
  let MERECAT_BOT_HASH: string;
  let appConfirm: (msg: any, opts: any, cb: any) => any;
  let attachDraft: (ta: any, ctx: string, titleInput?: any, overwrite?: boolean) => any;
  let attachEmoji: (textarea: any) => any;
  let attachMentions: (textarea: any) => any;
  let blockedOut: (d: any) => any;
  let bootSig: AbortSignal;
  let buildEmojiPanel: (textarea: any, onPick?: (it: any) => void) => any;
  let cachedJson: (url: any, init: any, ttl: any) => Promise<any>;
  let crumb: (parts: any) => any;
  let displayName: (hash: any) => any;
  let el: (tag: string, cls?: string | null, text?: string | number | null) => any;
  let fetchRetry: (url: string, opts: RequestInit | undefined, delays: number[], onRetry?: () => void) => Promise<Response>;
  let fillBody: (node: HTMLElement, text: any, plain?: boolean) => any;
  let getToken: () => Promise<any>;
  let go: (href: string, replace?: boolean) => any;
  let identityAction: (label: any, onClick: any) => any;
  let insertEmojiItem: (ta: any, it: any) => any;
  let mcDmBlobPut: (key: string, url: string, bytes: number) => void;
  let mcDmBlobs: { key: string; url: string; bytes: number }[];
  let mcIcon: (name: any) => any;
  let notifCacheSet: (n: any) => any;
  let mediaCfg: () => Promise<any>;
  let mediaGateFile: (f: any, cfg: any, sec: any, statusEl: any) => any;
  let pageBar: (total: number, per: number, curPage: number, hrefFor: ((n: number) => string) | null, onGo?: (n: number) => void) => HTMLElement | null;
  let profileHref: (hash: any) => any;
  let section: HTMLElement;
  let setBlock: (hash: any, on: any, done?: any) => any;
  let skeleton: (kind?: string) => any;
  let state: Record<string, any>;
  let trace: (why: string) => any;
  let utilBtnLabel: (btn: any, icon: string, word: string) => any;
  let voiceControl: (form: any, cfg: any, sec: any, statusEl: any, takeFile: any) => any;
  let warmOnFocus: (ta: any) => any;
  let DM_CACHE: string;
  let dmAvatarCell: (mm: unknown, cls: string) => any;
  let dmB64uEnc: (bytes: unknown) => any;
  let dmCollageInto: (host: unknown, rows: unknown[]) => any;
  let dmDayNode: (epoch: unknown) => any;
  let dmE2eExplainer: () => any;
  let dmExpiryNode: (target: unknown, ttl: unknown, isNew: unknown, onChange?: (t: number) => void) => any;
  let dmFlash: (target: unknown) => any;
  let dmLabel: (hash: unknown, nick: unknown) => any;
  let dmMakeRedacted: (node: unknown, mine: unknown) => any;
  let dmMarkEdited: (node: unknown) => any;
  let dmMediaEncryptFile: (file: unknown) => any;
  let dmMemberPicker: (opts: unknown) => any;
  let dmParseText: (plain: unknown) => any;
  let dmPlain: (m: unknown, ctx: unknown) => any;
  let dmQuoteText: (reply: unknown) => any;
  let dmReadByInfo: (m: unknown, ctx: unknown) => any;
  let dmRenderMsg: (m: unknown, ctx: unknown) => any;
  let dmReplyClean: (r: unknown) => any;
  let dmReplyRef: (m: unknown) => any;
  let dmSaveEdit: (m: unknown, node: unknown, ctx: unknown, nv: string) => Promise<any>;
  let dmSealFor: (plaintext: unknown, members: unknown) => any;
  let dmSeenLabel: (epoch: unknown) => any;
  let dmSeenPing: (target: unknown) => any;
  let dmTtlLabel: (ttl: unknown) => any;
  let dmUnreadCheck: (force?: boolean) => any;
  let dmVerified: (other: unknown) => any;
  let dmVerifyPanel: (other: unknown, otherPubB64: unknown, link: unknown) => any;
  let dmWrapText: (text: unknown, reply: unknown, fwd?: unknown) => any;
  let ensureDmStyles: () => any;
  let ensureNacl: () => Promise<any>;
  let fmtBytes: (n: unknown) => any;
  let fmtTimeCompact: (epoch: unknown) => string;
  let liveDmBadge: () => any;
  let myDmKeypair: () => any;
  let swipeDismissesKeyboard: (ta: unknown, composer: unknown) => any;

  function callsCfg(): Promise<{ enabled: boolean }> {
    return cachedJson(API + '/config', undefined, 300000)
      .then(function (d: any) { return { enabled: !(d && d.ok && d.calls && d.calls.enabled === false) }; })
      .catch(function () { return { enabled: true }; });   // server refuses regardless
  }

  function placeCall(other: string, label: string) {
    var mc: any = (window as any).mcCall;
    if (mc && mc.place) mc.place(other, label);
  }

  function callButton(other: string, label: string) {
    var b = utilBtnLabel(el('button', 'btn btn-attach mc-call-btn'), '📞', 'Call');
    b.type = 'button';
    b.title = 'Voice call (end-to-end encrypted)';
    b.addEventListener('click', function () { placeCall(other, label); });
    return b;
  }

  /* The conversation: a chat SCREEN (WhatsApp-shaped, the owner's 2026-09-11
     ruling). A sticky header — the correspondent's avatar, name (the app bar
     carries it on phones), a subtitle that reads Online / typing… / the lock,
     the call button, and ⓘ — over the messages, with a sticky composer at the
     foot: + attach, the rounded field with its emoji button, the mic that
     becomes Send the moment there is something to send. Everything about the
     conversation that is not a message — encryption and the safety number,
     the disappearing-message lifetime, block, delete — lives in the ⓘ sheet
     (tap the header, the ⓘ, or the ⏳ chip); the thread itself is only words. */
  function iconBtn(name: string, label: string, cls: string) {
    var b = el('button', cls);
    b.type = 'button';
    b.title = label;
    b.setAttribute('aria-label', label);
    b.appendChild(mcIcon(name));
    return b;
  }

  function viewDm(target: any) {
    /* A conversation by its id (messages.html?t=<id>, the only door a group
       has and the resolved form of a pair's) or a pair by its other (?dm=<hash>,
       the door every "Message" button and older bell still uses; a room not
       yet made is an empty one). */
    var other = '', threadWant = 0;
    if (typeof target === 'string') other = String(target);
    else if (target && typeof target === 'object') { other = String(target.with || ''); threadWant = Math.floor(Number(target.thread) || 0); }
    if (!threadWant && !/^[0-9a-f]{64}$/.test(other)) {
      crumb([['Community', 'community.html'], ['Messages']]);
      section.appendChild(el('p', 'comments-status', 'No such member.'));
      return;
    }
    if (!state.key) {
      crumb([['Community', 'community.html'], ['Messages']]);
      section.appendChild(el('p', 'comments-status', 'Messages need an identity. Create one on the board front page.'));
      return;
    }
    if (other && other === state.myHash) {
      crumb([['Community', 'community.html'], ['Messages']]);
      section.appendChild(el('p', 'comments-status', 'That would be a soliloquy. Pick another member.'));
      return;
    }
    var qs = new URLSearchParams(location.search);
    var pNum = Math.floor(Number(qs.get('p')) || 0);
    /* A reaction's bell lands on the very message (2026-09-12): ?m=<id> asks
       the server for that message's page (find=) and is scrolled to on arrival. */
    var mWant = Math.floor(Number(qs.get('m')) || 0);
    var payload: any = { key: state.key };
    if (threadWant) payload.thread_id = threadWant; else payload.with = other;
    if (pNum > 0) payload.p = pNum;
    else if (mWant > 0) payload.find = mWant;
    /* Same as viewTopic: this rendered nothing at all until the thread AND the
       crypto library had both arrived — the longest blank wait in the app. */
    crumb([['Community', 'community.html'], ['Messages', 'messages.html'], ['Conversation']]);
    section.appendChild(skeleton());
    Promise.all([
      ensureNacl(),
      fetchRetry(API + '/dm/thread', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }, [1000, 3000]).then(function (r) { return r.json(); }),
    ])
      .then(function (res) {
        var d = res[1];
        if (!d.ok) throw new Error(d.error || (d.status === 404 ? 'gone' : 'failed'));
        section.textContent = '';        // drop the placeholder crumb + skeleton
        /* The thread is a chat screen, not a document: under (hover:none)
           nothing on it is selectable text but the fields (ensureDmStyles) — a
           hold picks a message. The class leaves with the boot, so the next
           view on this section is a document again. */
        section.classList.add('dm-screen');
        bootSig.addEventListener('abort', function () { section.classList.remove('dm-screen'); }, { once: true });
        ensureDmStyles();
        /* The conversation and its members (0016): each member's published key
           — what a word is sealed to, what a word from them is opened with —
           their names, their read stamps. A room not yet made lists its two.
           A thread reached by its id learns its pair's other from the roster. */
        var thr = d.thread || null;
        var threadId = Math.floor(Number(d.thread_id || (thr && thr.id) || 0)) || 0;
        var kind = thr ? (Number(thr.kind) || 0) : 0;
        var members: any[] = (thr && Array.isArray(thr.members)) ? thr.members.slice() : [];
        if (!members.length && d.other) {
          members = [{ hash: state.myHash, nick: null, avatar: null, assigned: displayName(state.myHash), pubkey: dmB64uEnc(myDmKeypair().publicKey) }, d.other];
        }
        /* WHO AM I, and WHICH WORDS ARE MINE — the server's word first (it
           resolved the key; it does not guess), the id comparison only as a
           fallback for a payload cached before the server started saying so.
           The comparison was the whole answer until 2026-09-19, and when the
           ids changed shape under it the reader became a stranger to their own
           conversation: their own name in the title, every bubble drawn as the
           other party's, a pair's E1 words unopenable. No fallback comparison
           remains on purpose — one would be the very inference this removes,
           and it cannot be needed: every member row and every message carries
           the flag either way (1 or 0, never absent), the thread payload is
           fetched fresh and never cached, and Workers deploys ahead of Pages,
           so a page this new always meets a worker that marks. */
        type Marked = { is_me?: unknown; mine?: unknown };
        function isMe(mm: Marked) { return !!mm.is_me; }
        function mineMsg(mo: Marked) { return !!mo.mine; }
        var byHash: Record<string, any> = {};
        members.forEach(function (mm: any) { if (mm && mm.hash) byHash[mm.hash] = mm; });
        if (kind === 0 && !other) members.forEach(function (mm: any) { if (!isMe(mm) && !mm.left_at) other = mm.hash; });
        var otherRow = other ? (byHash[other] || d.other || null) : null;
        /* The correspondent's public key drives both decrypt and encrypt of a
           pair's E1 words (the shared secret is the same in both directions). */
        var otherPub = (otherRow && otherRow.pubkey) || null;
        function nameOf(h: any) { var r = byHash[String(h)]; return r ? (r.nick || r.assigned || displayName(String(h))) : displayName(String(h || '')); }
        function othersNames() { return members.filter(function (mm: any) { return !isMe(mm) && !mm.left_at; }).map(function (mm: any) { return nameOf(mm.hash); }); }
        var label = kind === 1 ? ((thr && thr.name) || othersNames().join(', ') || 'Group') : dmLabel(other, otherRow && otherRow.nick);
        var shortName = kind === 1 ? label : ((otherRow && otherRow.nick) || displayName(other));
        document.title = shortName + ' | Inbox';
        crumb([['Community', 'community.html'], ['Inbox', 'messages.html'], [shortName]]);
        /* The resolved door: a pair opened by its other takes its id in the
           address (never a navigation — that re-boots), so a reload, a share
           and the badge all speak of the same conversation. */
        function dmPageHref(i: any) { return (threadId ? 'messages.html?t=' + threadId : 'messages.html?dm=' + other) + '&p=' + i; }
        function adoptUrl() {
          if (!threadId || !qs.get('dm')) return;
          var u = 'messages.html?t=' + threadId + (pNum > 0 ? '&p=' + pNum : '') + (mWant > 0 ? '&m=' + mWant : '') + location.hash;
          try { history.replaceState(history.state, '', u); } catch (e) { /* the door still works */ }
        }
        adoptUrl();
        var curTtl = Number(d.ttl) || 2592000;   // Domain.Dm.defaultTtl
        var isNew = !d.messages.length;
        /* ---- the header ---- */
        var headEl = el('div', 'dm-head');
        var avatarLink = el('a', 'dm-head-avatar');
        if (other) avatarLink.href = profileHref(other);
        avatarLink.setAttribute('aria-label', 'Profile');
        function avatarInto(host: any, size: number) {
          if (kind === 1) { dmCollageInto(host, members.filter(function (mm: any) { return !mm.left_at && !isMe(mm); })); return; }
          if (otherRow && otherRow.avatar) {
            var im = el('img', 'dm-head-img');
            im.src = API + '/avatar?hash=' + other + '&v=' + encodeURIComponent(otherRow.avatar);
            im.alt = ''; im.width = size; im.height = size;
            host.appendChild(im);
          } else host.appendChild(el('span', 'dm-head-initial', (shortName.charAt(0) || '?').toUpperCase()));
        }
        avatarInto(avatarLink, 40);
        headEl.appendChild(avatarLink);
        var headText = el('button', 'dm-head-text');
        headText.type = 'button';
        headText.title = 'Conversation info';
        headText.appendChild(el('span', 'dm-head-name', label));
        var sub = el('span', 'dm-head-sub');
        headText.appendChild(sub);
        headEl.appendChild(headText);
        var acts = el('div', 'dm-head-acts');
        headEl.appendChild(acts);
        section.appendChild(headEl);
        /* presOn: null until the hub seeds it (then the lock line stands), true
           = Online, false = Offline — which is also what a member who chose
           "appear offline" reads as; the hub honours that before it answers. */
        var presOn: boolean | null = null, typingOn = false, typingHideT: any = 0;
        /* who is typing, by hash (a group names them; a pair's line is just "typing…") */
        var typists: Record<string, any> = {};
        function typistLine() {
          var names = Object.keys(typists).map(nameOf);
          if (kind === 0 || !names.length) return 'typing…';
          return (names.length > 2 ? names.slice(0, 2).join(', ') + ' and ' + (names.length - 2) + ' others' : names.join(' and ')) + (names.length > 1 ? ' are typing…' : ' is typing…');
        }
        /* The stamp the thread arrived with (null for a member who hides their
           presence); a live offline is "just now". Repainted each minute so
           "3 min ago" keeps time; the timer dies with the boot. */
        var seenAt: number = Number((d.other && d.other.last_seen) || 0);
        function paintSub() {
          sub.textContent = '';
          if (typingOn) { sub.appendChild(el('span', 'dm-sub-typing', typistLine())); return; }
          if (kind === 1) { sub.appendChild(document.createTextNode(members.filter(function (mm: any) { return !mm.left_at; }).length + ' members · 🔒')); return; }
          if (presOn === true) { sub.appendChild(el('span', 'dm-dot dm-dot-on')); sub.appendChild(document.createTextNode('Online')); return; }
          if (presOn === false) {
            sub.appendChild(el('span', 'dm-dot dm-dot-off'));
            sub.appendChild(document.createTextNode(seenAt ? 'Last seen ' + dmSeenLabel(seenAt) : 'Offline'));
            return;
          }
          sub.appendChild(document.createTextNode('🔒 End-to-end encrypted'));
        }
        paintSub();
        var seenTick = setInterval(function () { if (presOn === false && seenAt) paintSub(); }, 60000);
        bootSig.addEventListener('abort', function () { clearInterval(seenTick); }, { once: true });
        /* ---- conversation info: the sheet behind the header, the ⓘ and the ⏳ chip ---- */
        var infoExpiry: any = null;
        function infoNode() {
          var box = el('div', 'dm-info');
          var card = el('div', 'dm-info-card');
          var big = el('div', 'dm-info-avatar');
          avatarInto(big, 72);
          card.appendChild(big);
          card.appendChild(el('div', 'dm-info-name', label));
          if (other) {
            var pl = el('a', 'dm-info-link', 'View profile');
            pl.href = profileHref(other);
            card.appendChild(pl);
          }
          box.appendChild(card);
          var enc = el('div', 'dm-info-row');
          enc.appendChild(el('div', 'dm-info-row-title', '🔒 End-to-end encrypted'));
          var encP = el('p', 'dm-info-row-text');
          encP.appendChild(document.createTextNode('Messages here are encrypted on your own device; we hold only ciphertext. '));
          var how = el('a', null, 'How it works');
          how.href = '#';
          how.addEventListener('click', function (ev: any) { ev.preventDefault(); dmE2eExplainer(); });
          encP.appendChild(how);
          if (kind === 0 && otherPub) {
            encP.appendChild(document.createTextNode(' · '));
            var v = el('a', null, dmVerified(other) ? '✓ verified' : 'Verify safety number');
            v.href = '#';
            v.addEventListener('click', function (ev: any) { ev.preventDefault(); dmVerifyPanel(other, otherPub, v); });
            encP.appendChild(v);
          }
          enc.appendChild(encP);
          box.appendChild(enc);
          /* The members (2026-09-13): who is here, online or not, each with
             the safety number to verify; Add members (a pair forks into a new
             group — Snapchat's and WhatsApp's way, its private history stays);
             Leave, for a group. */
          if (threadId) {
            var mem = el('div', 'dm-info-row');
            var cur = ctx.current();
            mem.appendChild(el('div', 'dm-info-row-title', '👥 ' + (kind === 1 ? cur.length + ' members' : 'Members')));
            if (kind === 1) {
              var mlist = el('div', 'dm-members');
              var dots: Record<string, any> = {};
              cur.forEach(function (mm: any) {
                var mrow = el('div', 'dm-member-row');
                mrow.appendChild(dmAvatarCell(mm, 'dm-member-av'));
                var nm = el('a', 'dm-member-name', isMe(mm) ? 'You' : nameOf(mm.hash));
                nm.href = profileHref(mm.hash);
                mrow.appendChild(nm);
                var dot = el('span', 'dm-row-dot'); dot.hidden = true; dots[mm.hash] = dot;
                mrow.appendChild(dot);
                var macts = el('span', 'dm-member-acts');
                if (!isMe(mm) && mm.pubkey) {
                  var v2 = el('a', null, dmVerified(mm.hash) ? '✓ verified' : 'verify');
                  v2.href = '#';
                  v2.addEventListener('click', function (ev: any) { ev.preventDefault(); dmVerifyPanel(mm.hash, mm.pubkey, v2); });
                  macts.appendChild(v2);
                }
                if (!isMe(mm)) {
                  var bl = el('a', null, 'block');
                  bl.href = '#'; bl.title = 'Block this member: their words here are hidden from you, and their posts and profile too';
                  bl.addEventListener('click', function (ev: any) {
                    ev.preventDefault();
                    appConfirm('Block ' + nameOf(mm.hash) + '? Their words in this conversation are hidden from you (they are never told), and their posts and profile are hidden from you.', { okLabel: 'Block', danger: true }, function (ok: any) {
                      if (ok) setBlock(mm.hash, true, function () { location.reload(); });
                    });
                  });
                  macts.appendChild(bl);
                }
                mrow.appendChild(macts);
                mlist.appendChild(mrow);
                /* HOW FAR EACH MEMBER HAS READ, in words (2026-09-19). The
                   thread's own marker is drawn against the last word a member
                   read that they did not write themselves — so in a
                   conversation where one person has done all the talking, it
                   has nothing to say and everybody else sees no read state at
                   all. That is correct and it reads as broken. Here there is
                   room to say it plainly, for every member, whether or not
                   they have spoken. `read_at` is already withheld by the
                   server for anyone whose receipts are off, so showing it
                   honours the reciprocal rule without re-deciding it. */
                if (!isMe(mm)) {
                  var rl = el('div', 'dm-member-read dm-fwd-sub');
                  rl.textContent = mm.read_at ? ('Read ' + fmtTimeCompact(mm.read_at))
                    : mm.receipts === 0 ? 'Read receipts off' : 'Not read yet';
                  mlist.appendChild(rl);
                }
              });
              mem.appendChild(mlist);
              /* one batched presence read for the sheet (a group holds no live presence subs) */
              var hashesFor = cur.map(function (mm: any) { return mm.hash; }).filter(function (h: string) { return h !== state.myHash; });
              if (hashesFor.length) {
                fetch(API + '/dm/presence', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: state.key, hashes: hashesFor }) })
                  .then(function (r) { return r.json(); })
                  .then(function (pd) {
                    if (!(pd && pd.ok && Array.isArray(pd.online))) return;
                    hashesFor.forEach(function (h: string) { var dt = dots[h]; if (!dt) return; dt.className = 'dm-row-dot' + (pd.online.indexOf(h) !== -1 ? ' on' : ''); dt.title = pd.online.indexOf(h) !== -1 ? 'Online' : 'Offline'; dt.hidden = false; });
                  }).catch(function () { /* no dots, no harm */ });
              }
            }
            mem.appendChild(identityAction('Add members', function () {
              dmMemberPicker({ title: 'Add members', submitLabel: 'Add', exclude: members.filter(function (mm: any) { return !mm.left_at; }).map(function (mm: any) { return mm.hash; }), count: cur.length, host: section,
                onDone: function (hashes: string[]) {
                  return getToken().then(function (token) {
                    return fetch(API + '/dm/members', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ key: state.key, token: token, thread_id: threadId, add: hashes }) }).then(function (r) { return r.json(); });
                  }).then(function (d) {
                    if (blockedOut(d)) return;
                    if (!d || !d.ok) throw new Error((d && d.error) || 'They could not be added.');
                    /* the actor is not fanned to: reopen the conversation as it now stands (a pair's fork opens the new group) */
                    go('messages.html?t=' + (d.thread_id || threadId));
                  }).finally(function () { if (window.turnstile && state.widgetId !== null) turnstile.reset(state.widgetId); });
                } });
            }));
            if (kind === 1) {
              mem.appendChild(identityAction('Leave conversation', function () {
                appConfirm('Leave this conversation? You will see nothing further from it; the others keep it.', { okLabel: 'Leave', danger: true }, function (ok: any) {
                  if (!ok) return;
                  fetch(API + '/dm/leave', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: state.key, thread_id: threadId }) })
                    .then(function (r) { return r.json(); })
                    .then(function (d) { if (d && d.ok) { try { localStorage.removeItem(DM_CACHE); } catch (e) { /* fine */ } go('messages.html'); } else ctx.note((d && d.error) || 'Could not leave.'); })
                    .catch(function () { ctx.note('Network error. Try again.'); });
                });
              }));
            }
            box.appendChild(mem);
            if (kind === 1) {
              var nmRow = el('div', 'dm-info-row');
              nmRow.appendChild(el('div', 'dm-info-row-title', '✎ Name'));
              var nrow = el('div', 'key-row');
              var nin = el('input', 'key-input');
              nin.type = 'text'; nin.value = (thr && thr.name) || ''; nin.placeholder = 'Name this conversation'; nin.setAttribute('aria-label', 'Conversation name');
              nin.maxLength = (window.mcCore && window.mcCore.dmGroupNameMax) || 60;
              var nbtn = el('button', 'btn', 'Save'); nbtn.type = 'button';
              nbtn.addEventListener('click', function () {
                var v = nin.value.trim();
                if (!v) return;
                nbtn.disabled = true;
                fetch(API + '/dm/name', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: state.key, thread_id: threadId, name: v }) })
                  .then(function (r) { return r.json(); })
                  .then(function (d) { nbtn.disabled = false; if (d && d.ok) { state.dmView.setName(d.name); ctx.note('Named.'); } else ctx.note((d && d.error) || 'Could not name it.'); })
                  .catch(function () { nbtn.disabled = false; ctx.note('Network error. Try again.'); });
              });
              nrow.appendChild(nin); nrow.appendChild(nbtn);
              nmRow.appendChild(nrow);
              box.appendChild(nmRow);
            }
          }
          var dis = el('div', 'dm-info-row');
          dis.appendChild(el('div', 'dm-info-row-title', '⏳ Disappearing messages'));
          infoExpiry = dmExpiryNode(ctx.target(), curTtl, isNew, function (t: number) { curTtl = t; isNew = false; paintNote(); });
          dis.appendChild(infoExpiry);
          box.appendChild(dis);
          /* The quiet exit — the ONE block (unified 2026-08-03): messages held
             out of sight AND their posts/profile hidden from your view. */
          var dz = el('div', 'dm-info-row dm-info-danger');
          if (kind === 0) {
            dz.appendChild(identityAction(d.blocked ? 'Unblock this member' : 'Block this member', function () {
              var blocking = !d.blocked;
              var doBlock = function () { setBlock(other, blocking, function () { location.reload(); }); };
              if (blocking) appConfirm('Block this member? Their future messages are held out of your sight (they are never told), and their posts and profile are hidden from you. Unblocking undoes all of it and delivers everything they wrote meanwhile.', { okLabel: 'Block', danger: true }, function (ok: any) { if (ok) doBlock(); });
              else doBlock();
            }));
          }
          dz.appendChild(identityAction('Delete conversation', function () {
            appConfirm('Delete this conversation? It is cleared from your inbox; the other members keep their copies until they delete it too.', { okLabel: 'Delete', danger: true }, function (ok: any) {
              if (!ok) return;
              fetch(API + '/dm/delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(Object.assign({ key: state.key }, ctx.target())),
              }).then(function (r) { return r.json(); }).then(function (d3) {
                if (d3.ok) { try { localStorage.removeItem(DM_CACHE); } catch (e) {} go('messages.html'); }
              }).catch(function () {});
            });
          }));
          box.appendChild(dz);
          return box;
        }
        function openInfo() {
          var node = infoNode();
          if (window.mcSheet) { window.mcSheet.open(shortName, node, function () { infoExpiry = null; }); return; }
          /* No shell: the same panel folds out under the header. */
          var old = section.querySelector('.dm-info-inline');
          if (old) { old.remove(); infoExpiry = null; return; }
          node.classList.add('dm-info-inline');
          headEl.parentNode.insertBefore(node, headEl.nextSibling);
        }
        headText.addEventListener('click', openInfo);
        var infoBtn = iconBtn('info', 'Conversation info', 'dm-head-btn dm-head-info');
        infoBtn.addEventListener('click', openInfo);
        acts.appendChild(infoBtn);
        /* Opening marked it read on the server; make the badge tell the
           same story on the next paint. */
        try { localStorage.removeItem(DM_CACHE); } catch (e) {}
        dmUnreadCheck();
        /* ---- the messages ---- */
        var list = el('div', 'comments-list dm-list');
        var note = el('button', 'dm-note');
        note.type = 'button';
        function paintNote() { note.textContent = '⏳ Messages disappear ' + dmTtlLabel(curTtl) + ' after they are opened'; }
        paintNote();
        note.addEventListener('click', openInfo);
        list.appendChild(note);
        var dmPages = Math.max(1, Math.ceil(d.total / d.per));
        function dmHref(i: any) { return dmPageHref(i); }
        var topBar = pageBar(d.total, d.per, d.page, dmHref);
        if (topBar) list.appendChild(topBar);   // earlier pages are above; the newest word is at the foot
        section.appendChild(list);
        if (!d.messages.length) {
          list.appendChild(el('p', 'comments-status', 'No messages yet. Say the first word.'));
        }
        /* Everything a rendered bubble needs to act: the correspondent, the
           pair's key, the list it lives in (a quote jumps within it), the
           messages by id (a live edit updates the object a menu reads), the
           reply hook the composer owns below, and a word of feedback. */
        var ctx: any = { threadId: threadId, kind: kind, members: members, byHash: byHash,
          other: other, otherHash: other, otherPub: otherPub, shortName: shortName, list: list, byId: {},
          pubOf: function (h: any) { var r = byHash[String(h)]; return (r && r.pubkey) || null; },
          nameOf: nameOf,
          current: function () { return members.filter(function (mm: any) { return !mm.left_at; }); },
          target: function () { return threadId ? { thread_id: threadId } : { with: other }; },
          reply: function () {},
          note: function (t: string) { status.textContent = t; if (window.mcToast) window.mcToast(t); } };
        /* Who a word of mine seals to, and who my keystrokes reach: every current member but me. */
        function recipients() { return ctx.current().map(function (mm: any) { return mm.hash; }).filter(function (h: string) { return h !== state.myHash; }); }
        /* Read receipts: my own bubbles carry ✓ until the other opens them
           (opened_at is set at load, or a live dm-read event flips them to ✓✓).
           Only my sent messages carry one; it rides the bubble's meta row. */
        var receipts: any[] = [];
        /* ✓✓ once every other current member's read stamp reaches the word
           (Domain.Dm.readByAll — the members' read_at ride the thread and the
           live dm-read frames); a pair's opened_at, one deploy, says the same. */
        /* the members whose reads can be waited for: one who hides theirs sends no stamp */
        function reporting() { return ctx.current().filter(function (mm: any) { return mm.receipts !== 0 && mm.receipts !== '0'; }); }
        function seenByAll(m: any) {
          if (window.mcCore && window.mcCore.dmReadByAll && window.mcCore.dmReadByAll(m.created_at, state.myHash, reporting())) return true;
          return kind === 0 && !!m.opened_at;
        }
        function tickTitle(seen: boolean) {
          if (kind === 1) return seen ? 'Read by everyone · tap for who' : 'Delivered · tap for who has read';
          return seen ? 'Seen' : 'Delivered';
        }
        function addReceipt(node: any, m: any) {
          if (String(m.sender_hash) !== state.myHash) return;
          if (node.classList && node.classList.contains('dm-call-line')) return;   // a call's line is not a sent word: no receipt
          if (state.prefs && state.prefs.receipts === 'off') return;   // reciprocal: I send none AND see none
          var seen = seenByAll(m);
          var r = el('span', 'dm-receipt' + (seen ? ' dm-receipt-seen' : '') + (kind === 1 ? ' dm-receipt-tap' : ''), seen ? '✓✓' : '✓');
          r.title = tickTitle(seen);
          r.setAttribute('aria-label', r.title);
          /* In a group the tick is the door to who has read (2026-09-15). */
          if (kind === 1) { r.setAttribute('role', 'button'); r.tabIndex = 0; r.addEventListener('click', function (e: any) { e.stopPropagation(); dmReadByInfo(m, ctx); }); }
          var meta = node.querySelector(':scope > .dm-meta');
          (meta || node).appendChild(r);
          receipts.push({ created: Number(m.created_at) || 0, span: r, m: m });
        }
        function renderMsg(m: any) { var n = dmRenderMsg(m, ctx); addReceipt(n, m); return n; }
        /* Bubbles land under a day chip — Today, Yesterday, a date — whenever
           the day changes, so each bubble's meta carries only the time. */
        var lastDay = '', lastSender = '';
        function placeMsg(m: any) {
          var empty = list.querySelector(':scope > .comments-status');
          if (empty) empty.remove();   // the first word retires "No messages yet"
          var day = new Date((Number(m.created_at) || 0) * 1000).toDateString();
          if (day !== lastDay) { list.appendChild(dmDayNode(m.created_at)); lastDay = day; lastSender = ''; }
          /* a group names another's bubble once per run of the same sender */
          m._author = kind === 1 && String(m.sender_hash) !== state.myHash && lastSender !== String(m.sender_hash);
          lastSender = String(m.sender_hash || '');
          var n = renderMsg(m);
          list.appendChild(n);
          return n;
        }
        d.messages.forEach(function (m: any) { placeMsg(m); });
        /* Seen-by markers (a group, 2026-09-15; Messenger's and Snapchat's
           way): each other member's small face sits under the last word they
           have read — their stamp's watermark — and moves down live as they
           read. Never under their own word (they wrote it: implied), never for
           a member who hides their reads (no stamp comes), never in a pair
           (the ticks say it there). */
        function paintSeen() {
          if (kind !== 1) return;
          Array.prototype.forEach.call(list.querySelectorAll(':scope > .dm-seen-row'), function (n: any) { n.remove(); });
          var bubbles: any[] = Array.prototype.filter.call(list.querySelectorAll(':scope > [data-dmid]'), function (n: any) { return !!ctx.byId[n.getAttribute('data-dmid')]; });
          if (!bubbles.length) return;
          var under: Record<string, any[]> = {};
          ctx.current().forEach(function (mm: any) {
            if (isMe(mm) || !mm.read_at) return;
            var at = Number(mm.read_at) || 0, target: any = null;
            for (var i = bubbles.length - 1; i >= 0; i--) {
              var mo = ctx.byId[bubbles[i].getAttribute('data-dmid')];
              if (Number(mo.created_at) <= at) { target = mo.sender_hash === mm.hash ? null : bubbles[i]; break; }
            }
            if (!target) return;
            var key = target.getAttribute('data-dmid');
            (under[key] = under[key] || []).push(mm);
          });
          Object.keys(under).forEach(function (key) {
            var b = list.querySelector(':scope > [data-dmid="' + key + '"]');
            if (!b) return;
            var row = el('div', 'dm-seen-row');
            row.title = 'Seen by ' + under[key].map(function (mm: any) { return nameOf(mm.hash); }).join(', ');
            row.setAttribute('aria-label', row.title);
            under[key].slice(0, 6).forEach(function (mm: any) { row.appendChild(dmAvatarCell(mm, 'dm-seen-av')); });
            if (under[key].length > 6) row.appendChild(el('span', 'dm-seen-more', '+' + (under[key].length - 6)));
            b.parentNode.insertBefore(row, b.nextSibling);
          });
        }
        paintSeen();
        /* What this page actually weighs. A killed web view leaves no pagehide
           and no error, so the crumb ring can only say the app died — never
           how much it was carrying. Now it says. */
        trace('dm thread: ' + d.messages.length + ' msgs, '
          + d.messages.filter(function (m: any) { return m.media_key; }).length + ' attachments, '
          + mcDmBlobs.length + ' blobs held');
        /* The newest word sits at the foot, just above the composer. The foot
           of the THREAD — the last bubble against the fixed bar — never of the
           document: on desktop the footer follows the thread and must stay
           below the bar, not be pulled up into view (the owner's report,
           2026-09-11). The spacer stands behind the bar; its top is where the
           bubbles end. (spacer and form are the composer's, built below.) */
        function endGap() { return spacer.getBoundingClientRect().top - (form.getBoundingClientRect().top - 8); }
        function scrollToEnd(smooth?: boolean) {
          var delta = endGap();
          if (delta <= 0) return;
          try { window.scrollBy({ top: delta, left: 0, behavior: (smooth ? 'smooth' : 'instant') as any }); } catch (e) { window.scrollBy(0, delta); }
        }
        function nearEnd() { return endGap() < 240; }
        /* Reading back is never interrupted, and never blind (2026-09-11): a
           word that lands while the foot is out of view stays put under an
           "N unread messages" line, the jump button above the composer carries
           the count, and "seen" goes out only for words the reader actually
           reached — at the foot when they arrived, or when the reader comes
           down to them. pending: what the button counts; unseenLive: the live
           words no seen ping has covered yet. */
        var pending = 0, unseenLive = 0, unreadLine: any = null;
        function unreadText(n: number) { return n === 1 ? '1 unread message' : n + ' unread messages'; }
        function setUnreadLine(n: number, before: any) {
          if (unreadLine) unreadLine.remove();
          unreadLine = el('div', 'dm-unread-line', unreadText(n));
          unreadLine.setAttribute('role', 'separator');
          list.insertBefore(unreadLine, before);
        }
        function bumpUnreadLine(n: number) { if (unreadLine) unreadLine.textContent = unreadText(n); }
        var jump: any = null, jumpN: any = null, jumpRaf = 0;
        function updateJump() {
          if (!jump) return;
          var away = !nearEnd();
          jump.hidden = !away;
          if (!away) {
            pending = 0;
            if (unseenLive) { unseenLive = 0; dmSeenPing(ctx.target()); }   // reached: now they are seen
          }
          jumpN.hidden = !pending;
          jumpN.textContent = pending > 99 ? '99+' : String(pending);
        }
        window.addEventListener('scroll', function () {
          if (jumpRaf) return;
          jumpRaf = requestAnimationFrame(function () { jumpRaf = 0; updateJump(); });
        }, { passive: true, signal: bootSig } as any);
        /* The other party's keystrokes, in the thread itself: a bubble of three
           dots at the foot while they type (kept in view when the foot is), and
           the header's line for a reader who is scrolled back. */
        var typingNode: any = null;
        function typingBubble(on: boolean) {
          if (on && !typingNode) {
            typingNode = el('div', 'dm-msg dm-typing-bubble');
            typingNode.setAttribute('aria-label', 'typing');
            for (var i = 0; i < 3; i++) typingNode.appendChild(el('span', 'dm-typing-dot'));
            var wasNear = nearEnd();
            list.appendChild(typingNode);
            if (wasNear) scrollToEnd();
          } else if (!on && typingNode) { typingNode.remove(); typingNode = null; }
        }
        /* Live drop-in + presence/typing/receipt updates for this open thread.
           A message pushed over the private user scope from THIS other party lands
           at once (their own echo is ignored); presence and typing paint the
           header's subtitle; dm-read flips my bubbles to ✓✓. */
        /* The room gained its id (the first word of a pair): the door, the
           on-screen claim and every later write follow it. */
        function adopt(id: any) {
          var n = Math.floor(Number(id) || 0);
          if (!n || threadId) return;
          threadId = n; ctx.threadId = n; state.dmView.threadId = n;
          adoptUrl(); resub();
        }
        function resub() {
          if (!(window.mcLive && window.mcLive.board)) return;
          var subs: string[] = threadId ? ['dmview:t' + threadId] : [];
          if (kind === 0 && other) { subs.push('presence:' + other); if (!threadId) subs.push('dmview:' + other); }
          window.mcLive.board.sub(subs);
        }
        function setTypist(h: any, on: boolean) {
          var k = String(h || '');
          if (!k || k === state.myHash) return;
          clearTimeout(typists[k]);
          if (on) typists[k] = setTimeout(function () { delete typists[k]; state.dmView.setTyping(k, false); }, 6000);
          else delete typists[k];
        }
        state.dmView = { other: other, threadId: threadId, kind: kind, adopt: adopt,
          setTtl: function (t: any) { curTtl = Number(t) || curTtl; isNew = false; paintNote(); if (infoExpiry && infoExpiry.mcSetTtl) infoExpiry.mcSetTtl(t); },
          setPresence: function (on: any) {
            if (presOn === true && !on && seenAt !== -1) seenAt = Math.floor(Date.now() / 1000);   // went offline before our eyes
            presOn = !!on; paintSub();
          },
          setTyping: function (from: any, on: any) {
            setTypist(from, !!on);
            clearTimeout(typingHideT);
            typingOn = Object.keys(typists).length > 0; paintSub(); typingBubble(typingOn);
          },
          /* A member read up to `at`: their stamp moves, and every sent bubble
             every other member has now reached flips to ✓✓. */
          markRead: function (reader: any, at: any) {
            var t = Number(at) || 0, r = byHash[String(reader)];
            if (r) r.read_at = Math.max(Number(r.read_at || 0), t);
            receipts.forEach(function (rc) {
              if (seenByAll(rc.m) || (kind === 0 && rc.created <= t)) {
                rc.span.textContent = '✓✓'; rc.span.title = tickTitle(true); rc.span.setAttribute('aria-label', rc.span.title);
                rc.span.className = 'dm-receipt dm-receipt-seen' + (kind === 1 ? ' dm-receipt-tap' : '');
              }
            });
            paintSeen();
          },
          /* Someone was added or left: the roster the next word seals to,
             the header's count, the names. The line itself lands as a word. */
          roster: function (m: any) {
            (m.added || []).forEach(function (r: any) {
              if (!r || !r.hash) return;
              var cur = byHash[r.hash];
              if (cur) { cur.left_at = null; cur.pubkey = r.pubkey || cur.pubkey; cur.joined_at = r.joined_at || cur.joined_at; cur.nick = r.nick || cur.nick; cur.avatar = r.avatar || cur.avatar; }
              else { var row = { hash: r.hash, nick: r.nick || null, avatar: r.avatar || null, assigned: r.assigned || displayName(r.hash), pubkey: r.pubkey || null, joined_at: r.joined_at || null, left_at: null, read_at: null, receipts: r.receipts == null ? 1 : r.receipts }; members.push(row); byHash[r.hash] = row; }
            });
            (m.left || []).forEach(function (h: any) { var cur = byHash[String(h)]; if (cur) cur.left_at = Math.floor(Date.now() / 1000); setTypist(h, false); });
            if (kind === 1 && !(thr && thr.name)) { label = othersNames().join(', ') || 'Group'; shortName = label; headText.querySelector('.dm-head-name').textContent = label; }
            paintSub();
            paintSeen();
          },
          setName: function (name: any) {
            if (kind !== 1) return;
            if (thr) thr.name = name || null;
            label = name || othersNames().join(', ') || 'Group'; shortName = label;
            headText.querySelector('.dm-head-name').textContent = label;
            document.title = shortName + ' | Inbox';
          },
          append: function (msg: any) {
            if (!msg) return;
            if (mineMsg(msg)) {
              /* My own words are echoed locally — except a system line written
                 in my name (enc 2: my call's outcome, 2026-09-14), which has no
                 echo and lands here from the server: placed, no receipt, no
                 unread count, never "seen". */
              if (Number(msg.enc || 0) !== 2) return;
              var pg = Math.max(1, Math.ceil((d.total + 1) / d.per));
              d.total += 1;
              if (d.page !== pg) return;
              var near = nearEnd();
              placeMsg(msg);
              if (near) scrollToEnd();
              updateJump();
              return;
            }
            setTypist(msg.sender_hash, false); typingOn = Object.keys(typists).length > 0; paintSub(); typingBubble(typingOn);   // a real message ends "typing"
            /* a member's word says they have read up to it (the server stamps
               the sender on send); their face moves, my earlier words may tick */
            var sr = byHash[String(msg.sender_hash)];
            if (sr && Number(sr.read_at || 0) < Number(msg.created_at || 0)) { sr.read_at = Number(msg.created_at) || 0; state.dmView.markRead(msg.sender_hash, sr.read_at); }
            var newMsgPage = Math.max(1, Math.ceil((d.total + 1) / d.per));
            d.total += 1;
            if (d.page === newMsgPage) {
              var wasNear = nearEnd();
              var landed = placeMsg(msg);
              if (wasNear) {
                scrollToEnd();
                /* Watched it arrive: settle read state + receipt server-side
                   (the send-side quiet bell already skipped the notification). */
                dmSeenPing(ctx.target());
              } else {
                /* Reading back: the word waits under the line, the button counts
                   it, and it is "seen" when the reader comes down to it. */
                if (!pending) setUnreadLine(1, landed); else bumpUnreadLine(pending + 1);
                pending += 1; unseenLive += 1;
              }
              paintSeen();
              updateJump();
            } else {
              liveDmBadge();   // in the thread but paged back in history — still a bell
            }
          },
          /* The other party edited a message they sent me: re-render its body
             (decrypting, the reply envelope parsed away) and mark it edited.
             Only its text changes; the object the menu reads follows. */
          editMsg: function (msg: any) {
            if (!msg || !msg.id) return;
            var bubble = list.querySelector('[data-dmid="' + String(msg.id).replace(/"/g, '') + '"]');
            if (!bubble || bubble.classList.contains('dm-redacted-msg') || bubble.querySelector('.dm-media')) return;
            var body = bubble.querySelector(':scope > .comment-body');
            var mm = ctx.byId[String(msg.id)];
            if (mm && mm._k && !msg._k) msg._k = mm._k;   // the same K: the edit frame carries no keys
            if (mm && !msg.sender_hash) msg.sender_hash = mm.sender_hash;
            var text = Number(msg.enc || 0) ? (dmPlain(msg, ctx) || '⚠️ could not decrypt') : (msg.body || '');
            var pt = dmParseText(text);
            if (body) { body.textContent = ''; fillBody(body, pt.text); }
            if (mm) { mm.body = pt.text; mm.edited_at = msg.edited_at || Math.floor(Date.now() / 1000); }
            dmMarkEdited(bubble);
          },
          /* The other party deleted a message they sent me: show "<redacted>". */
          redactMsg: function (id: any) {
            if (!id) return;
            var bubble = list.querySelector('[data-dmid="' + String(id).replace(/"/g, '') + '"]');
            if (bubble) dmMakeRedacted(bubble, false);
          },
          /* A member reacted (or withdrew) on one of these bubbles: repaint its pill. */
          reactMsg: function (msg: any, from: any) {
            if (!msg || !msg.id) return;
            var bubble = list.querySelector('[data-dmid="' + String(msg.id).replace(/"/g, '') + '"]');
            if (bubble && (bubble as any).mcReactPaint) (bubble as any).mcReactPaint(msg.emoji, msg.by || from);
          },
          /* The other party saved (or unsaved) one of these bubbles: mark it for me too. */
          saveMsg: function (msg: any) {
            if (!msg || !msg.id) return;
            var bubble = list.querySelector('[data-dmid="' + String(msg.id).replace(/"/g, '') + '"]');
            if (bubble && (bubble as any).mcSavedPaint) (bubble as any).mcSavedPaint(msg.saved);
          } };
        /* Watch a pair's other online live (the DO seeds it now; a group shows
           no live presence — its ⓘ asks once), and carry the on-screen claim
           (dmview:t<id>; dmview:<other> for a room not yet made) that keeps THIS
           conversation's incoming messages off the bell while it is mounted —
           the sub is replaced by the next view's sub() and the socket closes on
           a hidden tab, so the claim is only ever true while the reader truly
           looks. */
        resub();
        /* ---- the composer ---- */
        var form = el('div', 'dm-composer');
        /* "Replying to …": the strip above the field while a reply is armed —
           from the surface's Reply, or a swipe on a bubble — with the ✕ that
           disarms it. The quote rides inside the next send's E2E plaintext. */
        var replyTo: any = null;
        var replyBar = el('div', 'dm-reply-bar');
        replyBar.hidden = true;
        var replyBody = el('div', 'dm-reply-body');
        var replyX = el('button', 'dm-reply-x', '✕');
        replyX.type = 'button'; replyX.title = 'Cancel reply'; replyX.setAttribute('aria-label', 'Cancel reply');
        replyBar.appendChild(replyBody); replyBar.appendChild(replyX);
        form.appendChild(replyBar);
        /* "Editing message": the strip above the field while one of my words
           is being edited IN the composer (2026-09-12) — the text loaded into
           the field, Send become a ✓, the ✕ (or Escape) giving the field its
           earlier draft back. One thing at a time: arming a reply ends an
           edit, and an edit disarms a reply. */
        var editing: any = null;
        var editBar = el('div', 'dm-reply-bar dm-edit-bar');
        editBar.hidden = true;
        var editBody = el('div', 'dm-reply-body');
        var editX = el('button', 'dm-reply-x', '✕');
        editX.type = 'button'; editX.title = 'Cancel edit'; editX.setAttribute('aria-label', 'Cancel edit');
        editBar.appendChild(editBody); editBar.appendChild(editX);
        form.appendChild(editBar);
        var mediaChip = el('span', 'dm-attach-chip');
        mediaChip.hidden = true;
        form.appendChild(mediaChip);
        var ta = el('textarea', 'comment-text dm-c-ta');
        ta.maxLength = 4000;
        ta.rows = 1;
        ta.placeholder = 'Message';
        ta.setAttribute('aria-label', 'Message');
        /* The focus net: the widget warms the instant they touch the field,
           the earliest honest sign they mean to send (the mdEditor road, here
           by hand because this composer is not the forum's). */
        warmOnFocus(ta);
        /* The picker and the keyboard never share the screen on a phone (the
           owner's report: both up at once was crammed). Opening the picker
           dismisses the keyboard; the 😊 becomes a keyboard button while it
           stands; a pick inserts the emoji, closes the picker and hands the
           keyboard back; a tap into the field closes it too. On desktop the
           picker simply stays open beside the field, as the forum's does. */
        var touchUi = false;
        try { touchUi = window.matchMedia('(hover: none)').matches; } catch (e) { touchUi = false; }
        var emojiPanel = buildEmojiPanel(ta, function (it: any) {
          insertEmojiItem(ta, it);
          if (touchUi) closePicker();
          ta.focus();
        });
        emojiPanel.classList.add('dm-c-emoji-panel');
        form.appendChild(emojiPanel);
        var row = el('div', 'dm-c-row');
        var plus = iconBtn('plus', 'Attach a photo, video or audio', 'dm-c-btn dm-c-plus');
        row.appendChild(plus);
        var field = el('div', 'dm-c-field');
        field.appendChild(ta);
        var emojiBtn = iconBtn('smile', 'Emoji', 'dm-c-emoji');
        function setEmojiFace(open: boolean) {
          emojiBtn.textContent = '';
          emojiBtn.appendChild(mcIcon(open ? 'keyboard' : 'smile'));
          emojiBtn.title = open ? 'Keyboard' : 'Emoji';
          emojiBtn.setAttribute('aria-label', emojiBtn.title);
          emojiBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
        }
        function openPicker() { if (touchUi) ta.blur(); emojiPanel.openPanel(); setEmojiFace(true); }
        function closePicker() { emojiPanel.closePanel(); setEmojiFace(false); }
        setEmojiFace(false);
        emojiBtn.addEventListener('click', function () {
          if (emojiPanel.hidden) openPicker();
          else { closePicker(); if (touchUi) ta.focus(); }
        });
        ta.addEventListener('focus', function () { if (touchUi && !emojiPanel.hidden) closePicker(); });
        field.appendChild(emojiBtn);
        row.appendChild(field);
        var mic: any = null;   // the voice button, when the Inbox takes voice notes
        var send = iconBtn('send', 'Send', 'dm-c-send');
        row.appendChild(send);
        form.appendChild(row);
        form.appendChild(el('div', 'ts-slot'));
        var status = el('p', 'form-status dm-c-status');
        form.appendChild(status);
        /* The way back to the foot: a round button above the composer whenever
           the foot is out of view, carrying the count of what waits there. */
        jump = el('button', 'dm-jump');
        jump.type = 'button'; jump.title = 'Jump to the latest message'; jump.setAttribute('aria-label', 'Jump to the latest message');
        jump.appendChild(el('span', 'dm-jump-ico', '⌄'));
        jumpN = el('span', 'dm-jump-n'); jumpN.hidden = true;
        jump.appendChild(jumpN);
        jump.hidden = true;
        jump.addEventListener('click', function () { scrollToEnd(true); });
        form.appendChild(jump);
        section.appendChild(form);
        /* The bar is FIXED above the tab bar (the merecat road), never sticky:
           a thread opens at the document's end, where a sticky bar sits in its
           natural place — above the body's tab-bar reservation and the footer
           — and floated a gap over the tab bar until a scroll re-stuck it (the
           owner's report, 2026-09-11). A spacer reserves the bar's height under
           the last bubble, remeasured as the bar changes (the reply strip, the
           attach chip, the recorder, the growing field); on desktop the bar is
           aligned to the content column by measurement, since the sidebar
           shifts the column. */
        var spacer = el('div', 'dm-c-space');
        section.appendChild(spacer);
        function place() {
          if (window.innerWidth > 600) {
            var r = section.getBoundingClientRect();
            form.style.left = Math.round(r.left) + 'px';
            form.style.width = Math.round(r.width) + 'px';
            form.style.right = 'auto';
          } else { form.style.left = ''; form.style.width = ''; form.style.right = ''; }
          spacer.style.height = (form.offsetHeight + 8) + 'px';
        }
        place();
        var placeT: any = 0;
        function replace() {
          clearTimeout(placeT);
          placeT = setTimeout(function () { var atEnd = nearEnd(); place(); if (atEnd) scrollToEnd(); updateJump(); }, 0);
        }
        if (window.ResizeObserver) {
          var ro = new ResizeObserver(replace);
          ro.observe(form); ro.observe(section);
          bootSig.addEventListener('abort', function () { ro.disconnect(); }, { once: true });
        }
        window.addEventListener('resize', replace, { signal: bootSig });
        if (window.MutationObserver) {
          /* the desktop sidebar toggles a body class and eases the column over: re-place after the ease too */
          var mo = new MutationObserver(function () { replace(); setTimeout(place, 320); });
          mo.observe(document.body, { attributes: true, attributeFilter: ['class'] });
          bootSig.addEventListener('abort', function () { mo.disconnect(); }, { once: true });
        }
        function setReply(ref: any) {
          replyTo = ref;
          replyBody.textContent = '';
          if (!ref) { replyBar.hidden = true; return; }
          replyBody.appendChild(el('span', 'dm-quote-who', 'Replying to ' + (ref.from === state.myHash ? 'yourself' : nameOf(ref.from))));
          replyBody.appendChild(el('span', 'dm-quote-text', dmQuoteText(ref)));
          replyBar.hidden = false;
        }
        replyX.addEventListener('click', function () { setReply(null); ta.focus(); });
        ctx.reply = function (m: any) { if (editing) clearEdit(true); setReply(dmReplyRef(m)); ta.focus(); };
        function paintSend() {
          send.textContent = '';
          send.appendChild(mcIcon(editing ? 'check' : 'send'));
          send.title = editing ? 'Save' : 'Send'; send.setAttribute('aria-label', send.title);
        }
        function setEdit(m: any, node: any) {
          if (editing && editing.node === node) { ta.focus(); return; }
          if (!editing) editing = { m: m, node: node, prev: ta.value };
          else { editing.m = m; editing.node = node; }
          setReply(null);
          editBody.textContent = '';
          editBody.appendChild(el('span', 'dm-quote-who', '✎ Editing message'));
          editBody.appendChild(el('span', 'dm-quote-text', dmQuoteText({ kind: 'text', text: String(m.body || '') })));
          editBar.hidden = false;
          ta.value = String(m.body || '');
          try { ta.setSelectionRange(ta.value.length, ta.value.length); } catch (e) { /* fine */ }
          grow(); refresh(); paintSend();
          status.textContent = '';
        }
        function clearEdit(restore: boolean) {
          if (!editing) return;
          var prev = editing.prev;
          editing = null;
          editBar.hidden = true;
          ta.value = restore ? prev : '';
          grow(); refresh(); paintSend();
        }
        editX.addEventListener('click', function () { clearEdit(true); ta.focus(); });
        ta.addEventListener('keydown', function (e: any) { if (e.key === 'Escape' && editing) { e.preventDefault(); clearEdit(true); } });
        ctx.edit = function (m: any, node: any) { setEdit(m, node); ta.focus(); };
        /* The field grows with the words, to a few lines, then scrolls. */
        /* An empty box is its natural one row (scrollHeight would count a
           wrapped placeholder); a filled one grows to a few lines, then scrolls.
           scrollHeight excludes a border-box field's borders: add them back. */
        function grow() {
          if (!ta.value) { ta.style.height = ''; return; }
          ta.style.height = 'auto';
          ta.style.height = Math.min(ta.scrollHeight + (ta.offsetHeight - ta.clientHeight), 168) + 'px';
        }
        var pendingFile: any = null;
        /* Mic while there is nothing to send, Send the moment there is —
           WhatsApp's swap. Without voice, Send stands always, dimmed when idle. */
        function refresh() {
          var has = !!(ta.value.trim() || pendingFile || editing);
          if (mic) { mic.hidden = has; send.hidden = !has; }
          else { send.hidden = false; send.classList.toggle('dm-c-idle', !has); }
          plus.hidden = !!editing;   // an edit changes words, never media
        }
        attachDraft(ta, 'dm:' + (kind === 1 ? 't' + threadId : other));
        attachEmoji(ta);
        attachMentions(ta);
        swipeDismissesKeyboard(ta, form);
        grow(); refresh();
        /* Sparing typing signal: a "start" at most once per 3s while composing,
           a "stop" 4s after the last keystroke. WebSocket only — no HTTP. */
        var typingLastSent = 0, typingStopT = 0;
        ta.addEventListener('input', function () {
          grow(); refresh();
          if (!(window.mcLive && window.mcLive.member)) return;
          var now = Date.now();
          if (now - typingLastSent > 3000) { window.mcLive!.member.typing!(recipients(), 'start', threadId); typingLastSent = now; }
          clearTimeout(typingStopT);
          typingStopT = setTimeout(function () { window.mcLive!.member.typing!(recipients(), 'stop', threadId); typingLastSent = 0; }, 4000);
        });
        /* Enter sends where there is a keyboard with a pointer (WhatsApp Web's
           convention; Shift+Enter breaks the line); on a phone Enter is a new
           line and the button sends. A picker that already took the key
           (the : emoji and @ mention lists) keeps it. */
        var finePointer = false;
        try { finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches; } catch (e) { finePointer = false; }
        ta.addEventListener('keydown', function (e: any) {
          if (e.key !== 'Enter' || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey || e.isComposing || e.defaultPrevented || !finePointer) return;
          e.preventDefault();
          send.click();
        });
        /* Attach a photo / audio / video from the device library. It is encrypted
           in the browser (AES-GCM) and sent as an E2E media message on Send; the
           text box becomes an optional caption. */
        var fileInput = el('input', 'dm-file-input');
        fileInput.type = 'file';
        fileInput.style.display = 'none';
        form.appendChild(fileInput);
        function clearAttach() { pendingFile = null; fileInput.value = ''; mediaChip.hidden = true; mediaChip.textContent = ''; refresh(); }
        plus.addEventListener('click', function () { fileInput.click(); });
        /* Gate + hold one picked (or recorded) file. The kind and size caps come
           from the served media settings (the old hardcoded 60 MB here let the
           server refuse at its own, smaller caps); images are downscaled in the
           browser BEFORE the E2E encrypt, so only the small ciphertext uploads. */
        function takeDmFile(f: any) {
          mediaCfg().then(function (cfg: any) {
            mediaGateFile(f, cfg, cfg.sections.dm, status).then(function (out: any) {
              if (!out) { fileInput.value = ''; return; }
              pendingFile = out;
              status.textContent = '';
              mediaChip.textContent = '';
              mediaChip.appendChild(document.createTextNode('📎 ' + (out.name || 'attachment') + ' · ' + fmtBytes(out.size) + '  '));
              var x = el('a', null, '✕');
              x.href = '#';
              x.addEventListener('click', function (ev: any) { ev.preventDefault(); clearAttach(); });
              mediaChip.appendChild(x);
              mediaChip.hidden = false;
              refresh();
            });
          });
        }
        fileInput.addEventListener('change', function () {
          var f = fileInput.files && fileInput.files[0];
          if (!f) return;
          takeDmFile(f);
        });
        /* One config tap: hide + when the Inbox takes no media, accept from
           the DM section's own kinds, the mic behind its voice flag. */
        mediaCfg().then(function (cfg: any) {
          var sec = cfg.sections.dm;
          if (cfg.enabled && sec.kinds.length) {
            fileInput.accept = window.mcCore ? (window.mcCore as any).mediaAcceptFor(sec.kinds) : 'image/*,video/*,audio/*';
            if (sec.voice && sec.kinds.indexOf('audio') !== -1) {
              mic = voiceControl(form, cfg, sec, status, takeDmFile);
              mic.className = 'dm-c-btn dm-c-mic';
              mic.textContent = '';
              mic.appendChild(mcIcon('mic'));
              mic.title = 'Voice note'; mic.setAttribute('aria-label', 'Voice note');
              row.insertBefore(mic, send);
              refresh();
            }
          } else plus.hidden = true;
          /* 📞 lives in the header, always in view (the WhatsApp place). Gated on
             the platform switch + WebRTC support; the bot has no ears. */
          if (kind === 0 && other && other !== MERECAT_BOT_HASH && (window as any).RTCPeerConnection
            && (navigator as any).mediaDevices && (navigator as any).mediaDevices.getUserMedia) {
            callsCfg().then(function (cc: any) {
              if (!cc.enabled) return;
              var cb = iconBtn('phone', 'Voice call (end-to-end encrypted)', 'dm-head-btn dm-head-call');
              cb.addEventListener('click', function () { placeCall(other, label); });
              acts.insertBefore(cb, acts.firstChild);
            });
          }
        });
        /* No challenge merely for OPENING a conversation: the focus net warms
           the widget the instant they touch the field. */
        /* We can only encrypt to a member who has published a key. Until they have
           signed in once under the encrypted client, hold the send with a plain
           notice rather than silently falling back to plaintext. */
        if (kind === 0 && !otherPub) {
          send.disabled = true;
          ta.disabled = true;
          plus.disabled = true;
          ta.placeholder = 'Waiting for this member to sign in once to set up encryption.';
          status.textContent = 'You can message them privately once they have signed in to set up their encryption key.';
        }
        /* Seal a word for the members as they are now and post it; a stale
           roster (someone came or went as this was sealed) is answered by the
           server with the fresh one, and the word is sealed once more. */
        function post(plain: string, mediaKey: any, token: any, retried?: boolean): Promise<any> {
          var cur = ctx.current();
          if (cur.some(function (mm: any) { return !mm.pubkey; })) return Promise.reject(new Error('A member has not set up encryption yet.'));
          var sealed = dmSealFor(plain, cur);
          var payload: any = Object.assign({ key: state.key, body: sealed.body, enc: 3, keys: sealed.keys, token: token }, ctx.target());
          if (mediaKey) payload.media_key = mediaKey;
          return fetchRetry(API + '/dm/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) },
            [1500], function () { status.textContent = 'Network hiccup, retrying...'; })
            .then(function (r) { return r.json(); })
            .then(function (d2) {
              if (d2 && d2.error === 'roster' && Array.isArray(d2.members) && !retried) {
                state.dmView.roster({ added: d2.members.filter(function (mm: any) { return !byHash[mm.hash] || byHash[mm.hash].left_at; }),
                  left: members.filter(function (mm: any) { return !mm.left_at && !d2.members.some(function (x: any) { return x.hash === mm.hash; }); }).map(function (mm: any) { return mm.hash; }) });
                d2.members.forEach(function (mm: any) { if (byHash[mm.hash] && mm.pubkey) byHash[mm.hash].pubkey = mm.pubkey; });
                return post(plain, mediaKey, token, true);
              }
              if (d2 && d2.ok) d2._k = sealed.K;
              return d2;
            });
        }
        send.addEventListener('click', function () {
          if (send.disabled) return;
          var body = ta.value.replace(/\s+$/, '');
          if (editing) {
            /* ✓: save the edit in place (dmSaveEdit re-wraps the quote it answered) */
            if (!body.trim()) { ta.focus(); return; }
            if (body === String(editing.m.body || '')) { clearEdit(false); return; }
            send.disabled = true; status.textContent = 'Saving…';
            dmSaveEdit(editing.m, editing.node, ctx, body).then(function (r) {
              send.disabled = false;
              if (!r.ok) { status.textContent = r.error; return; }
              status.textContent = '';
              clearEdit(false);
              if (ta.mcDraftDone) ta.mcDraftDone();
            }).catch(function () { send.disabled = false; status.textContent = 'Network error. Try again.'; });
            return;
          }
          if (!pendingFile && !body.trim()) { ta.focus(); return; }
          send.disabled = true;
          trace('submit: DM send');
          status.textContent = 'Verifying...';
          var sending = pendingFile;   // captured: the echo path needs the local file
          var replyAt = replyTo;       // captured: the quote this send answers
          getToken().then(function (token) {
            if (sending) {
              /* Media: encrypt the file in the browser, upload only ciphertext,
                 then send a normal E2E message whose body carries the AES key. */
              status.textContent = 'Encrypting...';
              return dmMediaEncryptFile(sending).then(function (mm: any) {
                status.textContent = 'Uploading...';
                var fd = new FormData();
                fd.append('key', state.key);
                fd.append('file', new Blob([mm.ct]), 'blob');
                return fetch(API + '/dm/media', { method: 'POST', body: fd }).then(function (r) { return r.json(); }).then(function (u) {
                  if (!u.ok) throw new Error(u.error || 'The file could not be uploaded.');
                  status.textContent = 'Sending...';
                  if (body.trim()) mm.env.caption = body;
                  if (replyAt) mm.env.reply = replyAt;
                  return post(JSON.stringify(mm.env), u.media_key, token).then(function (d2) { d2._env = mm.env; d2._media_key = u.media_key; return d2; });
                });
              });
            }
            status.textContent = 'Sending...';
            return post(dmWrapText(body, replyAt), null, token);
          }).then(function (d2) {
            if (blockedOut(d2)) return;
            if (!d2.ok) throw new Error(d2.error || 'The message could not be sent.');
            if (d2.thread_id) adopt(d2.thread_id);
            ta.value = '';
            if (ta.mcDraftDone) ta.mcDraftDone();
            closePicker();
            /* Seed the media cache from the local file so our own echo renders
               instantly without a round-trip. */
            if (sending && d2._media_key) { try { mcDmBlobPut(d2._media_key, URL.createObjectURL(sending), sending.size || 0); } catch (e) {} }
            clearAttach();
            setReply(null);
            grow(); refresh();
            /* Newest message lands at the bottom of the last page. Show it
               inline when that page is on screen; else jump to it. */
            var msgPage = Math.ceil((d.total + 1) / d.per);
            if (msgPage === d.page) {
              d.total += 1;
              if (sending && d2._media_key) {
                /* The media echo arrives with its envelope in hand (no decrypt). */
                var mecho = { id: d2.id, sender_hash: state.myHash, media_key: d2._media_key, created_at: d2.created_at, saved: 0, enc: 1,
                  _env: d2._env, _k: d2._k, reply: dmReplyClean(replyAt), reactions: [], react_me: '', react_other: '' };
                placeMsg(mecho);
              } else {
                /* The text echo is already plaintext (enc 0) and carries its quote — and its K, so an edit re-seals under it. */
                var echo = { id: d2.id, sender_hash: state.myHash, body: body, created_at: d2.created_at, saved: 0, enc: 0,
                  _k: d2._k, reply: dmReplyClean(replyAt), reactions: [], react_me: '', react_other: '' };
                placeMsg(echo);
              }
              status.textContent = '';
              scrollToEnd();
            } else {
              go(dmPageHref(msgPage));
            }
          }).catch(function (err) {
            status.textContent = err.message || 'Network error. Try again in a moment.';
          }).finally(function () {
            send.disabled = (kind === 0 && !otherPub);
            refresh();
            if (window.turnstile && state.widgetId !== null) turnstile.reset(state.widgetId);
          });
        });
        /* Open a conversation at its newest word: on the last page, the foot of
           the thread, just above the composer. Chrome resets the scroll position
           at the window load event (its restoration for a fresh entry), and on a
           real network the thread renders BEFORE load — the first cut opened at
           the top on prod and at the foot on a local serve, where load had long
           fired. When load is still to come, re-land the foot for a beat after
           it (the reader has had no time to scroll away). */
        /* The unread line stands above the first word this reader had not read
           when the thread opened — the server tells it BEFORE this open marks
           them read — with the count; it stays until the reader leaves. The
           landing is WhatsApp's: the foot when the unread words all fit under
           the header, else the line just under the header with the jump button
           carrying the count. */
        /* Opening read this sender's bells on the server; the bell's badge
           follows at once from the count the payload carries (2026-09-12). */
        if (typeof d.notif_unread === 'number') notifCacheSet(d.notif_unread);
        var firstUnread = d.unread_from ? list.querySelector('[data-dmid="' + String(d.unread_from).replace(/"/g, '') + '"]') : null;
        if (firstUnread && Number(d.unread) > 0) { setUnreadLine(Number(d.unread), firstUnread); pending = Number(d.unread); }
        function landing() {
          scrollToEnd();
          if (unreadLine) {
            var top = unreadLine.getBoundingClientRect().top, under = headEl.getBoundingClientRect().bottom + 6;
            if (top < under) { try { window.scrollBy({ top: top - under, left: 0, behavior: 'instant' as any }); } catch (e) { window.scrollBy(0, top - under); } }
          }
          updateJump();
        }
        var landOn = mWant > 0 ? list.querySelector('[data-dmid="' + mWant + '"]') : null;
        if (landOn) {
          try { landOn.scrollIntoView({ block: 'center' }); } catch (e) { landOn.scrollIntoView(); }
          dmFlash(landOn);
          updateJump();
        } else if (d.messages.length && d.page >= dmPages) {
          landing();
          if (document.readyState !== 'complete') {
            window.addEventListener('load', function () {
              var n = 0;
              var settle = function () { landing(); if (++n < 6) setTimeout(settle, 50); };
              settle();
            }, { once: true, signal: bootSig });
          }
        }
      })
      .catch(function (err: any) {
        section.textContent = '';        // drop the placeholder crumb + skeleton
        crumb([['Community', 'community.html'], ['Inbox', 'messages.html'], ['Conversation']]);
        /* "No such conversation": it ended (nothing saved, everything expired,
           nobody remains), or I left it. */
        var gone = err && /No such conversation|gone/.test(String(err.message || ''));
        section.appendChild(el('p', 'comments-status', gone ? 'This conversation has ended.' : 'The conversation could not be loaded. Check your connection and reload the page.'));
      });
  }

  function bind() {
    API = B.API;
    MERECAT_BOT_HASH = B.MERECAT_BOT_HASH;
    appConfirm = B.appConfirm;
    attachDraft = B.attachDraft;
    attachEmoji = B.attachEmoji;
    attachMentions = B.attachMentions;
    blockedOut = B.blockedOut;
    bootSig = B.bootSig;
    buildEmojiPanel = B.buildEmojiPanel;
    cachedJson = B.cachedJson;
    crumb = B.crumb;
    displayName = B.displayName;
    el = B.el;
    fetchRetry = B.fetchRetry;
    fillBody = B.fillBody;
    getToken = B.getToken;
    go = B.go;
    identityAction = B.identityAction;
    insertEmojiItem = B.insertEmojiItem;
    mcDmBlobPut = B.mcDmBlobPut;
    mcDmBlobs = B.mcDmBlobs;
    mcIcon = B.mcIcon;
    notifCacheSet = B.notifCacheSet;
    mediaCfg = B.mediaCfg;
    mediaGateFile = B.mediaGateFile;
    pageBar = B.pageBar;
    profileHref = B.profileHref;
    section = B.section;
    setBlock = B.setBlock;
    skeleton = B.skeleton;
    state = B.state;
    trace = B.trace;
    utilBtnLabel = B.utilBtnLabel;
    voiceControl = B.voiceControl;
    warmOnFocus = B.warmOnFocus;
    DM_CACHE = B.DM_CACHE;
    dmAvatarCell = B.dmAvatarCell;
    dmB64uEnc = B.dmB64uEnc;
    dmCollageInto = B.dmCollageInto;
    dmDayNode = B.dmDayNode;
    dmE2eExplainer = B.dmE2eExplainer;
    dmExpiryNode = B.dmExpiryNode;
    dmFlash = B.dmFlash;
    dmLabel = B.dmLabel;
    dmMakeRedacted = B.dmMakeRedacted;
    dmMarkEdited = B.dmMarkEdited;
    dmMediaEncryptFile = B.dmMediaEncryptFile;
    dmMemberPicker = B.dmMemberPicker;
    dmParseText = B.dmParseText;
    dmPlain = B.dmPlain;
    dmQuoteText = B.dmQuoteText;
    dmReadByInfo = B.dmReadByInfo;
    dmRenderMsg = B.dmRenderMsg;
    dmReplyClean = B.dmReplyClean;
    dmReplyRef = B.dmReplyRef;
    dmSaveEdit = B.dmSaveEdit;
    dmSealFor = B.dmSealFor;
    dmSeenLabel = B.dmSeenLabel;
    dmSeenPing = B.dmSeenPing;
    dmTtlLabel = B.dmTtlLabel;
    dmUnreadCheck = B.dmUnreadCheck;
    dmVerified = B.dmVerified;
    dmVerifyPanel = B.dmVerifyPanel;
    dmWrapText = B.dmWrapText;
    ensureDmStyles = B.ensureDmStyles;
    ensureNacl = B.ensureNacl;
    fmtBytes = B.fmtBytes;
    fmtTimeCompact = B.fmtTimeCompact;
    liveDmBadge = B.liveDmBadge;
    myDmKeypair = B.myDmKeypair;
    swipeDismissesKeyboard = B.swipeDismissesKeyboard;
  }
  function run() { /* nothing of this module ran at the boot's top level */ }
  return { bind, run, exports: { viewDm } };
}
