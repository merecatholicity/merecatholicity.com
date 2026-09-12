/* A profile picture pops out full size (2026-09-12): a tap (or Enter) on the
 * avatar on a profile page opens the bare media theater — the image as large
 * as the viewport allows, a download beside it, the five ways out the theater
 * already has (scrim, ✕, Esc, back, a navigation).
 *
 * What would break silently: the theater growing back a media-key-only door
 * (openImage would 404 a plain URL); the avatar losing its button semantics
 * (a keyboard reader could not open it); the zoom cursor rule dropped. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { clientModule } from '../_support/client.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const composer = clientModule('composer');
const profile = clientModule('profile');
const css = readFileSync(join(root, 'styles', 'main.css'), 'utf8');

test('the theater takes a URL and a filename; openMedia and openImage are two doors to the one lightbox', () => {
  assert.ok(/function openMedia\(mediaKey: any, kind: any, post: any\) \{\s*openLightbox\(API \+ '\/wall\/media\?key=' \+ encodeURIComponent\(mediaKey\), kind, post, mediaFilename\(mediaKey\)\);/.test(composer));
  assert.ok(/function openImage\(src: any, filename: any\) \{\s*openLightbox\(src, 'i', null, filename\);/.test(composer), 'a lone image, bare');
  const lb = composer.slice(composer.indexOf('function openLightbox('), composer.indexOf('function bind()'));
  assert.ok(!/mediaFilename\(mediaKey\)/.test(lb), 'the lightbox never derives a name from a media key it may not have');
  assert.ok(/mediaDownloadLink\(src, filename, 'Download'/.test(lb), 'the bare rail\'s download carries the given name');
});

test('the profile avatar is a button that opens the picture full size', () => {
  const rp = profile.slice(profile.indexOf('function renderProfile('), profile.indexOf('function renderProfileWall('));
  assert.ok(/avatar\.classList\.add\('profile-avatar-zoom'\);/.test(rp));
  assert.ok(/avatar\.setAttribute\('role', 'button'\); avatar\.tabIndex = 0;/.test(rp), 'reachable by keyboard');
  assert.ok(/openImage\(img\.src, 'avatar-' \+ String\(p\.hash \|\| ''\)\.slice\(0, 8\) \+ '\.jpg'\)/.test(rp), 'the very URL the head shows, a short filename');
  assert.ok(/avatar\.addEventListener\('click', zoom\);/.test(rp) && /e\.key === 'Enter' \|\| e\.key === ' '/.test(rp));
  assert.ok(/\.profile-avatar-zoom \{ cursor: zoom-in; \}/.test(css));
});
