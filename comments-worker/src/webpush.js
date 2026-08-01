/* Web Push (RFC 8291 aes128gcm + RFC 8188 + VAPID RFC 8292), hand-rolled on
   crypto.subtle so the worker sends real push with NO external service and NO
   Node 'crypto' lib (Cloudflare Workers do this natively). deliverPush in
   index.js is the only caller; it stays non-fatal — a push that fails must never
   affect the post or DM that triggered it.

   The math, once, so it can be checked against the RFCs:
     VAPID JWT (ES256): header.payload signed with the P-256 private key; the
       Authorization header carries the JWT (t=) and the public key (k=).
     Content encryption: an ephemeral P-256 keypair does ECDH with the UA's
       p256dh; RFC 8291 folds the shared secret with the auth secret into the
       IKM; RFC 8188 derives the AES-128-GCM key + nonce; the body is the
       standard aes128gcm single record (salt | rs | idlen | as_public | ct).
   tests/worker/webpush.test.mjs decrypts a real round-trip to prove it. */

const enc = new TextEncoder();

function concat(...arrays) {
  let total = 0;
  for (const a of arrays) total += a.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) { out.set(a, off); off += a.length; }
  return out;
}

/* base64url <-> bytes (no padding on the way out; tolerant on the way in). */
export function bytesToB64u(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < b.length; i += 1) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function b64uToBytes(str) {
  const norm = String(str || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = norm + '==='.slice((norm.length + 3) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

function b64uStr(str) { return bytesToB64u(enc.encode(str)); }

/* HKDF-SHA256 (extract + expand in one) via crypto.subtle. length <= 32 here, so
   the single-block expand WebCrypto performs is exactly what the RFCs specify. */
async function hkdf(salt, ikm, info, length) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8);
  return new Uint8Array(bits);
}

/* The VAPID private key is stored (secret) as base64url(PKCS8 DER). */
export function importVapidPrivateKey(b64u) {
  return crypto.subtle.importKey('pkcs8', b64uToBytes(b64u), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}

/* Build the VAPID Authorization header for one endpoint: a 12-hour ES256 JWT
   audienced at the push service origin, plus the public key as k=. */
export async function vapidAuthHeader(privKey, pubB64u, subject, endpoint) {
  const header = { typ: 'JWT', alg: 'ES256' };
  const payload = {
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: subject,
  };
  const signingInput = b64uStr(JSON.stringify(header)) + '.' + b64uStr(JSON.stringify(payload));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privKey, enc.encode(signingInput));
  const jwt = signingInput + '.' + bytesToB64u(new Uint8Array(sig));   // WebCrypto ECDSA sig is raw r||s (64 bytes) — exactly JOSE ES256
  return 'vapid t=' + jwt + ', k=' + pubB64u;
}

/* Encrypt `plaintext` (bytes) for a subscription's p256dh/auth into the aes128gcm
   body a push service expects. Returns the full RFC 8188 record. */
export async function encryptContent(uaPubRaw, authSecret, plaintext) {
  // Ephemeral (application-server) ECDH keypair, fresh per message.
  const asKeys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', asKeys.publicKey));   // 65 bytes, 0x04||X||Y
  const uaPubKey = await crypto.subtle.importKey('raw', uaPubRaw, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaPubKey }, asKeys.privateKey, 256));

  // RFC 8291 §3.4: combine the ECDH secret with the auth secret into the IKM.
  const keyInfo = concat(enc.encode('WebPush: info\0'), uaPubRaw, asPubRaw);
  const ikm = await hkdf(authSecret, ecdh, keyInfo, 32);

  // RFC 8188: derive the content-encryption key + nonce from a random salt.
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);

  const cekKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const record = concat(plaintext, new Uint8Array([0x02]));   // single, last record => 0x02 delimiter (no padding)
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, cekKey, record));

  // Header: salt(16) | rs(4, big-endian = 4096) | idlen(1)=65 | keyid(as_public,65) | ciphertext
  const rs = new Uint8Array([0x00, 0x00, 0x10, 0x00]);
  const idlen = new Uint8Array([asPubRaw.length]);
  return concat(salt, rs, idlen, asPubRaw, ct);
}

/* Prepare a sender bound to this worker's VAPID identity: imports the private key
   ONCE, then `send(subscription, payloadObj)` handles one endpoint. Returns
   { status, ok, gone } — `gone` (404/410) tells deliverPush to prune the token.
   Never throws; a transport/crypto failure resolves to { ok:false }. */
export async function createPusher(env) {
  const privKey = await importVapidPrivateKey(env.VAPID_PRIVATE_KEY);
  const pubB64u = String(env.VAPID_PUBLIC_KEY || '');
  const subject = String(env.VAPID_SUBJECT || 'mailto:admin@merecatholicity.com');
  return {
    async send(subscription, payloadObj) {
      try {
        if (!subscription || !subscription.endpoint || !subscription.keys ||
            !subscription.keys.p256dh || !subscription.keys.auth) {
          return { status: 0, ok: false, gone: true };   // malformed token: drop it
        }
        const authHeader = await vapidAuthHeader(privKey, pubB64u, subject, subscription.endpoint);
        const body = await encryptContent(
          b64uToBytes(subscription.keys.p256dh),
          b64uToBytes(subscription.keys.auth),
          enc.encode(JSON.stringify(payloadObj || {})),
        );
        const res = await fetch(subscription.endpoint, {
          method: 'POST',
          headers: {
            Authorization: authHeader,
            'Content-Encoding': 'aes128gcm',
            'Content-Type': 'application/octet-stream',
            TTL: '2419200',
          },
          body,
        });
        return { status: res.status, ok: res.status >= 200 && res.status < 300, gone: res.status === 404 || res.status === 410 };
      } catch (e) {
        return { status: 0, ok: false, gone: false, error: String(e) };
      }
    },
  };
}
