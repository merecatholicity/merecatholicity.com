"""Unit tests for the pure token-budget math in local/llm.py.

These lock the two deterministic, network-free helpers that the reranker's
"prevent a fat chunk from failing the whole /rerank batch" layer stands on:

  * ``_est_tokens`` — a tokenizer-free OVERestimate of a string's token count,
    weighted by character class (ASCII ~2.5 chars/token, non-ASCII ~1.2), with
    a fixed +8 safety margin.
  * ``_trim_tokens`` — cut text to a token budget. It normally checks the real
    tokenizer over the network (``tok_count``), but falls back to ``_est_tokens``
    the instant ``tok_count`` returns ``None``. We drive it entirely through
    that offline fallback so the tests are deterministic and touch no socket.

Every expected value below was read off the source formula
``int((len - non_ascii)/2.5 + non_ascii*1.2) + 8`` and confirmed by running the
functions directly.
"""
import sys
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'local'))

import llm  # noqa: E402


# A cfg whose rerank_url is empty makes tok_count() build the malformed URL
# "/tokenize", which urllib rejects immediately (no scheme, no socket). That
# raises a ValueError that tok_count swallows into a None return — so every
# _trim_tokens call below runs the fully deterministic estimate-only path.
OFFLINE_CFG = {'rerank_url': ''}


class TestEstTokens(unittest.TestCase):
    """_est_tokens: a deterministic per-character-class token estimate."""

    def test_empty_text_returns_the_fixed_margin(self):
        """Empty text carries only the +8 safety margin the formula adds."""
        self.assertEqual(llm._est_tokens(''), 8)

    def test_margin_floor_dominates_near_empty_text(self):
        """A one-char string still rounds down to the same +8 floor:
        int(1/2.5) == 0, so the estimate is just the margin."""
        self.assertEqual(llm._est_tokens('a'), 8)

    def test_ascii_estimate_matches_the_exact_formula(self):
        """100 ASCII chars: int(100/2.5) + 8 == 40 + 8 == 48."""
        self.assertEqual(llm._est_tokens('a' * 100), 48)

    def test_longer_ascii_estimates_more_than_shorter(self):
        """The estimate is monotone in length for a fixed character class."""
        short = llm._est_tokens('a' * 20)
        long = llm._est_tokens('a' * 200)
        self.assertGreater(long, short)

    def test_greek_estimate_matches_the_exact_formula(self):
        """100 non-ASCII (Greek) chars: int(100 * 1.2) + 8 == 120 + 8 == 128.
        Every Greek letter is ord > 127, so all 100 take the heavier weight."""
        self.assertEqual(llm._est_tokens('α' * 100), 128)

    def test_non_ascii_weighs_more_than_ascii_at_equal_length(self):
        """Same character length, but a Greek-dense run estimates MORE tokens
        than an ASCII run — the 1.2 non-ASCII weight beats ASCII's 1/2.5=0.4.
        This is the property that keeps a Greek-dense chunk from silently
        blowing past the reranker's physical batch."""
        length = 120
        ascii_est = llm._est_tokens('a' * length)
        greek_est = llm._est_tokens('α' * length)
        self.assertGreater(greek_est, ascii_est)


class TestTrimTokensOffline(unittest.TestCase):
    """_trim_tokens over the estimate-only (tokenizer-unreachable) path."""

    def test_offline_cfg_makes_tok_count_return_none(self):
        """Precondition for the rest: with an empty rerank_url, tok_count
        short-circuits to None instantly, so _trim_tokens uses _est_tokens."""
        self.assertIsNone(llm.tok_count(OFFLINE_CFG, 'hello world'))

    def test_nonpositive_budget_returns_empty_string(self):
        """A zero or negative budget yields the empty string with no work."""
        self.assertEqual(llm._trim_tokens(OFFLINE_CFG, 'hello world', 0), '')
        self.assertEqual(llm._trim_tokens(OFFLINE_CFG, 'hello world', -5), '')

    def test_generous_budget_returns_text_unchanged(self):
        """When the estimate already fits the budget, text is returned as-is
        on the first pass — no truncation."""
        text = 'a' * 1000  # estimates 408 tokens
        self.assertEqual(llm._trim_tokens(OFFLINE_CFG, text, 100_000), text)

    def test_tight_budget_shortens_text_to_fit_the_estimate(self):
        """A budget below the text's estimate shortens it, and the returned
        text's own estimate fits under the budget (the loop converges)."""
        text = 'a' * 1000  # estimates 408 tokens
        budget = 50
        out = llm._trim_tokens(OFFLINE_CFG, text, budget)
        self.assertLess(len(out), len(text))
        self.assertLessEqual(llm._est_tokens(out), budget)

    def test_tight_budget_converges_across_a_range(self):
        """Convergence isn't a one-off: several sub-estimate budgets all land
        with the returned estimate at or under the budget (each >= the +8
        margin so it is actually reachable)."""
        text = 'word ' * 400  # long ASCII, ~408 estimated tokens
        for budget in (20, 50, 100, 200):
            with self.subTest(budget=budget):
                out = llm._trim_tokens(OFFLINE_CFG, text, budget)
                self.assertLessEqual(llm._est_tokens(out), budget)

    def test_offline_trim_is_deterministic(self):
        """No network in the fallback path means identical input gives
        identical output every time."""
        text = 'lorem ipsum dolor ' * 200
        first = llm._trim_tokens(OFFLINE_CFG, text, 60)
        second = llm._trim_tokens(OFFLINE_CFG, text, 60)
        self.assertEqual(first, second)


if __name__ == '__main__':
    unittest.main()
