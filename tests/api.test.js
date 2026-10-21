import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import app from '../server.js';
import { initDb } from '../db.js';

let server;
let baseUrl;

describe('Express REST API End-to-End Tests', () => {
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

  test('GET /api/health should return ok and uptime', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.status, 'ok');
    assert.ok(typeof data.uptime === 'number');
  });

  test('GET /api/config should return safe config without exposing secret keys', async () => {
    const res = await fetch(`${baseUrl}/api/config`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok('ready' in data);
    assert.ok('activeProvider' in data);
    assert.ok(!('GEMINI_API_KEY' in data));
    assert.ok(!('OPENAI_API_KEY' in data));
  });

  test('POST /api/sessions/start & /end should manage call sessions', async () => {
    const startRes = await fetch(`${baseUrl}/api/sessions/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'session_api_test_1', product: 'FlowPilot', language: 'English' })
    });
    assert.strictEqual(startRes.status, 200);
    const startData = await startRes.json();
    assert.strictEqual(startData.success, true);

    const endRes = await fetch(`${baseUrl}/api/sessions/end`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'session_api_test_1' })
    });
    assert.strictEqual(endRes.status, 200);
  });

  test('POST /api/reply should generate voice sales reply', async () => {
    const res = await fetch(`${baseUrl}/api/reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Can FlowPilot automate our Slack notifications?',
        product: 'FlowPilot',
        language: 'English'
      })
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok(data.reply && data.reply.length > 5);
  });

  test('POST /api/reply with empty message should return 400 Bad Request', async () => {
    const res = await fetch(`${baseUrl}/api/reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '   ' })
    });
    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.ok(data.error);
  });

  test('POST /api/summary should return all 5 required fields and classification', async () => {
    const res = await fetch(`${baseUrl}/api/summary`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transcript: [
          { role: 'assistant', text: 'Hello, welcome to CloudDesk!' },
          { role: 'customer', text: 'We need helpdesk software for our 10 support agents. Can we get a demo?' }
        ],
        product: 'CloudDesk'
      })
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.ok(data.summary);
    assert.ok(Array.isArray(data.requirements));
    assert.ok(Array.isArray(data.questionsAsked));
    assert.ok(Array.isArray(data.objections));
    assert.ok(data.customerInterest);
    assert.ok(Array.isArray(data.nextSteps));
    assert.strictEqual(data.status, 'Demo Requested');
  });

  test('POST /api/calls should persist call and GET /api/calls should retrieve it', async () => {
    const newCall = {
      id: 'api_test_call_99',
      product: 'TeamSync',
      language: 'English',
      createdAt: new Date().toISOString(),
      durationSeconds: 90,
      durationFormatted: '01:30',
      status: 'Interested',
      transcript: [{ role: 'customer', text: 'Looks promising' }],
      summary: null,
      consentGiven: 1
    };

    const postRes = await fetch(`${baseUrl}/api/calls`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newCall)
    });
    assert.strictEqual(postRes.status, 200);

    const getRes = await fetch(`${baseUrl}/api/calls/api_test_call_99`);
    assert.strictEqual(getRes.status, 200);
    const callData = await getRes.json();
    assert.strictEqual(callData.id, 'api_test_call_99');
    assert.strictEqual(callData.product, 'TeamSync');
  });

  test('POST & GET /api/calls/:id/recording should upload and stream audio with Range header', async () => {
    const dummyAudio = Buffer.from('FAKE-WEBM-AUDIO-DATA-STREAM-1234567890');
    const uploadRes = await fetch(`${baseUrl}/api/calls/api_test_call_99/recording`, {
      method: 'POST',
      headers: { 'Content-Type': 'audio/webm' },
      body: dummyAudio
    });
    assert.strictEqual(uploadRes.status, 200);
    const uploadJson = await uploadRes.json();
    assert.strictEqual(uploadJson.success, true);

    // Stream with Range
    const streamRes = await fetch(`${baseUrl}/api/calls/api_test_call_99/recording`, {
      headers: { Range: 'bytes=0-15' }
    });
    assert.strictEqual(streamRes.status, 206); // Partial Content
    assert.ok(streamRes.headers.get('content-range').includes('bytes 0-15/'));
    const chunk = await streamRes.arrayBuffer();
    assert.strictEqual(chunk.byteLength, 16);
  });

  test('DELETE /api/calls/:id should remove call and recording', async () => {
    const delRes = await fetch(`${baseUrl}/api/calls/api_test_call_99`, { method: 'DELETE' });
    assert.strictEqual(delRes.status, 200);

    const checkRes = await fetch(`${baseUrl}/api/calls/api_test_call_99`);
    assert.strictEqual(checkRes.status, 404);
  });

  test('GET /api/stats should return sales metrics', async () => {
    const res = await fetch(`${baseUrl}/api/stats`);
    assert.strictEqual(res.status, 200);
    const stats = await res.json();
    assert.ok(typeof stats.totalCalls === 'number');
    assert.ok(typeof stats.statuses === 'object');
  });
});
