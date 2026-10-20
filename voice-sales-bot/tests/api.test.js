import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  makeConfig,
  cleanupConfig,
  mockGemini,
  withServer,
  postJson,
  getJson,
  sampleAudio,
} from './helpers.js';

test('health and config endpoints expose status without secrets', async () => {
  const config = makeConfig();
  const fetchImpl = mockGemini();
  try {
    await withServer(config, fetchImpl, async ({ base }) => {
      const health = await getJson(base, '/api/health');
      assert.equal(health.response.status, 200);
      assert.equal(health.body.ok, true);
      assert.equal(health.body.ai.configured, true);
      assert.equal(health.body.ai.provider, 'gemini');
      assert.equal(health.body.storage.persistent, true);

      const configRes = await getJson(base, '/api/config');
      assert.equal(configRes.response.status, 200);
      assert.equal(configRes.body.products.length, 4);
      assert.equal(configRes.body.languages.length, 2);
      assert.equal(configRes.body.salesStatuses.length, 6);
      assert.equal(configRes.body.ai.configured, true);

      const raw = JSON.stringify(health.body) + JSON.stringify(configRes.body);
      assert.ok(!raw.includes('test-gemini-key'), 'API key must never be returned to the browser');
      assert.equal(configRes.response.headers.get('x-content-type-options'), 'nosniff');
      assert.match(configRes.response.headers.get('content-security-policy') || '', /default-src 'self'/);
    });
  } finally {
    cleanupConfig(config);
  }
});

test('full call lifecycle: start, reply, end, summary, history, recording, delete', async () => {
  const config = makeConfig();
  const fetchImpl = mockGemini();
  try {
    await withServer(config, fetchImpl, async ({ base }) => {
      // 1) Start the call — a real AI greeting is generated and persisted.
      const started = await postJson(base, '/api/calls', {
        productId: 'flowpilot',
        language: 'en',
        consentRecording: true,
      });
      assert.equal(started.response.status, 201);
      assert.ok(started.body.greeting, 'greeting is returned');
      assert.equal(started.body.call.messages.length, 1);
      const callId = started.body.call.id;
      assert.match(callId, /^[0-9a-f-]{36}$/);

      // 2) Duplicate sessions must be rejected while one is active.
      const duplicate = await postJson(base, '/api/calls', {
        productId: 'flowpilot',
        language: 'en',
        consentRecording: false,
      });
      assert.equal(duplicate.response.status, 409);
      assert.equal(duplicate.body.error.code, 'CONFLICT');

      const active = await getJson(base, '/api/calls/active');
      assert.equal(active.body.call.id, callId);

      // 3) Customer asks a real question; the model answers.
      const reply = await postJson(base, `/api/calls/${callId}/reply`, {
        message: 'How much does FlowPilot cost for a team of 15?',
      });
      assert.equal(reply.response.status, 200);
      assert.match(reply.body.assistantMessage.content, /\$19 per user/);
      assert.equal(reply.body.customerMessage.role, 'customer');

      // 4) A failed reply keeps the customer turn and reports the error.
      const missing = await postJson(base, `/api/calls/${callId}/reply`, { message: '' });
      assert.equal(missing.response.status, 400);
      assert.equal(missing.body.error.code, 'VALIDATION_ERROR');

      // 5) Upload the recorded audio, then verify playback + range streaming.
      const audio = sampleAudio(4096);
      const upload = await fetch(`${base}/api/calls/${callId}/recording`, {
        method: 'POST',
        headers: { 'content-type': 'audio/webm;codecs=opus' },
        body: audio,
      });
      assert.equal(upload.status, 201);
      const uploadBody = await upload.json();
      assert.equal(uploadBody.recording.bytes, 4096);

      const playback = await fetch(`${base}/api/calls/${callId}/recording`);
      assert.equal(playback.status, 200);
      assert.match(playback.headers.get('content-type'), /audio\/webm/);
      assert.equal(playback.headers.get('accept-ranges'), 'bytes');
      assert.equal((await playback.arrayBuffer()).byteLength, 4096);

      const partial = await fetch(`${base}/api/calls/${callId}/recording`, {
        headers: { range: 'bytes=0-1023' },
      });
      assert.equal(partial.status, 206);
      assert.equal(partial.headers.get('content-range'), 'bytes 0-1023/4096');
      assert.equal(partial.headers.get('content-length'), '1024');

      const suffix = await fetch(`${base}/api/calls/${callId}/recording`, {
        headers: { range: 'bytes=-512' },
      });
      assert.equal(suffix.status, 206);
      assert.equal(suffix.headers.get('content-range'), 'bytes 3584-4095/4096');

      const invalidRange = await fetch(`${base}/api/calls/${callId}/recording`, {
        headers: { range: 'bytes=999999-' },
      });
      assert.equal(invalidRange.status, 416);

      // 6) End the call: duration + AI summary + automatic classification.
      const ended = await postJson(base, `/api/calls/${callId}/end`, { durationSeconds: 95 });
      assert.equal(ended.response.status, 200);
      const call = ended.body.call;
      assert.equal(call.status, 'Interested');
      assert.equal(call.durationSeconds, 95);
      assert.ok(call.endedAt);
      assert.equal(call.summary.classificationSource, 'ai');
      assert.deepEqual(call.summary.customerRequirements, ['Automate approvals for a 15-person operations team']);
      assert.equal(call.recording.available, true);

      const secondEnd = await postJson(base, `/api/calls/${callId}/end`, {});
      assert.equal(secondEnd.response.status, 200);
      assert.equal(secondEnd.body.alreadyEnded, true);

      // 7) History persists the transcript, summary, recording and status.
      const history = await getJson(base, '/api/calls');
      assert.equal(history.body.count, 1);
      assert.equal(history.body.calls[0].status, 'Interested');
      assert.equal(history.body.calls[0].recording.available, true);
      assert.equal(history.body.stats.total, 1);
      assert.equal(history.body.stats.recorded, 1);

      const filtered = await getJson(base, '/api/calls?status=Interested');
      assert.equal(filtered.body.count, 1);
      const notMatching = await getJson(base, '/api/calls?status=Converted');
      assert.equal(notMatching.body.count, 0);

      const searched = await getJson(base, '/api/calls?search=approvals');
      assert.equal(searched.body.count, 0, 'search matches transcript text, not the summary');
      const searchedTranscript = await getJson(base, '/api/calls?search=FlowPilot%20cost');
      assert.equal(searchedTranscript.body.count, 1);

      const detail = await getJson(base, `/api/calls/${callId}`);
      assert.equal(detail.body.call.messages.length, 3);

      // 8) Regenerating the summary keeps the call valid.
      const regenerated = await postJson(base, `/api/calls/${callId}/summary`, {});
      assert.equal(regenerated.response.status, 200);
      assert.equal(regenerated.body.call.status, 'Interested');

      // 9) Export contains transcripts and never secrets.
      const exported = await getJson(base, '/api/export');
      assert.equal(exported.response.status, 200);
      assert.equal(exported.body.count, 1);
      assert.equal(exported.body.calls[0].messages.length, 3);
      assert.ok(!JSON.stringify(exported.body).includes('test-gemini-key'));

      // 10) Delete removes DB rows and the audio file.
      const recordingFile = fs.readdirSync(config.dataDir + '/recordings');
      assert.equal(recordingFile.length, 1);
      const deleted = await fetch(`${base}/api/calls/${callId}`, { method: 'DELETE' });
      assert.equal(deleted.status, 200);
      assert.equal(fs.readdirSync(path.join(config.dataDir, 'recordings')).length, 0);
      const gone = await getJson(base, `/api/calls/${callId}`);
      assert.equal(gone.response.status, 404);
    });
  } finally {
    cleanupConfig(config);
  }
});

test('AI failures are reported with real error codes and the customer turn is kept', async () => {
  const config = makeConfig();
  const fetchImpl = mockGemini({ failWith: { status: 401, message: 'API key not valid' } });
  try {
    await withServer(config, fetchImpl, async ({ base }) => {
      const started = await postJson(base, '/api/calls', { productId: 'teamsync', language: 'en' });
      assert.equal(started.response.status, 201);
      assert.equal(started.body.greeting, null);
      assert.equal(started.body.greetingError.code, 'AI_AUTH_ERROR');
      const callId = started.body.call.id;

      const reply = await postJson(base, `/api/calls/${callId}/reply`, { message: 'Hello?' });
      assert.equal(reply.response.status, 502);
      assert.equal(reply.body.error.code, 'AI_AUTH_ERROR');
      assert.match(reply.body.error.message, /rejected the credential/);
      assert.equal(reply.body.customerMessage.content, 'Hello?');

      const detail = await getJson(base, `/api/calls/${callId}`);
      assert.equal(detail.body.call.messages.length, 1, 'customer message is persisted even when the model fails');
      assert.equal(detail.body.call.summary, null);

      // Retry endpoint reports the same provider error rather than a fake reply.
      const retry = await postJson(base, `/api/calls/${callId}/retry`, {});
      assert.equal(retry.response.status, 502);
    });
  } finally {
    cleanupConfig(config);
  }
});

test('a call with no customer speech ends as No Response without calling the model', async () => {
  const config = makeConfig();
  const fetchImpl = mockGemini();
  try {
    await withServer(config, fetchImpl, async ({ base }) => {
      const started = await postJson(base, '/api/calls', { productId: 'insightiq', language: 'en' });
      const callId = started.body.call.id;
      const callsBefore = fetchImpl.calls.length;
      const ended = await postJson(base, `/api/calls/${callId}/end`, { durationSeconds: 8 });
      assert.equal(ended.response.status, 200);
      assert.equal(ended.body.call.status, 'No Response');
      assert.equal(ended.body.call.summary.classificationSource, 'no-conversation');
      assert.equal(ended.body.call.summary.interestLevel, 'None');
      assert.equal(fetchImpl.calls.length, callsBefore, 'no AI summary call is made without a transcript');
    });
  } finally {
    cleanupConfig(config);
  }
});

test('server refuses to start calls when no AI key is configured', async () => {
  const config = makeConfig({ GEMINI_API_KEY: '', OPENAI_API_KEY: '' });
  try {
    await withServer(config, mockGemini(), async ({ base }) => {
      const health = await getJson(base, '/api/health');
      assert.equal(health.body.ai.configured, false);
      const start = await postJson(base, '/api/calls', { productId: 'flowpilot', language: 'en' });
      assert.equal(start.response.status, 503);
      assert.equal(start.body.error.code, 'AI_NOT_CONFIGURED');
      assert.match(start.body.error.message, /GEMINI_API_KEY/);
    });
  } finally {
    cleanupConfig(config);
  }
});

test('recording consent and validation rules are enforced by the API', async () => {
  const config = makeConfig();
  try {
    await withServer(config, mockGemini(), async ({ base }) => {
      // A call without consent may not store audio.
      const started = await postJson(base, '/api/calls', {
        productId: 'clouddesk',
        language: 'hi',
        consentRecording: false,
      });
      assert.equal(started.body.call.consentRecording, false);
      const callId = started.body.call.id;

      const noConsent = await fetch(`${base}/api/calls/${callId}/recording`, {
        method: 'POST',
        headers: { 'content-type': 'audio/webm' },
        body: sampleAudio(),
      });
      assert.equal(noConsent.status, 409);
      assert.match((await noConsent.json()).error.message, /consent/i);

      const tooLong = await postJson(base, `/api/calls/${callId}/reply`, { message: 'x'.repeat(2500) });
      assert.equal(tooLong.response.status, 400);

      const badLang = await postJson(base, '/api/calls', { productId: 'clouddesk', language: 'fr' });
      assert.equal(badLang.response.status, 400);
      assert.match(badLang.body.error.message, /language must be one of/);

      const badProduct = await postJson(base, '/api/calls', { productId: 'unknown-product', language: 'en' });
      assert.equal(badProduct.response.status, 400);
      assert.equal(badProduct.body.error.code, 'VALIDATION_ERROR');

      const badUuid = await getJson(base, '/api/calls/not-a-uuid');
      assert.equal(badUuid.response.status, 400);

      const badJson = await fetch(`${base}/api/calls/${callId}/reply`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{oops',
      });
      assert.equal(badJson.status, 400);

      const unknownRoute = await getJson(base, '/api/nope');
      assert.equal(unknownRoute.response.status, 404);

      const endActive = await postJson(base, `/api/calls/${callId}/end`, {});
      assert.equal(endActive.response.status, 200);
      assert.equal(endActive.body.call.status, 'No Response');

      // A consented call rejects non-audio payloads.
      const consented = await postJson(base, '/api/calls', {
        productId: 'clouddesk',
        language: 'hi',
        consentRecording: true,
      });
      const badType = await fetch(`${base}/api/calls/${consented.body.call.id}/recording`, {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: sampleAudio(),
      });
      assert.equal(badType.status, 415);
      const tiny = await fetch(`${base}/api/calls/${consented.body.call.id}/recording`, {
        method: 'POST',
        headers: { 'content-type': 'audio/webm' },
        body: new Uint8Array(10),
      });
      assert.equal(tiny.status, 400);
    });
  } finally {
    cleanupConfig(config);
  }
});

test('deleting and exporting are protected when ADMIN_TOKEN is configured', async () => {
  const config = makeConfig({ ADMIN_TOKEN: 'super-secret-token' });
  try {
    await withServer(config, mockGemini(), async ({ base }) => {
      const started = await postJson(base, '/api/calls', { productId: 'flowpilot', language: 'en' });
      const callId = started.body.call.id;
      await postJson(base, `/api/calls/${callId}/end`, {});

      const deniedExport = await getJson(base, '/api/export');
      assert.equal(deniedExport.response.status, 401);

      const allowedExport = await fetch(`${base}/api/export`, {
        headers: { 'x-admin-token': 'super-secret-token' },
      });
      assert.equal(allowedExport.status, 200);

      const deniedDelete = await fetch(`${base}/api/calls/${callId}`, { method: 'DELETE' });
      assert.equal(deniedDelete.status, 401);

      const allowedDelete = await fetch(`${base}/api/calls/${callId}`, {
        method: 'DELETE',
        headers: { 'x-admin-token': 'super-secret-token' },
      });
      assert.equal(allowedDelete.status, 200);
    });
  } finally {
    cleanupConfig(config);
  }
});

test('stale unfinished calls are automatically closed so new calls can start', async () => {
  const config = makeConfig({ ACTIVE_CALL_TTL_MINUTES: '1' });
  try {
    await withServer(config, mockGemini(), async ({ base, app }) => {
      const started = await postJson(base, '/api/calls', { productId: 'flowpilot', language: 'en' });
      const callId = started.body.call.id;

      // Backdate the active call to simulate an abandoned browser tab.
      app.store.db.prepare('UPDATE calls SET started_at = ? WHERE id = ?').run(
        new Date(Date.now() - 10 * 60_000).toISOString(),
        callId,
      );

      const active = await getJson(base, '/api/calls/active');
      assert.equal(active.body.call, null, 'stale call is closed on read');
      const ended = await getJson(base, `/api/calls/${callId}`);
      assert.equal(ended.body.call.status, 'No Response');
      assert.ok(ended.body.call.endedAt);

      const restart = await postJson(base, '/api/calls', { productId: 'flowpilot', language: 'en' });
      assert.equal(restart.response.status, 201);
    });
  } finally {
    cleanupConfig(config);
  }
});

test('static assets are served with security headers and traversal is blocked', async () => {
  const config = makeConfig();
  try {
    await withServer(config, mockGemini(), async ({ base }) => {
      const index = await fetch(`${base}/`);
      assert.equal(index.status, 200);
      assert.match(index.headers.get('content-type'), /text\/html/);
      const html = await index.text();
      assert.match(html, /Voxly/);
      assert.match(html, /id="startBtn"/);
      assert.match(html, /id="endBtn"/);
      assert.match(html, /id="consentCheck"/);
      assert.equal(index.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(index.headers.get('x-robots-tag'), 'noindex, nofollow');

      const appJs = await fetch(`${base}/app.js`);
      assert.equal(appJs.status, 200);
      assert.match(appJs.headers.get('content-type'), /javascript/);
      assert.ok(!(await appJs.text()).includes('GEMINI_API_KEY='), 'frontend bundle must not contain API keys');

      const traversal = await fetch(`${base}/%2e%2e%2f%2e%2e%2fetc%2fpasswd`);
      assert.equal(traversal.status, 404);
      const envFile = await fetch(`${base}/%2e%2e%2f.env`);
      assert.equal(envFile.status, 404);
      assert.ok(!(await envFile.text()).includes('GEMINI_API_KEY'));

      const spa = await fetch(`${base}/history`);
      assert.equal(spa.status, 200);
      assert.match(await spa.text(), /Voxly/);
    });
  } finally {
    cleanupConfig(config);
  }
});
