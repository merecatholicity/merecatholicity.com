"""Deep-link slug parity: librarian/ingest.py  <->  docs/deeplink.js.

Every generated Fathers/Scripture page is addressable down to the heading
because two independent slugifiers agree on the id they stamp:

  * the READER's client, ``slugify`` in ``docs/deeplink.js`` (stamps ids into
    the live DOM so a ``#hash`` resolves), and
  * the RAG INGEST, ``PandocWalk.slugify`` in ``librarian/ingest.py`` (stamps
    the same ids onto the chunks it pushes to merecat so its citation anchors
    land on the reader's headings).

If these two ever drift, merecat's source links point at anchors that do not
exist on the page. This has bitten before, so it is the most valuable test in
this suite: for a battery of fixtures it runs the REAL JS function (extracted
from and evaluated straight out of ``docs/deeplink.js`` under node -- never a
re-implementation) and asserts it produces byte-identical output to the Python
function for the same input.

A handful of golden-value tests additionally lock the SHARED contract itself,
so that an identical change made to BOTH implementations at once (which pure
py==js parity would happily wave through) still fails loudly.
"""

import json
import pathlib
import subprocess
import sys
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "librarian"))

from ingest import PandocWalk  # noqa: E402  (path set above)

NODE = pathlib.Path("/usr/bin/node")
DEEPLINK_JS = ROOT / "docs" / "deeplink.js"

# A tiny node program that reads docs/deeplink.js as TEXT, regex-extracts the
# real `function slugify(...) { ... }` (slugify has no nested braces, so a
# non-greedy match up to the first `}` captures the whole body), evaluates it,
# runs it over the JSON array of fixtures piped in on stdin, and prints the
# JSON array of results. It exits 2 -- loudly -- if the function cannot be
# found, so a rename or refactor in deeplink.js can never make this test pass
# by silently comparing nothing.
JS_DRIVER = r"""
import fs from 'fs';
const src = fs.readFileSync(process.argv[2], 'utf8');
const m = src.match(/function\s+slugify\s*\([^)]*\)\s*\{[^}]*\}/);
if (!m) { console.error('SLUGIFY_NOT_FOUND'); process.exit(2); }
const slugify = new Function('return (' + m[0] + ')')();
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { input += d; });
process.stdin.on('end', () => {
  let arr;
  try { arr = JSON.parse(input); }
  catch (e) { console.error('BAD_INPUT'); process.exit(3); }
  process.stdout.write(JSON.stringify(arr.map(s => slugify(s))));
});
"""

# (label, input) -- every fixture names a real slugging case. The labels show
# up in subTest output so a failure points straight at the case that drifted.
FIXTURES = [
    ("plain word", "Genesis"),
    ("mixed case + space", "Hello World"),
    ("punctuation (colon)", "The Rule of Faith: An Introduction"),
    ("apostrophe splits the word", "Newman's Idea of a University"),
    ("runs of spaces and underscores collapse", "Multiple   spaces___and__underscores"),
    ("leading/trailing non-alnum is stripped", "  ...leading and trailing!!!  "),
    ("over 60 chars -> capped", "x" * 80),
    ("cap can leave a trailing dash", "a" * 59 + " bcd"),
    ("accented / non-ASCII letters", "Café Naïve Ölçü Résumé"),
    ("all punctuation -> empty", "!!!???...---"),
    ("empty string", ""),
    ("roman numeral heading", "Chapter IV. Of the Church"),
]


def _run_js_slugify(fixtures):
    """Return docs/deeplink.js's real slugify applied to each fixture."""
    with tempfile.NamedTemporaryFile("w", suffix=".mjs", delete=False) as fh:
        fh.write(JS_DRIVER)
        driver = fh.name
    try:
        proc = subprocess.run(
            [str(NODE), driver, str(DEEPLINK_JS)],
            input=json.dumps(fixtures),
            capture_output=True,
            text=True,
            timeout=60,
        )
    finally:
        pathlib.Path(driver).unlink(missing_ok=True)

    if proc.returncode == 2:
        raise AssertionError(
            "docs/deeplink.js: `function slugify(...) {...}` could not be "
            "extracted -- was it renamed, made an arrow function, or given a "
            "nested-brace body? The parity check cannot run. stderr=%r"
            % proc.stderr
        )
    if proc.returncode != 0:
        raise AssertionError(
            "node driver failed (rc=%d): stdout=%r stderr=%r"
            % (proc.returncode, proc.stdout, proc.stderr)
        )
    return json.loads(proc.stdout)


class NodeAvailable(unittest.TestCase):
    def test_node_binary_is_present(self):
        """The JS side is exercised through the real interpreter at /usr/bin/node."""
        self.assertTrue(
            NODE.exists(),
            "expected node at %s (CLAUDE.md pins the JS toolchain there)" % NODE,
        )

    def test_deeplink_js_is_present(self):
        self.assertTrue(DEEPLINK_JS.exists(), "%s is missing" % DEEPLINK_JS)


class SlugParity(unittest.TestCase):
    """The invariant: PandocWalk.slugify(t) == deeplink.js slugify(t), always."""

    @classmethod
    def setUpClass(cls):
        cls.inputs = [text for _, text in FIXTURES]
        cls.js_results = _run_js_slugify(cls.inputs)
        cls.py_results = [PandocWalk.slugify(t) for t in cls.inputs]

    def test_js_slugify_was_actually_extracted_and_run(self):
        """Guard against a silent no-op: the JS side produced one slug per
        fixture, and a known input maps to its known slug on the JS side."""
        self.assertEqual(len(self.js_results), len(FIXTURES))
        by_input = dict(zip(self.inputs, self.js_results))
        self.assertEqual(by_input["Hello World"], "hello-world")

    def test_python_and_js_agree_on_every_fixture(self):
        """The load-bearing assertion: identical slugs across the language
        boundary for every case, or RAG anchors miss the reader's headings."""
        for (label, text), py, js in zip(FIXTURES, self.py_results, self.js_results):
            with self.subTest(case=label, input=text):
                self.assertEqual(
                    py,
                    js,
                    "slug drift for %r: python=%r js=%r" % (text, py, js),
                )


class SlugContract(unittest.TestCase):
    """Golden values that document (and lock) the SHARED slug contract, so an
    identical break applied to both implementations at once is still caught.
    Every expected value was read off the real Python function."""

    slug = staticmethod(PandocWalk.slugify)

    def test_lowercases_and_hyphenates_spaces(self):
        self.assertEqual(self.slug("Hello World"), "hello-world")

    def test_strips_leading_and_trailing_separators(self):
        # Punctuation at the ends is dropped entirely, not turned into a dash.
        self.assertEqual(self.slug("  ...leading and trailing!!!  "), "leading-and-trailing")

    def test_collapses_runs_of_separators_to_one_dash(self):
        # Spaces, underscores, and punctuation are all "not [a-z0-9]"; any run
        # of them (mixed or not) becomes a single hyphen.
        self.assertEqual(
            self.slug("Multiple   spaces___and__underscores"),
            "multiple-spaces-and-underscores",
        )

    def test_apostrophe_is_a_separator(self):
        # An apostrophe is non-alnum, so "Newman's" slugs to "newman-s".
        self.assertEqual(
            self.slug("Newman's Idea of a University"),
            "newman-s-idea-of-a-university",
        )

    def test_all_punctuation_yields_empty_string(self):
        self.assertEqual(self.slug("!!!???...---"), "")

    def test_empty_input_yields_empty_string(self):
        self.assertEqual(self.slug(""), "")

    def test_non_ascii_letters_become_separators(self):
        # slugify keeps only ASCII [a-z0-9]; accented letters are stripped like
        # any other non-alnum, so a run of them collapses to a single dash.
        self.assertEqual(self.slug("Café Naïve Ölçü Résumé"), "caf-na-ve-l-r-sum")

    def test_caps_at_sixty_characters(self):
        long = "x" * 80
        out = self.slug(long)
        self.assertEqual(len(out), 60)
        self.assertEqual(out, "x" * 60)

    def test_trim_happens_before_the_60_cap_so_a_trailing_dash_can_survive(self):
        # The end-trim runs on the full string, THEN it is sliced to 60 -- so
        # the 60-char cut can fall on a hyphen and leave one trailing. Both
        # implementations do this in the same order, which is why they agree.
        out = self.slug("a" * 59 + " bcd")
        self.assertEqual(out, "a" * 59 + "-")
        self.assertEqual(len(out), 60)


if __name__ == "__main__":
    unittest.main()
