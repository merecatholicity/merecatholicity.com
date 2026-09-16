/* Envelope v2 (2026-09-13; Domain.Dm.encSealed): a random content key per
 * message, boxed once per member — the crypto that makes a conversation of
 * many end-to-end. Proven by RUNNING the client's own functions with the
 * vendored tweetnacl: three identities seal and open, a fourth cannot, a
 * member left out of a later word cannot open it, an edit re-sealed under
 * the same key opens for everyone, a pair's older E1 word still opens both
 * ways, and a tampered body opens for nobody.
 *
 * What would break silently: a key sealed to the wrong public key (a word
 * nobody can open, or one a stranger can); the sender unable to read their
 * own word back; an edit that dropped every member's key; the E1 road broken
 * by the E3 one; a forged body accepted. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { clientModule } from '../_support/client.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
/* The vendored UMD reads `self` as it loads (a browser global); give Node one. */
if (typeof globalThis.self === 'undefined') globalThis.self = globalThis;
let nacl = createRequire(import.meta.url)(join(root, 'docs', 'tweetnacl.min.js'));
if (!nacl || !nacl.box) nacl = globalThis.self.nacl;
assert.ok(nacl && nacl.box && nacl.secretbox, 'tweetnacl loaded with box and secretbox');
const src = clientModule('dm-crypto');
const fn = (name) => {
  const i = src.indexOf(`function ${name}(`);
  assert.ok(i > 0, `${name} not found`);
  const j = src.indexOf('\n  function ', i + 10);
  return src.slice(i, j > i ? j : i + 8000);
};
const names = ['dmB64uEnc', 'dmB64uDec', 'myDmKeypair', 'dmEncrypt', 'dmDecrypt', 'dmSealKeyTo', 'dmOpenKey', 'dmSealBody', 'dmOpenBody', 'dmSealFor', 'dmOpen', 'dmPlain', 'dmReseal'];
/* The client is TypeScript; these carry only `: any` annotations. */
const body = 'var _dmKP = null, _dmKPFor = null;\n' + names.map((n) => fn(n)).join('\n').replace(/: any\b/g, '');
const factory = new Function('nacl', 'state', body + '\nreturn { dmB64uEnc, myDmKeypair, dmEncrypt, dmDecrypt, dmSealFor, dmOpen, dmPlain, dmReseal, dmOpenBody, dmSealBody };');
/* One seat per identity: the keypair is derived from the identity secret. */
const seat = (key) => {
  const state = { key, myHash: 'h' + key };   // the hash need only be distinct per seat here
  const env = factory(nacl, state);
  return { env, hash: state.myHash, pub: env.dmB64uEnc(env.myDmKeypair().publicKey) };
};
const A = seat('secret-of-ann'), B = seat('secret-of-bob'), C = seat('secret-of-cy'), D = seat('secret-of-di');
const roster = (...seats) => seats.map((s) => ({ hash: s.hash, pubkey: s.pub }));
const ctxFor = (seats) => { const by = {}; seats.forEach((s) => { by[s.hash] = s.pub; }); return { pubOf: (h) => by[h] || null, otherPub: null }; };
/* the word as the server serves it to `reader`: the body, MY sealed key beside it */
const served = (sent, sender, reader) => ({ enc: 3, sender_hash: sender.hash, body: sent.body, sealed: sent.keys[reader.hash] || null });

test('a word sealed for three opens for each of them — the sender included — and for nobody else', () => {
  const sent = A.env.dmSealFor('the first word', roster(A, B, C));
  assert.ok(sent.body.startsWith('E3.'), 'the sealed tag');
  assert.deepEqual(Object.keys(sent.keys).sort(), [A.hash, B.hash, C.hash].sort(), 'one key per member, the sender among them, nobody else');
  const ctx = ctxFor([A, B, C, D]);
  assert.equal(A.env.dmOpen(served(sent, A, A), ctx), 'the first word', 'the sender reads their own word back');
  assert.equal(B.env.dmOpen(served(sent, A, B), ctx), 'the first word');
  assert.equal(C.env.dmOpen(served(sent, A, C), ctx), 'the first word');
  assert.equal(D.env.dmOpen(served(sent, A, D), ctx), null, 'a stranger has no key');
  /* the live frame carries the whole map: a reader takes their own entry */
  assert.equal(B.env.dmOpen({ enc: 3, sender_hash: A.hash, body: sent.body, keys: sent.keys }, ctx), 'the first word');
  /* someone else's entry opens nothing for me */
  assert.equal(B.env.dmOpen({ enc: 3, sender_hash: A.hash, body: sent.body, sealed: sent.keys[C.hash] }, ctx), null, "another member's key is ciphertext to me");
});

test('a member left out of a later word cannot open it: no history for a newcomer, nothing further for a leaver', () => {
  const ctx = ctxFor([A, B, C]);
  const before = A.env.dmSealFor('before Cy joined', roster(A, B));
  assert.equal(C.env.dmOpen(served(before, A, C), ctx), null, 'a newcomer has no key for the earlier word');
  const after = B.env.dmSealFor('after Cy left', roster(A, B));
  assert.equal(C.env.dmOpen(served(after, B, C), ctx), null, 'a leaver has no key for the later word');
  assert.equal(A.env.dmOpen(served(after, B, A), ctx), 'after Cy left');
});

test('an edit re-sealed under the SAME key opens for every member without new keys; a pair\'s E1 word still opens both ways', () => {
  const ctx = ctxFor([A, B, C]);
  const sent = A.env.dmSealFor('a word with a typo', roster(A, B, C));
  const mine = served(sent, A, A);
  assert.equal(A.env.dmOpen(mine, ctx), 'a word with a typo');
  const edit = A.env.dmReseal('a word without a typo', mine, ctx);
  assert.equal(edit.enc, 3, 'sealed');
  assert.notEqual(edit.body, sent.body, 'a fresh nonce');
  const theirs = served(sent, A, B);
  assert.equal(B.env.dmOpen(theirs, ctx), 'a word with a typo');
  assert.equal(B.env.dmOpen({ enc: 3, sender_hash: A.hash, body: edit.body, sealed: sent.keys[B.hash] }, ctx), 'a word without a typo', "the member's old key opens the new words");
  /* E1: the pair's box, symmetric */
  const e1 = A.env.dmEncrypt('an older word', B.pub);
  assert.equal(B.env.dmPlain({ enc: 1, body: e1 }, { otherPub: A.pub }), 'an older word');
  assert.equal(A.env.dmPlain({ enc: 1, body: e1 }, { otherPub: B.pub }), 'an older word', 'the sender re-reads through the same secret');
  assert.equal(C.env.dmPlain({ enc: 1, body: e1 }, { otherPub: A.pub }), null, 'not a third party');
  const e1edit = A.env.dmReseal('an older word, edited', { enc: 1, body: e1 }, { otherPub: B.pub });
  assert.equal(e1edit.enc, 1, 'an E1 word is re-sealed to the pair');
});

test('a tampered body opens for nobody; a word without its envelope is nothing', () => {
  const ctx = ctxFor([A, B]);
  const sent = A.env.dmSealFor('untouched', roster(A, B));
  const parts = sent.body.split('.');
  const ct = Buffer.from(parts[2].replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  ct[3] ^= 0x01;
  const forged = parts[0] + '.' + parts[1] + '.' + ct.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  assert.equal(B.env.dmOpen(served({ body: forged, keys: sent.keys }, A, B), ctx), null, 'Poly1305 refuses the flipped byte');
  assert.equal(B.env.dmPlain({ enc: 0, body: 'plain' }, ctx), null, 'a plain word is not opened here');
  assert.equal(B.env.dmPlain({ enc: 3, body: 'E1.x.y', sealed: sent.keys[B.hash], sender_hash: A.hash }, ctx), null, 'a mismatched tag');
});
