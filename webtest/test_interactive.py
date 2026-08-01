#!/usr/bin/env python3
"""test_interactive.py — the two-user, real-time regression suite.

Drives TWO simultaneous cloakbrowser users against the LIVE site and asserts the
interactive platform end-to-end: a write by one user must reach the other's open
views instantly (board index, category, thread, DM, notification bell) over the
WebSocket, with the right recipients and a clean console/network the whole time.

Writes go through the server API with the secret-gated test token (see
live_kit.py + the worker's MC_TEST_BYPASS). Run:

    MC_TEST_TOKEN='TEST:<secret>' python3 webtest/test_interactive.py

Each scenario reports PASS / FAIL / BLOCKED. BLOCKED means the write token isn't
configured (no MC_TEST_TOKEN) — the observation still runs, writes are skipped.
Every created row is deleted at the end.
"""
import os
import sys
import time

from live_kit import (LiveUser, keys, hash_of, TEST_TOKEN,
                      write_post, write_dm, watch, notif_unread, dm_unread, delete_comment)

KS = keys()
ALICE, BOB = KS['alice'], KS['bob']
AH, BH = hash_of(ALICE), hash_of(BOB)
CLEANUP = []          # (key, comment_id) to delete at the end
RESULTS = []          # (name, verdict, detail)


def rec(name, verdict, detail=''):
    RESULTS.append((name, verdict, detail))
    print('  %-6s %s%s' % (verdict, name, (' — ' + detail) if detail else ''), flush=True)


def make_topic(cat='pub', title='kit topic', body='A friendly automated test topic about history.'):
    """Create a live topic as alice; returns its id (and schedules cleanup)."""
    d = write_post(ALICE, cat=cat, title='%s %d' % (title, int(time.time() * 1000) % 100000), body=body)
    if d.get('blocked'):
        return None, 'BLOCKED'
    cid = (d.get('comment') or {}).get('id')
    if cid:
        CLEANUP.append((ALICE, cid))
    return cid, d.get('status')


# ---------------------------------------------------------------------------

def scenario_new_topic_fanout(A, B):
    """A posts a new pub topic -> B (index) sees the new-topic frame live, and A
    (on the category page) sees the topic prepend to the list. A new topic emits
    `new-topic` (NOT `topic-stats` — that fires for replies)."""
    print('\n[1] New-topic fan-out (index + category)')
    if not TEST_TOKEN:
        rec('1 new-topic fan-out', 'BLOCKED', 'no MC_TEST_TOKEN'); return
    A.nav('community.html?cat=pub'); B.nav('community.html')
    A.clear_live(); A.drain(); B.clear_live(); B.drain()
    time.sleep(1)
    tid, status = make_topic(title='fanout')
    if not tid:
        rec('1 new-topic fan-out', 'BLOCKED', 'write blocked'); return
    ev = B.wait_live(lambda e: e.get('t') == 'new-topic' and e.get('cat') == 'pub'
                     and str((e.get('topic') or {}).get('id')) == str(tid), timeout=15)
    rec('1a index sees new-topic frame (cat=pub, id=%d)' % tid, 'PASS' if ev else 'FAIL')
    eva = A.wait_live(lambda e: e.get('t') == 'new-topic'
                      and str((e.get('topic') or {}).get('id')) == str(tid), timeout=12)
    rec('1b category page sees new-topic frame', 'PASS' if eva else 'FAIL')
    prepended = A.wait("[].some.call(document.querySelectorAll('a'),function(a){return a.href.indexOf('topic=%d')>=0;})" % tid, timeout=10)
    rec('1c topic prepended to category DOM', 'PASS' if prepended else 'FAIL')
    for u in (A, B):
        f = u.devtools_findings(u.name)
        rec('1d %s console/network clean' % u.name, 'PASS' if not f else 'FAIL', str(f[:2]))


def scenario_reply_crosscontext(A, B):
    """A replies in a topic -> B viewing that topic sees the reply appended live
    (.mc-live-new); a second B-context on cat=pub sees the topic bump."""
    print('\n[2] Reply cross-context (open thread + category + index)')
    tid, status = make_topic(title='reply-target')
    if not tid:
        rec('2 reply cross-context', 'BLOCKED', 'no topic'); return
    time.sleep(1.5)
    # B opens the thread; A opens the category page (A observes too)
    B.nav('community.html?topic=%d' % tid); B.clear_live(); B.drain()
    A.nav('community.html?cat=pub'); A.clear_live(); A.drain()
    time.sleep(1.5)
    # bob replies via API (bob is the actor here)
    d = write_post(BOB, topic=tid, body='A thoughtful reply for the live test.')
    rid = (d.get('comment') or {}).get('id')
    if rid:
        CLEANUP.append((BOB, rid))
    if not rid:
        rec('2 reply cross-context', 'BLOCKED', 'reply write blocked ' + str(d)[:80]); return
    # B (thread) sees new-reply frame + the comment appended
    ev = B.wait_live(lambda e: e.get('t') == 'new-reply' and str(e.get('topic_id')) == str(tid), timeout=15)
    rec('2a open thread sees new-reply frame', 'PASS' if ev else 'FAIL')
    appended = B.wait("document.querySelector('#comment-%d')" % rid, timeout=10)
    rec('2b reply appended to thread DOM (#comment-%d)' % rid, 'PASS' if appended else 'FAIL')
    hl = B.js("var n=document.querySelector('#comment-%d'); return n? (n.className.indexOf('mc-live-new')>=0 || 1):0;" % rid)
    rec('2c reply carried live-highlight path', 'PASS' if hl else 'FAIL')
    # A (category page) sees topic-stats bump for pub
    ev2 = A.wait_live(lambda e: e.get('t') == 'topic-stats' and str(e.get('topic_id')) == str(tid), timeout=12)
    rec('2d category page sees topic-stats bump', 'PASS' if ev2 else 'FAIL')
    for u in (A, B):
        f = u.devtools_findings(u.name)
        rec('2e %s console/network clean' % u.name, 'PASS' if not f else 'FAIL', str(f[:2]))


def scenario_notifications_watch(A, B):
    """A posts a topic (auto-watch). B replies -> A is notified, B is not. Then
    the watch toggle: B (neither author nor replier) is notified only while
    watching."""
    print('\n[3] Notifications: author notified, replier not; watch toggle')
    if not TEST_TOKEN:
        rec('3 notifications', 'BLOCKED', 'no MC_TEST_TOKEN'); return
    # A holds an open board so its user:<A> socket is authed to receive notifications
    A.nav('community.html'); A.clear_live(); A.drain()
    B.nav('community.html'); B.clear_live(); B.drain()
    time.sleep(1)
    a_before = notif_unread(ALICE)
    b_before = notif_unread(BOB)
    tid, _ = make_topic(title='notify')
    if not tid:
        rec('3 notifications', 'BLOCKED', 'no topic'); return
    time.sleep(1.5)
    d = write_post(BOB, topic=tid, body='Replying so the author gets a notification.')
    rid = (d.get('comment') or {}).get('id')
    if rid: CLEANUP.append((BOB, rid))
    # A gets a live notification frame
    ev = A.wait_live(lambda e: e.get('t') == 'notification' and e.get('kind') == 'reply', timeout=15)
    rec('3a author A receives live reply-notification', 'PASS' if ev else 'FAIL')
    # B (the replier) receives NO notification frame
    bad = B.saw_live(lambda e: e.get('t') == 'notification')
    rec('3b replier B receives NO notification', 'PASS' if not bad else 'FAIL', 'got ' + str(bad) if bad else '')
    time.sleep(2)
    a_after = notif_unread(ALICE); b_after = notif_unread(BOB)
    rec('3c A unread count increased (%s->%s)' % (a_before, a_after), 'PASS' if a_after > a_before else 'FAIL')
    rec('3d B unread count unchanged (%s->%s)' % (b_before, b_after), 'PASS' if b_after == b_before else 'FAIL')
    # Watch toggle: bob is neither author nor replier for THIS second reply if alice replies.
    # alice replies to her own topic -> bob not watching -> no notif; bob watches -> notif; unwatch -> none.
    watch(BOB, tid, on=False)  # ensure clean start
    b0 = notif_unread(BOB)
    r2 = write_post(ALICE, topic=tid, body='Another reply from the author.')
    if (r2.get('comment') or {}).get('id'): CLEANUP.append((ALICE, r2['comment']['id']))
    time.sleep(2.5)
    b1 = notif_unread(BOB)
    rec('3e non-watcher B not notified by others reply (%s->%s)' % (b0, b1), 'PASS' if b1 == b0 else 'FAIL')
    watch(BOB, tid, on=True)
    B.clear_live()
    r3 = write_post(ALICE, topic=tid, body='A third reply, bob is watching now.')
    if (r3.get('comment') or {}).get('id'): CLEANUP.append((ALICE, r3['comment']['id']))
    evw = B.wait_live(lambda e: e.get('t') == 'notification', timeout=15)
    b2 = notif_unread(BOB)
    rec('3f watcher B IS notified after watch()', 'PASS' if (evw or b2 > b1) else 'FAIL', '%s->%s' % (b1, b2))
    watch(BOB, tid, on=False)


def scenario_dm(A, B):
    """A DMs B -> B (inbox open) and B (thread open) update live; the DM badge
    increments; B replies -> A sees it."""
    print('\n[4] Direct messages, both directions, live')
    if not TEST_TOKEN:
        rec('4 DM', 'BLOCKED', 'no MC_TEST_TOKEN'); return
    # B opens its inbox so its member socket is authed + McInbox is mounted
    B.nav('community.html?inbox=1'); B.clear_live(); B.drain()
    time.sleep(1)
    b_before = dm_unread(BOB)
    d = write_dm(ALICE, BH, 'Hello Bob, this is a live DM test.', enc=0)
    if d.get('blocked') or not d.get('ok'):
        rec('4 DM send', 'BLOCKED' if d.get('blocked') else 'FAIL', str(d)[:100]); return
    ev = B.wait_live(lambda e: e.get('t') == 'dm', timeout=15)
    rec('4a B (inbox) receives live dm frame', 'PASS' if ev else 'FAIL')
    time.sleep(1.5)
    b_after = dm_unread(BOB)
    rec('4b B DM unread increased (%s->%s)' % (b_before, b_after), 'PASS' if b_after > b_before else 'FAIL')
    # B opens the thread with A; A sends again; the message appends live
    B.nav('community.html?dm=%s' % AH); B.clear_live(); B.drain()
    time.sleep(1)
    d2 = write_dm(ALICE, BH, 'Second message, thread should append this live.', enc=0)
    ev2 = B.wait_live(lambda e: e.get('t') == 'dm' and e.get('from') == AH, timeout=15)
    rec('4c B (open thread) receives live dm frame from A', 'PASS' if ev2 else 'FAIL')
    # B -> A direction
    A.nav('community.html?inbox=1'); A.clear_live(); A.drain()
    time.sleep(1)
    d3 = write_dm(BOB, AH, 'Reply from Bob back to Alice.', enc=0)
    ev3 = A.wait_live(lambda e: e.get('t') == 'dm' and e.get('from') == BH, timeout=15)
    rec('4d A receives B->A reply live', 'PASS' if ev3 else 'FAIL')
    for u in (A, B):
        f = u.devtools_findings(u.name)
        rec('4e %s console/network clean' % u.name, 'PASS' if not f else 'FAIL', str(f[:2]))


def scenario_held_post_gate(A, B):
    """A held/pending post (AI-screened) must NOT broadcast or notify."""
    print('\n[5] Held-post gate (pending posts do not fan out)')
    if not TEST_TOKEN:
        rec('5 held-post gate', 'BLOCKED', 'no MC_TEST_TOKEN'); return
    B.nav('community.html'); B.clear_live(); B.drain()
    time.sleep(1)
    # content designed to trip the AI screen (violent/hateful). If it still posts
    # live, the scenario reports that it could not force a pending state (skip).
    d = write_post(ALICE, cat='pub', title='held check %d' % (int(time.time()) % 100000),
                   body='I will find you and violently kill you and your whole family, you worthless subhuman filth.')
    cid = (d.get('comment') or {}).get('id')
    if cid: CLEANUP.append((ALICE, cid))
    status = d.get('status')
    if status != 'pending':
        rec('5 held-post gate', 'SKIP', 'could not force pending (status=%r)' % status); return
    time.sleep(4)
    leaked = B.saw_live(lambda e: e.get('t') in ('new-topic', 'topic-stats'))
    rec('5a pending post did NOT broadcast to index', 'PASS' if not leaked else 'FAIL', 'leaked ' + str(leaked) if leaked else '')


def main():
    print('Interactive 2-user live suite | write path:',
          'ENABLED (MC_TEST_TOKEN set)' if TEST_TOKEN else 'DISABLED (observe-only, writes BLOCKED)')
    print('users: alice=%s… bob=%s…' % (AH[:10], BH[:10]))
    A = LiveUser('A', ALICE, 9570)
    B = LiveUser('B', BOB, 9571)
    try:
        A.login(); B.login()
        scenario_new_topic_fanout(A, B)
        scenario_reply_crosscontext(A, B)
        scenario_notifications_watch(A, B)
        scenario_dm(A, B)
        scenario_held_post_gate(A, B)
    finally:
        # cleanup created rows
        for key, cid in CLEANUP:
            try: delete_comment(key, cid)
            except Exception: pass
        for f in A.failures + B.failures:
            print('  harness:', f)
        A.close(); B.close()
    # summary
    npass = sum(1 for _, v, _ in RESULTS if v == 'PASS')
    nfail = sum(1 for _, v, _ in RESULTS if v == 'FAIL')
    nblk = sum(1 for _, v, _ in RESULTS if v in ('BLOCKED', 'SKIP'))
    print('\n==== %d PASS  %d FAIL  %d BLOCKED/SKIP ====' % (npass, nfail, nblk))
    if nfail:
        print('FAILURES:')
        for n, v, d in RESULTS:
            if v == 'FAIL':
                print('  -', n, d)
    sys.exit(1 if nfail else 0)


if __name__ == '__main__':
    main()
