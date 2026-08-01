/* Domain.Access — the post-permission matrix the UI reads to decide which
   affordances to show: DM/mute (canInteract), the report link (canReport),
   edit (canEdit), delete (canDelete). Server authority is separate and
   unchanged; this only governs what the reader is offered. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Access from '../../purescript/output/Domain.Access/index.js';

const ci = (a, m, b) => Access.canInteract(a)(m)(b);
const cr = (a, m, b, ad) => Access.canReport(a)(m)(b)(ad);
const ce = (a, m) => Access.canEdit(a)(m);
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

test('canEdit: only your own post', () => {
  assert.equal(ce('me', 'me'), true);
  assert.equal(ce('x', 'me'), false);
});

test('canDelete: your own post, or any post if you are an admin', () => {
  assert.equal(cd('x', 'me', true), true, 'admin deletes any');
  assert.equal(cd('x', 'me', false), false, 'non-admin cannot delete another');
  assert.equal(cd('me', 'me', false), true, 'own post deletable');
  assert.equal(cd('x', '', true), false, 'keyless cannot delete');
});
