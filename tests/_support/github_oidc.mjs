/* A stand-in for GitHub's OIDC issuer (2026-09-17): a signing key of its own,
   the key set it publishes, and the tokens a workflow job would be handed.
   The worker (comments-worker/src/oidc.ts) fetches the key set from GitHub's
   URL; a test answers that URL with `serves` inside its netSpy responder.

     const gh = await githubIssuer();
     const net = netSpy((url) => gh.serves(url) || other(url));
     const token = await gh.token('ingest');              // merecat.yml, on a push to main
     const late = await gh.token('probe', { exp: 1 });    // any claim overridden
     const pr = await gh.token('ingest', { environment: undefined }); // a claim removed */
import { JWKS_URL } from '../../comments-worker/src/oidc.ts';

const b64url = (bytes) => Buffer.from(bytes).toString('base64url');

export async function githubIssuer({ kid = 'test-signing-key' } = {}) {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true, ['sign', 'verify']);
  const pub = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const jwks = { keys: [{ kty: 'RSA', kid, use: 'sig', alg: 'RS256', n: pub.n, e: pub.e }] };
  let fetched = 0;

  /* a JWT over any header and claims, signed with this issuer's key */
  async function sign(claims, header = {}, key = pair.privateKey) {
    const head = b64url(JSON.stringify({ typ: 'JWT', alg: 'RS256', kid, ...header }));
    const body = b64url(JSON.stringify(claims));
    const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(head + '.' + body));
    return head + '.' + body + '.' + b64url(sig);
  }

  /* the claims GitHub gives the job that may open `door` */
  function claims(door, over = {}) {
    const now = Math.floor(Date.now() / 1000);
    const file = door === 'probe' ? 'ops-watch.yml' : 'merecat.yml';
    const ref = 'merecatholicity/merecatholicity.com/.github/workflows/' + file + '@refs/heads/main';
    return {
      jti: 'a-token-id', sub: 'repo:merecatholicity/merecatholicity.com:ref:refs/heads/main',
      aud: 'merecatholicity-comments', ref: 'refs/heads/main', sha: 'f'.repeat(40),
      repository: 'merecatholicity/merecatholicity.com', repository_owner: 'merecatholicity',
      repository_owner_id: '306126219', repository_id: '1303720165', repository_visibility: 'public',
      run_id: '35236215735', run_number: '7', run_attempt: '1', actor: 'a-schaefers', actor_id: '26800291',
      workflow: door === 'probe' ? 'ops-watch' : 'merecat', workflow_ref: ref, workflow_sha: 'f'.repeat(40),
      job_workflow_ref: ref, job_workflow_sha: 'f'.repeat(40),
      event_name: door === 'probe' ? 'schedule' : 'push', ref_type: 'branch', runner_environment: 'github-hosted',
      ...(door === 'config' ? { environment: 'librarian-config', sub: 'repo:merecatholicity/merecatholicity.com:environment:librarian-config' } : {}),
      iss: 'https://token.actions.githubusercontent.com',
      nbf: now - 600, exp: now + 300, iat: now,
      ...over,
    };
  }

  return {
    kid, jwks, sign, claims,
    token: (door, over) => sign(claims(door, over)),
    /* the key set, when the worker asks GitHub for it */
    serves: (url) => (url === JWKS_URL ? (fetched++, Response.json(jwks)) : null),
    get fetched() { return fetched; },
  };
}
