"""API.md names every route the worker mounts, and mounts every route it names
(P3-2 of the 2026-09-16 review: the gap was eleven undocumented routes until
that week, then fifteen more turned up when this test was written).

The table is tests/_support/routes.json (the committed snapshot of ROUTES,
held to the source by tests/worker/routes.test.mjs). API.md abbreviates: a
row may say `POST /api/comments/lock` · `/deleteuser`, so a route counts as
named when its full path, or its path with the `/api/comments` (or
`/api/merecat`) prefix stripped, stands in a backtick span — alone, in a
` · `-joined list, or behind a method word. The reverse check reads every
full `/api/…` path API.md mentions; the ones it documents as deleted or
retired are listed here with their reason and must stay documented that way.
What would break silently: a door added and never written down (a native
client cannot find it), or a door removed with its paragraph left standing."""
import json
import os
import re
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
API = os.path.join(ROOT, 'comments-worker', 'API.md')
ROUTES = os.path.join(ROOT, 'tests', '_support', 'routes.json')

# documented as gone, on purpose — API.md §0 and §10 say so; drop the line here
# when the paragraphs go
RETIRED = {
    '/api/merecat/ask': 'replaced by ask-init + the chat WebSocket (API.md §0, §10)',
    '/api/merecat/store': 'a retired no-op (API.md §10)',
}
# mounted outside the ROUTES table, by fetch() itself
OUTSIDE_THE_TABLE = {'/api/comments/live', '/api/merecat/live'}
SHAPES = os.path.join(ROOT, 'tests', '_support', 'response_shapes.json')


def top_keys(shape):
    """The top-level keys of a documented `{ok, items:[…], page}` shape."""
    inner = shape.strip()[1:-1]
    items, depth, cur = [], 0, ''
    for ch in inner:
        if ch in '{[(':
            depth += 1
        elif ch in '}])':
            depth -= 1
        if ch == ',' and depth == 0:
            items.append(cur)
            cur = ''
        else:
            cur += ch
    items.append(cur)
    return {m.group(1) for m in (re.match(r'\s*([A-Za-z_][A-Za-z0-9_]*)', i) for i in items) if m}


def documented_shapes(api, path):
    """Every `{ok…}` answer API.md gives a GET route: its own table row (a line
    whose first cell names `GET <path>`), else a paragraph that opens with it."""
    pat = re.compile(r'`GET ' + re.escape(path) + r'(?:\?[^`]*)?`')
    for line in api.split('\n'):
        if line.startswith('|') and line.count('|') > 2 and pat.search(line.split('|')[1]):
            return re.findall(r'`(\{ok[^`]*\})`', line)
    for para in api.split('\n\n'):
        head = para.lstrip()[:200]
        if pat.search(head) and head.lstrip('*').startswith('`GET'):
            spans = re.findall(r'`(\{ok[^`]*\})`', para)
            if spans:
                return spans
    return []


def named(path, api, ticks):
    if path in api:
        return True
    short = re.sub(r'^/api/(comments|merecat)', '', path)
    for t in ticks:
        for part in re.split(r'\s·\s|\s\|\s', t):
            part = re.sub(r'^(GET|POST)\s+', '', part.strip())
            if part in (path, short):
                return True
    return False


class ApiParity(unittest.TestCase):
    def setUp(self):
        with open(API, encoding='utf-8') as f:
            self.api = f.read()
        with open(ROUTES, encoding='utf-8') as f:
            self.routes = json.load(f)
        self.ticks = set(re.findall(r'`([^`]+)`', self.api))

    def test_every_mounted_route_is_named_in_the_api_doc(self):
        missing = [r['m'] + ' ' + r['p'] for r in self.routes if not named(r['p'], self.api, self.ticks)]
        self.assertEqual(missing, [], 'routes the worker mounts that API.md never names')

    def test_every_full_path_the_doc_names_is_mounted_or_documented_as_gone(self):
        mounted = {r['p'] for r in self.routes} | OUTSIDE_THE_TABLE
        named_paths = set(re.findall(r'/api/(?:comments|merecat)(?:/[A-Za-z0-9_.@-]+)+', self.api))
        stale = sorted(p for p in named_paths if p not in mounted and p not in RETIRED)
        self.assertEqual(stale, [], 'paths API.md names that no route mounts (document them as retired in RETIRED, with the reason, or remove the paragraph)')
        for p, why in RETIRED.items():
            self.assertIn(p, named_paths, p + ' is in RETIRED but API.md no longer mentions it: drop it here (' + why + ')')


    def test_every_public_read_documents_exactly_the_keys_it_answers(self):
        """Documenting a route means calling it (2026-09-17): API.md called
        `/recent` "member-safe" the day before it was found serving the worker
        env. Each GET route that answers JSON documents a `{ok, …}` shape whose
        top-level keys are the ones the leak sweep saw it answer
        (tests/_support/response_shapes.json, `error` aside) — a key added to
        an answer is added here, and a key the doc names is really sent."""
        with open(SHAPES, encoding='utf-8') as f:
            shapes = json.load(f)
        drift = []
        for r in self.routes:
            if r['m'] != 'GET':
                continue
            snap = shapes['GET ' + r['p']]
            answered = {p.split(':')[0] for p in snap['json']}
            top = {p for p in answered if '.' not in p and '[]' not in p} - {'error'}
            if not top:
                continue   # a binary or RSS answer: no JSON to document
            spans = documented_shapes(self.api, r['p'])
            if not spans:
                drift.append('GET %s answers %s but API.md documents no {ok, …} shape' % (r['p'], sorted(top)))
                continue
            doc = set().union(*(top_keys(sp) for sp in spans))
            if doc != top:
                drift.append('GET %s: documented only %s, answered only %s' % (r['p'], sorted(doc - top), sorted(top - doc)))
        self.assertEqual(drift, [], 'API.md and the answers disagree (node scripts/response_shapes.mjs --write, then fix the doc)')


if __name__ == '__main__':
    unittest.main()
