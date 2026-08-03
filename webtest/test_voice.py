#!/usr/bin/env python3
"""test_voice.py — the voice-note recorder (media wave, 2026-08-02).

Three tests, each individually skippable with a printed reason:

  denied  (prod)  — the honest denied-microphone path: click 🎙 with the mic
                    blocked, expect the "Microphone access is blocked" copy,
                    the "Record with your device instead" fallback row, and
                    the hidden capture file input it springs. GATED on the
                    v=205 client being live (the v=204 copy is the old dead
                    end with no fallback).
  local           — the raw recorder pipeline on a LOCALLY served bundle:
                    fake-device getUserMedia → MediaRecorder (the client's
                    own mime ladder) → decodeAudioData → lamejs MP3 encode,
                    asserting real MPEG frame sync bytes. Runs green today.
  full    (prod)  — the whole composer flow with a fake mic: 🎙 → recording
                    row → Stop → preview <audio> → Use this → the attach
                    chip holding voice-note.mp3. Writes NOTHING (the wall
                    composer holds the file client-side until Send, which is
                    never clicked). GATED on the edge Permissions-Policy no
                    longer denying the mic AND the v=205 client being live.

Run all:            python3 webtest/test_voice.py
Run one:            python3 webtest/test_voice.py denied|local|full
Stdlib only, like everything in webtest/.
"""
import json
import re
import subprocess
import sys
import time
import urllib.request

import flows
from flows import Flow

LOCAL_BASE = 'http://127.0.0.1:8000'


# -- gates -----------------------------------------------------------------

def fetch_page(path):
    """(lowercased headers dict, body str) for a prod page. Browser-ish UA —
    the edge 403s urllib's default."""
    req = urllib.request.Request(flows.BASE + '/' + path,
                                 headers={'User-Agent': 'curl/8.14.1'})
    with urllib.request.urlopen(req, timeout=30) as r:
        return ({k.lower(): v for k, v in r.headers.items()},
                r.read().decode('utf-8', 'replace'))


def client_version(body):
    m = re.search(r'comments\.js\?v=(\d+)', body)
    return int(m.group(1)) if m else 0


def click_by_text(f, scope_sel, text):
    """Click the first button under scope_sel whose text contains `text`."""
    return f.js("""var s=document.querySelector(%s); if(!s) return false;
      var bs=s.querySelectorAll('button');
      for (var i=0;i<bs.length;i++) if (bs[i].textContent.indexOf(%s)!==-1) { bs[i].click(); return true; }
      return false;""" % (json.dumps(scope_sel), json.dumps(text)))


# -- (a) the denied path on prod --------------------------------------------

def test_denied_path(checks, fails):
    hdrs, body = fetch_page('feed.html')
    v = client_version(body)
    if v < 205:
        print('SKIP  test_denied_path — new client not deployed yet '
              '(prod serves comments.js?v=%d, needs v=205)' % v)
        return
    # NOTE: today the edge also sends Permissions-Policy: microphone=(), which
    # rejects getUserMedia with the very NotAllowedError this test drives — so
    # the denied path holds with or without that header once v=205 is live.
    with Flow(port=9601, mic='deny') as f:
        f.login()
        f.goto('feed.html')
        got_btn = f.wait("!!document.querySelector('.wall-composer .mc-voice-btn')", timeout=25)
        checks.append(('denied: wall composer offers the 🎙 button', got_btn))
        f.click('.wall-composer .mc-voice-btn')
        msg = f.wait("((document.querySelector('.wall-composer .form-status')||{}).textContent||'')"
                     ".indexOf('Microphone access is blocked')!==-1", timeout=15)
        checks.append(('denied: honest "Microphone access is blocked" status', msg))
        row = f.wait("""[].some.call(document.querySelectorAll('.wall-composer .mc-voice-fallback button'),
          function(b){return b.textContent.indexOf('Record with your device instead')!==-1;})""", timeout=10)
        checks.append(('denied: fallback row with "Record with your device instead"', row))
        click_by_text(f, '.wall-composer .mc-voice-fallback', 'Record with your device instead')
        inp = f.wait("""(function(){var i=document.querySelector('.wall-composer input.mc-voice-input');
          return !!(i && i.type==='file' && i.accept==='audio/*' && i.hasAttribute('capture')
                    && i.style.display==='none');})()""", timeout=10)
        checks.append(('denied: hidden capture file input (accept=audio/*, capture)', inp))
        checks.append(('denied: console clean', f.assert_console_clean('voice-denied')))
        fails += f.failures


# -- (b) the recorder primitives on a locally served bundle ------------------

def ensure_local_serve():
    """Reuse a running `make serve`, else start one. Returns the Popen to
    terminate (None when reused)."""
    try:
        urllib.request.urlopen(LOCAL_BASE + '/index.html', timeout=2)
        return None
    except Exception:
        pass
    proc = subprocess.Popen(['make', 'serve'], cwd=flows.REPO,
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(30):
        time.sleep(0.5)
        try:
            urllib.request.urlopen(LOCAL_BASE + '/index.html', timeout=2)
            return proc
        except Exception:
            continue
    proc.terminate()
    raise RuntimeError('make serve did not come up on ' + LOCAL_BASE)


PIPELINE_JS = """
window.__vp = {stage:'start'};
(function(){
  var mimes=['audio/mp4;codecs=mp4a.40.2','audio/mp4','audio/webm;codecs=opus','audio/ogg;codecs=opus'];
  var mt='';
  for (var i=0;i<mimes.length;i++){
    if (window.MediaRecorder && MediaRecorder.isTypeSupported(mimes[i])) { mt=mimes[i]; break; }
  }
  window.__vp.mime = mt;
  function fail(e){ window.__vp.err = String((e && (e.name+': '+e.message)) || e); }
  navigator.mediaDevices.getUserMedia({audio:true}).then(function(stream){
    window.__vp.stage='recording';
    var rec; try { rec = new MediaRecorder(stream, mt?{mimeType:mt}:{}); } catch(e){ fail(e); return; }
    var chunks=[];
    rec.ondataavailable=function(ev){ if(ev.data && ev.data.size) chunks.push(ev.data); };
    rec.onstop=function(){
      stream.getTracks().forEach(function(t){t.stop();});
      var blob=new Blob(chunks,{type:rec.mimeType||mt||'audio/webm'});
      window.__vp.blobSize=blob.size;
      window.__vp.stage='decoding';
      blob.arrayBuffer().then(function(buf){
        var AC=window.AudioContext||window.webkitAudioContext;
        var ctx=new AC();
        return new Promise(function(res,rej){ ctx.decodeAudioData(buf,res,rej); }).then(function(audio){
          try{ctx.close();}catch(e){}
          window.__vp.stage='encoding';
          window.__vp.sampleRate=audio.sampleRate;
          window.__vp.samples=audio.length;
          var data=audio.getChannelData(0);
          var pcm=new Int16Array(audio.length);
          for(var k=0;k<audio.length;k++){ var v=Math.max(-1,Math.min(1,data[k])); pcm[k]=Math.round(v*32767); }
          var enc=new lamejs.Mp3Encoder(1, audio.sampleRate, 64);
          var parts=[], total=0;
          for(var pos=0;pos<pcm.length;pos+=1152){
            var out=enc.encodeBuffer(pcm.subarray(pos, Math.min(pos+1152, pcm.length)));
            if(out && out.length){ parts.push(out); total+=out.length; }
          }
          var tail=enc.flush();
          if(tail && tail.length){ parts.push(tail); total+=tail.length; }
          var head=[];
          if(parts.length){ for(var j=0;j<4 && j<parts[0].length;j++) head.push(parts[0][j] & 255); }
          window.__vp.mp3Bytes=total;
          window.__vp.head=head;
          window.__vp.stage='done';
        });
      }).catch(fail);
    };
    rec.start(500);
    setTimeout(function(){ try{rec.stop();}catch(e){} }, 1500);
  }).catch(fail);
})();
return 1;
"""


def test_recorder_primitives_local(checks, fails):
    try:
        proc = ensure_local_serve()
    except RuntimeError as e:
        print('SKIP  test_recorder_primitives_local — %s' % e)
        return
    old_base = flows.BASE
    flows.BASE = LOCAL_BASE
    try:
        with Flow(port=9602, mic='fake') as f:
            f.goto('index.html')
            # lamejs from the LOCAL docs/ tree, the same lazy-script road the
            # client's ensureLame takes
            f.js("""var s=document.createElement('script'); s.src='/lamejs.min.js?v=1';
                 document.head.appendChild(s); return 1;""")
            got_lame = f.wait("!!(window.lamejs && window.lamejs.Mp3Encoder)", timeout=15)
            checks.append(('local: lamejs.min.js loads (global lamejs.Mp3Encoder)', got_lame))
            f.js(PIPELINE_JS)
            f.wait("window.__vp && (window.__vp.stage==='done' || window.__vp.err)", timeout=40)
            r = json.loads(f.js1("return JSON.stringify(window.__vp||{});"))
            if r.get('err'):
                fails.append('local pipeline: %s (stage %s)' % (r['err'], r.get('stage')))
            checks.append(('local: fake-device MediaRecorder produced bytes (mime %r, %s B)'
                           % (r.get('mime'), r.get('blobSize')), (r.get('blobSize') or 0) > 0))
            checks.append(('local: decodeAudioData decoded the take (%s samples @ %s Hz)'
                           % (r.get('samples'), r.get('sampleRate')), (r.get('samples') or 0) > 0))
            head = r.get('head') or []
            framed = ((len(head) >= 2 and head[0] == 0xFF and (head[1] & 0xE0) == 0xE0)
                      or head[:3] == [0x49, 0x44, 0x33])   # 'ID3'
            checks.append(('local: lamejs output is a real MP3 (first bytes %s, %s B total)'
                           % ([hex(b) for b in head], r.get('mp3Bytes')),
                           framed and (r.get('mp3Bytes') or 0) > 500))
            # NOTE: no console-clean assertion here — a locally served page has
            # no worker behind /api/*, so its background fetches 404 by design.
            fails += f.failures
    finally:
        flows.BASE = old_base
        if proc:
            proc.terminate()


# -- (c) the whole composer flow on prod --------------------------------------

def test_full_composer_flow(checks, fails):
    hdrs, body = fetch_page('feed.html')
    pp = hdrs.get('permissions-policy', '')
    if 'microphone=()' in pp:
        print('SKIP  test_full_composer_flow — edge Permissions-Policy still denies '
              'the mic (owner dashboard fix pending): %r' % pp)
        return
    v = client_version(body)
    if v < 205:
        print('SKIP  test_full_composer_flow — new client not deployed yet '
              '(prod serves comments.js?v=%d, needs v=205)' % v)
        return
    with Flow(port=9603, mic='fake') as f:
        f.login()
        f.goto('feed.html')
        got_btn = f.wait("!!document.querySelector('.wall-composer .mc-voice-btn')", timeout=25)
        checks.append(('full: wall composer offers the 🎙 button', got_btn))
        f.click('.wall-composer .mc-voice-btn')
        rec = f.wait("!!document.querySelector('.wall-composer .mc-rec-row .mc-rec-dot')", timeout=15)
        checks.append(('full: recording row (pulsing dot + clock)', rec))
        time.sleep(2)   # let the fake tone put real bytes in the take
        click_by_text(f, '.wall-composer .mc-rec-row', 'Stop')
        prev = f.wait("!!document.querySelector('.wall-composer .mc-rec-preview audio')", timeout=15)
        checks.append(('full: preview row with a listenable <audio>', prev))
        click_by_text(f, '.wall-composer .mc-rec-preview', 'Use this')
        chip = f.wait("""(function(){var c=document.querySelector('.wall-composer .dm-attach-chip');
          return !!(c && c.style.display!=='none' && (c.textContent||'').indexOf('voice-note')!==-1);})()""",
                      timeout=30)
        checks.append(('full: attach chip holds voice-note (client-side only, never sent)', chip))
        checks.append(('full: console clean', f.assert_console_clean('voice-full')))
        fails += f.failures
        # deliberately NO click on Post/Send: the file lives client-side until
        # Send, so this whole flow writes nothing.


# ---------------------------------------------------------------------------

def main():
    which = sys.argv[1] if len(sys.argv) > 1 else 'all'
    checks, fails = [], []
    if which in ('all', 'denied'):
        test_denied_path(checks, fails)
    if which in ('all', 'local'):
        test_recorder_primitives_local(checks, fails)
    if which in ('all', 'full'):
        test_full_composer_flow(checks, fails)
    for x in fails:
        print('FAIL', x)
    for n, p in checks:
        print(('PASS ' if p else 'FAIL '), n)
    sys.exit(2 if (fails or any(not p for _, p in checks)) else 0)


if __name__ == '__main__':
    main()
