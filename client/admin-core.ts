/* The admin core every page needs: the built-in admin hint (ADMIN_HASHES), isAdmin and the admin-page gate, the moderation lines a topic's admin corner and a profile card carry (lock, shadow ban, IP block and reverse DNS, delete user, trust), the profile fingerprint, the admin profile editor. Eager: the board, the wall and the profile bind these.
   Split out of client/admin.ts on 2026-09-16 (the six DM factories); every declaration
   moved verbatim. Names from the boot and the other modules are bound in bind(). */
import type { Boot } from './boot';

export function installAdminCore(B: Boot) {
  /* Names this module takes from the boot — the root's helpers and the other
     modules' exports — bound in bind() once every module is installed, so
     order of installation never matters and every body reads as it did. */
  let API: any;
  let CATS: any;
  let appConfirm: (msg: any, opts: any, cb: any) => any;
  let authSig: () => any;
  let catByKey: (key: any) => any;
  let el: (tag: string, cls?: string | null, text?: string | number | null) => any;
  let fetchRetry: (url: string, opts: RequestInit | undefined, delays: number[], onRetry?: () => void) => Promise<Response>;
  let isSharedV4Client: (ip: any) => any;
  let pageKey: any;
  let postMenu: (opts: any) => any;
  let profileLimits: () => any;
  let renderTrustLine: (line: any, hash: any, trusted: any) => any;
  let section: any;
  let skeleton: (kind?: string) => any;
  let stampFresh: () => any;
  let state: any;

  var ADMIN_HASHES = ['d1915a05c2583f437b1316971563b3c4c404cff016a016770d91af1f2645f7f6',
    'c83c2b4d105771aafa662a26745ddd2172213ddf5b39d64dfb91f579b5e18b03'];

  function isAdmin() {
    if (window.mcCore) return window.mcCore.authIsAdmin(authSig());
    if (!state.key) return false;
    if (state.profileLoaded) return state.myAdmin;
    return state.myAdmin || ADMIN_HASHES.indexOf(state.myHash) !== -1;
  }

  /* Guard for an admin-only view. Owners pass at once. If we cannot yet tell (a
     key is present but its profile has not loaded), show a neutral wait and
     redraw when it does, rather than flash a false "not for you". With no key,
     or once the profile is in, the answer is certain. Returns true when the
     caller should stop. */
  function adminGate(rerender: any) {
    var g = window.mcCore ? window.mcCore.authGate(authSig())
      : (isAdmin() ? 'pass' : ((!state.key || state.profileLoaded) ? 'deny' : 'wait'));
    if (g === 'pass') return false;
    if (g === 'deny') {
      section.appendChild(el('p', 'comments-status', 'This page is for the admins.'));
      return true;
    }
    section.appendChild(skeleton());
    if (rerender) B.profileWaiters.push(function () { section.textContent = ''; rerender(); });
    return true;
  }

  /* Reverse-DNS results, cached per address across drawers so a fingerprint
     opened twice never looks the same IP up twice. */
  var rdnsCache: Record<string, any> = {};

  /* Build the admin user-fingerprint drawer from one meta row and the
     identity->IPs map. Identical whether it hangs under a comment or on a
     profile, so both surfaces carry the very same controls. */
  function buildFingerprint(m: any, identities: any) {
    var details = el('details', 'comment-meta');
    details.appendChild(el('summary', null, 'user-fingerprint'));
    details.appendChild(el('div', null,
      (m.ip ? (m.ip.indexOf(':') !== -1 ? 'IPv6 ' : 'IPv4 ') + m.ip : 'ip?') +
      (m.os ? ' · ' + m.os : '') + (m.tz ? ' · ' + m.tz : '') +
      (m.lang ? ' · ' + m.lang : '')));
    if (m.ua) details.appendChild(el('div', null, m.ua));
    /* Trusted authors skip the AI screen. The line states the standing fact
       and offers the reversal, and flipping it updates every fingerprint of
       the same author on the page. The author never sees any of this. */
    if (m.author_hash) {
      var line = el('div', 'trust-line');
      line.setAttribute('data-hash', m.author_hash);
      renderTrustLine(line, m.author_hash, !!m.trusted);
      details.appendChild(line);
      details.appendChild(modLockLine(m.author_hash, !!m.locked));
      details.appendChild(modShadowLine(m.author_hash, !!m.shadowbanned));
      var ips = (identities && identities[m.author_hash]) || [];
      if (!ips.length && m.ip) ips = [{ ip_display: m.ip, ip_key: m.ip,
        family: m.ip.indexOf(':') !== -1 ? 6 : 4, source: 'seen', banned: !!m.ipbanned }];
      details.appendChild(modIpBlock(ips));
      wireRdns(details, ips);
      details.appendChild(modDeleteUserLine(m.author_hash));
      details.appendChild(modHelpNote());
    }
    return details;
  }

  function annotateMeta(forPage?: any) {
    if (!isAdmin()) return;
    fetch(API + '/meta', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ page: forPage || pageKey(), key: state.key }),
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (!d.ok) return;
      d.meta.forEach(function (m: any) {
        var node = document.getElementById('comment-' + m.id);
        if (!node || node.querySelector('.comment-meta')) return;
        node.appendChild(buildFingerprint(m, d.identities));
      });
    }).catch(function () {});
  }

  /* Admin moderation controls, all inside the user-fingerprint dropdown and
     each guarded by appConfirm() — a slide-up sheet on phones, the native
     confirm on desktop, reading the same either way. A reload after each so
     the page returns true. */

  function modLockLine(hash: any, locked: any) {
    var line = el('div', 'trust-line');
    line.appendChild(document.createTextNode(locked ? 'Locked. ' : 'Unlocked. '));
    var a = el('a', 'trust-toggle', locked ? '(toggle-unlocked)' : '(toggle-locked)');
    a.href = '#';
    a.addEventListener('click', function (e: any) {
      e.preventDefault();
      var doLock = function () {
        fetch(API + '/lock', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: state.key, hash: hash, locked: !locked }),
        }).then(function (r) { return r.json(); }).then(function (d) {
          if (d.ok) location.reload();
        }).catch(function () {});
      };
      if (locked) doLock();
      else appConfirm('Lock this identity? They will be logged out and unable to interact until you unlock them.', { okLabel: 'Lock', danger: true }, function (ok: any) { if (ok) doLock(); });
    });
    line.appendChild(a);
    return line;
  }

  /* Shadow ban: a quiet global mute. Their posts keep succeeding and they are
     never logged out or told, but their public content is hidden from everyone
     else and announces nothing. Toggles in place (no reload) so nothing about
     the admin's own view flashes. The author never sees any of this. */
  function modShadowLine(hash: any, shadowbanned: any) {
    var line = el('div', 'trust-line');
    function render(on: any) {
      line.textContent = '';
      line.appendChild(document.createTextNode(on
        ? 'Shadow banned. Their posts are muted globally — hidden from everyone else, and they are not told. '
        : 'Not shadow banned. '));
      var a = el('a', 'trust-toggle', on ? '(un-shadowban)' : '(shadow ban)');
      a.href = '#';
      a.addEventListener('click', function (e: any) {
        e.preventDefault();
        var doShadow = function () {
          fetch(API + '/shadowban', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: state.key, hash: hash, on: !on }),
          }).then(function (r) { return r.json(); }).then(function (d) {
            if (d && d.ok) render(!!d.shadowbanned);
          }).catch(function () {});
        };
        if (on) doShadow();
        else appConfirm('Shadow ban this identity? Their posts will be hidden from everyone else site-wide, but they can keep posting and will not be told. Undo it here any time.', { okLabel: 'Shadow ban', danger: true }, function (ok: any) { if (ok) doShadow(); });
      });
      line.appendChild(a);
    }
    render(shadowbanned);
    return line;
  }

  /* The IP block in a fingerprint: every address known for this identity, each
     bannable on its own, and a ban-all that shuts both families of a dual-stack
     user in one act. A v4 that looks like carrier-grade NAT is flagged, since it
     may be shared by many people. */
  function modIpBlock(rows: any) {
    var wrap = el('div', 'ip-block');
    if (!rows.length) {
      wrap.appendChild(el('div', 'trust-line', 'No IP on record.'));
      return wrap;
    }
    if (rows.length > 1) {
      var allBanned = rows.every(function (r: any) { return r.banned; });
      var head = el('div', 'trust-line');
      head.appendChild(document.createTextNode('Known IPs (' + rows.length + '). '));
      var all = el('a', 'trust-toggle', allBanned ? '(unban all)' : '(ban all IPs)');
      all.href = '#';
      all.addEventListener('click', function (e: any) {
        e.preventDefault();
        var doBan = function () { ipbanRequest(rows.map(function (r: any) { return r.ip_key; }), !allBanned); };
        if (allBanned) doBan();
        else appConfirm(banAllPrompt(rows), { okLabel: 'Ban all', danger: true }, function (ok: any) { if (ok) doBan(); });
      });
      head.appendChild(all);
      wrap.appendChild(head);
    }
    rows.forEach(function (r: any) { wrap.appendChild(ipRow(r)); });
    return wrap;
  }

  function ipRow(r: any) {
    var line = el('div', 'trust-line');
    line.appendChild(document.createTextNode((r.banned ? 'Banned. ' : 'Not banned. ') +
      (r.family === 6 ? 'IPv6 ' : 'IPv4 ') + r.ip_display +
      (r.source === 'claimed' ? ' · claimed' : '') + ' '));
    var rd = el('span', 'ip-rdns');
    rd.setAttribute('data-ip', r.ip_display);
    if (rdnsCache[r.ip_display]) rd.textContent = rdnsCache[r.ip_display] + ' ';
    line.appendChild(rd);
    var a = el('a', 'trust-toggle', r.banned ? '(unban)' : '(ban)');
    a.href = '#';
    a.addEventListener('click', function (e: any) {
      e.preventDefault();
      var doBan = function () { ipbanRequest([r.ip_key], !r.banned); };
      if (r.banned) { doBan(); return; }
      appConfirm('Ban ' + r.ip_display + '?' +
        (isSharedV4Client(r.ip_display) ? ' This looks like carrier-grade NAT, shared by many users; banning it may block innocents.' : '') +
        '\n\nLogged-in users from it will be blocked and sent to the terms page.',
      { okLabel: 'Ban', danger: true }, function (ok: any) { if (ok) doBan(); });
    });
    line.appendChild(a);
    return line;
  }

  function banAllPrompt(rows: any) {
    var shared = rows.filter(function (r: any) { return isSharedV4Client(r.ip_display); });
    return 'Ban all ' + rows.length + ' IPs for this identity?\n\n' +
      rows.map(function (r: any) { return (r.family === 6 ? 'IPv6 ' : 'IPv4 ') + r.ip_display; }).join('\n') +
      (shared.length ? '\n\nWARNING: ' + shared.map(function (r: any) { return r.ip_display; }).join(', ') +
        ' looks like carrier-grade NAT (shared by many users); banning may block innocents.' : '') +
      '\n\nLogged-in users from any of them will be blocked and sent to the terms page.';
  }

  function ipbanRequest(keys: any, banned: any) {
    fetch(API + '/ipban', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: state.key, ips: keys, banned: banned }),
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (d.ok) location.reload();
    }).catch(function () {});
  }

  /* Reverse-DNS the identity's addresses the first time its drawer opens, then
     fill every matching row. Admin-only and lazy, so the bulk fingerprint fetch
     and the poster's own path never pay for it. */
  function wireRdns(details: any, rows: any) {
    if (!rows.length) return;
    details.addEventListener('toggle', function () {
      if (!details.open || details.__rdnsDone) return;
      details.__rdnsDone = true;
      var want = rows.map(function (r: any) { return r.ip_display; })
        .filter(function (ip: any) { return !(ip in rdnsCache); });
      if (!want.length) return fillRdns(details);
      fetch(API + '/rdns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: state.key, ips: want }),
      }).then(function (r) { return r.json(); }).then(function (d) {
        if (d.ok && d.rdns) Object.keys(d.rdns).forEach(function (ip) { rdnsCache[ip] = d.rdns[ip] || ''; });
        fillRdns(details);
      }).catch(function () {});
    });
  }

  function fillRdns(details: any) {
    details.querySelectorAll('.ip-rdns').forEach(function (span: any) {
      var host = rdnsCache[span.getAttribute('data-ip')];
      if (host) span.textContent = host + ' ';
    });
  }

  function modHelpNote() {
    return el('p', 'mod-help',
      'Handling a troublesome user: an identity is only a key in a browser, so a locked or deleted one can be remade in a click. To actually keep someone out, ban the IP first, while it still shows above, then lock or delete the identity. IP bans reach signed-in users only, never anonymous cached reading, and a determined person can switch networks. Lean on bans sparingly, and reserve deletion for the worst.');
  }

  function modDeleteUserLine(hash: any) {
    var line = el('div', 'trust-line');
    var a = el('a', 'trust-toggle danger', 'Delete user and all posts');
    a.href = '#';
    a.addEventListener('click', function (e: any) {
      e.preventDefault();
      appConfirm('DELETE THIS USER? This permanently deletes ALL of their posts, their profile, and their avatar, and locks the identity so they cannot post again. This cannot be undone. Continue?', { okLabel: 'Continue', danger: true }, function (ok1: any) {
        if (!ok1) return;
        appConfirm('Are you sure? There is no undo.', { okLabel: 'Delete user', danger: true }, function (ok2: any) {
          if (!ok2) return;
          fetch(API + '/deleteuser', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: state.key, hash: hash }),
          }).then(function (r) { return r.json(); }).then(function (d) {
            if (d.ok) location.reload();
          }).catch(function () {});
        });
      });
    });
    line.appendChild(a);
    return line;
  }

  /* Admin topic controls on the category page. Reload after the act so
     the list, markers, and counts return true. */
  function modLinkEl(id: any, act: any, label: any) {
    var a = el('a', 'trust-toggle', label);
    a.href = '#';
    a.addEventListener('click', function (e: any) {
      e.preventDefault();
      var doAct = function () {
        fetch(API + '/moderate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: state.key, id: id, act: act }),
        }).then(function (r) { return r.json(); }).then(function (d) {
          if (d.ok) { stampFresh(); location.reload(); }
        }).catch(function () {});
      };
      if (act === 'delete') appConfirm('Delete this topic?', { okLabel: 'Delete', danger: true }, function (ok: any) { if (ok) doAct(); });
      else doAct();
    });
    return a;
  }

  /* The full admin corner for one topic: a Move dropdown plus sticky, lock, and
     delete. Shared by the category listing and the moderation console, so a topic
     is governed the same way wherever it shows. `curCat` is the topic's own
     category key, greyed in the Move list. Every act reloads the view on success. */
  function topicAdminCorner(topic: any, curCat: any) {
    var admin = el('span', 'board-admin-links board-admin-corner');
    var moveSel = el('select', 'board-move');
    var movePh = el('option', null, 'Move'); movePh.value = ''; moveSel.appendChild(movePh);
    CATS.forEach(function (c: any) {
      var o = el('option', null, c[1]); o.value = c[0];
      if (c[0] === curCat) o.disabled = true;
      moveSel.appendChild(o);
    });
    var resetMove = function () { moveSel.value = ''; if (moveSel.__mcHandle) moveSel.__mcHandle.refresh(); };
    moveSel.addEventListener('change', function () {
      var target = moveSel.value;
      if (!target) return;
      var name = catByKey(target)![1];
      appConfirm('Move "' + topic.title + '" to ' + name + '? The original poster will be notified by DM.', { okLabel: 'Move' }, function (ok: any) {
        if (!ok) { resetMove(); return; }
        fetch(API + '/move', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: state.key, id: topic.id, cat: target, catName: name }),
        }).then(function (r) { return r.json(); }).then(function (d) {
          if (d.ok) { stampFresh(); location.reload(); } else resetMove();
        }).catch(function () { resetMove(); });
      });
    });
    moveSel.setAttribute('aria-label', 'Move to category');
    /* The whole governance kit folds into one row-level ⋯ (the readability
       standard) — the Move select and every mod link keep their classes and
       handlers, they just live in the menu now. mcSelectSheet wraps the select
       AFTER it is parented inside the menu. */
    admin.appendChild(postMenu({ items: [
      moveSel,
      modLinkEl(topic.id, topic.sticky ? 'unsticky' : 'sticky', topic.sticky ? '(unsticky)' : '(sticky)'),
      modLinkEl(topic.id, topic.locked ? 'unlock' : 'lock', topic.locked ? '(unlock)' : '(lock)'),
      modLinkEl(topic.id, topic.readonly ? 'unreadonly' : 'readonly', topic.readonly ? '(un-read-only)' : '(read-only)'),
      modLinkEl(topic.id, 'delete', '(delete)'),
    ] }));
    if (window.mcSelectSheet) window.mcSelectSheet(moveSel);
    return admin;
  }

  function adminProfileEditor(card: any, hash: any, prof: any) {
    var slot = el('div', 'profile-admin-edit');
    var open = el('a', 'identity-action', 'Edit this profile (admin)');
    open.href = '#';
    slot.appendChild(open);
    card.appendChild(slot);
    open.addEventListener('click', function (e: any) {
      e.preventDefault();
      slot.textContent = '';
      function field(label: any, value: any, max: any, tag?: any) {
        slot.appendChild(el('div', 'profile-label', label));
        var inp = el(tag || 'input', 'key-input');
        if (!tag) inp.type = 'text';
        inp.value = value || '';
        inp.maxLength = max;
        slot.appendChild(inp);
        return inp;
      }
      var PLIM = profileLimits();
      var nick = field('Nickname', prof.nick, PLIM.nick);
      var bio = field('Bio', prof.bio, PLIM.bio, 'textarea');
      var sig = field('Signature', prof.signature, PLIM.sig, 'textarea');
      var avRow = el('label', 'profile-label');
      var avChk = el('input');
      avChk.type = 'checkbox';
      avRow.appendChild(avChk);
      avRow.appendChild(document.createTextNode(' Remove their avatar'));
      slot.appendChild(avRow);
      var note = el('p', 'comments-status', '');
      var save = el('button', 'btn btn-send', 'Save (admin)');
      var cancel = el('a', 'identity-action', 'Cancel');
      cancel.href = '#';
      slot.appendChild(save);
      slot.appendChild(document.createTextNode(' '));
      slot.appendChild(cancel);
      slot.appendChild(note);
      cancel.addEventListener('click', function (ev: any) { ev.preventDefault(); location.reload(); });
      save.addEventListener('click', function () {
        save.disabled = true;
        note.textContent = 'Saving…';
        fetchRetry(API + '/profile/admin', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: state.key, hash: hash, nick: nick.value,
            bio: bio.value, signature: sig.value, clear_avatar: avChk.checked }),
        }, [1000]).then(function (r) { return r.json(); }).then(function (d) {
          if (d.ok) { location.reload(); return; }
          save.disabled = false;
          note.textContent = 'Could not save: ' + (d.error || 'try again.');
        }).catch(function () {
          save.disabled = false;
          note.textContent = 'Network hiccup. Try again.';
        });
      });
    });
  }

  function bind() {
    API = B.API;
    CATS = B.CATS;
    appConfirm = B.appConfirm;
    authSig = B.authSig;
    catByKey = B.catByKey;
    el = B.el;
    fetchRetry = B.fetchRetry;
    isSharedV4Client = B.isSharedV4Client;
    pageKey = B.pageKey;
    postMenu = B.postMenu;
    profileLimits = B.profileLimits;
    renderTrustLine = B.renderTrustLine;
    section = B.section;
    skeleton = B.skeleton;
    stampFresh = B.stampFresh;
    state = B.state;
  }
  function run() { /* nothing of this module ran at the boot's top level */ }
  return { bind, run, exports: { ADMIN_HASHES, adminGate, adminProfileEditor, annotateMeta, buildFingerprint, isAdmin, topicAdminCorner } };
}
