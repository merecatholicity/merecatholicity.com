/* The librarian's AI budget guard (2026-09-10). merecat's questions spend
   the account's Workers AI neurons — one shared free day (the FREE table in
   usagecalc.ts) also drawn on by the board's screening, the avatar checks,
   embeddings and reranking. The question caps ration the librarian by COUNT;
   this guard reads the METER itself, the same figure the Platform usage page
   draws, and rests the librarian when the day's spend reaches the admin's
   line (Domain.Merecat: on by default, at 95%), naming the hours until the
   day renews. It binds admins too: it protects the account, not the ration —
   the merecat admin page is where it is switched off.

   Reading discipline: one analytics select, reused for a minute per isolate
   (each ChatRoom and each worker isolate keeps its own copy — a handful of
   selects a minute at the busiest), and trusted for fifteen minutes more when
   a fresh read fails; a failed read is not retried for a minute, so a slow
   analytics API costs one short timeout, not one per ask. When the meter
   cannot be read at all the guard STANDS OPEN and logs `merecat_quota_unread`
   — a monitor outage must not take the librarian down — which is also why the
   line is a margin and not the wall: the analytics run a minute or two behind
   the spend. Without CF_USAGE_TOKEN / CF_ACCOUNT_ID the guard has no meter
   and does nothing; the admin page says so. The decisions are the kernel's;
   this file fetches, caches and shapes. Its imports carry .ts extensions so
   Node runs it as-is (tests/worker/quota.test.mjs drives it with a stubbed
   fetch). */
import * as Merecat from '../../purescript/output/Domain.Merecat/index.js';
import { gqlSelect } from './analytics.ts';
import { buildReport, iso, utcDayStart } from './usagecalc.ts';

export const QUOTA_FRESH_MS = 60_000;          // a reading answers every ask this long
export const QUOTA_STALE_MS = 15 * 60_000;     // ...and still stands this long when a fresh read fails
export const QUOTA_FETCH_TIMEOUT_MS = 5000;    // an ask waits at most this long on the meter

/* The dataset the guard and the monitor both read: today's neurons by model. */
export function aiNeuronsSelect(dayIso: string): string {
  return 'aiInferenceAdaptiveGroups(limit: 1000, filter: {datetime_geq: "' + dayIso + '"}) { dimensions { modelId } sum { totalNeurons } }';
}

export type QuotaReading = { used: number; limit: number; pct: number; at: number };
export const quotaCache: { reading: QuotaReading | null; failedAt: number } = { reading: null, failedAt: 0 };

/* One select, aggregated by the monitor's own rulebook so the guard and the
   health bar can never disagree about the day's figure or its ceiling. */
export async function fetchAiNeurons(env: any, nowMs = Date.now()): Promise<QuotaReading> {
  const acct = await gqlSelect(env, aiNeuronsSelect(iso(utcDayStart(nowMs))), QUOTA_FETCH_TIMEOUT_MS);
  const row = buildReport({ ai: acct }).find((r) => r.id === 'ai.neurons');
  if (!row || row.error || !row.limit) throw new Error((row && row.error) || 'no neuron row');
  return { used: row.used || 0, limit: row.limit, pct: row.pct == null ? 0 : row.pct, at: nowMs };
}

export type QuotaView = {
  on: boolean; pct: number; configured: boolean;
  used: number | null; limit: number | null; meter_pct: number | null;
  resting: boolean; reset_in_h: number; note: string;
  read_at: number | null; stale: boolean; unread: boolean;
};

export async function merecatQuota(env: any, cfg: any, nowMs = Date.now()): Promise<QuotaView> {
  const on = !!cfg.quota_guard_on;
  const pct = Merecat.quotaGuardPctFrom(String(cfg.quota_guard_pct == null ? '' : cfg.quota_guard_pct));
  const reset_in_h = Merecat.hoursUntilUtcMidnight(nowMs);
  const base: QuotaView = {
    on, pct, configured: !!(env.CF_USAGE_TOKEN && env.CF_ACCOUNT_ID),
    used: null, limit: null, meter_pct: null, resting: false, reset_in_h, note: Merecat.restingNote(reset_in_h),
    read_at: null, stale: false, unread: false,
  };
  if (!on || !base.configured) return base;
  let r = quotaCache.reading;
  let stale = false;
  if (!r || nowMs - r.at >= QUOTA_FRESH_MS) {
    const backoff = quotaCache.failedAt > 0 && nowMs - quotaCache.failedAt < QUOTA_FRESH_MS;
    if (!backoff) {
      try {
        r = await fetchAiNeurons(env, nowMs);
        quotaCache.reading = r; quotaCache.failedAt = 0;
      } catch (e) {
        quotaCache.failedAt = nowMs;
        console.log(JSON.stringify({ event: 'merecat_quota_unread', error: String(e).slice(0, 200) }));
      }
    }
    if (r && nowMs - r.at >= QUOTA_FRESH_MS) {
      if (nowMs - r.at < QUOTA_STALE_MS) stale = true; else r = null;
    }
  }
  if (!r) return { ...base, unread: true };
  return { ...base, used: r.used, limit: r.limit, meter_pct: r.pct,
    resting: Merecat.quotaTripped(pct)(r.used)(r.limit), read_at: r.at, stale };
}

/* The member-facing slice (the quota line under the composer): the switch,
   the line, the day's share and whether the librarian rests — never the raw
   neuron counts or the reading's age, which are the admin page's. */
export function quotaPublic(v: QuotaView) {
  return { on: v.on, pct: v.pct, meter_pct: v.meter_pct, resting: v.resting, reset_in_h: v.reset_in_h,
    note: v.note, configured: v.configured, unread: v.unread };
}
