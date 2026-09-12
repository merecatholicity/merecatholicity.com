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
  assert.ok(/kbLadder = \[0, 120, 300, 520, 800\]\.map/.test(net), 'the ladder spans the keyboard\'s ~300 ms rise');
  assert.ok(!/mcKeyboard|kbAlign|kbSettle/.test(client), 'nothing in the boot re-implements it — the client only benefits');
});

test('placing: every scrollable ancestor first, then the document — never for a field a fixed ancestor holds', () => {
  assert.ok(/kbScrollers\(el\)\.forEach\(function \(s\) \{/.test(net) && /s\.scrollTop = before \+ d;/.test(net), 'inner scrollers (the sheet, the theater\'s rail)');
  assert.ok(/if \(!kbFixed\(el\)\) \{\s*var d2 = kbNeed\(el, region\.top, region\.bottom\);/.test(net), 'the document only when no fixed ancestor holds the field');
  assert.ok(/function kbFixed\(el: any\) \{[\s\S]*?getComputedStyle\(n\)\.position === 'fixed'\) return true;/.test(net));
  assert.ok(/behavior: 'instant' as any/.test(net), 'placing, not travelling');
});

test('the region is the visual viewport under the fixed top bar; a field taller than the room shows the caret\'s half and never bounces', () => {
  assert.ok(/var top = vv \? vv\.offsetTop : 0, bottom = vv \? vv\.offsetTop \+ vv\.height : window\.innerHeight;/.test(net));
  assert.ok(/document\.querySelectorAll\('\.mc-appbar, \.mc-deskbar'\)/.test(net) && /if \(br\.height > 0 && br\.bottom > top\) \{ top = br\.bottom; break; \}/.test(net),
    'the drawn bar\'s foot is the region\'s head — by its rect, since a fixed bar has no offsetParent');
  const need = net.slice(net.indexOf('function kbNeed('), net.indexOf('function kbAlign('));
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
