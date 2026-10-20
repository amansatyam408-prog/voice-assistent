import assert from 'node:assert/strict';
import test from 'node:test';

import { makeConfig, cleanupConfig, mockGemini, withServer, postJson, getJson, sampleAudio } from './helpers.js';

test('all security headers are present on HTML and JSON responses', async () => {
  const config = makeConfig();
  try {
    await withServer(config, mockGemini(), async ({ base }) => {
      for (const pathname of ['/', '/api/health', '/api/config']) {
        const response = await fetch(`${base}${pathname}`);
        assert.equal(response.headers.get('x-content-type-options'), 'nosniff', `${pathname} nosniff`);
        assert.equal(response.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
        assert.equal(response.headers.get('x-powered-by'), null);
        const csp = response.headers.get('content-security-policy');
        assert.ok(csp && csp.includes("default-src 'self'"), `${pathname} CSP`);
        assert.ok(csp.includes("object-src 'none'"));
      }
    });
  } finally {
    cleanupConfig(config);
  }
});

test('recording files are stored under server-generated UUID names (no path control)', async () => {
  const config = makeConfig();
  try {
    await withServer(config, mockGemini(), async ({ base }) => {
      const started = await postJson(base, '/api/calls', { productId: 'flowpilot', language: 'en', consentRecording: true });
      const callId = started.body.call.id;
      const upload = await fetch(`${base}/api/calls/${callId}/recording?filename=../../evil.webm`, {
        method: 'POST',
        headers: { 'content-type': 'audio/webm' },
        body: sampleAudio(1024),
      });
      assert.equal(upload.status, 201);
      const body = await upload.json();
      assert.match(body.call.recording.url, new RegExp(`^/api/calls/${callId}/recording$`));

      const traversal = await fetch(`${base}/api/calls/${encodeURIComponent('../../etc/passwd')}/recording`);
      assert.equal(traversal.status, 400);
      const traversalEncoded = await fetch(`${base}/api/calls/..%2F..%2Fetc%2Fpasswd/recording`);
      assert.equal(traversalEncoded.status, 400);

      const putAttempt = await fetch(`${base}/api/calls/${callId}/recording`, { method: 'PUT' });
      assert.equal(putAttempt.status, 405);
    });
  } finally {
    cleanupConfig(config);
  }
});

test('oversized JSON bodies are rejected before parsing', async () => {
  const config = makeConfig({ JSON_BODY_MAX_BYTES: '1024' });
  try {
    await withServer(config, mockGemini(), async ({ base }) => {
      const started = await postJson(base, '/api/calls', { productId: 'flowpilot', language: 'en' });
      const callId = started.body.call.id;
      const huge = JSON.stringify({ message: 'a'.repeat(4000) });
      const response = await fetch(`${base}/api/calls/${callId}/reply`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: huge,
      });
      assert.equal(response.status, 400);
      const body = await response.json();
      assert.equal(body.error.code, 'VALIDATION_ERROR');
      assert.match(body.error.message, /limit|large/i);
    });
  } finally {
    cleanupConfig(config);
  }
});

test('AI requests are rate limited per client', async () => {
  const config = makeConfig({ AI_REQUESTS_PER_MINUTE: '5' });
  try {
    await withServer(config, mockGemini(), async ({ base }) => {
      const started = await postJson(base, '/api/calls', { productId: 'flowpilot', language: 'en' });
      const callId = started.body.call.id;
      const results = [];
      for (let i = 0; i < 6; i += 1) {
        const result = await postJson(base, `/api/calls/${callId}/reply`, { message: `Question number ${i}` });
        results.push(result.response.status);
      }
      assert.deepEqual(results.slice(0, 5), [200, 200, 200, 200, 200]);
      assert.equal(results[5], 429);
    });
  } finally {
    cleanupConfig(config);
  }
});

test('errors are structured and never leak stack traces or environment secrets', async () => {
  const config = makeConfig({ GEMINI_API_KEY: 'super-secret-gemini-key-value' });
  try {
    await withServer(config, mockGemini({ failWith: { status: 500, message: 'internal provider detail' } }), async ({ base }) => {
      const started = await postJson(base, '/api/calls', { productId: 'flowpilot', language: 'en' });
      const callId = started.body.call.id;
      const response = await fetch(`${base}/api/calls/${callId}/reply`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: 'Hello' }),
      });
      const raw = await response.text();
      assert.equal(response.status, 502);
      assert.ok(!raw.includes('super-secret-gemini-key-value'), 'API key must not appear in error responses');
      assert.ok(!raw.includes('at Object.'), 'stack traces must not be returned');
      const parsed = JSON.parse(raw);
      assert.equal(parsed.error.code, 'AI_UPSTREAM_ERROR');
      assert.equal(typeof parsed.error.message, 'string');

      const notFound = await getJson(base, '/api/calls/99999999-9999-4999-8999-999999999999');
      assert.equal(notFound.response.status, 404);
      assert.equal(notFound.body.error.code, 'NOT_FOUND');
      assert.ok(!('stack' in notFound.body.error));
    });
  } finally {
    cleanupConfig(config);
  }
});

test('sensitive data is not returned by public endpoints', async () => {
  const config = makeConfig({ ADMIN_TOKEN: 'admin-secret-value', GEMINI_API_KEY: 'AIzaVerySecretKey123' });
  try {
    await withServer(config, mockGemini(), async ({ base }) => {
      for (const pathname of ['/api/config', '/api/health', '/api/calls', '/api/stats', '/api/export']) {
        const response = await fetch(`${base}${pathname}`);
        const text = await response.text();
        assert.ok(!text.includes('AIzaVerySecretKey123'), `${pathname} must not leak the Gemini key`);
        assert.ok(!text.includes('admin-secret-value'), `${pathname} must not leak the admin token`);
      }
    });
  } finally {
    cleanupConfig(config);
  }
});
