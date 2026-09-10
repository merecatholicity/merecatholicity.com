/* The GraphQL Analytics API glue, shared by the free-tier usage monitor
   (usage.ts: the health-bar page and the daily check) and the librarian's
   AI budget guard (quota.ts). One account-scoped select per call, under the
   READ-ONLY CF_USAGE_TOKEN secret (single scope "Account Analytics: Read")
   beside the CF_ACCOUNT_ID var; the callers decide what to do while neither
   stands. No worker imports, so a Node test can stub `fetch` and drive the
   modules built on it. */

const GRAPHQL = 'https://api.cloudflare.com/client/v4/graphql';

export async function gqlSelect(env: any, sel: string, timeoutMs = 12000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort('usage-timeout'), timeoutMs);
  try {
    const r = await fetch(GRAPHQL, {
      method: 'POST',
      headers: { authorization: 'Bearer ' + env.CF_USAGE_TOKEN, 'content-type': 'application/json' },
      body: JSON.stringify({ query: 'query { viewer { accounts(filter: {accountTag: "' + env.CF_ACCOUNT_ID + '"}) { ' + sel + ' } } }' }),
      signal: ctl.signal,
    });
    const d: any = await r.json().catch(() => null);
    if (!d) throw new Error('bad analytics response (' + r.status + ')');
    if (d.errors && d.errors.length) throw new Error(String(d.errors[0].message || 'GraphQL error').slice(0, 200));
    const acct = d.data && d.data.viewer && d.data.viewer.accounts && d.data.viewer.accounts[0];
    if (!acct) throw new Error('no account data (is the token Account Analytics: Read on this account?)');
    return acct;
  } finally { clearTimeout(timer); }
}
