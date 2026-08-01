/* comments-worker/src/webpush.js — the hand-rolled Web Push crypto (RFC 8291
   aes128gcm + RFC 8188 + VAPID RFC 8292). This is the one genuinely hard bit of
   the push feature, so it is proven end-to-end:

   1. A real subscription round-trip: encrypt a payload for a UA keypair, then
      decrypt it with the UA private half using an INDEPENDENT implementation of
      the RFC steps here in the test. If the derivation drifts from the spec, the
      GCM tag fails and the decrypt throws.
   2. The VAPID JWT: the Authorization header's JWT verifies under the public key
      (ES256), audiences the push origin, and carries the sub claim; the k= param
      is the public key.
   3. The PKCS8 storage format the worker imports round-trips (sign+verify). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  encryptContent, vapidAuthHeader, importVapidPrivateKey, bytesToB64u, b64uToBytes,
} from '../../comments-worker/src/webpush.js';

const enc = new TextEncoder();
const dec = new TextDecoder();

function concat(...arrays) {
  let total = 0;
  for (const a of arrays) total += a.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) { out.set(a, off); off += a.length; }
  return out;
}
// Independent HKDF-SHA256 for the decrypt side (does NOT reuse webpush.js).
async function hkdf(salt, ikm, info, length) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8);
  return new Uint8Array(bits);
}

// A fresh UA (recipient) subscription: an ECDH P-256 keypair + a 16-byte auth secret.
async function makeUaSubscription() {
  const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const pubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return { privateKey: kp.privateKey, pubRaw, auth };
}

// Reverse encryptContent's aes128gcm record using the UA private half — the proof
// that the encryption matches the RFCs a real push service implements.
async function decryptContent(ua, body) {
  const salt = body.slice(0, 16);
  const idlen = body[20];
  const asPubRaw = body.slice(21, 21 + idlen);
  const ct = body.slice(21 + idlen);

  const asPub = await crypto.subtle.importKey('raw', asPubRaw, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asPub }, ua.privateKey, 256));

  const keyInfo = concat(enc.encode('WebPush: info\0'), ua.pubRaw, asPubRaw);
  const ikm = await hkdf(ua.auth, ecdh, keyInfo, 32);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);

  const cekKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['decrypt']);
  const record = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, cekKey, ct));
  // Strip the RFC 8188 record delimiter (0x02 for the single/last record).
  assert.equal(record[record.length - 1], 0x02, 'last byte is the record delimiter');
  return dec.decode(record.slice(0, -1));
}

test('encryptContent round-trips: a UA private key decrypts the payload', async () => {
  const ua = await makeUaSubscription();
  const payload = { kind: 'reply', title: 'New reply', body: 'Someone replied to your thread', url: '/community.html?topic=5#comment-42' };
  const plaintext = enc.encode(JSON.stringify(payload));

  const body = await encryptContent(ua.pubRaw, ua.auth, plaintext);

  // Header framing: salt(16) | rs(4) | idlen(1)=65 | as_public(65) | ct
  assert.ok(body.length > 21 + 65, 'body has header + ciphertext');
  assert.equal(body[20], 65, 'idlen is the 65-byte P-256 point');
  assert.deepEqual(Array.from(body.slice(16, 20)), [0x00, 0x00, 0x10, 0x00], 'rs = 4096 big-endian');
  assert.equal(body[21], 0x04, 'as_public is an uncompressed point');

  const round = await decryptContent(ua, body);
  assert.equal(round, JSON.stringify(payload), 'decrypted plaintext equals the original payload');
});

test('encryptContent uses a fresh salt + ephemeral key each call (distinct ciphertexts)', async () => {
  const ua = await makeUaSubscription();
  const pt = enc.encode('same message');
  const a = await encryptContent(ua.pubRaw, ua.auth, pt);
  const b = await encryptContent(ua.pubRaw, ua.auth, pt);
  assert.notDeepEqual(Array.from(a.slice(0, 16)), Array.from(b.slice(0, 16)), 'salts differ');
  assert.notDeepEqual(Array.from(a), Array.from(b), 'ciphertexts differ');
  // Both still decrypt to the same plaintext.
  assert.equal(await decryptContent(ua, a), 'same message');
  assert.equal(await decryptContent(ua, b), 'same message');
});

test('vapidAuthHeader produces a JWT that verifies under the public key', async () => {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const pubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  const pubB64u = bytesToB64u(pubRaw);
  const subject = 'mailto:admin@merecatholicity.com';
  const endpoint = 'https://fcm.googleapis.com/fcm/send/abc123';

  const header = await vapidAuthHeader(kp.privateKey, pubB64u, subject, endpoint);
  const m = header.match(/^vapid t=([^,]+), k=(.+)$/);
  assert.ok(m, 'header is "vapid t=<jwt>, k=<pub>"');
  const jwt = m[1];
  assert.equal(m[2], pubB64u, 'k= is the public key');

  const [h, p, s] = jwt.split('.');
  assert.ok(h && p && s, 'JWT has three parts');

  // Signature verifies (raw r||s ES256) under the public key.
  const pubKey = await crypto.subtle.importKey('raw', pubRaw, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const sig = b64uToBytes(s);
  assert.equal(sig.length, 64, 'ES256 raw signature is 64 bytes');
  const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pubKey, sig, enc.encode(h + '.' + p));
  assert.equal(ok, true, 'JWT signature verifies');

  // Header alg + claims.
  const headerObj = JSON.parse(dec.decode(b64uToBytes(h)));
  assert.deepEqual(headerObj, { typ: 'JWT', alg: 'ES256' });
  const claims = JSON.parse(dec.decode(b64uToBytes(p)));
  assert.equal(claims.aud, 'https://fcm.googleapis.com', 'aud is the push origin');
  assert.equal(claims.sub, subject, 'sub is the configured subject');
  const now = Math.floor(Date.now() / 1000);
  assert.ok(claims.exp > now && claims.exp <= now + 12 * 60 * 60 + 5, 'exp is within 12h');
});

test('importVapidPrivateKey imports the PKCS8 storage format (sign+verify round-trip)', async () => {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', kp.privateKey));
  const stored = bytesToB64u(pkcs8);   // exactly what the VAPID_PRIVATE_KEY secret holds

  const priv = await importVapidPrivateKey(stored);
  const msg = enc.encode('vapid.import.check');
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, priv, msg));
  const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, kp.publicKey, sig, msg);
  assert.equal(ok, true, 'the imported private key signs what its public half verifies');
});

test('b64u helpers round-trip arbitrary bytes', () => {
  const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255, 65, 66]);
  assert.deepEqual(Array.from(b64uToBytes(bytesToB64u(bytes))), Array.from(bytes));
  // URL-safe alphabet, no padding.
  assert.equal(/[+/=]/.test(bytesToB64u(bytes)), false, 'no +, /, or = in base64url output');
});
