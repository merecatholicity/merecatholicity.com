/* Domain.Pipeline — which GitHub job may open which pipeline door (2026-09-17).
 *
 * What would break silently: the librarian's pipeline and the watchdog used
 * one static key, and the env disclosure published it — anyone holding it
 * could rewrite merecat's shelf, its persona and its dials. The pipeline now
 * proves itself with the OIDC token GitHub signs for one run, and this policy
 * reads its claims. A policy too loose lets a pull request's run, another
 * branch, another workflow, or a job that skipped the reviewer through, and
 * nothing on the site would look different. The signature is oidc.ts's (tests/
 * worker/pipeline.test.mjs); this file is the claims. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../../purescript/output/Domain.Pipeline/index.js';

const NOW = 1_789_650_000;
const job = (door, over = {}) => ({
  iss: 'https://token.actions.githubusercontent.com',
  aud: 'merecatholicity-comments',
  repositoryId: '1303720165',
  ownerId: '306126219',
  ref: 'refs/heads/main',
  refType: 'branch',
  eventName: 'push',
  runner: 'github-hosted',
  workflowRef: 'merecatholicity/merecatholicity.com/.github/workflows/' + (door === 'probe' ? 'ops-watch.yml' : 'merecat.yml') + '@refs/heads/main',
  environment: door === 'config' ? 'librarian-config' : '',
  exp: NOW + 300,
  nbf: NOW - 600,
  iat: NOW,
  ...over,
});
const refusal = (door, claims, now = NOW) => P.refusal(door)(claims)(now);

test('each door opens for its own job on main', () => {
  for (const door of ['ingest', 'config', 'probe']) {
    assert.equal(refusal(door, job(door)), '', door);
    assert.equal(P.allows(door)(job(door))(NOW), true, door);
  }
  assert.equal(P.workflowOf('ingest').value0, 'merecat.yml');
  assert.equal(P.workflowOf('config').value0, 'merecat.yml');
  assert.equal(P.workflowOf('probe').value0, 'ops-watch.yml');
  assert.equal(refusal('admin', job('ingest')), 'no such door');
  assert.equal(refusal('', job('ingest')), 'no such door');
});

test('the token must be GitHub\'s, for this site, from this repository by its ids', () => {
  assert.equal(refusal('ingest', job('ingest', { iss: 'https://token.actions.githubusercontent.com/' })), 'another issuer');
  assert.equal(refusal('ingest', job('ingest', { iss: '' })), 'another issuer');
  assert.equal(refusal('ingest', job('ingest', { aud: 'https://github.com/merecatholicity' })), 'another audience', 'GitHub\'s default audience is not ours');
  assert.equal(refusal('ingest', job('ingest', { aud: '' })), 'another audience');
  assert.equal(refusal('ingest', job('ingest', { repositoryId: '1303720166' })), 'another repository');
  assert.equal(refusal('ingest', job('ingest', { ownerId: '' })), 'another repository');
});

test('main only, and never a pull request\'s event', () => {
  assert.equal(refusal('ingest', job('ingest', { ref: 'refs/heads/feature' })), 'not main');
  assert.equal(refusal('ingest', job('ingest', { ref: 'refs/pull/7/merge' })), 'not main');
  assert.equal(refusal('ingest', job('ingest', { refType: 'tag' })), 'not main');
  assert.equal(refusal('ingest', job('ingest', { ref: 'refs/tags/main', refType: 'tag' })), 'not main');
  for (const eventName of ['pull_request', 'pull_request_target', 'pull_request_review', 'pull_request_review_comment', 'workflow_run', 'issue_comment', 'repository_dispatch', '']) {
    assert.equal(refusal('ingest', job('ingest', { eventName })), 'not a push, a schedule or a dispatch', eventName);
  }
  assert.deepEqual([...P.events], ['push', 'schedule', 'workflow_dispatch']);
  for (const eventName of P.events) assert.equal(refusal('probe', job('probe', { eventName })), '', eventName);
});

test('a GitHub-hosted runner, and the door\'s own workflow file from main', () => {
  assert.equal(refusal('ingest', job('ingest', { runner: 'self-hosted' })), 'not a GitHub-hosted runner');
  assert.equal(refusal('ingest', job('ingest', { runner: '' })), 'not a GitHub-hosted runner');
  assert.equal(refusal('ingest', job('probe')), 'another workflow', 'the watchdog\'s token does not ingest');
  assert.equal(refusal('probe', job('ingest')), 'another workflow', 'the librarian\'s token does not probe');
  assert.equal(refusal('ingest', job('ingest', { workflowRef: 'merecatholicity/merecatholicity.com/.github/workflows/merecat.yml@refs/heads/other' })), 'another workflow');
  assert.equal(refusal('ingest', job('ingest', { workflowRef: 'someone/fork/.github/workflows/merecat.yml@refs/heads/main' })), 'another workflow');
  assert.equal(refusal('ingest', job('ingest', { workflowRef: 'merecatholicity/merecatholicity.com/.github/workflows/build.yml@refs/heads/main' })), 'another workflow');
});

test('the persona and the dials need the job a reviewer approved; the corpus and the probe take any', () => {
  assert.equal(refusal('config', job('config', { environment: '' })), 'not the librarian-config environment', 'the ingest job cannot push the persona');
  assert.equal(refusal('config', job('config', { environment: 'terraform-production' })), 'not the librarian-config environment');
  assert.equal(refusal('config', job('ingest')), 'not the librarian-config environment');
  assert.equal(P.environmentOf('config'), 'librarian-config');
  assert.equal(refusal('ingest', job('config')), '', 'the config job may read the roster');
  assert.equal(refusal('ingest', job('ingest', { environment: 'anything' })), '');
  assert.equal(P.environmentOf('ingest'), '');
  assert.equal(P.environmentOf('probe'), '');
});

test('a token inside its lifetime, a minute of clock forgiven at either end', () => {
  const t = job('ingest');
  assert.equal(P.skew, 60);
  assert.equal(refusal('ingest', t, t.exp), '');
  assert.equal(refusal('ingest', t, t.exp + 60), '', 'a minute late is forgiven');
  assert.equal(refusal('ingest', t, t.exp + 61), 'expired');
  assert.equal(refusal('ingest', job('ingest', { exp: 0 })), 'expired', 'no expiry is no token');
  assert.equal(refusal('ingest', job('ingest', { exp: 2147483647 })), 'expired', 'the edge of the kernel\'s Int fails closed');
  assert.equal(refusal('ingest', job('ingest', { nbf: NOW + 60 })), '', 'a minute early is forgiven');
  assert.equal(refusal('ingest', job('ingest', { nbf: NOW + 61 })), 'not yet valid');
  assert.equal(refusal('ingest', job('ingest', { nbf: 0 })), '', 'nbf is optional');
  assert.equal(refusal('ingest', job('ingest', { iat: NOW + 61 })), 'issued in the future');
  assert.equal(refusal('ingest', job('ingest', { iat: 0 })), '', 'iat is optional');
});

test('the constants are the repository\'s', () => {
  assert.equal(P.issuer, 'https://token.actions.githubusercontent.com');
  assert.equal(P.audience, 'merecatholicity-comments');
  assert.equal(P.repositoryId, '1303720165');
  assert.equal(P.ownerId, '306126219');
});
