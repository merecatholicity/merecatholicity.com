/* Domain.Media — the media platform settings kernel: the default per-kind size
   limits and storage caps, the admin-setting clamps, the kinds-mask parser, the
   R2 object-key kind parser (the claim-time mask enforcement — strictness is
   the security property), and the exact MIME whitelists. Single-sourced into
   the worker (raw import) and the client (app/core.ts → window.mcCore). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Media from '../../purescript/output/Domain.Media/index.js';
import { orNull } from '../_support/ps.mjs';

const kindOfKey = (k) => orNull(Media.kindOfKey(k));
const kindOfMime = (m) => orNull(Media.kindOfMime(m));
const kindLetter = (k) => orNull(Media.kindLetter(k));
const letterKind = (l) => orNull(Media.letterKind(l));
const HEX64 = 'a1'.repeat(32); // 64 lowercase hex chars

test('defaults: the platform settings an admin overrides', () => {
  assert.deepEqual(Media.defaults, {
    imageMaxBytes: 10485760, // 10 MB
    videoMaxBytes: 15728640, // 15 MB
    audioMaxBytes: 5242880, // 5 MB
    audioMaxSeconds: 180,
    kindsDm: 'image,video,audio',
    kindsWall: 'image,video,audio',
    kindsBoard: 'image,video,audio', // video shipped on for the forum (2026-08-02)
    capDmBytes: 2147483648, // 2 GB
    capWallBytes: 3221225472, // 3 GB — the feed's own budget (board split out)
    capBoardBytes: 1073741824, // 1 GB — the forum's budget
    autocompress: true,
    scanWall: true, // AI image screen per public section — today's behavior kept
    scanBoard: true,
    voiceDm: true, // the 🎙 recorder feature flag, per section
    voiceWall: true,
    voiceBoard: true,
    retentionWallDays: 0, // media age retention; 0 = keep forever
    retentionBoardDays: 0,
  });
});

test('sectionNames / parseSection: dm, wall, board — lowercase-exact', () => {
  assert.deepEqual(Media.sectionNames, ['dm', 'wall', 'board']);
  for (const s of Media.sectionNames) assert.equal(orNull(Media.parseSection(s)), s);
  assert.equal(orNull(Media.parseSection('feed')), null, 'the UI word, not the wire word');
  assert.equal(orNull(Media.parseSection('DM')), null, 'case-exact');
  assert.equal(orNull(Media.parseSection('')), null);
});

test('section settings-key grammar: the one place the key names live', () => {
  assert.equal(orNull(Media.sectionKindBytesKey('board')('image')), 'media_board_image_max_bytes');
  assert.equal(orNull(Media.sectionKindBytesKey('dm')('video')), 'media_dm_video_max_bytes');
  assert.equal(orNull(Media.sectionKindBytesKey('wall')('audio')), 'media_wall_audio_max_bytes');
  assert.equal(orNull(Media.sectionKindBytesKey('feed')('image')), null, 'bad section');
  assert.equal(orNull(Media.sectionKindBytesKey('wall')('gif')), null, 'bad kind');
  assert.equal(orNull(Media.sectionVoiceKey('dm')), 'media_voice_dm');
  assert.equal(orNull(Media.sectionVoiceKey('board')), 'media_voice_board');
  assert.equal(orNull(Media.sectionVoiceKey('x')), null);
  assert.equal(orNull(Media.sectionAudioSecondsKey('wall')), 'media_audio_max_seconds_wall');
  assert.equal(orNull(Media.sectionRetentionKey('wall')), 'media_wall_retention_days');
  assert.equal(orNull(Media.sectionRetentionKey('dm')), 'media_dm_retention_days');
});

test('sectionScanKey: dm is null BY CONSTRUCTION — E2E ciphertext is unscannable', () => {
  /* DM media is end-to-end encrypted; the server holds only ciphertext, so an
     AI scan of it is structurally impossible. There is no key for anyone to
     flip — the admin UI shows a disabled, unchecked box with the honest note. */
  assert.equal(orNull(Media.sectionScanKey('wall')), 'media_scan_wall');
  assert.equal(orNull(Media.sectionScanKey('board')), 'media_scan_board');
  assert.equal(orNull(Media.sectionScanKey('dm')), null, 'the E2E law, in the type');
  assert.equal(orNull(Media.sectionScanKey('bogus')), null);
});

test('clampRetentionDays: 0 = keep forever SURVIVES the clamp; 3650 ceiling', () => {
  assert.equal(Media.clampRetentionDays(0), 0, 'the default must pass through');
  assert.equal(Media.clampRetentionDays(-5), 0, 'floor');
  assert.equal(Media.clampRetentionDays(99999), 3650, 'ceiling');
  assert.equal(Media.clampRetentionDays(365), 365);
});

test('clampDmRetentionDays: 1..90 — DM media can never be "forever"', () => {
  assert.equal(Media.clampDmRetentionDays(0), 1, 'floor');
  assert.equal(Media.clampDmRetentionDays(365), 90, 'ceiling');
  assert.equal(Media.clampDmRetentionDays(30), 30, 'the default passes');
});

test('defaults: every mask is already in canonical serialized form', () => {
  for (const mask of [Media.defaults.kindsDm, Media.defaults.kindsWall, Media.defaults.kindsBoard]) {
    assert.equal(Media.serializeKinds(Media.parseKinds(mask)), mask, `round-trips: ${mask}`);
  }
});

test('clampKindBytes: 64 KB floor, 100 MB ceiling (the request-body wall)', () => {
  assert.equal(Media.clampKindBytes(1), 65536, 'floor');
  assert.equal(Media.clampKindBytes(200000000), 104857600, 'ceiling');
  assert.equal(Media.clampKindBytes(10485760), 10485760, 'in range passes through');
});

test('clampAudioSeconds: 30 s .. 600 s', () => {
  assert.equal(Media.clampAudioSeconds(5), 30, 'floor');
  assert.equal(Media.clampAudioSeconds(3600), 600, 'ceiling');
  assert.equal(Media.clampAudioSeconds(180), 180);
});

test('clampCapBytes: 100 MB .. 9 GB (under the R2 free 10 GB)', () => {
  assert.equal(Media.clampCapBytes(1), 104857600, 'floor');
  assert.equal(Media.clampCapBytes(1e11), 9663676416, 'ceiling');
  assert.equal(Media.clampCapBytes(2147483648), 2147483648, '2 GB default passes');
});

test('parseKinds: trims, drops junk, dedupes, always canonical order', () => {
  assert.deepEqual(Media.parseKinds('image,video,audio'), ['image', 'video', 'audio']);
  assert.deepEqual(Media.parseKinds('audio, image , image'), ['image', 'audio'], 'canonical order regardless of input order');
  assert.deepEqual(Media.parseKinds('image,junk,gif,audio'), ['image', 'audio'], 'junk dropped');
  assert.deepEqual(Media.parseKinds(''), [], 'empty mask = nothing allowed');
  assert.deepEqual(Media.parseKinds('IMAGE'), [], 'kind names are lowercase-exact');
});

test('serializeKinds: canonical order, valid only, deduped', () => {
  assert.equal(Media.serializeKinds(['audio', 'image']), 'image,audio');
  assert.equal(Media.serializeKinds(['video', 'video', 'bogus']), 'video');
  assert.equal(Media.serializeKinds([]), '');
});

test('kindLetter / letterKind: i/v/a round-trip, junk -> null', () => {
  for (const [kind, letter] of [['image', 'i'], ['video', 'v'], ['audio', 'a']]) {
    assert.equal(kindLetter(kind), letter);
    assert.equal(letterKind(letter), kind, 'inverse');
  }
  assert.equal(kindLetter('gif'), null);
  assert.equal(letterKind('x'), null);
});

test('kindOfKey: accepts exactly wall/<i|v|a>/<64 lowercase hex>', () => {
  assert.equal(kindOfKey(`wall/i/${HEX64}`), 'image');
  assert.equal(kindOfKey(`wall/v/${HEX64}`), 'video');
  assert.equal(kindOfKey(`wall/a/${HEX64}`), 'audio');
});

test('kindOfKey: ANY deviation is null (claim-time mask enforcement)', () => {
  assert.equal(kindOfKey(`wall/x/${HEX64}`), null, 'unknown kind letter');
  assert.equal(kindOfKey(`dm/i/${HEX64}`), null, 'wrong prefix');
  assert.equal(kindOfKey(`board/i/${HEX64}`), null, 'wrong prefix');
  assert.equal(kindOfKey(`wall/i/${HEX64.slice(0, 63)}`), null, '63 hex chars');
  assert.equal(kindOfKey(`wall/i/${HEX64}a`), null, '65 hex chars');
  assert.equal(kindOfKey(`wall/i/${HEX64.toUpperCase()}`), null, 'uppercase hex refused');
  assert.equal(kindOfKey(`wall/i/${'g1'.repeat(32)}`), null, 'non-hex chars');
  assert.equal(kindOfKey(`wall/i/${HEX64}/extra`), null, 'extra segment');
  assert.equal(kindOfKey(''), null);
});

test('mimesFor: the exact whitelists; unknown kind -> []', () => {
  assert.deepEqual(Media.mimesFor('image'), ['image/jpeg', 'image/png', 'image/webp']);
  assert.deepEqual(Media.mimesFor('video'), ['video/mp4', 'video/quicktime', 'video/webm']);
  assert.deepEqual(Media.mimesFor('audio'),
    ['audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/webm', 'audio/ogg', 'audio/wav']);
  assert.deepEqual(Media.mimesFor('gif'), []);
});

test('mimeAllowed: case-insensitive, ;codecs suffix stripped, junk refused', () => {
  const allowed = (k, m) => Media.mimeAllowed(k)(m);
  assert.equal(allowed('audio', 'audio/webm;codecs=opus'), true, 'MediaRecorder codecs suffix stripped');
  assert.equal(allowed('video', 'Video/MP4'), true, 'case-insensitive');
  assert.equal(allowed('image', 'image/jpeg'), true);
  assert.equal(allowed('image', 'image/gif'), false, 'off-whitelist refused');
  assert.equal(allowed('audio', 'application/json'), false);
  assert.equal(allowed('image', 'video/mp4'), false, 'right mime, wrong kind');
  assert.equal(allowed('gif', 'image/jpeg'), false, 'unknown kind allows nothing');
});

test('kindOfMime: exact whitelist membership, never bare prefix matching', () => {
  assert.equal(kindOfMime('image/png'), 'image');
  assert.equal(kindOfMime('video/quicktime'), 'video');
  assert.equal(kindOfMime('audio/webm;codecs=opus'), 'audio', 'codecs stripped before lookup');
  assert.equal(kindOfMime('AUDIO/MPEG'), 'audio', 'case-insensitive');
  assert.equal(kindOfMime('image/gif'), null, 'image/* prefix alone is NOT enough');
  assert.equal(kindOfMime('video/x-msvideo'), null);
  assert.equal(kindOfMime(''), null);
});

test('acceptFor: kinds mask -> file-input accept attribute', () => {
  assert.equal(Media.acceptFor(['image', 'video', 'audio']), 'image/*,video/*,audio/*');
  assert.equal(Media.acceptFor(['audio', 'image']), 'image/*,audio/*', 'canonical order');
  assert.equal(Media.acceptFor(['image', 'bogus']), 'image/*', 'junk dropped');
  assert.equal(Media.acceptFor([]), '');
});

test('maxBytesFor: per-kind lookup in a limits record; unknown kind -> null', () => {
  const limits = { image: 10485760, video: 15728640, audio: 5242880 };
  assert.equal(orNull(Media.maxBytesFor('image')(limits)), 10485760);
  assert.equal(orNull(Media.maxBytesFor('video')(limits)), 15728640);
  assert.equal(orNull(Media.maxBytesFor('audio')(limits)), 5242880);
  assert.equal(orNull(Media.maxBytesFor('gif')(limits)), null);
});
