/* The DM crypto: the nacl loader, base64url, the identity's X25519 pair, the pair's box (E1) and envelope v2's sealed content key (E3), safety numbers and the verified set, the E2E explainer and badge.
   Split out of client/dm.ts on 2026-09-16 (the six DM factories); every declaration
   moved verbatim. Names from the boot and the other modules are bound in bind(). */
import type { Boot } from './boot';

export function installDmCrypto(B: Boot) {
  /* Names this module takes from the boot — the root's helpers and the other
     modules' exports — bound in bind() once every module is installed, so
     order of installation never matters and every body reads as it did. */
  let NACL_SRC: string;
  let appConfirm: (msg: any, opts: any, cb: any) => any;
  let el: (tag: string, cls?: string | null, text?: string | number | null) => any;
  let state: Record<string, any>;

  var _naclP: any = null;

  function ensureNacl(): Promise<any> {
    if (window.nacl) return Promise.resolve(window.nacl);
    if (_naclP) return _naclP;
    _naclP = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = NACL_SRC;
      s.async = true;
      s.onload = function () { if (window.nacl) resolve(window.nacl); else { _naclP = null; reject(new Error('nacl')); } };
      s.onerror = function () { _naclP = null; reject(new Error('nacl load failed')); };
      document.head.appendChild(s);
    });
    return _naclP;
  }

  function dmB64uEnc(bytes: any) {
    var s = '';
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function dmB64uDec(str: any) {
    var s = String(str).replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    var bin = atob(s);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  /* Keypair from the identity secret, cached until the key changes. SHA-512 of a
     domain-separated copy of the secret gives a 32-byte curve25519 seed (the
     secret is already 256-bit uniform, so this is a clean PRF); tweetnacl clamps
     it internally when it computes the public half. */
  var _dmKP: any = null, _dmKPFor: any = null;

  function myDmKeypair() {
    if (_dmKP && _dmKPFor === state.key) return _dmKP;
    var seed = nacl.hash(new TextEncoder().encode('mc/dm/x25519/v1|' + state.key)).subarray(0, 32);
    _dmKP = nacl.box.keyPair.fromSecretKey(new Uint8Array(seed));
    _dmKPFor = state.key;
    return _dmKP;
  }

  function dmEncrypt(plaintext: any, otherPubB64: any) {
    var kp = myDmKeypair();
    var nonce = nacl.randomBytes(24);
    var ct = nacl.box(new TextEncoder().encode(plaintext), nonce, dmB64uDec(otherPubB64), kp.secretKey);
    return 'E1.' + dmB64uEnc(nonce) + '.' + dmB64uEnc(ct);
  }

  function dmDecrypt(blob: any, otherPubB64: any) {
    if (typeof blob !== 'string' || blob.slice(0, 3) !== 'E1.' || !otherPubB64) return null;
    var parts = blob.split('.');
    if (parts.length !== 3) return null;
    try {
      var pt = nacl.box.open(dmB64uDec(parts[2]), dmB64uDec(parts[1]), dmB64uDec(otherPubB64), myDmKeypair().secretKey);
      return pt ? new TextDecoder().decode(pt) : null;
    } catch (e) { return null; }
  }

  /* ---- Envelope v2 (2026-09-13; Domain.Dm.encSealed = 3): a random content key
     K per message. The body is K's secretbox ("E3.<nonce>.<ct>"); K itself is
     boxed once per member — to each member's published X25519 key, from my own
     — and rides beside the body as `keys` (the server hands each reader only
     their own `sealed`). A member added later has no key for earlier words; a
     member who left has none for later ones. The same primitives and the same
     library as E1 (X25519 / XSalsa20-Poly1305), so a pair is sealed the same
     way a group is — one road. K is kept on the message (m._k) so an edit
     re-seals under it and every member's key still opens the new words. ---- */
  function dmSealKeyTo(K: any, pubB64: any) {
    var n = nacl.randomBytes(24);
    var box = nacl.box(K, n, dmB64uDec(pubB64), myDmKeypair().secretKey);
    var out = new Uint8Array(24 + box.length);
    out.set(n, 0); out.set(box, 24);
    return dmB64uEnc(out);
  }

  function dmOpenKey(sealedB64: any, senderPubB64: any) {
    if (!sealedB64 || !senderPubB64) return null;
    try {
      var raw = dmB64uDec(sealedB64);
      if (raw.length <= 24) return null;
      var K = nacl.box.open(raw.subarray(24), raw.subarray(0, 24), dmB64uDec(senderPubB64), myDmKeypair().secretKey);
      return K && K.length === 32 ? K : null;
    } catch (e) { return null; }
  }

  function dmSealBody(plaintext: any, K: any) {
    var n = nacl.randomBytes(24);
    var ct = nacl.secretbox(new TextEncoder().encode(String(plaintext)), n, K);
    return 'E3.' + dmB64uEnc(n) + '.' + dmB64uEnc(ct);
  }

  function dmOpenBody(blob: any, K: any) {
    if (!K || typeof blob !== 'string' || blob.slice(0, 3) !== 'E3.') return null;
    var parts = blob.split('.');
    if (parts.length !== 3) return null;
    try {
      var pt = nacl.secretbox.open(dmB64uDec(parts[2]), dmB64uDec(parts[1]), K);
      return pt ? new TextDecoder().decode(pt) : null;
    } catch (e) { return null; }
  }

  /* Seal a plaintext for these members — me among them, so I can read my own
     word back — under a fresh K. What /dm/send takes: the body, the keys by
     hash; K rides back on the echo. A member without a published key gets no
     key (the caller refuses the send before this). */
  function dmSealFor(plaintext: any, members: any) {
    var K = nacl.randomBytes(32);
    var keys: any = {};
    (members || []).forEach(function (mm: any) { if (mm && mm.hash && mm.pubkey) keys[mm.hash] = dmSealKeyTo(K, mm.pubkey); });
    return { body: dmSealBody(plaintext, K), keys: keys, K: K };
  }

  /* Open a sealed word from my seat: my K (served beside the word as `sealed`,
     or in a live frame's `keys` map) under the SENDER's key, then the body. */
  function dmOpen(m: any, ctx: any) {
    if (!m._k) {
      var sealed = m.sealed || (m.keys && m.keys[state.myHash]) || null;
      m._k = dmOpenKey(sealed, ctx.pubOf ? ctx.pubOf(m.sender_hash) : null);
    }
    return dmOpenBody(m.body, m._k);
  }

  /* The plaintext of a word, whichever envelope it wears: E1 with the pair's
     key, E3 with mine. Null when it cannot be opened. */
  function dmPlain(m: any, ctx: any) {
    var e = Number(m.enc || 0);
    if (e === 1) return dmDecrypt(m.body, ctx.otherPub);
    if (e === 3) return dmOpen(m, ctx);
    return null;
  }

  /* Re-seal an edit: a sealed word under the SAME K (the keys stand), a pair's
     E1 word to the pair's key. What /dm/edit takes. */
  function dmReseal(plaintext: any, m: any, ctx: any) {
    if (m._k) return { body: dmSealBody(plaintext, m._k), enc: 3 };
    if (ctx.otherPub) return { body: dmEncrypt(plaintext, ctx.otherPub), enc: 1 };
    return null;
  }

  /* A per-conversation safety number: a short fingerprint of the two public keys,
     ordered the same way on both sides so both compute the identical code. Two
     people compare it out of band to be sure no key was substituted. */
  function dmSafetyNumber(otherPubB64: any) {
    try {
      var mineBytes = myDmKeypair().publicKey;
      var mineB64 = dmB64uEnc(mineBytes);
      var theirBytes = dmB64uDec(otherPubB64);
      var mineFirst = mineB64 < otherPubB64;
      var f = mineFirst ? mineBytes : theirBytes;
      var s = mineFirst ? theirBytes : mineBytes;
      var cat = new Uint8Array(f.length + s.length);
      cat.set(f, 0); cat.set(s, f.length);
      var h = nacl.hash(cat);
      var hex = '';
      for (var i = 0; i < 10; i++) hex += ('0' + h[i].toString(16)).slice(-2);
      return hex.toUpperCase().replace(/(.{4})/g, '$1 ').trim();
    } catch (e) { return ''; }
  }

  /* Which correspondents this browser has marked "safety number verified". */
  var DM_VERIFIED = 'mc-dm-verified';

  function dmVerifiedSet() { try { var a = JSON.parse(localStorage.getItem(DM_VERIFIED) as string); return Array.isArray(a) ? a : []; } catch (e) { return []; } }

  function dmVerified(other: any) { return dmVerifiedSet().indexOf(other) !== -1; }

  function dmMarkVerified(other: any) {
    var a = dmVerifiedSet();
    if (a.indexOf(other) === -1) { a.push(other); try { localStorage.setItem(DM_VERIFIED, JSON.stringify(a)); } catch (e) {} }
  }

  /* The honest "how it works" note behind the badge — confident, scoped to what
     the design actually guarantees (stored ciphertext, keys never leave you). */
  function dmE2eExplainer() {
    appConfirm(
      'End-to-end encrypted. Your messages are encrypted on your own device before they are sent. '
      + 'We store them only as ciphertext, we do not hold the keys, and we cannot read your inbox — '
      + 'only you and the person you are writing to can open them. The encryption is standard, open '
      + 'X25519 + XSalsa20-Poly1305 (NaCl), and the code that runs it is public in our repository. '
      + 'To be sure no one is in the middle, compare the safety number at the top of a conversation. '
      + 'One thing to keep in mind: because only you hold your key, a lost key means the encrypted '
      + 'history cannot be recovered — not even by us.',
      { okLabel: 'Got it', cancelLabel: 'Close' }, function () {});
  }

  /* The tucked-away verify step: reveal the safety number and let the reader mark
     the pair confirmed (remembered locally, so it never nags again). */
  function dmVerifyPanel(other: any, otherPubB64: any, link: any) {
    appConfirm(
      'Safety number: ' + dmSafetyNumber(otherPubB64) + '.  '
      + 'Read this aloud with the person you are messaging. If it matches on both sides, no one is '
      + 'intercepting this conversation. This is optional — your messages are encrypted either way.',
      { okLabel: 'Mark verified', cancelLabel: 'Close' }, function (ok: any) {
        if (ok) { dmMarkVerified(other); if (link) link.textContent = '✓ verified'; }
      });
  }

  /* The quiet "🔒 End-to-end encrypted" badge, shared by the inbox and the thread
     view: the honest explainer one tap away, and — when a specific correspondent
     is in view — the optional safety-number verify. No PIN, no friction. */
  function dmE2eBadge(other?: any, otherPubB64?: any) {
    var e2e = el('p', 'dm-e2e');
    e2e.appendChild(document.createTextNode('🔒 End-to-end encrypted · '));
    var how = el('a', null, 'how it works');
    how.href = '#';
    how.addEventListener('click', function (ev: any) { ev.preventDefault(); dmE2eExplainer(); });
    e2e.appendChild(how);
    if (other && otherPubB64) {
      e2e.appendChild(document.createTextNode(' · '));
      var v = el('a', null, dmVerified(other) ? '✓ verified' : 'verify');
      v.href = '#';
      v.addEventListener('click', function (ev: any) { ev.preventDefault(); dmVerifyPanel(other, otherPubB64, v); });
      e2e.appendChild(v);
    }
    return e2e;
  }

  function bind() {
    NACL_SRC = B.NACL_SRC;
    appConfirm = B.appConfirm;
    el = B.el;
    state = B.state;
  }
  function run() { /* nothing of this module ran at the boot's top level */ }
  return { bind, run, exports: { dmB64uDec, dmB64uEnc, dmE2eBadge, dmE2eExplainer, dmPlain, dmReseal, dmSealFor, dmVerified, dmVerifyPanel, ensureNacl, myDmKeypair } };
}
