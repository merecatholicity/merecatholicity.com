/* 1v1 voice calls — the SHELL-OWNED engine, on every page.

   Moved out of comments.js (2026-08-03) because a call must RING ANYWHERE:
   comments.js boots only on the platform pages and its listeners die with each
   soft-nav boot cycle, so a receiver reading the Library never heard the bell.
   This module rides the bundle (app.js → every page via nav.js), binds its
   listeners ONCE for the page's whole life, and self-enables the member's
   live socket wherever a key exists — so the banner rings over the KJV reader
   as readily as over the feed. comments.js keeps only the 📞 buttons, which
   delegate here through window.mcCall.place().

   Media is peer-to-peer DTLS-SRTP (genuinely end-to-end; even a TURN relay
   carries only ciphertext). Every state change flows through the Domain.Call
   kernel (core.callStep): Ended is absorbing, a stale ring timer is a no-op in
   Active, and NOTHING here listens to socket-close — an Active call rides
   through the live layer's hidden/idle socket closes untouched (a remote
   hangup during a gap surfaces as pc failure within the ~10 s grace). A full
   page reload kills the pc and the call ends: the honest story. */
import * as core from './core.ts';

declare global {
  interface Window {
    mcCall?: { place: (other: string, label?: string) => void; inCall: () => boolean };
    mcSound?: { play: (name: string, loop?: boolean) => void; stop: (name: string) => void };
    __mcCall?: any;
  }
}

const API = '/api/comments';
const STUN = [{ urls: ['stun:stun.cloudflare.com:3478'] }, { urls: ['stun:stun.l.google.com:19302'] }];

function mk(tag: string, cls?: string, text?: string) {
  const n: any = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

async function sha256hex(s: string) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, '0')).join('');
}

function readKey() {
  try { return localStorage.getItem('mc-comment-key') || ''; } catch (e) { return ''; }
}

/* One retry on network failure — the house fetchRetry's little brother. */
function post(path: string, body: any): Promise<any> {
  const go = () => fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
  return go().catch(() => new Promise((res) => setTimeout(res, 1200)).then(go));
}

function micFailMessage(e: any) {
  const name = String((e && e.name) || '');
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') return 'No microphone was found on this device.';
  if (name === 'NotReadableError' || name === 'TrackStartError') return 'The microphone is busy — another app or tab may be using it.';
  if (name === 'SecurityError') return 'Recording is blocked in this browser context.';
  return 'Microphone access is blocked. Check this site’s microphone permission (the icon by the address bar).';
}

const END_COPY: Record<string, string> = {
  hangup: 'Call ended', declined: 'Call declined', busy: 'They are on another call',
  canceled: 'Call canceled', noanswer: 'No answer — they will see a missed call',
  missed: 'Missed call', taken: 'Answered on another device', failed: 'The call could not be completed',
  idle: 'Call ended after a long silence',
};

/* ---- UI sounds (docs/sounds/, CC0 — see _readme_and_license.txt there).
   The ONE sound engine, shell-owned like the call engine so the ring can
   sound on any page; comments.js delegates its bell through window.mcSound.
   Sounds fire only from live socket events or the member's own call actions
   (never polls or page arrival) and honor the gear's per-device "Sound
   effects" switch (mc-sounds). The ring is shared by BOTH sides of a call:
   looped for the callee while the banner stands, and as the caller's ringback
   while Outgoing (their 📞 tap is the autoplay gesture). Autoplay refusals
   before the first user gesture are swallowed. */
const SOUND_SRC: Record<string, string> = { bell: 'sounds/notify.mp3', ring: 'sounds/ring.mp3', end: 'sounds/hangup.mp3' };
const soundCache: Record<string, any> = {};
function soundsOn() {
  try { return localStorage.getItem('mc-sounds') !== 'off'; } catch (e) { return true; }
}
function playSound(name: string, loop?: boolean) {
  if (!soundsOn() || !SOUND_SRC[name]) return;
  try {
    const a = soundCache[name] || (soundCache[name] = new Audio(SOUND_SRC[name]));
    a.loop = !!loop;
    a.currentTime = 0;
    const p = a.play();
    if (p && p.catch) p.catch(() => { /* no gesture yet — stay silent */ });
  } catch (e) { /* no Audio / blocked — silence is fine */ }
}
function stopSound(name: string) {
  const a = soundCache[name];
  if (a) { try { a.pause(); a.currentTime = 0; } catch (e) { /* fine */ } }
}

/* The singleton — on window so a dev console can inspect it and the webtests
   can assert it; ONE per page lifetime (the shell never reboots). */
function freshCall() {
  return { state: 'Idle', reason: '', id: '', peer: '', peerLabel: '', dir: '',
    pc: null as any, stream: null as any, pendingSdp: '', iceIn: [] as any[], iceOut: [] as any[],
    iceT: 0 as any, ringT: 0 as any, setupT: 0 as any, tickT: 0 as any, graceT: 0 as any,
    idleT: 0 as any, lastVoice: 0, startedAt: 0, muted: false };
}

export function installCall() {
  if (window.mcCall) return;   // one engine per page
  const CALL: any = (window as any).__mcCall || freshCall();
  (window as any).__mcCall = CALL;

  let myKey = '';
  let myHash = '';
  const nickCache: Record<string, string> = {};

  /* A member's live socket on every page: the ring's transport. Re-checked on
     pageshow/focus so a login in another tab starts ringing here too. */
  function ensureMember() {
    const k = readKey();
    if (!k || (k === myKey && myHash)) return;
    myKey = k;
    sha256hex(k).then((h) => {
      myHash = h;
      if (window.mcLive && window.mcLive.member) window.mcLive.member.enable(k, h);
    }).catch(() => { /* no crypto.subtle = no calls */ });
  }

  function label(hash: string) {
    if (nickCache[hash]) return nickCache[hash];
    try { return (core as any).displayName(hash); } catch (e) { return hash.slice(0, 8); }
  }
  function fetchNick(hash: string, callId: string) {
    fetch(API + '/profile?hash=' + hash).then((r) => r.json()).then((d: any) => {
      if (d && d.ok && d.profile && d.profile.nick) {
        nickCache[hash] = d.profile.nick;
        if (CALL.id === callId) {
          CALL.peerLabel = d.profile.nick;
          const who = document.querySelector('#mc-call-ui .mc-call-who');
          if (who && (CALL.state === 'Incoming' || CALL.state === 'Outgoing' || CALL.state === 'Active')) render();
        }
      }
    }).catch(() => { /* pseudonym stands */ });
  }

  function step(ev: string) {
    const r = (core as any).callStep(CALL.state, CALL.reason, ev);
    const changed = r.state !== CALL.state || r.reason !== CALL.reason;
    CALL.state = r.state; CALL.reason = r.reason;
    render();
    return changed;
  }

  function ensureStyles() {
    if (document.getElementById('mc-call-css')) return;
    const s = mk('style');
    s.id = 'mc-call-css';
    s.textContent =
      '#mc-call-ui{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(18px + env(safe-area-inset-bottom,0px));z-index:99997;width:min(92vw,430px)}' +
      '.mc-call-panel{background:var(--card,var(--bg,#17191c));color:var(--ink,#eee);border:1px solid var(--rule,#3a3a3a);border-radius:14px;padding:14px 16px;box-shadow:0 8px 30px rgba(0,0,0,.4);display:flex;align-items:center;gap:10px;flex-wrap:wrap}' +
      '.mc-call-who{font-weight:600;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '.mc-call-note{font-size:.78em;opacity:.7;width:100%;margin:2px 0 0}' +
      '.mc-call-time{font-variant-numeric:tabular-nums;opacity:.85}' +
      '.mc-call-panel .btn{margin:0}' +
      '.mc-call-btn{margin-left:.5em;font-size:.9em;vertical-align:middle}' +
      '@keyframes mc-call-pulse{0%,100%{opacity:1}50%{opacity:.45}}' +
      '.mc-call-ring{animation:mc-call-pulse 1.6s infinite}';
    document.head.appendChild(s);
  }
  function ensureUi(): any {
    let ui: any = document.getElementById('mc-call-ui');
    if (!ui) { ui = mk('div'); ui.id = 'mc-call-ui'; document.body.appendChild(ui); }
    return ui;
  }
  function audioEl(): any {
    let au: any = document.getElementById('mc-call-audio');
    if (!au) { au = mk('audio'); au.id = 'mc-call-audio'; au.autoplay = true; au.style.display = 'none'; document.body.appendChild(au); }
    return au;
  }
  function randId() {
    const b = new Uint8Array(16);
    crypto.getRandomValues(b);
    return Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('');
  }
  function iceServers(): Promise<any[]> {
    return post('/call/turn', { key: myKey })
      .then((d: any) => (d && d.ok && d.iceServers && d.iceServers.length ? d.iceServers : STUN))
      .catch(() => STUN);
  }
  function sig(to: string, f: any) {
    try { return !!(window.mcLive && window.mcLive.member && window.mcLive.member.callSig && window.mcLive.member.callSig(to, f)); }
    catch (e) { return false; }
  }
  function flushIce() {
    if (!CALL.iceOut.length || !CALL.peer || !CALL.id) return;
    const batch = CALL.iceOut.splice(0, 12);
    if (!sig(CALL.peer, { call: CALL.id, kind: 'ice', payload: { cand: batch } })) {
      CALL.iceOut = batch.concat(CALL.iceOut);   // socket down: buffer; resync re-flushes
    } else if (CALL.iceOut.length) flushIce();
  }
  function addRemoteIce(pc: any, c: any) {
    if (!c) return;
    try {
      if (c.eoc) pc.addIceCandidate(null).catch(() => { /* some engines refuse the sentinel */ });
      else pc.addIceCandidate(c).catch(() => { /* a racing candidate is survivable */ });
    } catch (e) { /* same */ }
  }
  function clearTimers() {
    clearTimeout(CALL.ringT); clearTimeout(CALL.setupT); clearTimeout(CALL.graceT);
    clearInterval(CALL.iceT); clearInterval(CALL.tickT); clearInterval(CALL.idleT);
    CALL.ringT = CALL.setupT = CALL.graceT = CALL.iceT = CALL.tickT = CALL.idleT = 0;
  }
  function cleanup() {
    stopSound('ring');   // every teardown path silences the ring
    clearTimers();
    try { if (CALL.pc) CALL.pc.close(); } catch (e) { /* already */ }
    CALL.pc = null;
    try { if (CALL.stream) CALL.stream.getTracks().forEach((t: any) => t.stop()); } catch (e) { /* fine */ }
    CALL.stream = null; CALL.muted = false;
    const au: any = document.getElementById('mc-call-audio');
    if (au) { try { au.srcObject = null; } catch (e) { /* fine */ } }
    CALL.iceIn = []; CALL.iceOut = []; CALL.pendingSdp = '';
  }
  function end(ev: string, sendEnd?: boolean) {
    /* A CONNECTED call ending is audible on BOTH sides (the local hang-up and
       the remote 'end' signal both come through here); declines, timeouts, and
       failed setups stay silent — the ring stopping is their signal. */
    const wasActive = CALL.state === 'Active';
    if (sendEnd && CALL.peer && CALL.id) sig(CALL.peer, { call: CALL.id, kind: 'end' });
    step(ev);
    cleanup();
    if (wasActive) playSound('end');
    const endedId = CALL.id;
    setTimeout(() => {
      if (CALL.state === 'Ended' && CALL.id === endedId) {
        CALL.state = 'Idle'; CALL.reason = ''; CALL.id = ''; CALL.peer = ''; CALL.peerLabel = '';
        render();
      }
    }, 2600);
  }
  function makePc(servers: any[]) {
    const pc: any = new (window as any).RTCPeerConnection({ iceServers: servers });
    CALL.pc = pc;
    pc.onicecandidate = (ev: any) => {
      CALL.iceOut.push(ev.candidate ? JSON.parse(JSON.stringify(ev.candidate)) : { eoc: true });
    };
    pc.ontrack = (ev: any) => {
      const au = audioEl();
      try { au.srcObject = ev.streams[0]; const p = au.play(); if (p && p.catch) p.catch(() => { /* gesture given */ }); } catch (e) { /* fine */ }
    };
    pc.onconnectionstatechange = () => {
      if (CALL.pc !== pc) return;
      const st = pc.connectionState;
      if (st === 'connected') {
        clearTimeout(CALL.setupT); clearTimeout(CALL.graceT);
        if (CALL.state === 'Connecting') { CALL.startedAt = Date.now(); step('Connected'); startIdleWatch(pc); }
      } else if (st === 'failed') end('Failure');
      else if (st === 'disconnected') {
        /* 10 s grace for transient blips; ICE restart is v1-out-of-scope, so
           past it the call ends honestly. */
        clearTimeout(CALL.graceT);
        CALL.graceT = setTimeout(() => {
          if (CALL.pc === pc && pc.connectionState !== 'connected') end('Failure');
        }, 10000);
      }
    };
    return pc;
  }

  /* The silence watch (admin-toggleable, /config calls.idle_*): WebRTC stats
     already carry a per-second audioLevel (0..1) for the local mic
     (media-source) and the remote track (inbound-rtp) — no audio graph, and
     nothing leaves the device. Either side clearing the Domain.Call voiceFloor
     resets the clock; past the admin's window the call ends itself through the
     kernel's IdleHangUp (legal ONLY in Active, so a stale interval can never
     kill anything else). A browser that never reports a numeric audioLevel
     disarms the watch — missing data must never hang up a call. Both ends run
     this and race to the same verdict; Ended is absorbing, and the loser of
     the race just sees the other's plain 'end' signal. */
  function startIdleWatch(pc: any) {
    fetch(API + '/config').then((r) => r.json()).then((cfg: any) => {
      const c = (cfg && cfg.calls) || {};
      if (!c.idle_hangup) return;
      if (CALL.pc !== pc || CALL.state !== 'Active') return;
      const limitMs = (core as any).callIdleClampSecs(c.idle_seconds) * 1000;
      CALL.lastVoice = Date.now();
      let sawLevel = false;
      let blanks = 0;
      clearInterval(CALL.idleT);
      CALL.idleT = setInterval(() => {
        if (CALL.pc !== pc || CALL.state !== 'Active') { clearInterval(CALL.idleT); CALL.idleT = 0; return; }
        pc.getStats().then((report: any) => {
          if (CALL.pc !== pc || CALL.state !== 'Active') return;
          let heard = false;
          let seen = false;
          report.forEach((st: any) => {
            if (st.kind !== 'audio' && st.mediaType !== 'audio') return;
            if (st.type !== 'media-source' && st.type !== 'inbound-rtp') return;
            if (typeof st.audioLevel === 'number') {
              seen = true;
              if (st.audioLevel > (core as any).callVoiceFloor) heard = true;
            }
          });
          if (seen) sawLevel = true;
          else if (!sawLevel && ++blanks > 10) { clearInterval(CALL.idleT); CALL.idleT = 0; return; }
          if (heard) CALL.lastVoice = Date.now();
          else if (sawLevel && Date.now() - CALL.lastVoice >= limitMs) end('IdleHangUp', true);
        }).catch(() => { /* stats refused this tick — the next may answer */ });
      }, 1000);
    }).catch(() => { /* no config = no watch; the call stands */ });
  }

  function place(other: string, prettyLabel?: string) {
    ensureMember();
    if (!myKey) return;
    if ((core as any).callInCall(CALL.state)) return;
    if (!(navigator as any).mediaDevices || !(window as any).RTCPeerConnection) return;
    if (!/^[0-9a-f]{64}$/.test(String(other || ''))) return;
    ensureStyles(); ensureUi();
    CALL.dir = 'out'; CALL.peer = other; CALL.peerLabel = prettyLabel || label(other);
    CALL.reason = ''; CALL.id = randId(); CALL.iceIn = []; CALL.iceOut = [];
    const id = CALL.id;
    step('Place');
    if (!prettyLabel) fetchNick(other, id);
    Promise.all([(navigator as any).mediaDevices.getUserMedia({ audio: true }), iceServers()])
      .then((rr: any[]) => {
        if (CALL.state !== 'Outgoing' || CALL.id !== id) { try { rr[0].getTracks().forEach((t: any) => t.stop()); } catch (e) { /* fine */ } return; }
        CALL.stream = rr[0];
        const pc = makePc(rr[1]);
        CALL.stream.getTracks().forEach((t: any) => pc.addTrack(t, CALL.stream));
        return pc.createOffer()
          .then((o: any) => pc.setLocalDescription(o))
          .then(() => post('/call/offer', { key: myKey, to: other, call: id, sdp: pc.localDescription.sdp }))
          .then((d: any) => {
            if (CALL.state !== 'Outgoing' || CALL.id !== id) return;
            if (!d || !d.ok) { end('Failure'); return; }
            /* Ringback: the caller hears the SAME looped ring the callee does,
               from the moment the offer is delivered — stopped on answer
               (onAnswer) and by every teardown path (cleanup). */
            playSound('ring', true);
            CALL.iceT = setInterval(flushIce, 250);
            CALL.ringT = setTimeout(() => {
              if (CALL.state === 'Outgoing' && CALL.id === id) end('Timeout', true);
            }, (core as any).callRingSecs * 1000);
          });
      })
      .catch((e: any) => {
        if (CALL.id !== id) return;
        end('Failure');
        const note = document.querySelector('#mc-call-ui .mc-call-note');
        if (note) note.textContent = micFailMessage(e);
      });
  }

  function answer() {
    if (CALL.state !== 'Incoming') return;
    stopSound('ring');
    clearTimeout(CALL.ringT);
    const id = CALL.id;
    step('Answer');
    Promise.all([(navigator as any).mediaDevices.getUserMedia({ audio: true }), iceServers()])
      .then((rr: any[]) => {
        if (CALL.state !== 'Connecting' || CALL.id !== id) { try { rr[0].getTracks().forEach((t: any) => t.stop()); } catch (e) { /* fine */ } return; }
        CALL.stream = rr[0];
        const pc = makePc(rr[1]);
        return pc.setRemoteDescription({ type: 'offer', sdp: CALL.pendingSdp })
          .then(() => {
            CALL.stream.getTracks().forEach((t: any) => pc.addTrack(t, CALL.stream));
            CALL.iceIn.splice(0).forEach((c: any) => addRemoteIce(pc, c));
            return pc.createAnswer();
          })
          .then((a: any) => pc.setLocalDescription(a))
          .then(() => post('/call/answer', { key: myKey, to: CALL.peer, call: id, sdp: pc.localDescription.sdp }))
          .then((d: any) => {
            if (CALL.state !== 'Connecting' || CALL.id !== id) return;
            if (!d || !d.ok) { end('Failure', true); return; }
            sig(myHash, { call: id, kind: 'taken' });   // hush my other tabs
            CALL.iceT = setInterval(flushIce, 250);
            CALL.setupT = setTimeout(() => {
              if (CALL.state === 'Connecting' && CALL.id === id) end('Timeout', true);
            }, (core as any).callSetupSecs * 1000);
          });
      })
      .catch((e: any) => {
        if (CALL.id !== id) return;
        end('Failure', true);
        const note = document.querySelector('#mc-call-ui .mc-call-note');
        if (note) note.textContent = micFailMessage(e);
      });
  }

  function onOffer(m: any) {
    ensureMember();
    if (!myHash || !m || !m.from || !m.call || !m.sdp) return;
    if ((core as any).callInCall(CALL.state)) {
      if (CALL.state === 'Outgoing' && m.from === CALL.peer) {
        /* Glare — we called each other at once; the lower hash's offer wins. */
        if ((core as any).callGlareWins(myHash, m.from)) {
          sig(m.from, { call: m.call, kind: 'busy' });
          return;
        }
        sig(CALL.peer, { call: CALL.id, kind: 'end' });
        cleanup();
        CALL.state = 'Idle'; CALL.reason = '';
      } else {
        sig(m.from, { call: m.call, kind: 'busy' });
        return;
      }
    }
    ensureStyles(); ensureUi();
    CALL.dir = 'in'; CALL.peer = m.from; CALL.id = m.call; CALL.pendingSdp = m.sdp;
    CALL.iceIn = []; CALL.iceOut = []; CALL.reason = '';
    CALL.peerLabel = label(m.from);
    step('Ring');
    playSound('ring', true);   // looped while the Incoming panel stands; every exit stops it
    fetchNick(m.from, m.call);
    CALL.ringT = setTimeout(() => {
      if (CALL.state === 'Incoming' && CALL.id === m.call) end('Timeout');
    }, (core as any).callRingSecs * 1000);
  }

  function onAnswer(m: any) {
    if (!m || CALL.state !== 'Outgoing' || m.call !== CALL.id || m.from !== CALL.peer) return;
    stopSound('ring');   // they picked up — the ringback yields to the call
    clearTimeout(CALL.ringT);
    const pc = CALL.pc;
    if (!pc) { end('Failure', true); return; }
    step('RemoteAnswer');
    pc.setRemoteDescription({ type: 'answer', sdp: m.sdp })
      .then(() => { CALL.iceIn.splice(0).forEach((c: any) => addRemoteIce(pc, c)); })
      .catch(() => end('Failure', true));
    CALL.setupT = setTimeout(() => {
      if (CALL.state === 'Connecting' && CALL.id === m.call) end('Timeout', true);
    }, (core as any).callSetupSecs * 1000);
  }

  function onSig(m: any) {
    if (!m) return;
    if (m.kind === 'taken') {
      if (m.from === myHash && CALL.state === 'Incoming' && m.call === CALL.id) end('Taken');
      return;
    }
    if (m.call !== CALL.id || m.from !== CALL.peer) return;   // stale/foreign: drop
    if (m.kind === 'ice') {
      const cands = (m.payload && m.payload.cand) || [];
      if (CALL.pc && CALL.pc.remoteDescription) cands.forEach((c: any) => addRemoteIce(CALL.pc, c));
      else CALL.iceIn = CALL.iceIn.concat(cands);
    } else if (m.kind === 'end') end('RemoteEnd');
    else if (m.kind === 'decline') end('RemoteDecline');
    else if (m.kind === 'busy') end('RemoteBusy');
  }

  function fmtElapsed() {
    const s = Math.max(0, Math.floor((Date.now() - (CALL.startedAt || Date.now())) / 1000));
    return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2);
  }

  function render() {
    let ui: any = document.getElementById('mc-call-ui');
    if (!ui) { if (CALL.state === 'Idle') return; ensureStyles(); ui = ensureUi(); }
    ui.textContent = '';
    clearInterval(CALL.tickT); CALL.tickT = 0;
    if (CALL.state === 'Idle') return;
    const panel = mk('div', 'mc-call-panel');
    ui.appendChild(panel);
    const btn = (lbl: string, cls: string, fn: any) => {
      const b = mk('button', 'btn ' + cls, lbl);
      b.type = 'button';
      b.addEventListener('click', fn);
      panel.appendChild(b);
      return b;
    };
    if (CALL.state === 'Outgoing') {
      panel.appendChild(mk('span', 'mc-call-who mc-call-ring', '📞 Calling ' + CALL.peerLabel + '…'));
      btn('Cancel', '', () => end('HangUp', true));
      panel.appendChild(mk('p', 'mc-call-note', ''));
    } else if (CALL.state === 'Incoming') {
      panel.appendChild(mk('span', 'mc-call-who mc-call-ring', '📞 ' + CALL.peerLabel + ' is calling'));
      btn('Answer', 'btn-send', () => answer());
      btn('Decline', '', () => { sig(CALL.peer, { call: CALL.id, kind: 'decline' }); end('LocalDecline'); });
      panel.appendChild(mk('p', 'mc-call-note', 'Voice call · end-to-end encrypted'));
    } else if (CALL.state === 'Connecting') {
      panel.appendChild(mk('span', 'mc-call-who mc-call-ring', 'Connecting…'));
      btn('Hang up', '', () => end('HangUp', true));
      panel.appendChild(mk('p', 'mc-call-note', ''));
    } else if (CALL.state === 'Active') {
      panel.appendChild(mk('span', 'mc-call-who', '📞 ' + CALL.peerLabel));
      const time = mk('span', 'mc-call-time', fmtElapsed());
      panel.appendChild(time);
      CALL.tickT = setInterval(() => { time.textContent = fmtElapsed(); }, 1000);
      btn(CALL.muted ? 'Unmute' : 'Mute', '', (ev: any) => {
        CALL.muted = !CALL.muted;
        try { CALL.stream.getAudioTracks().forEach((t: any) => { t.enabled = !CALL.muted; }); } catch (e) { /* fine */ }
        ev.target.textContent = CALL.muted ? 'Unmute' : 'Mute';
      });
      btn('Hang up', '', () => end('HangUp', true));
      panel.appendChild(mk('p', 'mc-call-note', 'End-to-end encrypted. Keep this screen open — locking the phone pauses the call.'));
    } else if (CALL.state === 'Ended') {
      panel.appendChild(mk('span', 'mc-call-who', END_COPY[CALL.reason] || 'Call ended'));
    }
  }

  /* Permanent listeners — the shell lives as long as the page does. */
  document.addEventListener('mc-live', (ev: any) => {
    const m = ev.detail;
    if (!m) return;
    if (m.t === 'call-offer') onOffer(m);
    else if (m.t === 'call-answer') onAnswer(m);
    else if (m.t === 'call-sig') onSig(m);
  });
  document.addEventListener('mc-live-resync', () => flushIce());
  window.addEventListener('pagehide', () => {
    if ((core as any).callInCall(CALL.state) && CALL.peer && CALL.id) sig(CALL.peer, { call: CALL.id, kind: 'end' });
  });
  window.addEventListener('pageshow', () => ensureMember());
  window.addEventListener('focus', () => ensureMember());

  ensureMember();
  if (CALL.state !== 'Idle') { ensureStyles(); render(); }
  window.mcCall = { place, inCall: () => !!(core as any).callInCall(CALL.state) };
  window.mcSound = { play: playSound, stop: stopSound };   // comments.js rings its bell through this
}
