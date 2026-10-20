import assert from 'node:assert/strict';
import test from 'node:test';

import { generateReply, generateSummary, buildSystemPrompt } from '../lib/ai.js';
import { getProduct } from '../lib/products.js';
import { makeConfig, mockGemini, jsonResponse, geminiTextResponse } from './helpers.js';

const product = getProduct('flowpilot');

test('system prompt contains only verified product facts and language rules', () => {
  const prompt = buildSystemPrompt({ product, language: 'hi' });
  assert.match(prompt, /Hindi/);
  assert.match(prompt, /FlowPilot/);
  assert.match(prompt, /\$19 per user \/ month/);
  assert.match(prompt, /never invent/i);
  assert.match(prompt, /Never invent features, prices/i);
  assert.ok(!prompt.includes('offline demo'));
});

test('generateReply calls the real Gemini endpoint server-side and returns model text', async () => {
  const config = makeConfig();
  const fetchImpl = mockGemini({ reply: 'FlowPilot is $19 per user per month. How many people are on your team?' });
  const result = await generateReply({
    config,
    product,
    language: 'en',
    messages: [
      { role: 'assistant', content: 'Hello! What is your biggest operational bottleneck?' },
      { role: 'customer', content: 'How much is FlowPilot?' },
    ],
    fetchImpl,
  });

  assert.match(result.text, /\$19 per user/);
  assert.equal(result.provider, 'gemini');
  assert.equal(result.model, 'gemini-test');
  assert.equal(fetchImpl.calls.length, 1);
  const [call] = fetchImpl.calls;
  assert.match(call.url, /generativelanguage\.googleapis\.com/);
  assert.match(call.url, /models\/gemini-test:generateContent/);
  assert.match(call.url, /key=test-gemini-key/);
  assert.match(call.systemText, /Voxly/);
  assert.equal(call.body.contents.at(-1).role, 'user');
  assert.equal(call.body.contents.at(-1).parts[0].text, 'How much is FlowPilot?');
});

test('OAuth-style keys are sent as a bearer token instead of a query key', async () => {
  const config = makeConfig({ GEMINI_API_KEY: 'AQ.oauth-token' });
  const fetchImpl = mockGemini({ reply: 'Sure.' });
  await generateReply({ config, product, language: 'en', messages: [], fetchImpl });
  const [call] = fetchImpl.calls;
  assert.equal(call.headers.authorization, 'Bearer AQ.oauth-token');
  assert.ok(!call.url.includes('key='));
});

test('missing provider configuration fails loudly instead of faking a reply', async () => {
  const config = makeConfig({ GEMINI_API_KEY: '' });
  await assert.rejects(
    generateReply({ config, product, language: 'en', messages: [], fetchImpl: mockGemini() }),
    (error) => {
      assert.equal(error.code, 'AI_NOT_CONFIGURED');
      assert.equal(error.status, 503);
      assert.match(error.message, /GEMINI_API_KEY/);
      return true;
    },
  );
});

test('authentication failures surface as AI_AUTH_ERROR with the real status', async () => {
  const config = makeConfig();
  const fetchImpl = mockGemini({ failWith: { status: 401, message: 'API key not valid' } });
  await assert.rejects(
    generateReply({ config, product, language: 'en', messages: [], fetchImpl }),
    (error) => {
      assert.equal(error.code, 'AI_AUTH_ERROR');
      assert.equal(error.providerStatus, 401);
      assert.match(error.message, /rejected the API key/);
      return true;
    },
  );
});

test('rate limits surface as AI_RATE_LIMITED', async () => {
  const config = makeConfig();
  const fetchImpl = mockGemini({ failWith: { status: 429, message: 'quota exceeded' } });
  await assert.rejects(
    generateReply({ config, product, language: 'en', messages: [], fetchImpl }),
    (error) => {
      assert.equal(error.code, 'AI_RATE_LIMITED');
      assert.equal(error.status, 429);
      return true;
    },
  );
});

test('an unknown model falls back to the configured fallback model', async () => {
  const config = makeConfig({ GEMINI_MODEL: 'gemini-missing', GEMINI_FALLBACK_MODELS: 'gemini-working' });
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(url);
    if (url.includes('gemini-missing')) return jsonResponse({ error: { message: 'model not found' } }, 404);
    return geminiTextResponse('Fallback model reply.');
  };
  const result = await generateReply({ config, product, language: 'en', messages: [], fetchImpl });
  assert.equal(result.text, 'Fallback model reply.');
  assert.equal(result.model, 'gemini-working');
  assert.equal(seen.length, 2);
});

test('network failures report a clear, non-retryable-looking error', async () => {
  const config = makeConfig();
  let attempts = 0;
  const fetchImpl = async () => {
    attempts += 1;
    throw new TypeError('fetch failed');
  };
  await assert.rejects(
    generateReply({ config, product, language: 'en', messages: [], fetchImpl }),
    (error) => {
      assert.equal(error.code, 'AI_NETWORK_ERROR');
      assert.match(error.message, /Could not reach Gemini/);
      return true;
    },
  );
  assert.equal(attempts, 2, 'network failures are retried exactly once');
});

test('empty or blocked model responses are reported, not hidden', async () => {
  const config = makeConfig();
  const fetchImpl = async () => jsonResponse({ candidates: [{ finishReason: 'SAFETY' }] });
  await assert.rejects(
    generateReply({ config, product, language: 'en', messages: [], fetchImpl }),
    (error) => {
      assert.equal(error.code, 'AI_EMPTY_RESPONSE');
      assert.match(error.message, /SAFETY/);
      return true;
    },
  );
});

test('generateSummary sends the real transcript and returns a grounded summary', async () => {
  const config = makeConfig();
  const fetchImpl = mockGemini();
  const messages = [
    { role: 'assistant', content: 'Which process is slowest today?' },
    { role: 'customer', content: 'Approvals take three days. How much for 15 people?' },
  ];
  const result = await generateSummary({ config, product, language: 'en', messages, fetchImpl });
  assert.equal(result.status, 'Interested');
  assert.equal(result.statusSource, 'ai');
  assert.equal(result.summary.interestLevel, 'High');
  assert.deepEqual(result.summary.customerRequirements, ['Automate approvals for a 15-person operations team']);

  const [call] = fetchImpl.calls;
  assert.match(call.systemText, /sales operations analyst/);
  assert.match(call.body.contents[0].parts[0].text, /Approvals take three days/);
  assert.equal(call.body.generationConfig.responseMimeType, 'application/json');
});

test('generateSummary handles a JSON response wrapped in markdown fences', async () => {
  const config = makeConfig();
  const fetchImpl = async () =>
    geminiTextResponse('```json\n{"summary":"Fenced","customerRequirements":[],"questionsAsked":[],"objections":[],"interestLevel":"Low","interestReason":"x","nextSteps":[],"status":"Follow-up Required"}\n```');
  const result = await generateSummary({
    config,
    product,
    language: 'en',
    messages: [{ role: 'customer', content: 'Send me a brochure.' }],
    fetchImpl,
  });
  assert.equal(result.summary.summary, 'Fenced');
  assert.equal(result.status, 'Follow-up Required');
});

test('generateSummary rejects non-JSON model output', async () => {
  const config = makeConfig();
  const fetchImpl = async () => geminiTextResponse('I think they are interested.');
  await assert.rejects(
    generateSummary({
      config,
      product,
      language: 'en',
      messages: [{ role: 'customer', content: 'Hello' }],
      fetchImpl,
    }),
    (error) => {
      assert.equal(error.code, 'AI_BAD_SUMMARY_JSON');
      return true;
    },
  );
});

test('generateSummary never calls the provider when the customer never spoke', async () => {
  const config = makeConfig();
  const fetchImpl = mockGemini();
  const result = await generateSummary({
    config,
    product,
    language: 'en',
    messages: [{ role: 'assistant', content: 'Hello, are you there?' }],
    fetchImpl,
  });
  assert.equal(result.status, 'No Response');
  assert.equal(fetchImpl.calls.length, 0);
  assert.deepEqual(result.summary.customerRequirements, []);
});

test('summary supports Hindi call transcripts', async () => {
  const config = makeConfig();
  const fetchImpl = mockGemini({
    summary: {
      summary: 'ग्राहक ने कीमत पूछी।',
      customerRequirements: ['कीमत जानना'],
      questionsAsked: ['कीमत क्या है?'],
      objections: [],
      interestLevel: 'Medium',
      interestReason: 'कीमत पूछी',
      nextSteps: ['ईमेल पर कोटेशन भेजें'],
      status: 'Follow-up Required',
    },
  });
  const result = await generateSummary({
    config,
    product,
    language: 'hi',
    messages: [{ role: 'customer', content: 'कीमत क्या है?' }],
    fetchImpl,
  });
  assert.equal(result.status, 'Follow-up Required');
  assert.match(result.summary.summary, /कीमत/);
  const [call] = fetchImpl.calls;
  assert.match(call.systemText, /Hindi \(Devanagari script\)/);
});
