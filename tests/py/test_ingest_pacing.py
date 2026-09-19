"""The shelf takes a slice of the day, not the day (librarian/ingest.py, 2026-09-19).

D1's free tier allows 100,000 row writes per ACCOUNT per day, shared by the
three librarian rooms, the comments database, every migration a worker deploy
applies, and every comment, DM and reaction a member writes. On 2026-09-18 a
PARSER_VERSION bump re-ingested the whole corpus in one burst, spent 109,021 of
them in six minutes, and production took no writes at all until midnight.

What breaks silently here is arithmetic: a ceiling that looks conservative in
ESTIMATED rows and is not in actual ones (D1 counts index and FTS writes, so the
estimate undercounts by EST_TO_ACTUAL), or a meter reading that is trusted in
the wrong direction — an unread meter taken for a free day would restore exactly
the behaviour this change removed. So these tests hold the pacing itself: the
ceiling binds, the live meter may only LOWER it, a spent day yields nothing, and
an absent meter falls back to the ceiling rather than to the sky.
"""
import os
import re
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, 'librarian'))
import ingest  # noqa: E402

CAP = 100_000          # D1 free tier, per account, per UTC day


def source(name):
    with open(os.path.join(ROOT, name), encoding='utf-8') as f:
        return f.read()


def defaults():
    """The ceiling and the reserve a run with NO flags uses — what the
    unattended daily cron gets, read out of the argument parser itself."""
    src = source(os.path.join('librarian', 'ingest.py'))
    out = []
    for flag in ('--budget-rows', '--reserve-rows'):
        decl = src[src.index('ap.add_argument("%s"' % flag):]
        out.append(int(re.search(r'default=(\d+)', decl).group(1)))
    return out


class Pacing(unittest.TestCase):
    def test_a_wide_open_day_is_still_only_the_ceiling(self):
        """The meter may lower the bite, never raise it: an empty day is not a licence."""
        budget, note = ingest.paced_budget(20_000, 40_000, 0, CAP)
        self.assertEqual(budget, 20_000)
        self.assertIn('ceiling', note)

    def test_a_busy_day_shrinks_the_bite_to_what_is_left(self):
        """55,000 written and 40,000 reserved leaves 5,000 actual — ~4,132 estimated."""
        budget, _ = ingest.paced_budget(20_000, 40_000, 55_000, CAP)
        self.assertEqual(budget, int(5_000 / ingest.EST_TO_ACTUAL))
        self.assertLess(budget, 20_000)

    def test_a_spent_day_yields_nothing_rather_than_finishing_the_cap(self):
        for written in (60_000, 95_000, CAP, CAP + 10_000):
            budget, _ = ingest.paced_budget(20_000, 40_000, written, CAP)
            self.assertEqual(budget, 0, 'written=%d must buy no rows' % written)

    def test_an_unread_meter_falls_back_to_the_ceiling_not_to_the_sky(self):
        """No CF_USAGE_TOKEN, a slow analytics API or an older worker: the
        roster simply carries no reading, and the fixed ceiling governs — the
        whole policy as it stood before the meter existed."""
        for written, cap in ((None, CAP), (None, None), (0, None), (5, 0)):
            budget, note = ingest.paced_budget(20_000, 40_000, written, cap)
            self.assertEqual(budget, 20_000, 'meter (%r, %r)' % (written, cap))
            self.assertIn('unread', note)

    def test_the_shipped_defaults_leave_the_site_most_of_the_day(self):
        """The point of the change, in one assertion. A full-ceiling run costs
        ceiling * EST_TO_ACTUAL ACTUAL rows; that must be a minority of the
        account's day, with the reserve still standing behind it."""
        ceiling, reserve = defaults()
        worst = ceiling * ingest.EST_TO_ACTUAL
        self.assertLess(worst, CAP * 0.35, 'a single run may not take a third of the account day')
        self.assertLessEqual(worst + reserve, CAP, 'ceiling and reserve must fit inside the cap')
        self.assertGreaterEqual(reserve, 25_000, 'the site keeps a real share, not a token one')

    def test_the_daily_cron_gets_the_defaults(self):
        """merecat.yml must not hand the ingest a budget of its own: the number
        that governs the unattended 04:10 UTC run is the one reviewed here."""
        wf = source(os.path.join('.github', 'workflows', 'merecat.yml'))
        self.assertNotIn('--budget-rows', wf)
        self.assertNotIn('--reserve-rows', wf)


if __name__ == '__main__':
    unittest.main()
