#!/usr/bin/env python3
"""Compare two capture JSONs; print property-level diffs. Exit 0 if identical."""
import json, sys
a = json.load(open(sys.argv[1])); b = json.load(open(sys.argv[2]))
label = sys.argv[3] if len(sys.argv) > 3 else ''
diffs = 0
keys = sorted(set(a) | set(b))
for sel in keys:
    va, vb = a.get(sel), b.get(sel)
    if va is None and vb is None:
        continue
    if (va is None) != (vb is None):
        print('  [%s] %s: presence %r -> %r' % (label, sel, va is not None, vb is not None)); diffs += 1; continue
    for p in sorted(set(va) | set(vb)):
        if va.get(p) != vb.get(p):
            print('  [%s] %s . %s : %r -> %r' % (label, sel, p, va.get(p), vb.get(p))); diffs += 1
if diffs == 0:
    print('  [%s] IDENTICAL' % label)
sys.exit(1 if diffs else 0)
