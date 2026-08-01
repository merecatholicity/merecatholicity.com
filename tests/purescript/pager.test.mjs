/* Domain.Pager — the page-bar windowing (page 1, the last page, the active
   page's neighbours, with one-page gaps filled and wider gaps an ellipsis; [] for
   a single page). Single source for both the href pager and the button pager.
   We brute-force it against the classic pagerPages over a wide grid so no edge
   (empty, boundary, active past the end) can silently diverge. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Pager from '../../purescript/output/Domain.Pager/index.js';

function origPagerPages(total, per, active) {
  const pages = Math.ceil(total / per);
  if (pages < 2) return null;
  const shown = [];
  for (let n = 1; n <= pages; n++) if (n === 1 || n === pages || Math.abs(n - active) <= 1) shown.push(n);
  const out = []; let prev = 0;
  shown.forEach((n) => {
    if (prev) { if (n - prev === 2) out.push({ n: prev + 1 }); else if (n - prev > 2) out.push({ gap: true }); }
    out.push({ n, active: n === active }); prev = n;
  });
  return out;
}
const pproj = (it) => ({ gap: !!it.gap, active: !!it.active, n: it.gap ? 0 : it.n });

test('pagerItems matches the classic windowing across a wide grid', () => {
  let cases = 0;
  for (let total = 0; total <= 90; total++) for (const per of [1, 2, 5, 10, 20]) {
    for (let active = 0; active <= Math.ceil(total / per) + 2; active++) {
      cases++;
      const orig = origPagerPages(total, per, active);
      const ps = Pager.pagerItems(total)(per)(active);
      assert.deepEqual(ps.map(pproj), (orig === null ? [] : orig).map(pproj),
        `pagerItems(${total},${per},${active})`);
    }
  }
  assert.ok(cases > 1000, 'the grid actually ran');
});

test('a single/empty page produces no page bar', () => {
  assert.deepEqual(Pager.pagerItems(0)(20)(1), []);
});
