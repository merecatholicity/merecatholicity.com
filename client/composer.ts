/* The composer (Wave F, 2026-09-11 — moved out of comments.ts verbatim): the
   markdown editor and its toolbar, the emoji packs/panel/autocomplete, the
   Scripture picker, drafts, the media gate + image compression + the voice
   recorder, @mentions, and the media stash. */
import type { Boot } from './boot';

export function installComposer(B: Boot) {
  /* Names this module takes from the boot — the root's helpers and the other
     modules' exports — bound in bind() once every module is installed, so
     order of installation never matters and every body reads as it did. */
  let API: any;
  let asset: any;
  let authorNode: (hash: any, nick: any, withSub: any, faith?: any, posts?: any) => any;
  let blockedOut: (d: any) => any;
  let bootSig: any;
  let cachedJson: (url: any, init: any, ttl: any) => Promise<any>;
  let closePop: () => any;
  let displayName: (hash: any) => any;
  let dmLabel: (hash: any, nick: any) => any;
  let dmScore: (q: any, name: any) => any;
  let el: (tag: string, cls?: string | null, text?: string | number | null) => any;
  let fetchRetry: (url: string, opts: RequestInit | undefined, delays: number[], onRetry?: () => void) => Promise<Response>;
  let fillBody: (node: HTMLElement, text: any, plain?: boolean) => any;
  let fmtBytes: (n: any) => any;
  let fmtDateTime: (epoch: any) => any;
  let fmtSecs: (s: any) => any;
  let freshParam: (sep: any) => any;
  let loadingLine: (text: string, cls?: string) => any;
  let mcIcon: (name: any) => any;
  let mediaFilename: (mediaKey: any) => any;
  let showShareMenu: (anchor: any, shareUrl: any, mediaDl: any, saveRef?: any) => any;
  let state: any;
  let wallActions: (post: any) => any;
  let wallAvatarInto: (head: any, hash: any, avatar: any) => any;
  let wallCommentsSection: (post: any, onCount: any) => any;
  let warmToken: () => any;

  /* Custom emoji: image packs a member can drop into a post as :shortcode:. The
     body stores only the plain-text code; the renderer swaps a KNOWN code for a
     same-origin <img> from this whitelist, and an unknown :code: stays literal
     text, so nothing a user writes ever becomes an arbitrary image source. */
  /* Single-sourced from Domain.Emoji via window.mcCore (the same packs the worker
     serves at /config); the inline copy is the no-app fallback. */
  var EMOJI_PACKS: Record<string, [string, string][]> = window.mcCore!.emojiPacks;
  var CUSTOM_EMOJI: Record<string, string> = {};
  /* Tab 1 of the picker: the common Unicode emoji, inserted as characters and
     stored as UTF-8 like any other text. Split on spaces (no emoji holds one). */
  var STANDARD_EMOJI = ('😀 😃 😄 😁 😆 😅 😂 🤣 🙂 🙃 😉 😊 😇 🥰 😍 🤩 😘 😗 😚 😙 😋 😛 😜 🤪 😝 🤗 🤭 🤫 🤔 🤐 🤨 😐 😑 😶 😏 😒 🙄 😬 😌 😔 😪 🤤 😴 😷 🤒 🤕 🤢 🤮 🤧 🥵 🥶 🥴 😵 🤯 🤠 🥳 😎 🤓 🧐 😕 😟 🙁 😮 😯 😲 😳 🥺 😦 😧 😨 😰 😥 😢 😭 😱 😖 😣 😞 😓 😩 😫 🥱 😤 😡 😠 🤬 😈 👿 💀 💩 🤡 👻 👽 🤖 😺 😸 😹 😻 😼 😽 🙀 😿 😾 👋 🤚 ✋ 🖖 👌 🤌 🤏 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ 👍 👎 ✊ 👊 🤛 🤜 👏 🙌 👐 🤲 🙏 🤝 💪 🖕 ❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 💕 💞 💓 💗 💖 💘 💝 💯 💢 💥 💫 💦 💨 💬 💭 💤 🔥 ⭐ 🌟 ✨ ⚡ 💧 🌈 ☀️ 🎉 🎊 🎁 🏆 🥇 🎯 ✅ ❌ ⭕ ❗ ❓ ⚠️ 🔔 💡 🔑 🔒 🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🙈 🙉 🙊 🐔 🐧 🐦 🦆 🦉 🐺 🐗 🐴 🦄 🐝 🐛 🦋 🐌 🐢 🐍 🐙 🦀 🐟 🐬 🐳 🍎 🍌 🍉 🍇 🍓 🍒 🍑 🍍 🥝 🍅 🥑 🌽 🍄 🍞 🧀 🍔 🍟 🍕 🌭 🌮 🍿 🍩 🍪 🎂 🍰 🍫 🍬 🍭 🍺 🍻 🥂 🍷 ☕ 🍵').split(' ');
  /* Named standard emoji: the subset reachable by a :shortcode:, so the : helper
     and manual typing resolve common names (:fire:, :joy:) to a character, the
     same path custom pack codes take. name/char pairs, char never holding a
     space. A :code: matches a custom image first, then a name here, else stays
     literal text. */
  var NAMED_EMOJI: Record<string, string> = {};

  /* Any anchor whose href lands on a KJV verse gets the hover-preview data,
     however the anchor was born: a plain written reference, a markdown link
     (merecat writes those), or a sources-footer entry. The slug is greedy, so
     1-corinthians-6-9 splits book/chapter/verse correctly; a chapter-only
     hash (no verse) stays undecorated since there is nothing to preview. */
  function scriptureDecor(a: any, url: any) {
    if (window.mcRich) return window.mcRich.scriptureDecor(a, url);
    var m = /(?:^|\/)kjv\.html#([a-z0-9-]+)-(\d+)-(\d+)$/.exec(String(url || ''));
    var dr = null;
    if (!m) {
      dr = /(?:^|\/)douay-rheims\.html#([a-z0-9-]+)-(\d+)-(\d+)$/.exec(String(url || ''));
      m = dr;
    }
    if (!m) return;
    a.className += ' scripture-link';
    if (dr) a.setAttribute('data-bible', 'dr');
    a.setAttribute('data-slug', m[1]);
    a.setAttribute('data-ch', m[2]);
    a.setAttribute('data-v1', m[3]);
    /* A range written in the link's own text ("1 Cor 6:9-10") previews whole,
       as a plainly written reference would; the URL carries only the first
       verse. The text's range must start at the URL's verse or the URL wins. */
    var r = /:(\d+)\s*[-\u2013]\s*(\d+)\s*$/.exec(a.textContent || '');
    a.setAttribute('data-v2', (r && r[1] === m[3]) ? r[2] : m[3]);
  }

  /* ---- The served media settings: one cached read of /api/comments/config's
     `media` block. EVERY client-side attachment gate below reads THIS — never a
     hardcoded number (the old 60 MB client gate vs the server's own caps was a
     real bug). On any failure the kernel's Domain.Media defaults stand in, so
     the gates always have a shape to read. ---- */
  var _mediaCfgP: any = null;
  /* Normalize whatever the server sent (the per-section `sections` shape, an
     older worker's flat legacy fields, or nothing at all) into ONE shape every
     gate below reads: { enabled, autocompress, kinds, max_bytes,
     audio_max_seconds, sections: { dm|wall|board: { kinds, voice, scan,
     max_bytes:{image,video,audio}, audio_max_seconds } } }. The ladder per
     field: served section value → served legacy value → kernel default. dm's
     scan is ALWAYS false — E2E ciphertext is structurally unscannable. */
  function mediaCfgNormalize(m: any) {
    var core: any = window.mcCore;
    var d = core.mediaDefaults;
    m = m || {};
    var defKinds: any = { dm: d.kindsDm, wall: d.kindsWall, board: d.kindsBoard };
    var defBytes: any = { image: Number(d.imageMaxBytes), video: Number(d.videoMaxBytes), audio: Number(d.audioMaxBytes) };
    function sec(ctx: any) {
      var s = (m.sections && m.sections[ctx]) || {};
      var kinds = Array.isArray(s.kinds) ? s.kinds
        : (m.kinds && Array.isArray(m.kinds[ctx]) ? m.kinds[ctx] : core.mediaParseKinds(defKinds[ctx]));
      var mb: any = {};
      for (var k in defBytes) {
        mb[k] = Number(s.max_bytes && s.max_bytes[k]) || Number(m.max_bytes && m.max_bytes[k]) || defBytes[k];
      }
      return {
        kinds: kinds,
        voice: typeof s.voice === 'boolean' ? s.voice : true,
        scan: ctx === 'dm' ? false : (typeof s.scan === 'boolean' ? s.scan : true),
        max_bytes: mb,
        audio_max_seconds: Number(s.audio_max_seconds) || Number(m.audio_max_seconds) || Number(d.audioMaxSeconds),
      };
    }
    var out: any = {
      enabled: m.enabled !== false,
      autocompress: m.autocompress !== false,
      max_bytes: { image: Number(m.max_bytes && m.max_bytes.image) || defBytes.image,
        video: Number(m.max_bytes && m.max_bytes.video) || defBytes.video,
        audio: Number(m.max_bytes && m.max_bytes.audio) || defBytes.audio },
      audio_max_seconds: Number(m.audio_max_seconds) || Number(d.audioMaxSeconds),
      sections: { dm: sec('dm'), wall: sec('wall'), board: sec('board') },
    };
    out.kinds = { dm: out.sections.dm.kinds, wall: out.sections.wall.kinds, board: out.sections.board.kinds };
    return out;
  }
  function mediaCfg(): Promise<any> {
    if (_mediaCfgP) return _mediaCfgP;
    _mediaCfgP = cachedJson(API + '/config', undefined, 300000)
      .then(function (d: any) {
        return mediaCfgNormalize(d && d.ok ? d.media : null);
      })
      .catch(function () { return mediaCfgNormalize(null); });
    return _mediaCfgP;
  }
  /* File via window so the built classic script never names a bare DOM global
     eslint's browser whitelist lacks; falls back to a named Blob where the File
     constructor is missing (the server sniffs magic bytes, not names). */
  function mkFile(parts: any[], name: any, type: any) {
    var F: any = (window as any).File;
    try { return new F(parts, name, { type: type }); }
    catch (e) { var b: any = new Blob(parts, { type: type }); b.name = name; return b; }
  }
  /* Downscale/re-encode a picked image in the browser before upload (the served
     `autocompress` switch): long edge capped at 2048, JPEG at 0.8 (one retry at
     0.65 when still over the image cap). Small JPEGs and non-images pass through
     untouched; resolves null only when the image cannot be decoded at all. */
  function compressImage(file: any, cfg: any, imageLimit?: any) {
    if (!/^image\//.test(String(file.type || ''))) return Promise.resolve(file);
    if (!cfg || cfg.autocompress === false) return Promise.resolve(file);
    if (file.size <= 524288 && file.type === 'image/jpeg') return Promise.resolve(file);
    var cib: any = (window as any).createImageBitmap;
    if (typeof cib !== 'function') return Promise.resolve(file);
    var limit = Number(imageLimit) || Number(cfg.max_bytes && cfg.max_bytes.image) || 10485760;
    return cib(file).then(function (bmp: any) {
      var scale = Math.min(1, 2048 / Math.max(bmp.width || 1, bmp.height || 1));
      if (scale === 1 && file.type === 'image/jpeg' && file.size <= limit) {
        try { bmp.close(); } catch (e) { /* fine */ }
        return file;
      }
      var canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bmp.width * scale));
      canvas.height = Math.max(1, Math.round(bmp.height * scale));
      var ctx = canvas.getContext('2d');
      if (!ctx) { try { bmp.close(); } catch (e) { /* fine */ } return file; }
      ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
      try { bmp.close(); } catch (e) { /* fine */ }
      function encode(q: any) {
        return new Promise(function (resolve) { canvas.toBlob(resolve, 'image/jpeg', q); });
      }
      return encode(0.8).then(function (blob: any) {
        if (blob && blob.size > limit) return encode(0.65);
        return blob;
      }).then(function (blob: any) {
        if (!blob) return file;
        var name = String(file.name || 'image').replace(/\.[A-Za-z0-9]+$/, '') + '.jpg';
        return mkFile([blob], name, 'image/jpeg');
      });
    }, function () { return null; });
  }
  /* Gate one picked (or recorded) file for a SECTION (a cfg.sections.* object):
     kind whitelisted for that section, per-section per-kind size cap from the
     served settings, images downscaled first (against the section's own image
     cap). Resolves the File to hold, or null after writing a friendly line to
     statusEl. Shared by the DM, wall, and board attach paths. */
  function mediaGateFile(f: any, cfg: any, sec: any, statusEl: any) {
    var core: any = window.mcCore;
    var kind = core ? core.mediaKindOfMime(String(f.type || '')) : null;
    var kinds = (sec && sec.kinds) || [];
    if (!cfg.enabled) { statusEl.textContent = 'Media sharing is turned off.'; return Promise.resolve(null); }
    if (!kind || kinds.indexOf(kind) === -1) {
      statusEl.textContent = 'That file type cannot be shared here' + (kinds.length ? ' — only ' + kinds.join(', ') + '.' : '.');
      return Promise.resolve(null);
    }
    var p = kind === 'image' ? compressImage(f, cfg, sec.max_bytes && sec.max_bytes.image) : Promise.resolve(f);
    return p.then(function (out: any) {
      if (!out) { statusEl.textContent = 'That image could not be read.'; return null; }
      var limit = Number(sec.max_bytes && sec.max_bytes[kind]) || 0;
      if (limit && out.size > limit) {
        statusEl.textContent = 'That ' + kind + ' is too large — the limit is ' + Math.round(limit / 1048576) + ' MB.';
        return null;
      }
      return out;
    });
  }

  /* ---- Voice notes: one shared recorder for the DM, wall, and board composers.
     Feature-detected; where MediaRecorder is missing (iOS PWA among others) the
     🎙 button falls back to a plain capture file input riding the normal attach
     path. A finished take is MP3-encoded in the browser (lamejs, lazily injected
     the same way as tweetnacl) so one small format plays everywhere; an encode
     failure falls back to the raw recording — a take is never dead-ended. ---- */
  var LAME_SRC: any;
  var _lameP: any = null;
  function ensureLame(): Promise<any> {
    var w: any = window;
    if (w.lamejs) return Promise.resolve(w.lamejs);
    if (_lameP) return _lameP;
    _lameP = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = LAME_SRC;
      s.async = true;
      s.onload = function () { if (w.lamejs) resolve(w.lamejs); else { _lameP = null; reject(new Error('lamejs')); } };
      s.onerror = function () { _lameP = null; reject(new Error('lamejs load failed')); };
      document.head.appendChild(s);
    });
    return _lameP;
  }
  function voiceSupported() {
    var w: any = window;
    var nav: any = navigator;
    return !!(nav.mediaDevices && nav.mediaDevices.getUserMedia && w.MediaRecorder && w.MediaRecorder.isTypeSupported);
  }
  /* First recordable type the browser admits to; '' lets it pick its default.
     INVARIANT: every named entry must be decodable by the SAME browser's
     decodeAudioData (Safari records+decodes mp4/AAC; Chrome mp4 [126+] or
     webm/opus, decodes both; Firefox webm/ogg opus, decodes both) — that is
     what makes voiceMp3Encode same-browser-safe. The '' tail is the one
     unproven pair, and voicePreview's raw-file catch covers it. */
  function voiceMime() {
    var MR: any = (window as any).MediaRecorder;
    var list = ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm;codecs=opus', 'audio/ogg;codecs=opus', ''];
    for (var i = 0; i < list.length; i++) {
      if (list[i] === '' || MR.isTypeSupported(list[i])) return list[i];
    }
    return '';
  }
  /* The raw-recording fallback File, extension matched to the recorder's mime. */
  function voiceRawFile(blob: any) {
    var t = String(blob.type || '');
    var ext = t.indexOf('mp4') !== -1 ? 'm4a' : (t.indexOf('ogg') !== -1 ? 'ogg' : 'webm');
    return mkFile([blob], 'voice-note.' + ext, t || 'audio/webm');
  }
  /* Decode the take, downmix to mono, and MP3-encode at 64 kbps in 1152-sample
     blocks, yielding to the UI every ~64 blocks so a long note never freezes
     the composer. Resolves a File('voice-note.mp3'). */
  function voiceMp3Encode(blob: any) {
    return ensureLame().then(function (lame: any) {
      return blob.arrayBuffer().then(function (buf: any) {
        var AC: any = (window as any).AudioContext || (window as any).webkitAudioContext;
        if (!AC) throw new Error('no audio context');
        var ctx = new AC();
        return new Promise(function (resolve, reject) { ctx.decodeAudioData(buf, resolve, reject); })
          .then(function (audio: any) {
            try { ctx.close(); } catch (e) { /* fine */ }
            var chs = audio.numberOfChannels || 1;
            var len = audio.length;
            var mono = new Float32Array(len);
            for (var c = 0; c < chs; c++) {
              var data = audio.getChannelData(c);
              for (var i = 0; i < len; i++) mono[i] += data[i];
            }
            if (chs > 1) for (var j = 0; j < len; j++) mono[j] /= chs;
            var pcm = new Int16Array(len);
            for (var k = 0; k < len; k++) {
              var v = Math.max(-1, Math.min(1, mono[k]));
              pcm[k] = Math.round(v * 32767);
            }
            var enc = new lame.Mp3Encoder(1, audio.sampleRate, 64);
            var parts: any[] = [];
            var pos = 0;
            function step(): any {
              var n = 0;
              while (pos < len && n < 64) {
                var out = enc.encodeBuffer(pcm.subarray(pos, Math.min(pos + 1152, len)));
                if (out && out.length) parts.push(out);
                pos += 1152;
                n++;
              }
              if (pos < len) return new Promise(function (r) { setTimeout(r, 0); }).then(step);
              var tail = enc.flush();
              if (tail && tail.length) parts.push(tail);
              return mkFile(parts, 'voice-note.mp3', 'audio/mpeg');
            }
            return step();
          });
      });
    });
  }
  /* The OS-layer recording fallback: a hidden capture file input riding the
     composer's normal attach path. The road that always exists — used where
     MediaRecorder is missing AND offered inline after any getUserMedia
     failure, so a blocked/absent/busy microphone never dead-ends a voice note
     (on phones `capture` opens the OS recorder; on desktop it is an honest
     audio-file pick). */
  function voiceFallbackInput(form: any, takeFile: any) {
    var fi = form.querySelector('input.mc-voice-input');
    if (fi) return fi;
    fi = el('input', 'mc-voice-input');
    fi.type = 'file';
    fi.accept = 'audio/*';
    fi.setAttribute('capture', '');
    fi.style.display = 'none';
    fi.addEventListener('change', function () {
      var f = fi.files && fi.files[0];
      if (f) takeFile(f);
      fi.value = '';
    });
    form.appendChild(fi);
    return fi;
  }
  /* After a failed getUserMedia: one idempotent row offering the OS-layer
     road. Sits under the honest error line statusEl just carried. */
  function voiceOfferFallback(form: any, takeFile: any) {
    if (form.querySelector('.mc-voice-fallback')) return;
    var row = el('div', 'mc-rec-row mc-voice-fallback');
    var btn = el('button', 'btn btn-attach', 'Record with your device instead');
    btn.type = 'button';
    btn.addEventListener('click', function () { voiceFallbackInput(form, takeFile).click(); });
    row.appendChild(btn);
    form.appendChild(row);
  }
  /* Honest per-cause failure copy. NotAllowedError covers BOTH a user "Block"
     and a Permissions-Policy denial (the header case rejects instantly with no
     prompt — the live 2026-08-02 report); the message points at the site
     permission and the fallback row carries the working road either way. */
  function voiceFailMessage(e: any) {
    var name = String((e && e.name) || '');
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') {
      return 'No microphone was found on this device — you can record with your device below.';
    }
    if (name === 'NotReadableError' || name === 'TrackStartError') {
      return 'The microphone is busy — another app or tab may be using it. You can record with your device below.';
    }
    if (name === 'SecurityError') {
      return 'Recording is blocked in this browser context — you can record with your device below.';
    }
    return 'Microphone access is blocked. Check this site’s microphone permission (the icon by the address bar), or record with your device below.';
  }
  /* The live recorder row: pulsing dot, elapsed / cap countdown, Stop. Stops
     itself at the section's seconds cap or when the raw bytes pass its audio
     size cap, then offers the preview row (listen / Use this / Re-record /
     Discard). A permissions preflight (where the browser has the API — Safari
     may not, and a query that throws just proceeds) catches the
     denied-without-a-prompt case up front. */
  function startVoiceRecorder(form: any, cfg: any, sec: any, statusEl: any, takeFile: any) {
    /* Block a second recorder while a take or preview is up — but NOT for the
       fallback row (also classed mc-rec-row), or one failed attempt would
       silently kill the 🎙 button for the rest of the page's life. */
    if (form.querySelector('.mc-rec-row:not(.mc-voice-fallback)')) return;
    var maxSecs = Number(sec && sec.audio_max_seconds) || Number(cfg.audio_max_seconds) || 180;
    var maxBytes = Number(sec && sec.max_bytes && sec.max_bytes.audio) || 5242880;
    var nav: any = navigator;
    var pre = (nav.permissions && nav.permissions.query)
      ? Promise.resolve().then(function () { return nav.permissions.query({ name: 'microphone' }); }).catch(function () { return null; })
      : Promise.resolve(null);
    pre.then(function (st: any) {
      if (st && st.state === 'denied') {
        statusEl.textContent = voiceFailMessage({ name: 'NotAllowedError' });
        voiceOfferFallback(form, takeFile);
        return;
      }
      navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream: any) {
      /* The mic works (again) — a fallback row from an earlier failure is
         stale chrome now. */
      var fb = form.querySelectorAll('.mc-voice-fallback');
      for (var fi = 0; fi < fb.length; fi++) fb[fi].remove();
      var MR: any = (window as any).MediaRecorder;
      var mt = voiceMime();
      var opts: any = { audioBitsPerSecond: 64000 };
      if (mt) opts.mimeType = mt;
      var rec: any;
      try { rec = new MR(stream, opts); }
      catch (e) {
        stream.getTracks().forEach(function (t: any) { t.stop(); });
        statusEl.textContent = 'Recording is not available in this browser.';
        return;
      }
      var row = el('div', 'mc-rec-row');
      row.appendChild(el('span', 'mc-rec-dot'));
      var time = el('span', 'mc-rec-time', '0:00 / ' + fmtSecs(maxSecs));
      row.appendChild(time);
      var stopBtn = el('button', 'btn', 'Stop');
      stopBtn.type = 'button';
      row.appendChild(stopBtn);
      form.appendChild(row);
      var chunks: any[] = [];
      var bytes = 0;
      var startedAt = Date.now();
      var stopped = false;
      function stopNow() {
        if (stopped) return;
        stopped = true;
        clearInterval(tick);
        try { rec.stop(); } catch (e) { /* already */ }
      }
      var tick = setInterval(function () {
        var s = Math.floor((Date.now() - startedAt) / 1000);
        time.textContent = fmtSecs(Math.min(s, maxSecs)) + ' / ' + fmtSecs(maxSecs);
        if (s >= maxSecs) stopNow();
      }, 250);
      stopBtn.addEventListener('click', stopNow);
      rec.ondataavailable = function (ev: any) {
        if (ev.data && ev.data.size) {
          chunks.push(ev.data);
          bytes += ev.data.size;
          if (bytes > maxBytes) stopNow();
        }
      };
      rec.onstop = function () {
        stream.getTracks().forEach(function (t: any) { t.stop(); });
        row.remove();
        var blob = new Blob(chunks, { type: rec.mimeType || mt || 'audio/webm' });
        if (!blob.size) { statusEl.textContent = 'Nothing was recorded.'; return; }
        voicePreview(form, cfg, sec, statusEl, blob, takeFile);
      };
      try { rec.start(1000); } catch (e) { stopNow(); }
      }).catch(function (e: any) {
        statusEl.textContent = voiceFailMessage(e);
        voiceOfferFallback(form, takeFile);
      });
    });
  }
  function voicePreview(form: any, cfg: any, sec: any, statusEl: any, blob: any, takeFile: any) {
    var row = el('div', 'mc-rec-row mc-rec-preview');
    var url = URL.createObjectURL(blob);
    var player = el('audio', 'mc-rec-audio');
    player.src = url;
    player.controls = true;
    row.appendChild(player);
    var use = el('button', 'btn btn-send', 'Use this');
    use.type = 'button';
    var redo = el('button', 'btn', 'Re-record');
    redo.type = 'button';
    var drop = el('button', 'btn', 'Discard');
    drop.type = 'button';
    row.appendChild(use);
    row.appendChild(redo);
    row.appendChild(drop);
    form.appendChild(row);
    function cleanup() { try { URL.revokeObjectURL(url); } catch (e) { /* fine */ } row.remove(); }
    drop.addEventListener('click', function () { cleanup(); });
    redo.addEventListener('click', function () { cleanup(); startVoiceRecorder(form, cfg, sec, statusEl, takeFile); });
    use.addEventListener('click', function () {
      use.disabled = true; redo.disabled = true; drop.disabled = true;
      statusEl.textContent = 'Preparing…';
      voiceMp3Encode(blob)
        .catch(function () { return voiceRawFile(blob); })
        .then(function (f: any) { statusEl.textContent = ''; cleanup(); takeFile(f); });
    });
  }
  /* The 🎙 button a composer places beside its 📎: real recorder where the
     browser has one, otherwise the capture file input riding the same attach
     path (takeFile = that composer's own picked-file handler). `sec` is the
     composer's own cfg.sections.* — its caps and its voice flag govern. */
  /* Phone composers show the utility buttons (📎 🎙 📞) as icon-only circles
     (the mobile CSS sizes them equal); the word survives in title +
     aria-label. Desktop keeps "icon word". Decided at build time — composers
     are rebuilt on every view, so a rotated/resized session heals itself. */
  function utilBtnLabel(btn: any, icon: string, word: string) {
    var phone = false;
    try { phone = window.matchMedia('(max-width: 600px)').matches; } catch (e) { /* desktop */ }
    btn.textContent = phone ? icon : icon + ' ' + word;
    btn.title = word;
    btn.setAttribute('aria-label', word);
    return btn;
  }

  function voiceControl(form: any, cfg: any, sec: any, statusEl: any, takeFile: any) {
    var btn = utilBtnLabel(el('button', 'btn btn-attach mc-voice-btn'), '🎙', 'Voice');
    btn.type = 'button';
    if (!voiceSupported()) {
      btn.addEventListener('click', function () { voiceFallbackInput(form, takeFile).click(); });
      return btn;
    }
    btn.addEventListener('click', function () { startVoiceRecorder(form, cfg, sec, statusEl, takeFile); });
    return btn;
  }
  /* Focus is the earliest honest signal of intent, and the safest moment for
     anything the challenge might do. */
  function warmOnFocus(ta: any) {
    if (!ta || ta.mcWarm) return;
    ta.mcWarm = true;
    ta.addEventListener('focus', warmToken, { once: true });
  }

  /* ---- Markdown compose toolbar. The box stays a single plain-text textarea
     holding the markdown source; these buttons only edit that source at the
     caret or around the selection, and fillBody renders it on show. ---- */

  function afterEdit(ta: any) {
    ta.focus();
    try { ta.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {}
  }

  /* Wrap the selection, or, with nothing selected, drop the markers and put the
     caret between them: WORD -> **WORD**, and | -> **|**. */
  function wrapSel(ta: any, before: any, after: any) {
    var s = ta.value, a = ta.selectionStart, b = ta.selectionEnd, sel = s.slice(a, b);
    if (sel) {
      ta.value = s.slice(0, a) + before + sel + after + s.slice(b);
      try { ta.setSelectionRange(a + before.length, a + before.length + sel.length); } catch (e) {}
    } else {
      ta.value = s.slice(0, a) + before + after + s.slice(a);
      var caret = a + before.length;
      try { ta.setSelectionRange(caret, caret); } catch (e) {}
    }
    afterEdit(ta);
  }

  /* Prefix every line the selection touches (or the caret's own line). */
  function linePrefix(ta: any, prefix: any) {
    var s = ta.value, a = ta.selectionStart, b = ta.selectionEnd;
    var start = s.lastIndexOf('\n', a - 1) + 1;
    var end = s.indexOf('\n', b); if (end === -1) end = s.length;
    var block = s.slice(start, end).split('\n').map(function (ln: any) { return prefix + ln; }).join('\n');
    ta.value = s.slice(0, start) + block + s.slice(end);
    try { ta.setSelectionRange(start, start + block.length); } catch (e) {}
    afterEdit(ta);
  }

  /* Insert a same-site link template, caret landing in the URL to complete. */
  function insertLink(ta: any) {
    var s = ta.value, a = ta.selectionStart, b = ta.selectionEnd, sel = s.slice(a, b) || 'text';
    var url = 'https://merecatholicity.com/';
    ta.value = s.slice(0, a) + '[' + sel + '](' + url + ')' + s.slice(b);
    var urlStart = a + sel.length + 3;
    try { ta.setSelectionRange(urlStart, urlStart + url.length); } catch (e) {}
    afterEdit(ta);
  }

  function mdButton(label: any, title: any, cls: any, handler: any) {
    var btn = el('button', 'md-btn' + (cls ? ' ' + cls : ''), label);
    btn.type = 'button';
    btn.title = title;
    btn.addEventListener('click', function (e: any) { e.preventDefault(); handler(); });
    return btn;
  }

  /* ================= Emoji =================================================
     Standard Unicode emoji insert and store as plain characters; the pack emoji
     (memes/pepe) insert and store as :code:, and only a code on the CUSTOM_EMOJI
     whitelist ever becomes a same-origin <img> (an unknown :token: stays text).
     The full standard set, with search keywords and grouped for browsing, is
     fetched once from emoji/emoji-data.json on first use, so ~1900 emoji never
     ride the initial page load. Three ways in: the picker button's tabbed panel,
     the : autocomplete while typing (both desktop and mobile), and hand-typed
     :shortcode:. ======================================================== */

  /* One :code: -> a node: a whitelisted pack image, a named-emoji character, or
     the literal text when neither is known. Called by appendRich. */
  function emojiToken(code: any, raw: any) {
    var c = code.toLowerCase();
    if (CUSTOM_EMOJI[c]) return emojiImg(CUSTOM_EMOJI[c], c);
    if (NAMED_EMOJI[c]) return document.createTextNode(NAMED_EMOJI[c]);
    return document.createTextNode(raw);
  }
  function emojiImg(path: any, code: any) {
    ensureEmojiStyles();
    var img = el('img', 'mc-emoji');
    img.src = path;
    img.alt = ':' + code + ':';
    img.title = ':' + code + ':';
    img.loading = 'lazy';
    img.decoding = 'async';
    return img;
  }

  var emojiData: any = null, emojiDataPromise: any = null;
  function loadEmojiData(): Promise<any> {
    if (emojiDataPromise) return emojiDataPromise;
    emojiDataPromise = fetch(asset('emoji/emoji-data.json')).then(function (r) { return r.json(); })
      .then(function (d) {
        var flat: any[] = [];
        (d.groups || []).forEach(function (g: any) { g.e.forEach(function (e: any) { flat.push({ c: e[0], a: e[1], k: e[2] }); }); });
        emojiData = { groups: d.groups || [], flat: flat };
        return emojiData;
      })
      .catch(function () { emojiData = { groups: [], flat: [] }; return emojiData; });
    return emojiDataPromise;
  }
  function prefetchEmoji() { loadEmojiData(); }

  /* One ranked search across pack codes and the standard set (the full lazy set
     when it is loaded, else the small inline NAMED_EMOJI). Prefix hits rank above
     substring hits. Returns items the picker and the : list both render. */
  function emojiSearch(q: any, limit: any) {
    q = String(q).toLowerCase();
    if (!q) return [];
    var pre: any[] = [], sub: any[] = [], seen: Record<string, any> = {};
    Object.keys(EMOJI_PACKS).forEach(function (pk) {
      EMOJI_PACKS[pk].forEach(function (e: any) {
        var i = e[0].indexOf(q);
        if (i === 0) pre.push({ kind: 'img', code: e[0], path: e[1] });
        else if (i > 0) sub.push({ kind: 'img', code: e[0], path: e[1] });
      });
    });
    if (emojiData && emojiData.flat.length) {
      emojiData.flat.forEach(function (e: any) {
        if (e.a.indexOf(q) === 0 || (' ' + e.k).indexOf(' ' + q) > -1) pre.push({ kind: 'char', char: e.c, label: e.a });
        else if (e.k.indexOf(q) > -1) sub.push({ kind: 'char', char: e.c, label: e.a });
      });
    } else {
      Object.keys(NAMED_EMOJI).forEach(function (n) {
        var i = n.indexOf(q);
        if (i === 0) pre.push({ kind: 'char', char: NAMED_EMOJI[n], label: n });
        else if (i > 0) sub.push({ kind: 'char', char: NAMED_EMOJI[n], label: n });
      });
    }
    var out: any[] = [];
    pre.concat(sub).forEach(function (it) {
      var key = it.kind === 'img' ? 'i' + it.code : 'c' + it.char;
      if (seen[key] || out.length >= limit) return;
      seen[key] = 1; out.push(it);
    });
    return out;
  }

  function insertAtCaret(ta: any, text: any) {
    var s = ta.value, a = ta.selectionStart, b = ta.selectionEnd;
    ta.value = s.slice(0, a) + text + s.slice(b);
    var np = a + text.length;
    try { ta.setSelectionRange(np, np); } catch (e) {}
    afterEdit(ta);
  }
  function insertEmojiItem(ta: any, it: any) {
    insertAtCaret(ta, it.kind === 'img' ? ':' + it.code + ':' : it.char);
  }

  /* The : autocomplete, the sibling of attachMentions: an @ picks a member, a :
     picks an emoji. Triggered by ":" plus a code start at the caret; Enter/Tab or
     tap inserts. Works the same on desktop and mobile. */
  function attachEmoji(textarea: any) {
    if (!textarea || textarea.dataset.emojiac) return;
    textarea.dataset.emojiac = '1';
    var sug = el('div', 'mention-suggest emoji-suggest');
    sug.hidden = true;
    textarea.parentNode.insertBefore(sug, textarea.nextSibling);
    var current: any[] = [], sel = 0, at = -1, timer: any = null;
    function render() {
      sug.textContent = '';
      if (!current.length) { sug.hidden = true; return; }
      current.forEach(function (it, i) {
        var r = el('a', 'dm-suggest-row emoji-suggest-row' + (i === sel ? ' dm-suggest-sel' : ''));
        r.href = '#';
        var g = el('span', 'emoji-suggest-glyph');
        if (it.kind === 'img') g.appendChild(emojiImg(it.path, it.code)); else g.textContent = it.char;
        r.appendChild(g);
        r.appendChild(el('span', null, ':' + (it.kind === 'img' ? it.code : it.label) + ':'));
        r.addEventListener('mousedown', function (e: any) { e.preventDefault(); pick(it); });
        sug.appendChild(r);
      });
      sug.hidden = false;
    }
    function scan() {
      var caret = textarea.selectionStart;
      var m = /(^|\s):([a-z0-9][a-z0-9_+-]{0,39})$/i.exec(textarea.value.slice(0, caret));
      if (!m) { current = []; at = -1; sug.hidden = true; return; }
      at = caret - m[2].length - 1;
      var q = m[2].toLowerCase();
      current = emojiSearch(q, 30); sel = 0; render();
      if (!emojiData) loadEmojiData().then(function () { if (at > -1) { current = emojiSearch(q, 30); render(); } });
    }
    function pick(it: any) {
      if (at < 0) return;
      var caret = textarea.selectionStart, v = textarea.value;
      var ins = it.kind === 'img' ? ':' + it.code + ':' : it.char;
      textarea.value = v.slice(0, at) + ins + ' ' + v.slice(caret);
      var np = at + ins.length + 1;
      try { textarea.setSelectionRange(np, np); } catch (e) {}
      current = []; at = -1; sug.hidden = true; afterEdit(textarea);
    }
    textarea.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(scan, 100); });
    textarea.addEventListener('keydown', function (e: any) {
      if (sug.hidden || !current.length) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(sel + 1, current.length - 1); render(); scrollSel(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(sel - 1, 0); render(); scrollSel(); }
      else if (e.key === 'Enter' || e.key === 'Tab') { if (current[sel]) { e.preventDefault(); pick(current[sel]); } }
      else if (e.key === 'Escape') { current = []; sug.hidden = true; }
    });
    function scrollSel() { var s = sug.querySelector('.dm-suggest-sel'); if (s && s.scrollIntoView) s.scrollIntoView({ block: 'nearest' }); }
    textarea.addEventListener('blur', function () { setTimeout(function () { sug.hidden = true; }, 200); });
  }

  /* The picker panel: a search box that narrows across everything, then tabs for
     the standard set (grouped, scrolling) and each pack. On touch the search
     focuses on open, so a tap behaves like typing ":". Kept short with an inner
     scroll so it never swallows the screen. */
  function buildEmojiPanel(textarea: any, onPick?: (it: any) => void) {
    ensureEmojiStyles();
    var panel = el('div', 'emoji-panel');
    panel.hidden = true;
    var search = el('input', 'emoji-search');
    search.type = 'search'; search.placeholder = 'Search emoji...';
    var srow = el('div', 'emoji-search-row'); srow.appendChild(search); panel.appendChild(srow);
    var tabs = el('div', 'emoji-tabs'), body = el('div', 'emoji-body');
    var TABS = [['standard', 'Emoji'], ['memes', 'Memes'], ['pepe', 'Pepe']];
    var active = 'standard', tabBtns: Record<string, any> = {};
    TABS.forEach(function (t) {
      var b = el('button', 'emoji-tab', t[1]); b.type = 'button';
      b.addEventListener('click', function () { active = t[0]; search.value = ''; mark(); draw(); });
      tabBtns[t[0]] = b; tabs.appendChild(b);
    });
    panel.appendChild(tabs); panel.appendChild(body);
    function mark() { TABS.forEach(function (t) { tabBtns[t[0]].className = 'emoji-tab' + (t[0] === active ? ' emoji-tab-on' : ''); }); }
    /* A pick goes to the caller when one is given (the DM reaction picker);
       else into the textarea at the caret, as always. */
    function put(it: any) { if (onPick) { onPick(it); return; } insertEmojiItem(textarea, it); textarea.focus(); }
    function cellChar(ch: any, label: any) {
      var b = el('button', 'emoji-cell'); b.type = 'button'; b.textContent = ch; b.title = ':' + label + ':';
      b.addEventListener('click', function () { put({ kind: 'char', char: ch }); });
      return b;
    }
    function cellImg(code: any, path: any) {
      var b = el('button', 'emoji-cell'); b.type = 'button'; b.title = ':' + code + ':';
      b.appendChild(emojiImg(path, code));
      b.addEventListener('click', function () { put({ kind: 'img', code: code }); });
      return b;
    }
    function gridImgs(pairs: any) { var g = el('div', 'emoji-grid'); pairs.forEach(function (e: any) { g.appendChild(cellImg(e[0], e[1])); }); return g; }
    function draw() {
      body.textContent = '';
      var q = search.value.trim();
      if (q) {
        var res = emojiSearch(q, 250);
        if (!res.length) { body.appendChild(el('p', 'emoji-empty', 'No matches.')); return; }
        var g = el('div', 'emoji-grid');
        res.forEach(function (it) { g.appendChild(it.kind === 'img' ? cellImg(it.code, it.path) : cellChar(it.char, it.label)); });
        body.appendChild(g);
        return;
      }
      if (active === 'memes') { body.appendChild(gridImgs(EMOJI_PACKS.memes)); return; }
      if (active === 'pepe') { body.appendChild(gridImgs(EMOJI_PACKS.pepe)); return; }
      if (emojiData && emojiData.groups.length) {
        emojiData.groups.forEach(function (grp: any) {
          body.appendChild(el('div', 'emoji-group-head', grp.g));
          var g = el('div', 'emoji-grid');
          grp.e.forEach(function (e: any) { g.appendChild(cellChar(e[0], e[1])); });
          body.appendChild(g);
        });
      } else {
        var g2 = el('div', 'emoji-grid');
        STANDARD_EMOJI.forEach(function (ch) { g2.appendChild(cellChar(ch, ch)); });
        body.appendChild(g2);
        loadEmojiData().then(function () { if (active === 'standard' && !search.value.trim() && !panel.hidden) draw(); });
      }
    }
    search.addEventListener('input', draw);
    panel.openPanel = function () {
      panel.hidden = false; mark(); draw(); loadEmojiData();
      /* On touch the search takes focus so a tap behaves like typing ":" — for
         the forum toolbar's picker. A caller that hands over onPick (the DM
         composer, the reaction surface) owns the keyboard: focusing here would
         raise it under the picker, the crammed screen the owner reported. */
      if (onPick) return;
      try { if (window.matchMedia && window.matchMedia('(hover: none)').matches) search.focus(); } catch (e) {}
    };
    panel.closePanel = function () { panel.hidden = true; };
    panel.toggle = function () { if (panel.hidden) panel.openPanel(); else panel.closePanel(); };
    return panel;
  }

  /* The whole KJV text, fetched once and cached, only when the Scripture picker
     is first opened — the same lazy pattern as the emoji data. */
  var kjvData: any = null, kjvPromise: any = null;
  function loadKjv(): Promise<any> {
    if (kjvPromise) return kjvPromise;
    kjvPromise = fetch(asset('kjv.json')).then(function (r) { return r.json(); })
      .then(function (d) { kjvData = d; return d; })
      .catch(function () { kjvData = { books: [] }; return kjvData; });
    return kjvPromise;
  }
  var drData: any = null, drPromise: any = null;
  function loadDr(): Promise<any> {
    if (drPromise) return drPromise;
    drPromise = fetch(asset('dr.json')).then(function (r) { return r.json(); })
      .then(function (d) { drData = d; return d; })
      .catch(function () { drData = { books: [] }; return drData; });
    return drPromise;
  }

  /* The Scripture picker: choose a book, chapter, and a verse (or a span of
     verses), and drop the passage into the box as a blockquote with the
     reference — which the renderer then autolinks back to the exact verse. */
  function buildScripturePanel(textarea: any) {
    ensureEmojiStyles();
    var panel = el('div', 'emoji-panel scripture-panel');
    panel.hidden = true;
    var row = el('div', 'scripture-row');
    var bookSel = el('select', 'scripture-sel');
    var chapSel = el('select', 'scripture-sel scripture-sel-sm');
    var v1Sel = el('select', 'scripture-sel scripture-sel-sm');
    var dash = el('span', 'scripture-dash', '–');
    var v2Sel = el('select', 'scripture-sel scripture-sel-sm');
    row.appendChild(bookSel); row.appendChild(el('span', 'scripture-sp', ' '));
    row.appendChild(chapSel); row.appendChild(el('span', 'scripture-colon', ':'));
    row.appendChild(v1Sel); row.appendChild(dash); row.appendChild(v2Sel);
    panel.appendChild(row);
    var status = loadingLine('Loading the King James text…', 'scripture-status');
    panel.appendChild(status);
    var preview = el('blockquote', 'scripture-preview'); preview.hidden = true;
    panel.appendChild(preview);
    var insert = el('button', 'scripture-insert', 'Insert passage');
    insert.type = 'button';
    panel.appendChild(insert);

    function opts(sel: any, n: any, label?: any) {
      sel.textContent = '';
      for (var i = 1; i <= n; i++) {
        var o = el('option'); o.value = i; o.textContent = label ? label + ' ' + i : i;
        sel.appendChild(o);
      }
    }
    function curBook() { return kjvData.books[bookSel.value ? +bookSel.value - 1 : 0]; }
    function fillBooks() {
      bookSel.textContent = '';
      kjvData.books.forEach(function (b: any, i: any) {
        var o = el('option'); o.value = i + 1; o.textContent = b.name; bookSel.appendChild(o);
      });
      fillChapters();
    }
    function fillChapters() { opts(chapSel, curBook().chapters.length, 'Chapter'); fillVerses(); }
    function fillVerses() {
      var ch = curBook().chapters[+chapSel.value - 1] || [];
      opts(v1Sel, ch.length); opts(v2Sel, ch.length);
      drawPreview();
    }
    function drawPreview() {
      var a = +v1Sel.value || 1, z = +v2Sel.value || a;
      if (z < a) { z = a; v2Sel.value = a; }
      var ch = curBook().chapters[+chapSel.value - 1] || [], parts = [];
      for (var v = a; v <= z; v++) if (ch[v - 1]) parts.push(ch[v - 1]);
      fillBody(preview, parts.join(' '));
      preview.hidden = !parts.length;
    }
    function passage() {
      var b = curBook(), c = +chapSel.value, a = +v1Sel.value, z = +v2Sel.value;
      if (z < a) z = a;
      var ch = b.chapters[c - 1] || [], parts = [];
      for (var v = a; v <= z; v++) if (ch[v - 1]) parts.push(ch[v - 1]);
      var ref = b.name + ' ' + c + ':' + a + (z > a ? '-' + z : '');
      return '> ' + parts.join(' ') + ' (' + ref + ')\n';
    }
    /* App bottom-sheet pickers over the four cascading selects on phones; each
       fill repopulates dependents, so refresh their picker labels after. */
    function enhSel(sel: any, label: any) {
      sel.setAttribute('aria-label', label);
      if (window.mcSelectSheet) { var h = window.mcSelectSheet(sel); if (h) h.refresh(); }
    }
    function enhAll() { enhSel(bookSel, 'Book'); enhSel(chapSel, 'Chapter'); enhSel(v1Sel, 'From verse'); enhSel(v2Sel, 'To verse'); }
    bookSel.addEventListener('change', function () { fillChapters(); enhAll(); });
    chapSel.addEventListener('change', function () { fillVerses(); enhAll(); });
    v1Sel.addEventListener('change', function () { drawPreview(); enhAll(); });
    v2Sel.addEventListener('change', function () { drawPreview(); enhAll(); });
    insert.addEventListener('click', function () {
      insertAtCaret(textarea, passage());
      textarea.focus();
      panel.closePanel();
    });

    panel.openPanel = function () {
      panel.hidden = false;
      if (kjvData) { status.hidden = true; fillBooks(); enhAll(); }
      else {
        status.hidden = false;
        loadKjv().then(function () {
          if (kjvData.books.length) { status.hidden = true; fillBooks(); enhAll(); }
          else status.textContent = 'Could not load the Bible text.';
        });
      }
    };
    panel.closePanel = function () { panel.hidden = true; };
    panel.toggle = function () { if (panel.hidden) panel.openPanel(); else panel.closePanel(); };
    return panel;
  }

  /* Inject the emoji styles once, matched to the site palette, rather than touch
     the shared stylesheet. The inner scroll keeps the panel and : list compact. */
  function ensureEmojiStyles() {
    if (window.mcRich) return window.mcRich.ensureEmojiStyles();
    if (document.getElementById('mc-emoji-css')) return;
    var css = '' +
      /* Markdown headings inside bodies: sized within reason for a comment —
         # a touch larger, ### about normal, ##### slightly small — never a
         page-title shout, and dressed in the site's maroon. */
      '.mc-hd{font-weight:bold;color:var(--maroon,#8b1a1a);margin:0.65em 0 0.3em;line-height:1.25}' +
      '.mc-hd:first-child{margin-top:0.1em}' +
      '.mc-hd1{font-size:1.28em}' +
      '.mc-hd2{font-size:1.18em}' +
      '.mc-hd3{font-size:1.09em}' +
      '.mc-hd4{font-size:1em}' +
      '.mc-hd5{font-size:0.92em}' +
      /* display explicit: a site-wide img{display:block} (05-home.css) would
         otherwise drop every inline emoji onto its own line. */
      '.mc-emoji{display:inline-block;height:1.35em;width:auto;vertical-align:-0.28em;margin:0 .04em}' +
      '.emoji-suggest{max-height:15em;overflow-y:auto}' +
      'a.emoji-suggest-row{align-items:center}' +
      '.emoji-suggest-glyph{display:inline-flex;align-items:center;justify-content:center;min-width:1.6em;font-size:1.15rem}' +
      '.emoji-suggest-glyph .mc-emoji{height:1.4em}' +
      '.emoji-panel{margin:.45em 0 0;border:1px solid var(--rule);border-radius:8px;background:var(--surface,#fff);box-shadow:0 2px 10px rgba(0,0,0,.08);overflow:hidden}' +
      '.emoji-search-row{padding:.5em;border-bottom:1px solid var(--rule)}' +
      '.emoji-search{width:100%;box-sizing:border-box;padding:.4em .6em;border:1px solid var(--rule);border-radius:6px;font:inherit;background:var(--surface,#fff);color:var(--ink,#1a1a1a)}' +
      '.emoji-search:focus,.scripture-sel:focus{outline:1px solid var(--maroon);border-color:var(--maroon)}' +
      '.emoji-tabs{display:flex;gap:.3em;flex-wrap:wrap;padding:.45em .5em 0}' +
      '.emoji-tab{font:inherit;font-size:.92rem;padding:.25em .8em;border:1px solid var(--rule);border-bottom:none;border-radius:6px 6px 0 0;background:var(--cream,#f7f1e3);color:var(--faint);cursor:pointer}' +
      '.emoji-tab-on{background:var(--surface,#fff);color:var(--maroon);font-weight:600}' +
      '.emoji-body{max-height:15em;overflow-y:auto;padding:.4em .5em .6em}' +
      '.emoji-group-head{position:sticky;top:0;background:var(--surface,#fff);color:var(--faint);font-size:.75rem;text-transform:uppercase;letter-spacing:.04em;padding:.4em .15em .2em}' +
      '.emoji-grid{display:flex;flex-wrap:wrap;gap:.1em}' +
      '.emoji-cell{width:2em;height:2em;display:inline-flex;align-items:center;justify-content:center;border:none;background:none;border-radius:6px;cursor:pointer;font-size:1.25rem;line-height:1;padding:0}' +
      '.emoji-cell:hover{background:var(--cream,#f9f3e6)}' +
      '.emoji-cell .mc-emoji{height:1.5em}' +
      '.emoji-empty{color:var(--faint);padding:.5em;margin:0}' +
      '.av-body{max-height:17em}' +
      '.av-grid{gap:.35em}' +
      '.av-cell{width:3em;height:3em;padding:2px;border:1px solid var(--rule);background:var(--cream-2,#faf6ee);border-radius:8px}' +
      '.av-cell:hover{background:var(--cream,#f2e7d0);border-color:var(--maroon)}' +
      '.av-cell img{max-width:100%;max-height:100%;width:auto;height:auto;object-fit:contain;display:block;margin:0}' +
      '.btn-gallery{display:inline-block;margin:.15em 0 .1em}' +
      /* Scripture picker + autolink + hover preview */
      '.scripture-panel{padding:.6em}' +
      '.scripture-row{display:flex;flex-wrap:wrap;align-items:center;gap:.25em}' +
      '.scripture-sel{font:inherit;font-size:.95rem;padding:.15em .3em;border:1px solid var(--rule);border-radius:5px;background:var(--cream-2,#faf6ee);color:var(--ink);max-width:14em}' +
      '.scripture-sel-sm{max-width:6em}' +
      '.scripture-colon,.scripture-dash{color:var(--faint);padding:0 .05em}' +
      '.scripture-status{color:var(--faint);font-size:.9rem;padding:.4em 0}' +
      '.scripture-preview{margin:.6em 0;padding:.4em .7em;border-left:3px solid var(--rule);color:var(--ink-soft);font-size:.95rem;max-height:9em;overflow:auto}' +
      '.scripture-insert{font:inherit;cursor:pointer;margin-top:.3em;padding:.3em .8em;border:1px solid var(--maroon);border-radius:6px;background:var(--maroon);color:var(--bg,#faf6ee)}' +
      '.scripture-insert:hover{background:var(--maroon-dark)}' +
      '.scripture-link{white-space:nowrap}' +
      '.scripture-tip{position:fixed;z-index:1200;max-width:30rem;max-height:60vh;overflow:auto;background:var(--surface,#fff);color:var(--ink);border:1px solid var(--rule);border-radius:6px;box-shadow:0 3px 14px rgba(0,0,0,.22);padding:.55em .7em;font-size:.92rem;line-height:1.5;pointer-events:none}' +
      '.scripture-tip-ref{display:block;color:var(--maroon);margin-bottom:.25em}' +
      '.scripture-tip-v{color:var(--faint);font-size:.72em;margin-right:.1em}' +
      /* Post preview: the composer swaps for the rendered body */
      '.md-editor.md-previewing>:not(.md-preview){display:none}' +
      '.md-preview{border:1px dashed var(--rule);border-radius:8px;padding:.55em .8em;min-height:5em}' +
      '.md-preview-title{font-weight:700}' +
      '.md-preview-empty{color:var(--faint);margin:0}' +
      '.btn-preview{background:transparent;border-color:var(--maroon);color:var(--maroon);font:inherit;cursor:pointer}' +
      '.btn-preview:hover{background:var(--maroon);color:var(--bg,#fff)}' +
      '.btn-preview:disabled{opacity:.6;cursor:default}' +
      // scripture-sel 16px on phones: a sub-16px focused control zooms the iOS viewport (and the zoom outlives it)
      '@media (max-width:620px){.emoji-body,.emoji-suggest{max-height:40vh}.emoji-cell{width:2.4em;height:2.4em;font-size:1.45rem}.av-cell{width:3.4em;height:3.4em}.scripture-sel{max-width:9em;font-size:16px}}';
    var st = el('style'); st.id = 'mc-emoji-css'; st.textContent = css;
    document.head.appendChild(st);
  }

  /* ---- Drafts. Whatever you type is kept in this browser's localStorage as
     you type it, one slot per composer: this page's comment box, each board
     category's new-topic form, each topic's reply box, each DM thread, each
     post being edited. A crashed browser or a dead phone costs nothing, come
     back and the words are where you left them. A slot is cleared when its
     post lands (or its edit is cancelled), and any slot untouched for thirty
     days is swept on the next visit. Purely client-side, the server never
     sees a draft. ---- */
  var DRAFT_NS = 'mc-draft:';
  var DRAFT_KEEP_MS = 30 * 86400 * 1000;

  function draftRead(ctx: any) {
    try {
      var d = JSON.parse(localStorage.getItem(DRAFT_NS + ctx) as string);
      return d && typeof d.body === 'string' ? d : null;
    } catch (e) { return null; }
  }

  function draftClear(ctx: any) {
    try { localStorage.removeItem(DRAFT_NS + ctx); } catch (e) {}
  }

  /* Wire a composer to its slot: restore on build, save as it changes (the
     toolbar, pickers, and quote button all dispatch input like typing does),
     flush when the tab is hidden or torn down. A successful post calls
     ta.mcDraftDone(), which clears the slot and holds further saves until the
     next real keystroke, so a teardown flush on the way to a redirect can
     never resurrect what was just posted. With overwrite set (editing an
     existing post), a differing draft wins over the prefilled body. */
  /* Every live composer on the page, so a single listener can flush them all.
     Held weakly by isConnected checks rather than by a WeakSet, because we need
     to iterate. Detached composers are dropped on each sweep. */
  var draftLive: any[] = [];

  function attachDraft(ta: any, ctx: string, titleInput?: any, overwrite?: boolean) {
    var muted = false;
    var timer: any = null;
    var lastSaved: string | null = null;
    var d = draftRead(ctx);
    if (d) {
      if (d.body && (overwrite ? d.body !== ta.value : !ta.value)) ta.value = d.body;
      if (titleInput && d.title && !titleInput.value) titleInput.value = d.title;
    }
    function save() {
      if (muted || !ta.isConnected) return;
      var body = ta.value;
      var title = titleInput ? titleInput.value : '';
      lastSaved = body + '\u0000' + title;
      try {
        if (!body.trim() && !title.trim()) localStorage.removeItem(DRAFT_NS + ctx);
        else localStorage.setItem(DRAFT_NS + ctx,
          JSON.stringify({ body: body, title: title || undefined, at: Date.now() }));
      } catch (e) {}
    }
    /* Cheap enough to call on every press: it only touches storage when the
       composer holds something that is not already saved. */
    function flush() {
      if (muted || !ta.isConnected) return;
      var now = ta.value + '\u0000' + (titleInput ? titleInput.value : '');
      if (now === lastSaved) return;
      clearTimeout(timer);
      save();
    }
    draftLive.push({ ta: ta, flush: flush });
    ta.mcDraftFlush = flush;
    function later() { muted = false; clearTimeout(timer); timer = setTimeout(save, 400); }
    ta.addEventListener('input', later);
    ta.addEventListener('blur', save);
    if (titleInput) {
      titleInput.addEventListener('input', later);
      titleInput.addEventListener('blur', save);
    }
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') save();
    }, { signal: bootSig });
    addEventListener('pagehide', save, { signal: bootSig });
    ta.mcDraftDone = function () {
      muted = true;
      lastSaved = null;
      clearTimeout(timer);
      draftClear(ctx);
    };
  }

  /* Wrap a compose textarea with a button row above,
     returning the wrapper to mount where the textarea would have gone. The
     textarea itself is unchanged, so .comment-text lookups still resolve.
     A topic form passes its title input too, so the preview can wear it. */
  function mdEditor(textarea: any, titleInput?: any) {
    /* EVERY composer on the site is wrapped by this, so warming here reaches
       the forum, the feed, direct messages and the page-comment box alike —
       nothing to remember to add at each call site. */
    warmOnFocus(textarea);
    if (titleInput) warmOnFocus(titleInput);
    var wrap = el('div', 'md-editor');
    var bar = el('div', 'md-toolbar');
    bar.appendChild(mdButton('B', 'Bold  **text**', 'md-b', function () { wrapSel(textarea, '**', '**'); }));
    bar.appendChild(mdButton('I', 'Italic  *text*', 'md-i', function () { wrapSel(textarea, '*', '*'); }));
    bar.appendChild(mdButton('” Quote', 'Blockquote  > line', null, function () { linePrefix(textarea, '> '); }));
    bar.appendChild(mdButton('• List', 'Bulleted list  - item', null, function () { linePrefix(textarea, '- '); }));
    bar.appendChild(mdButton('Link', 'Link  [text](url) — merecatholicity.com only', null, function () { insertLink(textarea); }));
    var panel = buildEmojiPanel(textarea);
    var scripture = buildScripturePanel(textarea);
    bar.appendChild(mdButton('😊 Emoji', 'Insert an emoji', 'md-emoji', function () { scripture.closePanel(); panel.toggle(); }));
    bar.appendChild(mdButton('✝ Scripture', 'Insert a Bible passage', 'md-scripture', function () { panel.closePanel(); scripture.toggle(); }));
    wrap.appendChild(bar);
    wrap.appendChild(textarea);
    wrap.appendChild(panel);
    wrap.appendChild(scripture);
    /* Preview rides the composer: the whole editor swaps for the post as it
       will render, drawn by the same fillBody that draws every published
       comment, and one click swaps back. The state lives on the textarea
       because button rows are rebuilt whenever identity changes, so any
       button made by previewButton binds here and is relabeled in place.
       The value is untouched, posting works from either side. */
    var pvBox: any = null;
    var pvBtns: any[] = [];
    textarea.mcPreview = {
      active: false,
      bind: function (btn: any) {
        pvBtns.push(btn);
        btn.textContent = this.active ? 'Edit' : 'Preview';
      },
      toggle: function () { this.set(!this.active); },
      off: function () { this.set(false); },
      set: function (on: any) {
        if (on === this.active) return;
        this.active = on;
        if (on) {
          panel.closePanel();
          scripture.closePanel();
          pvBox = el('div', 'comment-body md-preview');
          if (textarea.value.trim()) fillBody(pvBox, textarea.value);
          else pvBox.appendChild(el('p', 'md-preview-empty', 'Nothing to preview yet.'));
          var t = titleInput ? titleInput.value.replace(/\s+/g, ' ').trim() : '';
          if (t) pvBox.insertBefore(el('p', 'md-preview-title', t), pvBox.firstChild);
          wrap.appendChild(pvBox);
          wrap.classList.add('md-previewing');
        } else {
          if (pvBox) pvBox.remove();
          pvBox = null;
          wrap.classList.remove('md-previewing');
          textarea.focus();
        }
        if (titleInput) titleInput.style.display = on ? 'none' : '';
        pvBtns = pvBtns.filter(function (b) { return b.isConnected; });
        pvBtns.forEach(function (b) { b.textContent = on ? 'Edit' : 'Preview'; });
      }
    };
    attachEmoji(textarea);
    textarea.addEventListener('focus', prefetchEmoji, { once: true });
    return wrap;
  }

  /* The Preview and back-to-Edit toggle that sits beside every Post button.
     Rows rebuild when identity changes, so the label reads the live state
     and bind keeps whichever button currently stands relabeled. */
  function previewButton(ta: any) {
    if (!ta || !ta.mcPreview) return null;
    var btn = el('button', 'btn btn-preview', 'Preview');
    btn.type = 'button';
    btn.title = 'Read the post as it will look';
    btn.addEventListener('click', function () { ta.mcPreview.toggle(); });
    ta.mcPreview.bind(btn);
    return btn;
  }

  /* ---- The attachment stash: a picked or RECORDED file survives a reload.
     Born of a live loss (2026-08-03): a voice note rode a new-topic composer,
     the page died at Post (an iOS engine reload no page script can prevent),
     and the recording — already uploaded, its media_key held only in JS
     memory — was orphaned and swept. Text drafts survive via attachDraft;
     this is the same covenant for media. IndexedDB, because a blob has no
     place in localStorage: one record per composer place {blob, name, type,
     size, key, at}. A stashed upload key is reused while the server's
     unlinked-orphan window (15 min) can still hold the row; past that the
     kept blob re-uploads through the normal gate. Cleared by ✕, by a
     successful post, and by age (24 h). Board + feed/wall composers; the DM
     composer is deliberately out (its media rides the E2E envelope, a
     different custody story). Best-effort throughout: no IndexedDB = exactly
     the old behavior. */
  var stashDbP: any = null;
  function mediaStashDb(): Promise<any> {
    if (stashDbP) return stashDbP;
    stashDbP = new Promise(function (resolve) {
      try {
        var req = indexedDB.open('mc-media-stash', 1);
        req.onupgradeneeded = function () { try { req.result.createObjectStore('stash'); } catch (e) { /* raced */ } };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { resolve(null); };
      } catch (e) { resolve(null); }
    });
    return stashDbP;
  }
  function mediaStash(op: any, place: any, rec?: any) {
    return mediaStashDb().then(function (db: any) {
      if (!db) return null;
      return new Promise(function (resolve) {
        try {
          var tx = db.transaction('stash', op === 'get' ? 'readonly' : 'readwrite');
          var st = tx.objectStore('stash');
          var r = op === 'get' ? st.get(place) : op === 'del' ? st.delete(place) : st.put(rec, place);
          r.onsuccess = function () { resolve(op === 'get' ? r.result : true); };
          r.onerror = function () { resolve(null); };
        } catch (e) { resolve(null); }
      });
    }).catch(function () { return null; });
  }
  /* The board composer's place, in attachDraft's own key grammar. */
  function boardMediaPlace() {
    var qs = new URLSearchParams(location.search);
    return qs.get('topic') ? 'reply:' + qs.get('topic') : 'topic:' + (qs.get('cat') || '');
  }

  /* The board composer's attach controls (📎 + 🎙), added asynchronously once
     the served settings say the board takes attachments at all. The pick path
     gates kind + size (images downscaled first), uploads at once to
     /board/media, and holds the returned media_key on state.boardMedia for the
     next boardPost; ✕ or a successful post clears it. The row lives OUTSIDE
     .comment-buttons, which identity re-renders wipe. The back-room composer
     gets no controls (the server refuses back-room attachments outright). */
  function attachBoardMedia(form: any) {
    state.boardMedia = null;
    if (new URLSearchParams(location.search).get('cat') === 'adminsonly') return;
    mediaCfg().then(function (cfg: any) {
      var sec = cfg.sections.board;
      if (!cfg.enabled || !sec.kinds.length) return;
      var core: any = window.mcCore;
      var row = el('div', 'mc-media-row');
      var fileInput = el('input', 'mc-board-file');
      fileInput.type = 'file';
      fileInput.accept = core.mediaAcceptFor(sec.kinds);
      fileInput.style.display = 'none';
      var chip = el('span', 'dm-attach-chip');
      chip.style.display = 'none';
      var note = el('span', 'mc-media-note');
      var place = boardMediaPlace();
      var held: any = { key: '', clear: clearHeld };
      function clearHeld() {
        held.key = '';
        fileInput.value = '';
        chip.style.display = 'none';
        chip.textContent = '';
        mediaStash('del', place);
      }
      state.boardMedia = held;
      var attach = utilBtnLabel(el('button', 'btn btn-attach'), '📎', 'Attach');
      attach.type = 'button';
      attach.addEventListener('click', function () { fileInput.click(); });
      function showChip(name: any, size: any) {
        chip.textContent = '';
        chip.appendChild(document.createTextNode('📎 ' + (name || 'attachment') + ' · ' + fmtBytes(size) + '  '));
        var x = el('a', null, '✕');
        x.href = '#';
        x.addEventListener('click', function (e: any) { e.preventDefault(); clearHeld(); });
        chip.appendChild(x);
        chip.style.display = '';
      }
      function takeFile(f: any) {
        note.textContent = '';
        mediaGateFile(f, cfg, sec, note).then(function (out: any) {
          if (!out) { fileInput.value = ''; return; }
          note.textContent = 'Uploading…';
          var fd = new FormData();
          fd.append('key', state.key || '');
          fd.append('file', out);
          fetchRetry(API + '/board/media', { method: 'POST', body: fd }, [1500])
            .then(function (r) { return r.json(); })
            .then(function (d: any) {
              if (blockedOut(d)) return;
              if (!d || !d.ok) { note.textContent = (d && d.error) || 'Upload failed.'; return; }
              note.textContent = '';
              held.key = d.media_key;
              showChip(out.name, out.size);
              /* The stash keeps BOTH the key (instant reuse) and the bytes
                 (re-upload once the server's orphan window has passed). */
              mediaStash('put', place, { blob: out, name: out.name || 'attachment',
                type: out.type || '', size: out.size, key: d.media_key, at: Date.now() });
            })
            .catch(function () { note.textContent = 'Upload failed. Try again.'; });
        });
      }
      /* A reload (or the iOS engine dying at Post) rebuilds the composer:
         re-adopt what the stash holds so the recording is still attached. */
      mediaStash('get', place).then(function (rec: any) {
        if (!rec || !rec.at || held.key || fileInput.value) return;
        if (Date.now() - rec.at > 86400000) { mediaStash('del', place); return; }
        if (rec.key && Date.now() - rec.at < 12 * 60000) {
          held.key = rec.key;
          showChip(rec.name, rec.size);
        } else if (rec.blob) {
          try {
            takeFile(new File([rec.blob], rec.name || 'attachment', { type: rec.type || rec.blob.type || '' }));
          } catch (e) { /* File ctor unavailable: stash stays for a newer engine */ }
        }
      });
      fileInput.addEventListener('change', function () {
        var f = fileInput.files && fileInput.files[0];
        if (f) takeFile(f);
      });
      row.appendChild(attach);
      if (sec.voice && sec.kinds.indexOf('audio') !== -1) row.appendChild(voiceControl(form, cfg, sec, note, takeFile));
      row.appendChild(chip);
      row.appendChild(note);
      form.appendChild(fileInput);
      var btnRow = form.querySelector('.comment-buttons');
      if (btnRow) form.insertBefore(row, btnRow);
      else form.appendChild(row);
    });
  }

  /* @mentions in the reply box. The very same directory and fuzzy scorer as the
     Send-a-DM search, but triggered by an "@" token at the caret: a pick inserts
     "@Name" and remembers that member's hash, and boardPost carries the hashes
     whose token still stands in the body. Picking is the only source of truth,
     since a pseudonym cannot be reversed to a hash. */
  B.mentionDir = null; var mentionDirLoading = false;
  var pendingMentions: any[] = [];
  function ensureMentionDir(cb: any) {
    if (B.mentionDir) return cb();
    if (mentionDirLoading) return;
    mentionDirLoading = true;
    fetch(API + '/dm/directory' + freshParam('?'))
      .then(function (r) { return r.json(); })
      .then(function (d) { mentionDirLoading = false; if (d.ok) { B.mentionDir = d.users; cb(); } })
      .catch(function () { mentionDirLoading = false; });
  }
  function collectMentions(text: any) {
    if (window.mcCore) return window.mcCore.mentionsIn(text, pendingMentions);
    var out = [];
    for (var i = 0; i < pendingMentions.length; i++) {
      var m = pendingMentions[i];
      if (text.indexOf(m.token) > -1 && out.indexOf(m.hash) === -1) out.push(m.hash);
    }
    return out;
  }
  function attachMentions(textarea: any) {
    if (!textarea || textarea.dataset.mentions) return;
    textarea.dataset.mentions = '1';
    pendingMentions = [];
    /* A plain static container (not the absolute .dm-suggest) so the list flows
       right below the box; its rows carry the shared suggestion styling. */
    var sug = el('div', 'mention-suggest');
    sug.hidden = true;
    textarea.parentNode.insertBefore(sug, textarea.nextSibling);
    var current: any[] = [], sel = 0, at = -1, timer: any = null;
    function scan() {
      var caret = textarea.selectionStart;
      var m = /(^|\s)@([^\s@]{1,30})$/.exec(textarea.value.slice(0, caret));
      if (!m) { current = []; at = -1; sug.hidden = true; return; }
      at = caret - m[2].length - 1;
      var q = m[2].toLowerCase();
      ensureMentionDir(function () {
        current = B.mentionDir
          .filter(function (u: any) { return u.hash !== state.myHash; })
          .map(function (u: any) { return { u: u, s: Math.max(dmScore(q, u.nick), dmScore(q, displayName(u.hash))), label: dmLabel(u.hash, u.nick) }; })
          .filter(function (x: any) { return x.s > 0; })
          .sort(function (x: any, y: any) { return y.s - x.s || (x.label < y.label ? -1 : 1); })
          .slice(0, 8).map(function (x: any) { return x.u; });
        /* The librarian rides the same picker: type toward "merecat" and the
           bot leads the list, labeled for what it is. Picking it inserts the
           literal @merecat token — the server watches for the words, so no
           hash rides in the mentions at all. */
        if (dmScore(q, 'merecat') > 0) {
          current = [{ bot: true, nick: 'merecat' }].concat(current).slice(0, 8);
        }
        sel = 0;
        render();
      });
    }
    function render() {
      sug.textContent = '';
      if (!current.length) { sug.hidden = true; return; }
      current.forEach(function (u, i) {
        var r = el('a', 'dm-suggest-row' + (i === sel ? ' dm-suggest-sel' : ''));
        r.href = '#';
        r.appendChild(el('span', null, u.bot ? 'merecat · AI BOT 🐈' : dmLabel(u.hash, u.nick)));
        r.appendChild(el('span', 'dm-suggest-go', u.bot ? 'ask the librarian' : 'mention'));
        r.addEventListener('mousedown', function (e: any) { e.preventDefault(); pick(u); });
        sug.appendChild(r);
      });
      sug.hidden = false;
    }
    function pick(u: any) {
      if (at < 0) return;
      var caret = textarea.selectionStart;
      var token = u.bot ? '@merecat' : '@' + (u.nick || displayName(u.hash));
      var v = textarea.value;
      textarea.value = v.slice(0, at) + token + ' ' + v.slice(caret);
      var np = at + token.length + 1;
      try { textarea.setSelectionRange(np, np); } catch (e) {}
      if (!u.bot && !pendingMentions.some(function (m) { return m.hash === u.hash && m.token === token; })) {
        pendingMentions.push({ hash: u.hash, token: token });
      }
      current = []; at = -1; sug.hidden = true;
      afterEdit(textarea);
    }
    textarea.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(scan, 120); });
    textarea.addEventListener('keydown', function (e: any) {
      if (sug.hidden || !current.length) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(sel + 1, current.length - 1); render(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(sel - 1, 0); render(); }
      else if (e.key === 'Enter') { e.preventDefault(); if (current[sel]) pick(current[sel]); }
      else if (e.key === 'Escape') { current = []; sug.hidden = true; }
    });
    textarea.addEventListener('blur', function () { setTimeout(function () { sug.hidden = true; }, 200); });
  }
  function mediaDownloadLink(url: any, filename: any, label: any, cls: any) {
    var a = el('a', cls || 'wall-act wall-act-dl');
    a.href = url; (a as HTMLAnchorElement).download = filename || 'download';
    a.title = 'Download'; a.setAttribute('aria-label', 'Download');
    a.appendChild(mcIcon('download'));
    if (label) a.appendChild(el('span', 'wall-act-lbl', label));
    a.addEventListener('click', function (e: any) { e.stopPropagation(); });
    return a;
  }

  /* The media THEATER: click a post's image/video to pop it open — media as large
     as possible on the left (video plays), the post's engagement + comments on the
     right (desktop) or stacked below (mobile). Click the scrim / ✕ / Esc closes.
     For a comment's media (no post) it is a plain viewer with a download. */
  function openMedia(mediaKey: any, kind: any, post: any) {
    closePop();
    var src = API + '/wall/media?key=' + encodeURIComponent(mediaKey);
    var ov = el('div', 'wall-lightbox' + (post ? '' : ' wall-lightbox-bare'));
    var inner = el('div', 'wall-lb-inner');
    var stage = el('div', 'wall-lb-stage');
    var mel: any;
    if (kind === 'v') { mel = el('video', 'wall-lb-media'); mel.src = src; mel.controls = true; mel.autoplay = true; mel.playsInline = true; }
    else if (kind === 'a') { mel = el('audio', 'wall-lb-media wall-lb-audio'); mel.src = src; mel.controls = true; mel.autoplay = true; }
    else { mel = el('img', 'wall-lb-media'); mel.src = src; mel.alt = ''; }
    stage.appendChild(mel);
    inner.appendChild(stage);
    var rail = el('div', 'wall-lb-rail');
    if (post) {
      var head = el('div', 'comment-head');
      wallAvatarInto(head, post.author_hash, post.avatar);
      head.appendChild(authorNode(post.author_hash, post.nick, true, post.faith, post.posts));
      head.appendChild(el('span', 'comment-date', ' ' + fmtDateTime(post.created_at)));
      rail.appendChild(head);
      if (post.body) rail.appendChild(fillBody(el('div', 'comment-body'), post.body));
      var acts = wallActions(post);
      rail.appendChild(acts.el);
      var cs = wallCommentsSection(post, acts.bumpComment);
      rail.appendChild(cs.wrap); cs.load();
      var focusComposer = function () { var ta = cs.wrap.querySelector('.comment-form .comment-text') as HTMLElement; if (ta) ta.focus(); };
      acts.cmtBtn.addEventListener('click', focusComposer);
      acts.cmtSum.addEventListener('click', focusComposer);
      acts.shareBtn.addEventListener('click', function (e: any) { e.stopPropagation(); showShareMenu(acts.shareBtn, location.origin + '/feed.html?post=' + post.id, { url: src, filename: mediaFilename(mediaKey) }, { kind: 'wall', ref: post.id }); });
    } else {
      var mini = el('div', 'wall-lb-mini');
      mini.appendChild(mediaDownloadLink(src, mediaFilename(mediaKey), 'Download', 'btn btn-anon'));
      rail.appendChild(mini);
    }
    inner.appendChild(rail);
    ov.appendChild(inner);
    var x = el('button', 'wall-lb-x'); x.type = 'button'; x.appendChild(mcIcon('close')); x.title = 'Close';
    ov.appendChild(x);
    /* The theater must never feel like leaving the app: it joins history (the
       shell treats a same-URL popstate as hash-only travel and stays put), so
       the app bar's back button, the phone's back gesture, and the browser back
       all close it in place; a soft navigation (a tab tap, any in-app link)
       closes it too. With the scrim gap and the ✕ that is five ways out. */
    var pushed = false;
    function close(fromHistory?: any) {
      if (!ov.parentNode) return;
      ov.parentNode.removeChild(ov);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('popstate', onPop);
      document.removeEventListener('mc-navigate', onNav);
      try { if (mel.pause) mel.pause(); } catch (e) { /* fine */ }
      if (pushed && !fromHistory) { pushed = false; try { history.back(); } catch (e) { /* fine */ } }
    }
    function onPop() { close(true); }
    function onNav() { close(true); }   // the navigation owns history; never history.back() over it
    function onKey(e: any) { if (e.key === 'Escape') close(); }
    ov.addEventListener('click', function (e: any) { if (e.target === ov || e.target === inner || e.target === stage) close(); });
    x.addEventListener('click', function (e: any) { e.stopPropagation(); close(); });
    document.addEventListener('keydown', onKey);
    window.addEventListener('popstate', onPop);
    document.addEventListener('mc-navigate', onNav);
    try { history.pushState({ mcTheater: 1 }, '', location.href); pushed = true; } catch (e) { /* private mode etc.: ✕/scrim/Esc still close */ }
    document.body.appendChild(ov);
  }
  function bind() {
    API = B.API;
    asset = B.asset;
    authorNode = B.authorNode;
    blockedOut = B.blockedOut;
    bootSig = B.bootSig;
    cachedJson = B.cachedJson;
    closePop = B.closePop;
    displayName = B.displayName;
    dmLabel = B.dmLabel;
    dmScore = B.dmScore;
    el = B.el;
    fetchRetry = B.fetchRetry;
    fillBody = B.fillBody;
    fmtBytes = B.fmtBytes;
    fmtDateTime = B.fmtDateTime;
    fmtSecs = B.fmtSecs;
    freshParam = B.freshParam;
    loadingLine = B.loadingLine;
    mcIcon = B.mcIcon;
    mediaFilename = B.mediaFilename;
    showShareMenu = B.showShareMenu;
    state = B.state;
    wallActions = B.wallActions;
    wallAvatarInto = B.wallAvatarInto;
    wallCommentsSection = B.wallCommentsSection;
    warmToken = B.warmToken;
  }
  /* What ran at boot time in the old file, in the old order, after every
     module is bound: listeners, deferred initializers. */
  function run() {
    Object.keys(EMOJI_PACKS).forEach(function (k) {
      EMOJI_PACKS[k].forEach(function (e: any) { CUSTOM_EMOJI[e[0]] = e[1]; });
    });
    (window.mcCore!.emojiNamedTokens).trim().split(/\s+/).forEach(function (tok, i, a) { if (i % 2 === 0) NAMED_EMOJI[tok] = a[i + 1]; });
    LAME_SRC = asset('lamejs.min.js');

    /* Hovering an autolinked reference pops the verse(s) themselves, pulled from
       the same cached KJV text the picker uses. Desktop only — there is no hover
       on touch, and reading the passage is a tap away on the link. A large span is
       allowed but capped so a whole-chapter reference can't fill the screen. */
    if (window.mcRich) { window.mcRich.initScriptureHover(bootSig); } else (function scriptureHover() {
      try { if (!window.matchMedia || !window.matchMedia('(hover: hover)').matches) return; } catch (e) { return; }
      var tip: any = null, maps: Record<string, any> = {}, hideTimer: any = null, CAP = 30;
      function bySlug(which: any, data: any, slug: any) {
        if (!maps[which] && data) {
          maps[which] = {};
          data.books.forEach(function (b: any) { maps[which][b.slug] = b; });
        }
        return maps[which] ? maps[which][slug] : null;
      }
      function place(a: any, ex: any, ey: any) {
        /* A reference that wraps across lines has a union box spanning the
           whole paragraph width, and a tip placed from it lands far from the
           cursor (in the narrow merecat bubbles this happened constantly and
           read as "no tooltip"). Place from the line fragment actually under
           the pointer, first fragment as the fallback. */
        var r = a.getBoundingClientRect();
        var rs = a.getClientRects();
        if (rs && rs.length) {
          r = rs[0];
          if (ey != null) {
            for (var i = 0; i < rs.length; i++) {
              if (ey >= rs[i].top - 2 && ey <= rs[i].bottom + 2) { r = rs[i]; break; }
            }
          }
        }
        tip.style.left = Math.max(6, Math.min(r.left, window.innerWidth - tip.offsetWidth - 10)) + 'px';
        /* Below the fragment if it fits, above if not, and always clamped into
           the viewport: a tall tip near the top edge once fled off-screen. The
           tip scrolls internally and ignores the pointer, so overlap is safe. */
        var below = r.bottom + 8;
        var top = below;
        if (below + tip.offsetHeight > window.innerHeight) {
          var above = r.top - tip.offsetHeight - 8;
          top = above > 6 ? above : Math.max(6, window.innerHeight - tip.offsetHeight - 6);
        }
        tip.style.top = top + 'px';
      }
      function show(a: any, ex: any, ey: any) {
        var dr = a.getAttribute('data-bible') === 'dr';
        (dr ? loadDr() : loadKjv()).then(function () {
          var b = bySlug(dr ? 'dr' : 'kjv', dr ? drData : kjvData, a.getAttribute('data-slug')); if (!b) return;
          var c = +a.getAttribute('data-ch'), ch = b.chapters[c - 1]; if (!ch) return;
          var v1 = +a.getAttribute('data-v1'), v2 = +a.getAttribute('data-v2');
          if (!tip) {
            /* The tip's CSS rides ensureEmojiStyles, which composer views call
               and the merecat chat does not: without it the tip is an unstyled
               static div at the end of the body, invisible below the fold —
               the whole "no tooltip in the chat" mystery. Idempotent, so call
               it here and the hover owns its own dress in every view. */
            ensureEmojiStyles();
            tip = el('div', 'scripture-tip');
            document.body.appendChild(tip);
          }
          tip.textContent = '';
          var h = el('strong', 'scripture-tip-ref', b.name + ' ' + c + ':' + v1 + (v2 > v1 ? '-' + v2 : ''));
          tip.appendChild(h);
          var body = el('div'), n = 0;
          for (var v = v1; v <= v2 && n < CAP; v++, n++) {
            if (!ch[v - 1]) continue;
            if (v2 > v1) { var vn = el('sup', 'scripture-tip-v', v + ' '); body.appendChild(vn); }
            body.appendChild(document.createTextNode(ch[v - 1] + ' '));
          }
          if (v2 - v1 + 1 > CAP) body.appendChild(document.createTextNode('…'));
          tip.appendChild(body);
          tip.hidden = false;
          place(a, ex, ey);
        });
      }
      document.addEventListener('mouseover', function (e) {
        var a = (e.target as any) && (e.target as any).closest && (e.target as any).closest('a.scripture-link');
        if (!a) return;
        clearTimeout(hideTimer);
        show(a, e.clientX, e.clientY);
      }, { signal: bootSig });
      document.addEventListener('mouseout', function (e) {
        var a = (e.target as any) && (e.target as any).closest && (e.target as any).closest('a.scripture-link');
        if (!a) return;
        hideTimer = setTimeout(function () { if (tip) tip.hidden = true; }, 160);
      }, { signal: bootSig });
    })();

    (function pruneDrafts() {
      try {
        var cut = Date.now() - DRAFT_KEEP_MS;
        var dead = [];
        for (var i = 0; i < localStorage.length; i++) {
          var k = localStorage.key(i);
          if (!k || k.indexOf(DRAFT_NS) !== 0) continue;
          var d = null;
          try { d = JSON.parse(localStorage.getItem(k) as string); } catch (e2) {}
          if (!d || !(d.at > cut)) dead.push(k);
        }
        dead.forEach(function (k2) { localStorage.removeItem(k2); });
      } catch (e) {}
    })();
    /* THE LOSS GUARD (2026-09-07, born of a live report: hitting Post sometimes
       white-flashed, reloaded, posted nothing, and lost what had been typed —
       "horrendous", and rightly).
       Saving was debounced 400ms after the last keystroke, plus a blur. Both
       USUALLY fire before a submit, and "usually" is exactly what was failing:
       type fast, tap Post, and the reload could land in the gap.
       So the draft is written the instant a finger goes DOWN on anything —
       capture phase, before any handler, before any async work, before anything
       can reload the page. It costs one localStorage write per press, and only
       when the text actually changed since the last save. Whatever is causing
       the reload, it can no longer take the words with it. */
    /* signal: bootSig is load-bearing, not tidiness. mcBoot() is the whole
       client and re-runs on every soft navigation, so without it each hop left
       ANOTHER permanent capture-phase listener on the document, each holding its
       own draftLive array and every composer ever attached to it — a growing
       pile of work on every finger-down, and memory that only a full page load
       could reclaim. */
    document.addEventListener('pointerdown', function () {
      for (var i = draftLive.length - 1; i >= 0; i--) {
        var rec = draftLive[i];
        if (!rec.ta.isConnected) { draftLive.splice(i, 1); continue; }
        try { rec.flush(); } catch (e) { /* one bad composer must not stop the rest */ }
      }
    }, { capture: true, signal: bootSig });
  }
  return { bind, run, exports: { CUSTOM_EMOJI, afterEdit, attachBoardMedia, attachDraft, attachEmoji, attachMentions, buildEmojiPanel, collectMentions, emojiImg, emojiToken, ensureEmojiStyles, ensureMentionDir, insertEmojiItem, mdEditor, mediaCfg, mediaDownloadLink, mediaGateFile, mediaStash, openMedia, previewButton, scriptureDecor, utilBtnLabel, voiceControl, warmOnFocus } };
}
