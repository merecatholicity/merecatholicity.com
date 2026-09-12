/* Domain.Access — the post-permission matrix the UI reads to decide which
   affordances to show: DM/mute (canInteract), the report link (canReport),
   edit (canEdit), delete (canDelete). Server authority is separate and
   unchanged; this only governs what the reader is offered. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Access from '../../purescript/output/Domain.Access/index.js';

const ci = (a, m, b) => Access.canInteract(a)(m)(b);
const cr = (a, m, b, ad) => Access.canReport(a)(m)(b)(ad);
const ce = (a, m, ad) => Access.canEdit(a)(m)(!!ad);
const cd = (a, m, ad) => Access.canDelete(a)(m)(ad);

test('canInteract: someone else, only if you hold a key and it is not the bot', () => {
  assert.equal(ci('x', 'me', 'bot'), true);
  assert.equal(ci('me', 'me', 'bot'), false, 'no self-interact');
  assert.equal(ci('bot', 'me', 'bot'), false, 'no bot-interact');
  assert.equal(ci('x', '', 'bot'), false, 'keyless cannot interact');
});

test('canReport: interact-able AND you are not an admin (admins act directly)', () => {
  assert.equal(cr('x', 'me', 'bot', true), false, 'admin has no report link');
  assert.equal(cr('x', 'me', 'bot', false), true);
});

test('canEdit: your own post, or any post when you are an admin (2026-09-12) — never keyless', () => {
  assert.equal(ce('me', 'me'), true);
  assert.equal(ce('x', 'me'), false);
  assert.equal(ce('x', 'me', true), true, 'an admin edits anyone\'s');
  assert.equal(ce('x', '', true), false, 'no key, no edit — admin-ness rides a key');
  assert.equal(ce('', 'me', true), true, 'an anonymous post is editable by an admin');
});

test('canDelete: your own post, or any post if you are an admin', () => {
  assert.equal(cd('x', 'me', true), true, 'admin deletes any');
  assert.equal(cd('x', 'me', false), false, 'non-admin cannot delete another');
  assert.equal(cd('me', 'me', false), true, 'own post deletable');
  assert.equal(cd('x', '', true), false, 'keyless cannot delete');
});
