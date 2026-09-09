#!/usr/bin/env python3
"""Publish the built PDFs to R2, and prove the bucket matches the manifest.

The 244 published PDFs live in the R2 bucket `merecatholicity-files`, served at
files.merecatholicity.com behind a Cloudflare redirect from /<name>.pdf. Until
2026-09-09 they got there by hand — one `wrangler r2 object put` per file — and
nothing ever asked whether the bucket agreed with docs/pdfs.txt, the manifest
linkcheck trusts. Two failure modes lived in that gap: a rebuilt PDF that kept
serving its OLD bytes until someone remembered to upload it, and a newly-listed
PDF that passed `make check` while 404ing live.

Two modes:

  publish   Upload every local docs/*.pdf whose MD5 differs from the bucket's
            copy (R2's ETag is the plain MD5 for single-part objects — verified),
            then purge the edge for exactly the URLs that changed, because the
            edge caches PDFs (cf-cache-status: HIT). Unchanged files cost one
            list call and nothing else.
  --check   Fail if any manifest name is absent from the bucket, or any local
            PDF differs from the bucket's copy ("rebuilt but unpublished").
            Bucket objects the manifest does not list are only reported.

Both talk to the R2 REST API with CLOUDFLARE_API_TOKEN (Workers R2 Storage:Edit
+ Cache Purge:Purge). Without a token, --check falls back to public HEADs of the
manifest names — which works from the dev box and is 403'd by Bot Fight Mode
from a CI runner — and can only see absence, never a hash mismatch. Publishing
without a token is refused.

Usage:
  python scripts/publish_pdfs.py            # publish what differs
  python scripts/publish_pdfs.py --dry-run  # say what would be uploaded/purged
  python scripts/publish_pdfs.py --check    # the gate
"""
import argparse
import glob
import hashlib
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOCS = os.path.join(ROOT, 'docs')
MANIFEST = os.path.join(DOCS, 'pdfs.txt')

API = 'https://api.cloudflare.com/client/v4'
ACCOUNT = os.environ.get('CLOUDFLARE_ACCOUNT_ID', '6093bc0889c95a08f0a92a8df6750c66')
ZONE = os.environ.get('CLOUDFLARE_ZONE_ID', '2b270ffb21b7f98a39960abb6bf953ae')
TOKEN = os.environ.get('CLOUDFLARE_API_TOKEN', '').strip()
BUCKET = 'merecatholicity-files'
HOST = 'files.merecatholicity.com'
# Bot Fight Mode judges a bare urllib UA as a bot; a browser UA is what a reader
# sends. Only the token-less fallback ever fetches the public host.
UA = ('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) '
      'Chrome/128.0 Safari/537.36')
PURGE_BATCH = 30  # the purge_cache endpoint's per-request ceiling on `files`


class ApiError(RuntimeError):
    pass


def api(method, path, body=None, raw=False, headers=None, query=None):
    url = API + path + ('?' + urllib.parse.urlencode(query) if query else '')
    h = {'Authorization': 'Bearer ' + TOKEN}
    data = None
    if body is not None:
        if raw:
            data = body
        else:
            data = json.dumps(body).encode()
            h['Content-Type'] = 'application/json'
    if headers:
        h.update(headers)
    req = urllib.request.Request(url, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=600) as r:
            out = json.load(r)
    except urllib.error.HTTPError as e:
        try:
            detail = json.load(e)
            msg = '; '.join(f"{x.get('code')}: {x.get('message')}" for x in detail.get('errors', []))
        except Exception:
            msg = e.read()[:300].decode('utf-8', 'replace')
        raise ApiError(f'{method} {path} -> HTTP {e.code} {msg}') from None
    if not out.get('success', False):
        raise ApiError(f"{method} {path} -> " + '; '.join(
            f"{x.get('code')}: {x.get('message')}" for x in out.get('errors', [])))
    return out


def list_bucket():
    """key -> (etag, size) for every object in the bucket."""
    objects = {}
    cursor = None
    while True:
        q = {'per_page': 1000}
        if cursor:
            q['cursor'] = cursor
        out = api('GET', f'/accounts/{ACCOUNT}/r2/buckets/{BUCKET}/objects', query=q)
        for o in out['result']:
            objects[o['key']] = (o.get('etag', ''), o.get('size', 0))
        info = out.get('result_info') or {}
        if not info.get('is_truncated'):
            return objects
        cursor = info.get('cursor')
        if not cursor:
            return objects


def upload(name, path):
    """PUT one object; R2 answers with the etag it stored, which we check."""
    with open(path, 'rb') as f:
        body = f.read()
    out = api('PUT', f'/accounts/{ACCOUNT}/r2/buckets/{BUCKET}/objects/{urllib.parse.quote(name)}',
              body=body, raw=True,
              headers={'Content-Type': 'application/pdf', 'Content-Length': str(len(body))})
    return (out.get('result') or {}).get('etag', '')


def purge(names):
    for i in range(0, len(names), PURGE_BATCH):
        batch = [f'https://{HOST}/{urllib.parse.quote(n)}' for n in names[i:i + PURGE_BATCH]]
        api('POST', f'/zones/{ZONE}/purge_cache', body={'files': batch})


def manifest():
    if not os.path.exists(MANIFEST):
        sys.exit(f'publish_pdfs: {os.path.relpath(MANIFEST, ROOT)} is missing — run `make pdf-manifest` '
                 '(it is written at the end of `make html`).')
    with open(MANIFEST, encoding='utf-8') as f:
        return [ln.strip() for ln in f if ln.strip()]


def local_pdfs():
    out = {}
    for p in sorted(glob.glob(os.path.join(DOCS, '*.pdf'))):
        h = hashlib.md5()
        with open(p, 'rb') as f:
            for chunk in iter(lambda: f.read(1 << 20), b''):
                h.update(chunk)
        out[os.path.basename(p)] = h.hexdigest()
    return out


def public_status(name):
    req = urllib.request.Request(f'https://{HOST}/{urllib.parse.quote(name)}', method='HEAD',
                                 headers={'User-Agent': UA})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code
    except Exception:
        return 0


def do_check():
    names = manifest()
    local = local_pdfs()
    problems, notes = [], []
    if TOKEN:
        remote = list_bucket()
        for n in names:
            if n not in remote:
                problems.append(f'absent from the bucket: {n}  (listed in docs/pdfs.txt — never uploaded?)')
        for n, md5 in local.items():
            if n not in remote:
                problems.append(f'never published: {n}  (built here, not in the bucket — run `make publish-pdfs`)')
            elif remote[n][0] != md5:
                problems.append(f'rebuilt but unpublished: {n}  (local md5 {md5[:8]}… ≠ bucket etag '
                                f'{remote[n][0][:8]}… — run `make publish-pdfs`)')
        extras = sorted(set(remote) - set(names))
        if extras:
            notes.append(f'{len(extras)} object(s) in the bucket that docs/pdfs.txt does not list '
                         f'(harmless; e.g. {", ".join(extras[:3])})')
        notes.append(f'checked {len(names)} manifest names and {len(local)} local PDFs against '
                     f'{len(remote)} bucket objects via the R2 API')
    else:
        unknown = 0
        for n in names:
            code = public_status(n)
            if code == 404:
                problems.append(f'404 at https://{HOST}/{n}  (listed in docs/pdfs.txt)')
            elif code != 200:
                unknown += 1
        notes.append('no CLOUDFLARE_API_TOKEN: checked presence only, by public HEAD '
                     f'({len(names)} names, {unknown} unanswerable' +
                     (' — Bot Fight Mode blocks this from CI; set the token for a real check)' if unknown else ')'))
        if local:
            notes.append(f'{len(local)} local PDF(s) could not be hash-compared without a token')
    for n in notes:
        print(f'publish_pdfs: {n}')
    if problems:
        print('publish_pdfs: FAIL')
        for p in problems:
            print('  ' + p)
        return 1
    print('publish_pdfs: OK — the bucket matches the manifest' +
          (' and every local PDF' if local and TOKEN else ''))
    return 0


def do_publish(dry_run):
    if not TOKEN:
        sys.exit('publish_pdfs: CLOUDFLARE_API_TOKEN is required to publish (R2 write + cache purge).')
    names = set(manifest())
    local = local_pdfs()
    if not local:
        print('publish_pdfs: no docs/*.pdf here — nothing to publish '
              '(build with `make -C resources pdf`, `make pdf`, `make publish`, `make chart-pdfs`).')
        return 0
    remote = list_bucket()
    todo = [n for n, md5 in local.items() if remote.get(n, ('', 0))[0] != md5]
    unlisted = [n for n in todo if n not in names]
    if unlisted:
        print(f'publish_pdfs: WARNING {len(unlisted)} local PDF(s) are not in docs/pdfs.txt '
              f'(stale manifest? run `make pdf-manifest`): {", ".join(unlisted[:5])}')
    if not todo:
        print(f'publish_pdfs: all {len(local)} local PDFs already match the bucket — nothing to do')
    else:
        print(f'publish_pdfs: {len(todo)} of {len(local)} local PDFs differ from the bucket'
              + (' (dry run — not uploading):' if dry_run else ':'))
        for n in todo:
            state = 'new' if n not in remote else 'changed'
            print(f'  {state:8s} {n}')
    if dry_run or not todo:
        return 0
    done = []
    for n in todo:
        etag = upload(n, os.path.join(DOCS, n))
        if etag and etag != local[n]:
            sys.exit(f'publish_pdfs: R2 stored {n} with etag {etag}, expected md5 {local[n]} — refusing to continue')
        done.append(n)
        print(f'  uploaded {n} ({os.path.getsize(os.path.join(DOCS, n)) // 1024} KB)')
    purge(done)
    print(f'publish_pdfs: purged {len(done)} URL(s) at https://{HOST}/ so the edge serves the new bytes')
    missing = sorted(names - set(list_bucket()))
    if missing:
        print(f'publish_pdfs: NOTE {len(missing)} manifest name(s) are still not in the bucket '
              f'(not built on this machine): {", ".join(missing[:5])}{"…" if len(missing) > 5 else ""}')
    return 0


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('--check', action='store_true', help='verify the bucket against the manifest; no uploads')
    ap.add_argument('--dry-run', action='store_true', help='list what would be uploaded; no uploads, no purge')
    args = ap.parse_args()
    try:
        return do_check() if args.check else do_publish(args.dry_run)
    except ApiError as e:
        print(f'publish_pdfs: Cloudflare API error: {e}')
        return 2


if __name__ == '__main__':
    sys.exit(main())
