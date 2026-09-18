#!/usr/bin/env python3
"""scripts/key_audit.py — run a wordlist against the live member hashes, the way
an attacker would, so the owner knows whether layer three of the P0 fix is
urgent or merely correct (the 2026-09-17 review's P0, this its diagnostic step).

The chain the review found: a member's public id is `SHA-256(key)`, unsalted,
one round — the same digest the server stores to verify the key. So the roster
of hashes (now keyed: `POST /api/comments/dm/directory`) plus a wordlist is an
offline impersonation attack at GPU speed, and the only defence a member has is
having kept the generated key instead of typing a memorable one. This script IS
that attack, run by the defender against their own members:

  1. take the live hashes (a keyed directory read, or a file of hashes), and
  2. hash every candidate the same way the server does, reporting any match.

A match is a member whose key a stranger could guess: contact them, and it is
the case that moves layer three from "correct" to "ship it now". No match over a
large list is the evidence that the generated-key default is holding, and that
layer three can be SCHEDULED rather than rushed.

Stdlib only (hashlib) — fifteen members against a few million words is seconds
to minutes here; `--hashcat FILE` writes the `-m 1400` input if a GPU pass is
wanted for a much larger list. Reads the roster with a key from
webtest/.testkeys (the same git-ignored file the webtests read) or a hash file;
never writes a key or a hash into the repo.

  python3 scripts/key_audit.py --wordlist rockyou.txt
  python3 scripts/key_audit.py --hashes hashes.txt --wordlist words.txt
  python3 scripts/key_audit.py --wordlist words.txt --hashcat live.hash
"""
import argparse
import hashlib
import json
import os
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
API = 'https://merecatholicity.com/api/comments/dm/directory'


def sha256hex(s):
    return hashlib.sha256(s.encode('utf-8')).hexdigest()


def testkey(name='alice'):
    """A key from the git-ignored webtest/.testkeys, to read the keyed roster."""
    path = os.path.join(ROOT, 'webtest', '.testkeys')
    if not os.path.exists(path):
        return ''
    for line in open(path, encoding='utf-8'):
        line = line.strip()
        if line and not line.startswith('#') and '=' in line:
            k, v = line.split('=', 1)
            if k.strip() == name:
                return v.strip()
    return ''


def roster_from_api(key):
    """The live roster's hashes and nicks, via the keyed directory (2026-09-18).
    A browser UA because the edge 403s Python-urllib (Bot Fight Mode)."""
    body = json.dumps({'key': key}).encode('utf-8')
    req = urllib.request.Request(API, data=body, method='POST', headers={
        'Content-Type': 'application/json',
        'Origin': 'https://merecatholicity.com',
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36',
    })
    with urllib.request.urlopen(req, timeout=45) as r:
        d = json.loads(r.read())
    if not d.get('ok'):
        raise SystemExit('the roster read was refused: %s' % d.get('error', d))
    return [(u['hash'], u.get('nick') or u.get('assigned') or '') for u in d.get('users', [])]


def roster_from_file(path):
    """One 64-hex hash per line (an optional `,nick` after it)."""
    out = []
    for line in open(path, encoding='utf-8'):
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        h, _, nick = line.partition(',')
        out.append((h.strip().lower(), nick.strip()))
    return out


def candidates(path):
    """Each wordlist line, plus a couple of trivial mangles a real cracker tries
    for free — the point is to be at least as thorough as the threat, not less.
    latin-1 so a byte-salad wordlist (rockyou) never dies on decode."""
    seen = set()
    for line in open(path, encoding='latin-1'):
        w = line.rstrip('\n')
        if not w:
            continue
        for c in (w, w.strip(), w.capitalize(), w + '1', w + '!'):
            if c and c not in seen:
                seen.add(c)
                yield c


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    src = ap.add_mutually_exclusive_group()
    src.add_argument('--hashes', help='a file of member hashes (64-hex per line); default is the live keyed roster')
    src.add_argument('--key', help='the identity key that reads the roster; default reads webtest/.testkeys')
    ap.add_argument('--wordlist', required=True, help='the candidate keys to try (one per line)')
    ap.add_argument('--hashcat', metavar='FILE', help='also write the hashes here as a hashcat -m 1400 input for a GPU pass')
    args = ap.parse_args()

    if args.hashes:
        roster = roster_from_file(args.hashes)
    else:
        key = args.key or testkey('alice')
        if not key:
            raise SystemExit('no key: pass --key, put one in webtest/.testkeys, or read hashes with --hashes')
        roster = roster_from_api(key)
    if not roster:
        raise SystemExit('the roster is empty')
    targets = {h: nick for h, nick in roster}
    print('%d member hashes to test' % len(targets), file=sys.stderr)

    if args.hashcat:
        with open(args.hashcat, 'w', encoding='utf-8') as f:
            f.write('\n'.join(targets) + '\n')
        print('wrote %d hashes to %s (run: hashcat -m 1400 %s <wordlist>)' % (len(targets), args.hashcat, args.hashcat), file=sys.stderr)

    cracked = {}
    tried = 0
    for cand in candidates(args.wordlist):
        tried += 1
        h = sha256hex(cand)
        if h in targets and h not in cracked:
            cracked[h] = cand
            print('CRACKED  %s  (%s)  key=%r' % (h[:12], targets[h] or '—', cand))
            if len(cracked) == len(targets):
                break

    print('\n--- %d candidates tried, %d of %d members cracked ---' % (tried, len(cracked), len(targets)), file=sys.stderr)
    if cracked:
        print('These members typed a guessable key. Contact each and have them create a NEW identity'
              ' (the generated key is the safe shape), and treat layer three of the P0 fix as urgent:'
              ' until the public id stops being the secret\'s digest, a leaked hash is a leaked account.',
              file=sys.stderr)
        return 1
    print('No member key fell to this wordlist: the generated-key default is holding, and layer three'
          ' can be scheduled as its own change rather than rushed.', file=sys.stderr)
    return 0


if __name__ == '__main__':
    sys.exit(main())
