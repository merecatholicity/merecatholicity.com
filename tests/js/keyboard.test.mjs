/* The keyboard shackle (2026-09-12): every field the reader types into is
 * kept wholly visible, directly above the soft keyboard — the fixed composers
 * by CSS (--mc-kb), the sheet and the theater lifted by it, and every in-flow
 * field (a reply box, an edit box a tap just opened, a topic composer, a
 * profile field, the report prompt) placed by the shell's net.
 *
 * What would break silently: the net moving back into a boot (it would leak
 * a document listener per soft navigation, or die with one); a placing that
 * scrolls the document for a field a fixed composer holds (the page behind
 * would jump for nothing); a field taller than the room bouncing between its
 * head and its foot on every keystroke; the settle ladder gone (the browser's
 * own focus scroll runs BEFORE the keyboard stands — that is the blind box);
 * the sheet or the theater no longer lifted. The placing itself is proved
 * headless with an explicit region (a keyboard cannot be raised there). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { clientAll } from '../_support/client.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const chrome = readFileSync(join(root, 'app', 'appchrome.ts'), 'utf8');
const css = readFileSync(join(root, 'styles', 'main.css'), 'utf8');
const client = clientAll();
const net = chrome.slice(chrome.indexOf('The keyboard shackle (2026-09-12)'), chrome.indexOf('window.mcKeyboard = '));

test('the net is the shell\'s, installed once, and hears focus, the keyboard and typing', () => {
  assert.ok(chrome.includes("document.addEventListener('focusin', function (e: any) { if (kbField(e.target)) kbSettle(e.target); });"), 'focusin → the settle ladder');
  assert.ok(chrome.includes("document.addEventListener('input', function (e: any) { if (kbField(e.target) && e.target === document.activeElement) kbAlign(e.target); }, true);"), 'input → place again (autosize, typing under the keyboard)');
  assert.ok(chrome.includes("if (vv) vv.addEventListener('resize', function () { var a: any = document.activeElement; if (kbField(a)) kbSettle(a); });"), 'the keyboard rising or changing → the ladder again');
  assert.ok(/kbLadder = \[0, 120, 300, 520, 800, 1200\]\.map/.test(net), 'the ladder spans the keyboard\'s ~300 ms rise, and a slow first rise');
  assert.ok(/kbSettleUntil = Date\.now\(\) \+ 1500;/.test(net) && /if \(Date\.now\(\) > kbSettleUntil\) return;/.test(net),
    'a settle window, inside which a scroll re-places the field (the browser\'s own late focus-scroll lands it under iOS\'s floating accessory)');
  assert.ok(chrome.includes("window.addEventListener('scroll', kbOnScroll, { passive: true, capture: true });") && chrome.includes("if (vv) vv.addEventListener('scroll', kbOnScroll);"),
    'both the document\'s and the visual viewport\'s scroll');
  assert.ok(/kbScrollT = setTimeout\(function \(\) \{ if \(document\.activeElement === a\) kbAlign\(a\); \}, 80\);/.test(net), 'once the scroll settles, never mid-gesture');
  assert.ok(!/mcKeyboard|kbAlign|kbSettle/.test(client), 'nothing in the boot re-implements it — the client only benefits');
});

test('placing: every scrollable ancestor first, then the document — never for a field a fixed ancestor holds', () => {
  assert.ok(/kbScrollers\(el\)\.forEach\(function \(s\) \{/.test(net) && /s\.scrollTop = before \+ d;/.test(net), 'inner scrollers (the sheet, the theater\'s rail)');
  assert.ok(/if \(!kbFixed\(el\)\) \{\s*var d2 = kbNeed\(el, region\.top, region\.bottom\);/.test(net), 'the document only when no fixed ancestor holds the field');
  assert.ok(/function kbFixed\(el: any\) \{[\s\S]*?getComputedStyle\(n\)\.position === 'fixed'\) return true;/.test(net));
  assert.ok(/behavior: 'instant' as any/.test(net), 'placing, not travelling');
});

test('the region is the visual viewport minus the site\'s own chrome at both edges; a field taller than the room shows the caret\'s half and never bounces', () => {
  assert.ok(/var base = raw \|\| kbPretend;\s*var top = base \? base\.top : \(vv \? vv\.offsetTop : 0\), bottom = base \? base\.bottom : \(vv \? vv\.offsetTop \+ vv\.height : window\.innerHeight\);/.test(net),
    'the visual viewport, or the proof\'s pretend one (given, or standing) — the chrome comes off either');
  assert.ok(/var region = kbRegion\(raw\);/.test(net), 'a placing never bypasses the chrome subtraction');
  assert.ok(/var KB_TOP_BARS = '\.mc-appbar, \.mc-deskbar, \.dm-head';/.test(net), 'the fixed top bar and the DM\'s sticky header');
  assert.ok(/var KB_BOTTOM_BARS = '\.mc-tabbar, \.dm-composer, \.merecat-form, \.mc-dock';/.test(net),
    'every fixed bar that can stand on the keyboard — a field "on the keyboard" would otherwise sit BEHIND the composer (the DM edit box, 2026-09-12)');
  assert.ok(/if \(tr\.height > 0 && tr\.top <= top \+ 2 && tr\.bottom > top\) top = tr\.bottom;/.test(net) && /if \(br\.height > 0 && br\.top < bottom && br\.bottom >= bottom - 2\) bottom = br\.top;/.test(net),
    'by their rects: a tab bar slid away under the keyboard drops out by itself');
  assert.ok(/for \(var pass = 0; pass < 2; pass\+\+\)/.test(net), 'two passes: a bar standing on a bar');
  const need = net.slice(net.indexOf('function kbNeed('), net.indexOf('function kbAlign('));
  assert.ok(/var KB_GROUPS = '\.dm-edit-box, \.comment-editor, \.wall-edit-box, \.comment-form, \.mc-confirm, \[data-mc-kb-group\]';/.test(net),
    'the editor a field sits in — with its Save/Post row — is what is placed when it fits');
  assert.ok(/var g = kbGroup\(el\);\s*if \(g !== el\) \{\s*var gr = g\.getBoundingClientRect\(\);\s*if \(gr\.height <= room\) r = gr;/.test(need), 'the editor when it fits the room, else the field');
  assert.ok(/if \(r\.height >= room\) \{/.test(need) && /atFoot = el\.selectionEnd >= el\.value\.length \/ 2;/.test(need),
    'taller than the room: the foot when the caret is past the middle, else the head — one rule, so successive placings agree');
  assert.ok(/if \(r\.bottom > vb - gap\) return Math\.round\(r\.bottom - \(vb - gap\)\);\s*if \(r\.top < vt \+ gap\) return Math\.round\(r\.top - \(vt \+ gap\)\);\s*return 0;/.test(need),
    'a field that fits: its foot onto the keyboard when hidden below, its head under the bar when hidden above, nothing when visible');
});

test('the sheet and the theater are lifted onto the keyboard, as the composers are', () => {
  assert.ok(/body\.mc-kb-open \.mc-sheet \{\s*bottom: var\(--mc-kb, 0px\);\s*max-height: calc\(100vh - var\(--mc-kb, 0px\) - 3rem\);\s*max-height: calc\(100dvh - var\(--mc-kb, 0px\) - 3rem\);/.test(css),
    'the sheet rides --mc-kb, capped to the room above the keyboard (dvh: the layout viewport, which the keyboard never shrinks)');
  assert.ok(/body\.mc-app\.mc-kb-open \.wall-lightbox \{ bottom: var\(--mc-kb, 0px\); \}/.test(css), 'the theater too');
  assert.ok(/body\.mc-kb-open \.merecat-form \{ bottom: var\(--mc-kb, 0px\)/.test(css), 'the merecat row, as before');
  assert.ok(/body\.mc-app\.mc-kb-open \.dm-composer\{bottom:var\(--mc-kb,0px\)/.test(client), 'the DM composer, as before');
});
