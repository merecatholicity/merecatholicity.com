"""Unit tests for local/serve.py :: ThinkStrip.

ThinkStrip is the streaming filter that removes the model's reasoning from the
token stream before the answer is shown to a reader. It must handle two shapes
of reasoning:

  * a paired ``<think>…</think>`` span appearing anywhere in the stream, and
  * a *leading* untagged reasoning run that ends in a bare ``</think>`` (qwen3
    via ollama sometimes emits only the closing tag into the content channel).

The subtle, worth-guarding part is that the stream arrives in arbitrary chunks,
so a tag may be split across a chunk boundary (``<`` / ``th`` / ``ink>``). The
filter must NEVER emit a half-tag as visible output — a reader must never see a
stray ``<think`` flash by. It does this by holding an ambiguous trailing tag
prefix in an internal buffer until enough bytes arrive to decide.

Emit contract (read off the source):
  * ``feed(chunk)`` returns the text that is now safe to emit (may be empty).
  * ``flush()`` returns whatever remains buffered at end of stream — the held
    tail if it turned out to be ordinary text, or "" if a ``<think>`` was still
    open (unterminated reasoning is dropped).

Every expected value below was derived by reading the class and by running the
real class over these sequences.
"""

import sys
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'local'))

from serve import ThinkStrip


def strip_stream(chunks):
    """Feed each chunk through a fresh ThinkStrip and return the full visible
    output: everything feed() emitted, followed by the final flush()."""
    ts = ThinkStrip()
    out = "".join(ts.feed(c) for c in chunks)
    out += ts.flush()
    return out


class CompleteSpan(unittest.TestCase):
    def test_paired_span_removed_surrounding_text_kept(self):
        """A complete <think>…</think> span is dropped; the text before and
        after it survives, joined with nothing between them."""
        out = strip_stream(["before<think>reasoning</think>after"])
        self.assertEqual(out, "beforeafter")

    def test_only_the_reasoning_is_removed(self):
        """The reasoning text itself never appears in the output."""
        out = strip_stream(["Q: <think>secret chain of thought</think>A"])
        self.assertNotIn("secret", out)
        self.assertNotIn("chain of thought", out)
        self.assertEqual(out, "Q: A")


class PlainText(unittest.TestCase):
    def test_text_without_tags_passes_through_unchanged(self):
        """With no think tags at all, the stream is emitted verbatim."""
        msg = "Hello, this is a plain answer."
        self.assertEqual(strip_stream([msg]), msg)

    def test_a_non_tag_less_than_is_preserved(self):
        """A bare '<' that is ordinary text (e.g. a comparison), even split
        across chunks, is held while ambiguous and then emitted intact — it is
        NOT mistaken for the start of a <think> tag."""
        out = strip_stream(["3 ", "<", " 4 is true"])
        self.assertEqual(out, "3 < 4 is true")


class SplitAcrossChunks(unittest.TestCase):
    def test_tag_split_across_chunk_boundaries_is_reassembled(self):
        """When the opening and closing tags arrive one or two characters at a
        time, the span is still recognized and removed, and the real text is
        stitched back together."""
        chunks = ["before", "<", "th", "ink>", "reason", "</", "think>", "after"]
        self.assertEqual(strip_stream(chunks), "beforeafter")

    def test_character_by_character_still_strips_the_span(self):
        """Feeding the stream one character at a time is the hardest split; the
        result is identical to feeding it whole."""
        out = strip_stream(list("A<think>x</think>B"))
        self.assertEqual(out, "AB")

    def test_partial_tag_is_never_emitted_as_visible_output(self):
        """The core guarantee: while a tag is arriving split, no intermediate
        feed() return may contain a half-written tag. In this stream every '<'
        belongs to a tag, so asserting no emitted chunk contains '<' proves a
        reader never sees a stray '<think' or '</think'."""
        ts = ThinkStrip()
        chunks = ["before", "<", "th", "ink>", "reason", "</", "think>", "after"]
        emitted = [ts.feed(c) for c in chunks]
        emitted.append(ts.flush())
        for piece in emitted:
            self.assertNotIn("<", piece)
        self.assertEqual("".join(emitted), "beforeafter")


class LeadingUntaggedReasoning(unittest.TestCase):
    def test_leading_reasoning_ending_in_bare_close_tag_is_dropped(self):
        """qwen3 sometimes streams reasoning with no opening tag, terminated by
        a lone </think>. Everything up to and including that close tag is
        dropped; only the real answer after it is emitted."""
        out = strip_stream(["okay let me think</think>The real answer."])
        self.assertEqual(out, "The real answer.")

    def test_bare_close_tag_is_always_consumed_never_emitted(self):
        """The bare </think> is always swallowed and never surfaces in the
        output, even when split across chunks, and text after it is kept.

        Note the honest limit of the leading-reasoning drop: it can only remove
        reasoning that is still buffered when the close tag is seen. Here the
        reasoning arrives in its own chunk with no trailing tag-prefix, so it is
        emitted immediately and cannot be recalled — the drop is reliable only
        when the reasoning and its </think> are buffered together (as in the
        single-chunk test above). What IS guaranteed in every case: the tag
        itself is stripped and the real answer after it survives."""
        out = strip_stream(["reasoning here", "</", "think>", "answer"])
        self.assertNotIn("</think>", out)
        self.assertTrue(out.endswith("answer"))
        self.assertEqual(out, "reasoning hereanswer")


class Flush(unittest.TestCase):
    def test_unterminated_think_span_yields_nothing_after_it(self):
        """An opened <think> that never closes suppresses everything to the end
        of the stream; flush() returns "" rather than leaking the reasoning."""
        ts = ThinkStrip()
        head = ts.feed("visible<think>reasoning that never closes")
        tail = ts.flush()
        self.assertEqual(head, "visible")
        self.assertEqual(tail, "")

    def test_ambiguous_trailing_tag_prefix_is_held_then_released(self):
        """A trailing '<' at end of a chunk looks like it might begin a tag, so
        it is withheld from feed()'s output and released by flush() once the
        stream ends and it is known to be ordinary text."""
        ts = ThinkStrip()
        body = ts.feed("answer<")
        self.assertEqual(body, "answer")   # the '<' is held back, not emitted
        self.assertEqual(ts.flush(), "<")  # flush releases the held tail

    def test_fresh_instance_has_clean_state(self):
        """Each ThinkStrip is independent; a new one starts emitting immediately
        with no leftover suppression from a prior stream."""
        self.assertEqual(strip_stream(["plain"]), "plain")


if __name__ == '__main__':
    unittest.main()
