#!/usr/bin/env node
/**
 * Post-deployment smoke test. Run by CI after every deployment and after every
 * rollback; a failure triggers the automatic rollback.
 *
 * Env:
 *   API_URL          AppSync GraphQL URL
 *   SITE_URL         CloudFront URL of the React app
 *   AWS_REGION       region of the API
 *   EXPECT_VERSION   (optional) git SHA that must be live in both the API and the site
 *
 * Checks:
 *   1. Query.health via IAM (SigV4): Lambda -> RDS and Lambda -> private Fargate server are up,
 *      and the Live Lambda alias runs the expected version
 *   2. The API rejects unauthenticated requests
 *   3. The site is served over HTTPS with security headers, SPA routing works, and
 *      config.json points at this API and version
 */
import { Sha256 } from '@aws-crypto/sha256-js';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { HttpRequest } from '@smithy/protocol-http';
import { SignatureV4 } from '@smithy/signature-v4';

const { API_URL, SITE_URL, AWS_REGION, EXPECT_VERSION } = process.env;
if (!API_URL || !SITE_URL || !AWS_REGION) {
  console.error('API_URL, SITE_URL and AWS_REGION are required');
  process.exit(2);
}

const signer = new SignatureV4({ service: 'appsync', region: AWS_REGION, credentials: defaultProvider(), sha256: Sha256 });

async function signedGraphql(query) {
  const url = new URL(API_URL);
  const body = JSON.stringify({ query });
  const signed = await signer.sign(
    new HttpRequest({
      method: 'POST',
      protocol: url.protocol,
      hostname: url.hostname,
      path: url.pathname,
      headers: { host: url.hostname, 'content-type': 'application/json' },
      body,
    }),
  );
  const headers = { ...signed.headers };
  delete headers.host; // fetch sets Host itself (same value that was signed)
  const res = await fetch(API_URL, { method: 'POST', headers, body });
  return { status: res.status, body: await res.json().catch(() => null) };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const checks = {
  async 'API health (IAM auth, end-to-end)'() {
    const { status, body } = await signedGraphql('query Smoke { health { status database graphqlServer version } }');
    assert(status === 200, `HTTP ${status}: ${JSON.stringify(body)}`);
    const h = body?.data?.health;
    assert(h, `no health payload: ${JSON.stringify(body)}`);
    assert(h.database === 'ok', `database: ${h.database}`);
    assert(h.graphqlServer === 'ok', `private GraphQL server: ${h.graphqlServer}`);
    assert(h.status === 'ok', `status: ${h.status}`);
    if (EXPECT_VERSION) assert(h.version === EXPECT_VERSION, `Live alias runs ${h.version}, expected ${EXPECT_VERSION}`);
    return `version ${h.version}`;
  },

  async 'API rejects unauthenticated requests'() {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: '{ tasks { items { id } } }' }),
    });
    assert(res.status === 401 || res.status === 403, `expected 401/403, got ${res.status}`);
    return `HTTP ${res.status}`;
  },

  async 'Site served over HTTPS with security headers'() {
    const res = await fetch(SITE_URL, { redirect: 'manual' });
    assert(res.status === 200, `HTTP ${res.status}`);
    const html = await res.text();
    assert(html.includes('<div id="root">'), 'index.html does not contain the app root');
    for (const h of ['strict-transport-security', 'content-security-policy', 'x-content-type-options', 'x-frame-options']) {
      assert(res.headers.get(h), `missing header ${h}`);
    }
    return 'ok';
  },

  async 'SPA deep link falls back to the app shell'() {
    const res = await fetch(new URL('/some/deep/link', SITE_URL));
    assert(res.status === 200 && (await res.text()).includes('<div id="root">'), `HTTP ${res.status}`);
    return 'ok';
  },

  async 'Runtime config points at this API'() {
    const res = await fetch(new URL('/config.json', SITE_URL), { cache: 'no-store' });
    assert(res.status === 200, `HTTP ${res.status}`);
    const cfg = await res.json();
    assert(cfg.graphqlUrl === API_URL, `config.json graphqlUrl=${cfg.graphqlUrl}`);
    if (EXPECT_VERSION) assert(cfg.version === EXPECT_VERSION, `site serves ${cfg.version}, expected ${EXPECT_VERSION}`);
    return `version ${cfg.version}`;
  },
};

async function withRetries(fn, attempts = 6, delayMs = 10_000) {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i >= attempts) throw err;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

let failed = 0;
for (const [name, fn] of Object.entries(checks)) {
  try {
    const detail = await withRetries(fn);
    console.log(`✓ ${name} (${detail})`);
  } catch (err) {
    failed++;
    console.error(`✗ ${name}: ${err.message}`);
  }
}
if (failed) {
  console.error(`\n${failed} smoke check(s) failed`);
  process.exit(1);
}
console.log('\nAll smoke checks passed');
