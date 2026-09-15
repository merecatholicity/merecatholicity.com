/* Conversations with members, on the client (2026-09-13): a group's bubbles
 * name their author (once per run, in the member's colour), the membership
 * lines read as sentences, the pill is the public painter's tally with the
 * DM's own pick, the header wears a collage and the count, the ⓘ sheet
 * lists the members (add, leave, name, verify, block), a pair's ⓘ offers
 * Add members (a fork), the inbox opens New group, and every write that
 * touches a group goes through the kernel's caps and grammar.
 *
 * What would break silently: an author line on a pair's bubbles (the side
 * says who) or none in a group; a membership line drawn as a bubble with a
 * surface to react on; a group's pill wired to the public ledger; a picker
 * that lets the cap be passed; the actor of an add left looking at the
 * roster as it was; a group opened by anything but its id. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clientModule } from '../_support/client.mjs';

const src = clientModule('dm');
const fn = (name, next) => {
  const i = src.indexOf(`function ${name}(`);
  assert.ok(i > 0, `${name} not found`);
  const j = next ? src.indexOf(`function ${next}(`, i + 10) : src.indexOf('\n  function ', i + 10);
  return src.slice(i, j > i ? j : i + 8000);
};
const view = src.slice(src.indexOf('function viewDm('), src.indexOf('\n  function bind() {'));

test('a group names its authors, once per run, in the member\'s colour; a pair never does', () => {
  const bubble = fn('dmBubble');
  assert.ok(/if \(!mine && m\._author && opts && opts\.ctx && opts\.ctx\.kind === 1\) \{/.test(bubble), 'another\'s bubble, in a group, when placeMsg said so');
  assert.ok(/window\.mcCore\.dmMemberHue\(String\(m\.sender_hash \|\| ''\)\)/.test(bubble) && /el\('div', 'dm-author dm-hue-' \+ hue, opts\.ctx\.nameOf\(m\.sender_hash\)\)/.test(bubble), 'the kernel\'s hue, the roster\'s name');
  assert.ok(/m\._author = kind === 1 && String\(m\.sender_hash\) !== state\.myHash && lastSender !== String\(m\.sender_hash\);/.test(view), 'once per run of the same sender');
  assert.ok(/if \(day !== lastDay\) \{ list\.appendChild\(dmDayNode\(m\.created_at\)\); lastDay = day; lastSender = ''; \}/.test(view), 'a new day names the author again');
});

test('a membership line is a muted line, read by the kernel\'s grammar — never a bubble, never a surface', () => {
  const render = fn('dmRenderMsg');
  assert.ok(/else if \(e === 2 && window\.mcCore && window\.mcCore\.dmSysLine && window\.mcCore\.dmSysLine\(String\(m\.body \|\| ''\)\)\) \{[\s\S]*?return dmSysLineNode\(m, ctx\);/.test(render), 'before the call line and the bubbles');
  const line = fn('dmSysLineNode');
  assert.ok(/el\('div', 'dm-call-line dm-sys-line'\)/.test(line), 'the call line\'s shape (no receipt, no surface: dmArmMessage never sees it)');
  assert.ok(/core\.dmSysLineText\(String\(m\.body \|\| ''\), actor, who\)/.test(line) && /String\(h\) === state\.myHash \? 'you'/.test(line) && /var actor = mine \? 'You' : who\(m\.sender_hash\);/.test(line), '"You added Bob and you" — the reader is "you"');
});

test('a group\'s pill is the public painter with the DM\'s own pick and names; a pair keeps its two-sided pill', () => {
  const paint = fn('dmReactPaint');
  assert.ok(/if \(ctx && ctx\.kind === 1\) \{[\s\S]*?window\.mcCore\.dmTally\(m\.reactions \|\| \[\]\)[\s\S]*?reactPillInto\(host, 'dm', m\.id, cells, dmReactSides\(m\)\.mine, \{\s*onPick: function \(e: any\) \{ dmReact\(m, node, ctx, e\); \}/.test(paint), 'the tally, the surface\'s own act');
  assert.ok(/var rx = dmReactSides\(m\);/.test(paint), 'a pair: the two sides');
  const surface = clientModule('surface');
  assert.ok(/function reactPillInto\(host: any, target: any, id: any, cells: any\[\], mine: string, opts\?: any\)/.test(surface) && /if \(opts && opts\.onPick\) opts\.onPick\(c\.e\); else reactSend\(target, id, c\.e\);/.test(surface) && /if \(!\(opts && opts\.onPick\)\) attachWho\(chip, target, id\);/.test(surface),
    'the painter takes the DM\'s pick and never wires a group\'s chip to /react or /react/who');
});

test('the ⓘ sheet: the members with presence, verify and block; Add members (a pair forks); Leave and Name for a group; the actor reopens the conversation as it stands', () => {
  assert.ok(/mem\.appendChild\(el\('div', 'dm-info-row-title', '👥 ' \+ \(kind === 1 \? cur\.length \+ ' members' : 'Members'\)\)\);/.test(view));
  assert.ok(/dmVerifyPanel\(mm\.hash, mm\.pubkey, v2\)/.test(view), 'a safety number per member');
  assert.ok(/setBlock\(mm\.hash, true, function \(\) \{ location\.reload\(\); \}\)/.test(view), 'block, per member');
  assert.ok(/API \+ '\/dm\/presence'/.test(view.slice(view.indexOf('var mlist = el'))), 'one batched presence read for the sheet');
  assert.ok(/identityAction\('Add members', function \(\) \{\s*dmMemberPicker\(\{ title: 'Add members', submitLabel: 'Add', exclude: members\.filter/.test(view), 'Add members runs the picker, current members excluded');
  assert.ok(/body: JSON\.stringify\(\{ key: state\.key, token: token, thread_id: threadId, add: hashes \}\)/.test(view) && /go\('messages\.html\?t=' \+ \(d\.thread_id \|\| threadId\)\);/.test(view), 'the add, then the conversation reopened by id (a fork opens the new group)');
  assert.ok(/identityAction\('Leave conversation', function \(\) \{/.test(view) && /API \+ '\/dm\/leave'/.test(view) && /go\('messages\.html'\)/.test(view), 'Leave, then the inbox');
  assert.ok(/API \+ '\/dm\/name'/.test(view) && /state\.dmView\.setName\(d\.name\)/.test(view), 'Name, painted live');
  assert.ok(/if \(threadId\) \{\s*var mem = el\('div', 'dm-info-row'\);/.test(view), 'a room not yet made has no members to list or add to');
});

test('the member picker: the cap is the kernel\'s, the directory searched, the chosen returned; New group opens by its id', () => {
  const picker = fn('dmMemberPicker');
  assert.ok(/var cap = \(window\.mcCore && window\.mcCore\.dmMaxMembers\) \|\| 25;/.test(picker) && /if \(cb\.checked && have \+ Object\.keys\(chosen\)\.length \+ 1 > cap\)/.test(picker), 'no more than the cap, the members already in counted');
  assert.ok(/exclude\.indexOf\(u\.hash\) === -1/.test(picker) && /u\.hash !== MERECAT_BOT_HASH/.test(picker), 'never a current member, never the bot');
  assert.ok(/nameIn\.maxLength = \(window\.mcCore && window\.mcCore\.dmGroupNameMax\) \|\| 60;/.test(picker), 'the name\'s cap is the kernel\'s');
  const box = fn('dmSearchBox');
  assert.ok(/dmMemberPicker\(\{ title: 'New group', nameField: true, submitLabel: 'Create', exclude: \[state\.myHash\], count: 1/.test(box), 'New group: me and the chosen');
  assert.ok(/API \+ '\/dm\/groups'/.test(box) && /go\('messages\.html\?t=' \+ d\.thread_id\);/.test(box), 'the group opens by its id');
  /* ONE list, two roads (the owner's second look, 2026-09-14): New group is the
     list's first row, shown on focus before a letter is typed; no button beside
     the field, no second pathway. */
  assert.ok(/sug\.appendChild\(groupRow\(sel === 0\)\);\s*current\.forEach/.test(box), 'the New group row leads the list');
  assert.ok(/input\.addEventListener\('focus', function \(\) \{ renderSug\(\); \}\);/.test(box), 'the list opens on focus');
  assert.ok(/if \(sel === 0\) openNewGroup\(\);/.test(box) && /sel = current\.length \? 1 : 0;/.test(box), 'Enter opens the best match, or the group when there is none');
  assert.ok(!/dm-new-group/.test(src), 'no button beside the field');
});

test('the header wears a group\'s collage and its count; presence and the call stay a pair\'s', () => {
  assert.ok(/if \(kind === 1\) \{ dmCollageInto\(host, members\.filter\(function \(mm: any\) \{ return !mm\.left_at && mm\.hash !== state\.myHash; \}\)\); return; \}/.test(view));
  assert.ok(/if \(kind === 1\) \{ sub\.appendChild\(document\.createTextNode\(members\.filter\(function \(mm: any\) \{ return !mm\.left_at; \}\)\.length \+ ' members · 🔒'\)\); return; \}/.test(view), 'the count under the name');
  assert.ok(/if \(kind === 0 && other && other !== MERECAT_BOT_HASH && \(window as any\)\.RTCPeerConnection/.test(view), 'the 📞 is a pair\'s');
  assert.ok(/if \(kind === 0 && other\) \{ subs\.push\('presence:' \+ other\); if \(!threadId\) subs\.push\('dmview:' \+ other\); \}/.test(view), 'live presence is a pair\'s (a group asks once, in the sheet)');
  const collage = fn('dmCollageInto');
  assert.ok(/window\.mcCore\.dmInboxAvatars\) \|\| 4/.test(collage), 'up to four faces, the kernel\'s number');
});
