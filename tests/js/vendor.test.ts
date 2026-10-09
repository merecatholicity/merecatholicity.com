/* The three third-party libraries come from npm (2026-10-09; scripts/vendor.ts).
 *
 * The client never imports them: it injects docs/<name>.min.js as a classic
 * script on first use and reads a GLOBAL — `nacl` (client/comments.ts),
 * `lamejs` (client/composer.ts), `qrcode` (app/appchrome.ts). What would break
 * silently is a version bump that changes the file's shape: an ES-module build,
 * a renamed global, a UMD that no longer falls back to `self`. The script tag
 * would load, the global would be missing, and the feature would fail only in
 * a browser. So this RUNS each file vendor.ts writes as a bare classic script
 * in an empty context and asks for the global, the way the page does. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { VENDORED } from '../../scripts/vendor.ts';

/* An empty global, as a page's classic script sees one: `self` is the global
   (tweetnacl's UMD writes self.nacl), and there is no module or define. */
function run(name: string): Record<string, any> {
  const g: Record<string, any> = {};
  g.self = g;
  g.crypto = globalThis.crypto;
  vm.runInContext(VENDORED[name](), vm.createContext(g), { filename: name });
  return g;
}

test('vendor.ts writes exactly the three files the client asks mcAsset for', () => {
  assert.deepEqual(Object.keys(VENDORED).sort(), ['lamejs.min.js', 'qr.min.js', 'tweetnacl.min.js']);
});

test('tweetnacl.min.js defines self.nacl, and a box opens for its recipient only', () => {
  const page = run('tweetnacl.min.js');
  const nacl = page.nacl;
  assert.ok(nacl && nacl.box && nacl.secretbox, 'the DM envelope needs box and secretbox');
  const a = nacl.box.keyPair(), b = nacl.box.keyPair(), c = nacl.box.keyPair();
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  /* the page's own Uint8Array: tweetnacl checks instanceof, and this realm's is another */
  const sealed = nacl.box(vm.runInContext('new Uint8Array([1, 2, 3])', page), nonce, b.publicKey, a.secretKey);
  assert.deepEqual(Array.from(nacl.box.open(sealed, nonce, a.publicKey, b.secretKey)), [1, 2, 3]);
  assert.equal(nacl.box.open(sealed, nonce, a.publicKey, c.secretKey), null);
});

test('lamejs.min.js defines the global lamejs, whose Mp3Encoder encodes a frame', () => {
  const lamejs = run('lamejs.min.js').lamejs;
  assert.equal(typeof lamejs?.Mp3Encoder, 'function', 'the voice note encoder');
  const enc = new lamejs.Mp3Encoder(1, 44100, 64);
  const pcm = new Int16Array(1152 * 4);
  for (let i = 0; i < pcm.length; i++) pcm[i] = Math.round(8000 * Math.sin(i / 10));
  const bytes = enc.encodeBuffer(pcm).length + enc.flush().length;
  assert.ok(bytes > 0, 'an MP3 came out');
});

test('qr.min.js defines the global qrcode, and it draws a code', () => {
  const qrcode = run('qr.min.js').qrcode;
  assert.equal(typeof qrcode, 'function', 'the profile QR');
  const qr = qrcode(0, 'M');
  qr.addData('https://merecatholicity.com/@abc123');
  qr.make();
  assert.ok(qr.getModuleCount() >= 21);
  assert.equal(typeof qr.isDark(0, 0), 'boolean');
});
