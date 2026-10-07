"""The webtest kit's driver start (webtest/flows.py, which audit.py shares). A
chromedriver a killed run left behind keeps its port; a new run's own driver
then exits at once (address in use), and the kit used to ask whatever answered
on that port for its session — two nightly suites ran on a leftover driver,
unseen, and left it running (2026-09-17). What would break silently: a held
port taken anyway; a driver that exited at start taken for a ready one.

And the console gate's list of the edge's own noise (BENIGN_CONSOLE, which
audit.py carries too): an entry that names the whole edge would hide a
challenge-platform failure, and a list the two kits stopped sharing would let
the audit pass what the nightly fails (2026-10-07: the nightly reported nine
regressions, twenty-four of twenty-five failures the edge-injected beacon's
report answered 404 at /cdn-cgi/rum)."""
import os
import socket
import stat
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'webtest'))
import flows  # noqa: E402


class DriverPort(unittest.TestCase):
    def test_a_port_something_listens_on_is_passed_over(self):
        held = socket.socket()
        held.bind(('127.0.0.1', 0))
        held.listen(1)
        try:
            port = held.getsockname()[1]
            got = flows.driver_port(port)
            self.assertNotEqual(got, port, 'the leftover keeps its port; the run takes another')
            self.assertGreater(got, 0)
        finally:
            held.close()

    def test_a_free_port_is_the_suites_own(self):
        s = socket.socket()
        s.bind(('127.0.0.1', 0))
        port = s.getsockname()[1]
        s.close()
        self.assertEqual(flows.driver_port(port), port)


class StartDriver(unittest.TestCase):
    """A stand-in for chromedriver in a scratch CHROME_DIR: one that exits at
    once, as the real one does on a held port, and one that stays up."""

    def run_with(self, script):
        real = flows.CHROME_DIR
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, 'chromedriver')
            with open(path, 'w') as f:
                f.write('#!/bin/sh\n' + script + '\n')
            os.chmod(path, os.stat(path).st_mode | stat.S_IXUSR)
            flows.CHROME_DIR = d
            try:
                return flows.start_driver(1)
            finally:
                flows.CHROME_DIR = real

    def test_a_driver_that_exited_at_start_is_an_error(self):
        with self.assertRaises(RuntimeError) as e:
            self.run_with('echo "bind() failed: Address already in use (98)" >&2; exit 1')
        self.assertIn('exited at start', str(e.exception))

    def test_a_driver_that_is_up_is_handed_back(self):
        drv = self.run_with('exec sleep 30')
        try:
            self.assertIsNone(drv.poll(), 'still running: the run owns it')
        finally:
            drv.kill()
            drv.wait()


class BenignConsole(unittest.TestCase):
    def test_the_edge_beacons_refused_report_is_noise(self):
        """The beacon the edge injects posts to /cdn-cgi/rum on this origin and
        has been answered 404 since the site record's auto_install went false;
        no code of ours makes that request (nav.js's own beacon never runs
        under webdriver), so it is not a finding."""
        self.assertIn('cdn-cgi/rum', flows.BENIGN_CONSOLE)

    def test_the_list_names_a_path_never_the_whole_edge(self):
        for entry in flows.BENIGN_CONSOLE:
            self.assertNotEqual(entry.strip('/'), 'cdn-cgi',
                                'bare cdn-cgi/ would hide the challenge platform failing')

    def test_audit_and_flows_keep_one_list(self):
        import audit  # noqa: E402  (webtest/audit.py, stdlib only, no side effect on import)
        self.assertEqual(tuple(audit.BENIGN_CONSOLE), tuple(flows.BENIGN_CONSOLE),
                         'the audit must not pass what the nightly fails, or the reverse')


if __name__ == '__main__':
    unittest.main()
