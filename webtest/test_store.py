#!/usr/bin/env python3
"""Wave A gate: the API store must REDUCE requests on rapid view hops.

Journey (logged in): board index -> cat=pub -> topic -> back -> cat AGAIN.
The second category visit must cost strictly fewer API requests than the
first (memory serves it), the whole run must produce ZERO rate-limit
answers (the grazing the store exists to kill), and every hop stays soft.
"""
import sys
import time

from flows import Flow


def main():
    with Flow(port=9561) as f:
        f.login()
        f.drain()
        # first category visit
        f.click('a[href="community.html?cat=pub"]')
        f.wait("document.querySelectorAll('.board-topic').length > 0")
        time.sleep(1)
        first_net = f.net()
        first_api = f.api_requests(first_net)
        soft1 = f.assert_soft('cat#1')
        f.assert_console_clean('cat#1')
        # topic hop
        f.click('.board-topic a.board-topic-title')
        f.wait("!!document.querySelector('.comment-body, .comment')")
        time.sleep(1)
        f.drain()
        # back to the category (memory should serve)
        f.js('history.back(); return 1;')
        f.wait("location.search.indexOf('cat=pub') === 0 || location.search.indexOf('?cat=pub') === 0")
        f.wait("document.querySelectorAll('.board-topic').length > 0")
        time.sleep(1)
        second_net = f.net()
        second_api = f.api_requests(second_net)
        soft2 = f.assert_soft('cat#2')
        f.assert_console_clean('cat#2')
        limited = f.js1(
            "return performance.getEntriesByType('resource').filter(function(r){return r.name.indexOf('/api/')!==-1 && r.responseStatus===429;}).length;") or 0
        print('cat visit #1 API requests:', len(first_api))
        for u in first_api:
            print('   ', u.split('.com')[-1][:90])
        print('cat visit #2 (from memory) API requests:', len(second_api))
        for u in second_api:
            print('   ', u.split('.com')[-1][:90])
        print('429s seen by the page:', limited)
        checks = [
            ('first visit made API reads', len(first_api) >= 1),
            ('repeat visit cost FEWER API reads', len(second_api) < len(first_api)),
            ('zero rate-limit answers', limited == 0),
            ('both hops soft', soft1 and soft2),
        ]
        sys.exit(f.verdict(checks))


if __name__ == '__main__':
    main()
