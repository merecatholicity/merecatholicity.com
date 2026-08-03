#!/usr/bin/env python3
"""test_call.py — 1v1 WebRTC audio calls (2026-08-03), against LIVE prod.

Scenarios (each runnable alone: python3 webtest/test_call.py [p2p|stun|block|tabs]):

  p2p    The crown jewel: two fake-mic browsers, alice calls from the DM
         thread, bob answers from community.html (proving the GLOBAL banner),
         both reach Active, pc.getStats() shows inbound-rtp audio packets on
         BOTH sides. On THIS sandboxed host the selected pair is relay↔relay
         (no direct path between headless browsers here — measured), which
         makes this a full proof of the minted-TURN leg too; ordinary member
         networks direct-connect most calls. Mid-call, a second API-crafted
         offer from alice draws bob's automatic 'busy' reply (the in-call
         auto-decline). Hang up: both end with reason 'hangup'. Consoles
         clean. Relay spend: a few seconds of Opus, ~50 KB of the 1,000 GB
         pool.
  stun   The degraded path: /call/turn monkeypatched to the STUN-only
         fallback shape in both pages. ENVIRONMENT FACT (measured 2026-08-03):
         this sandboxed host has NO direct path between two headless browsers
         (mDNS host candidates unresolvable, srflx blocked) — the successful
         p2p call above rides relay↔relay — so a STUN-only call cannot
         connect HERE (ordinary member networks direct-connect most calls).
         What this scenario therefore proves: the client CONSUMES the
         degraded shape (pc built from it, SDP negotiated to stable both
         sides) and then fails HONESTLY — the 20 s setup watchdog ends both
         sides with reason 'failed', no hang, no zombie UI. Also asserts the
         real /call/turn endpoint answers {ok, iceServers[...]}.
  block  Indistinguishability: bob blocks alice; alice's raw /call/offer gets
         the same {ok:true} an ordinary offer gets, and bob's armed collector
         sees NO call-offer frame; unblock, offer again, the frame arrives.
  tabs   Multi-tab hush: bob open twice; both tabs ring; one answers; the
         other's banner resolves 'taken' (answered on another device).

Needs webtest/.testkeys (alice/bob) and the mic-capable Flow kit. Calls are
deliberately NOT Turnstile-gated, so no MC_TEST_TOKEN is required. Residue per
ring: one coalesced 'call' notification row for the callee (read-marked by the
answer handler in p2p/tabs; the block scenario's control ring leaves one for
bob — acceptable, it is a true record).
"""
import hashlib
import json
import sys
import time

from flows import api
from live_kit import LiveUser, Party, keys

K = keys()
ALICE, BOB = K['alice'], K['bob']
H = lambda k: hashlib.sha256(k.encode()).hexdigest()
A_HASH, B_HASH = H(ALICE), H(BOB)

STUN_PATCH = (
    "if(!window.__turnPatched){window.__turnPatched=1;var of=window.fetch;"
    "window.fetch=function(u,o){if(String(u).indexOf('/call/turn')!==-1){"
    "return Promise.resolve(new Response(JSON.stringify({ok:true,iceServers:[{urls:['stun:stun.cloudflare.com:3478']}],relay:false}),"
    "{status:200,headers:{'Content-Type':'application/json'}}));}"
    "return of.apply(this,arguments);};} return 1;"
)


def click_call_button(f, checks, label):
    ok = f.wait("!!document.querySelector('.mc-call-btn')", timeout=20)
    checks.append((label + ': 📞 button renders in the DM header', ok))
    f.click('.mc-call-btn')


def click_panel_btn(f, text):
    return f.js(
        "var p=document.getElementById('mc-call-ui'); if(!p) return false;"
        "var bs=p.querySelectorAll('button');"
        "for(var i=0;i<bs.length;i++) if(bs[i].textContent===%s){bs[i].click();return true;}"
        "return false;" % json.dumps(text))


def call_state(f):
    return f.js("return (window.__mcCall||{}).state||'';")


def wait_state(f, st, timeout=25):
    return f.wait("window.__mcCall && window.__mcCall.state===%s" % json.dumps(st), timeout=timeout)


def rtp_packets(f, tries=20):
    """Poll pc.getStats() until inbound-rtp audio shows packets (or give up)."""
    for _ in range(tries):
        f.js("var pc=(window.__mcCall||{}).pc; window.__rtp=-1; if(pc){pc.getStats().then(function(s){"
             "var n=0;s.forEach(function(r){if(r.type==='inbound-rtp'&&(r.kind==='audio'||r.mediaType==='audio'))n=Math.max(n,r.packetsReceived||0);});"
             "window.__rtp=n;});} return 1;")
        time.sleep(0.6)
        n = f.js("return window.__rtp;")
        if isinstance(n, (int, float)) and n > 0:
            return int(n)
    return 0


def run_call(A, B, checks, tag, patch_turn=False):
    """alice (A, on her DM thread with bob) calls; bob (B) answers wherever he
    is; both reach Active with real audio flowing. Returns True on Active."""
    if patch_turn:
        A.js(STUN_PATCH)
        B.js(STUN_PATCH)
    click_call_button(A, checks, tag)
    checks.append((tag + ': caller reaches Outgoing', wait_state(A, 'Outgoing', 15)))
    rang = B.wait("!!document.querySelector('#mc-call-ui .mc-call-who')", timeout=20)
    checks.append((tag + ': callee banner rings (global, off the DM page)', rang))
    checks.append((tag + ': callee state Incoming', wait_state(B, 'Incoming', 10)))
    click_panel_btn(B, 'Answer')
    checks.append((tag + ': callee reaches Active', wait_state(B, 'Active', 30)))
    checks.append((tag + ': caller reaches Active', wait_state(A, 'Active', 15)))
    if call_state(A) != 'Active' or call_state(B) != 'Active':
        return False
    pa, pb = rtp_packets(A), rtp_packets(B)
    checks.append((tag + ': caller receives audio (inbound-rtp %d pkts)' % pa, pa > 0))
    checks.append((tag + ': callee receives audio (inbound-rtp %d pkts)' % pb, pb > 0))
    return True


def scenario_p2p(checks, fails):
    with Party(LiveUser('A', ALICE, 9610, mic='fake'), LiveUser('B', BOB, 9611, mic='fake')) as (A, B):
        B.nav('community.html')
        A.nav('community.html?dm=' + B_HASH)
        # Drain the log buffers so the console/network gate judges only the
        # call itself — login + nav span three documents, and the duplicate-
        # asset detector is written for one.
        for u in (A, B):
            u._logs('performance')
            u._logs('browser')
        if run_call(A, B, checks, 'p2p'):
            # in-call auto-busy: a second offer (another alice device, say)
            A.clear_live()
            d = api('/api/comments/call/offer', {'key': ALICE, 'to': B_HASH,
                                                 'call': 'f' * 32, 'sdp': 'v=0\r\ns=-\r\n'})
            checks.append(('p2p: second offer accepted at the wire', bool(d.get('ok'))))
            busy = A.wait_live(lambda e: e.get('t') == 'call-sig' and e.get('kind') == 'busy')
            checks.append(('p2p: busy auto-reply while on a call', bool(busy)))
            checks.append(('p2p: the live call was undisturbed', call_state(B) == 'Active'))
            # hang up from the caller; both end honestly
            click_panel_btn(A, 'Hang up')
            checks.append(('p2p: caller ends (hangup)',
                           A.wait("window.__mcCall.state==='Ended'&&window.__mcCall.reason==='hangup'||window.__mcCall.state==='Idle'", timeout=10)))
            checks.append(('p2p: callee ends (hangup relayed)',
                           B.wait("window.__mcCall.state==='Ended'&&window.__mcCall.reason==='hangup'||window.__mcCall.state==='Idle'", timeout=15)))
        for u, label in ((A, 'p2p A'), (B, 'p2p B')):
            for f in u.devtools_findings(label):
                fails.append(f)
        for u in (A, B):
            fails.extend(['%s: %s' % (u.name, x) for x in u.failures])


def scenario_stun(checks, fails):
    d = api('/api/comments/call/turn', {'key': ALICE})
    checks.append(('stun: real /call/turn answers ok with servers (relay=%s)' % d.get('relay'),
                   bool(d.get('ok')) and bool(d.get('iceServers'))))
    with Party(LiveUser('A', ALICE, 9612, mic='fake'), LiveUser('B', BOB, 9613, mic='fake')) as (A, B):
        B.nav('community.html')
        A.nav('community.html?dm=' + B_HASH)
        A.js(STUN_PATCH)
        B.js(STUN_PATCH)
        click_call_button(A, checks, 'stun')
        checks.append(('stun: caller reaches Outgoing on the degraded shape', wait_state(A, 'Outgoing', 15)))
        checks.append(('stun: callee rings', wait_state(B, 'Incoming', 20)))
        click_panel_btn(B, 'Answer')
        # The degraded shape is consumed end-to-end: SDP negotiates to stable.
        neg = B.wait("window.__mcCall.pc && window.__mcCall.pc.signalingState==='stable'", timeout=15)
        checks.append(('stun: callee negotiated to stable on STUN-only config', neg))
        # No direct path exists on this host, so the honest end is the watchdog.
        checks.append(('stun: caller ends honestly (setup watchdog, no zombie UI)',
                       A.wait("window.__mcCall.state==='Idle'||window.__mcCall.state==='Ended'&&window.__mcCall.reason==='failed'", timeout=40)))
        checks.append(('stun: callee ends honestly too',
                       B.wait("window.__mcCall.state==='Idle'||window.__mcCall.state==='Ended'&&window.__mcCall.reason==='failed'", timeout=40)))
        for u in (A, B):
            fails.extend(['%s: %s' % (u.name, x) for x in u.failures])


def scenario_block(checks, fails):
    try:
        with Party(LiveUser('B', BOB, 9614)) as B:
            B.nav('community.html')
            d = api('/api/comments/dm/block', {'key': BOB, 'hash': A_HASH, 'blocked': True})
            checks.append(('block: bob blocks alice', bool(d.get('ok'))))
            B.clear_live()
            blocked = api('/api/comments/call/offer', {'key': ALICE, 'to': B_HASH,
                                                       'call': 'a' * 32, 'sdp': 'v=0\r\ns=-\r\n'})
            time.sleep(5)
            seen = B.saw_live(lambda e: e.get('t') == 'call-offer')
            checks.append(('block: blocked offer answers plain {ok:true}',
                           blocked == {'ok': True}))
            checks.append(('block: no frame, no banner at the callee', not seen
                           and not B.js("return !!document.querySelector('#mc-call-ui .mc-call-who');")))
            api('/api/comments/dm/block', {'key': BOB, 'hash': A_HASH, 'blocked': False})
            B.clear_live()
            control = api('/api/comments/call/offer', {'key': ALICE, 'to': B_HASH,
                                                       'call': 'b' * 32, 'sdp': 'v=0\r\ns=-\r\n'})
            checks.append(('block: control offer answers the SAME shape',
                           control == {'ok': True}))
            frame = B.wait_live(lambda e: e.get('t') == 'call-offer', timeout=10)
            checks.append(('block: unblocked offer frame arrives', bool(frame)))
            click_panel_btn(B, 'Decline')   # tidy the control ring away
            fails.extend(['B: %s' % x for x in B.failures])
    finally:
        api('/api/comments/dm/block', {'key': BOB, 'hash': A_HASH, 'blocked': False})


def scenario_tabs(checks, fails):
    with Party(LiveUser('A', ALICE, 9615, mic='fake'),
               LiveUser('B1', BOB, 9616, mic='fake'),
               LiveUser('B2', BOB, 9617)) as (A, B1, B2):
        B1.nav('community.html')
        B2.nav('feed.html')
        A.nav('community.html?dm=' + B_HASH)
        click_call_button(A, checks, 'tabs')
        checks.append(('tabs: tab 1 rings', wait_state(B1, 'Incoming', 20)))
        checks.append(('tabs: tab 2 rings too', wait_state(B2, 'Incoming', 10)))
        click_panel_btn(B1, 'Answer')
        checks.append(('tabs: answering tab reaches Active', wait_state(B1, 'Active', 30)))
        hushed = B2.wait("window.__mcCall.state==='Ended'&&window.__mcCall.reason==='taken'||window.__mcCall.state==='Idle'", timeout=12)
        checks.append(('tabs: the other tab is hushed (taken)', hushed))
        click_panel_btn(A, 'Hang up')
        for u in (A, B1, B2):
            fails.extend(['%s: %s' % (u.name, x) for x in u.failures])


def main():
    which = sys.argv[1] if len(sys.argv) > 1 else 'all'
    checks, fails = [], []
    if which in ('all', 'p2p'):
        scenario_p2p(checks, fails)
    if which in ('all', 'stun'):
        scenario_stun(checks, fails)
    if which in ('all', 'block'):
        scenario_block(checks, fails)
    if which in ('all', 'tabs'):
        scenario_tabs(checks, fails)
    for x in fails:
        print('FAIL', x)
    for n, p in checks:
        print(('PASS ' if p else 'FAIL '), n)
    sys.exit(2 if (fails or any(not p for _, p in checks)) else 0)


if __name__ == '__main__':
    main()
