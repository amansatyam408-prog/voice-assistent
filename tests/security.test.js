import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import app from '../server.js';
import { initDb } from '../db.js';

let server;
let baseUrl;

describe('Security, Input Validation & Header Tests', () => {
  before(async () => {
    initDb(':memory:');
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  after(() => {
    if (server) server.close();
  });

  test('should set essential security headers', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    assert.strictEqual(res.headers.get('x-content-type-options'), 'nosniff');
    assert.strictEqual(res.headers.get('x-frame-options'), 'SAMEORIGIN');
    assert.strictEqual(res.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
  });

  test('should block directory traversal on recording endpoints', async () => {
    const maliciousId = '..%2F..%2Fetc%2Fpasswd';
    const res = await fetch(`${baseUrl}/api/calls/${maliciousId}/recording`);
    // Should be 400 Bad Request or 404 Not Found, never 200 or 500
    assert.ok(res.status === 400 || res.status === 404);
  });

  test('should reject overly large messages on /api/reply', async () => {
    const hugeMessage = 'A'.repeat(3000);
    const res = await fetch(`${baseUrl}/api/reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: hugeMessage })
    });
    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.ok(data.error.includes('maximum length'));
  });

  test('should never leak server environment API keys in responses', async () => {
    const res = await fetch(`${baseUrl}/api/config`);
    const text = await res.text();
    assert.ok(!text.includes('AIzaSy'));
    assert.ok(!text.includes('sk-proj'));
    assert.ok(!text.includes('GEMINI_API_KEY'));
  });
});
