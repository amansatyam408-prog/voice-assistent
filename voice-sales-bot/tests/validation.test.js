import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeStatus,
  assertLanguage,
  assertUuid,
  assertString,
  parseJsonBody,
  clampInt,
  SALES_STATUSES,
} from '../lib/validation.js';
import { classifyFromTranscript, normalizeSummary } from '../lib/ai.js';
import { loadConfig, describeAi } from '../lib/config.js';
import { getProduct, PRODUCTS, publicProducts } from '../lib/products.js';

const customer = (content) => ({ role: 'customer', content });
const assistant = (content) => ({ role: 'assistant', content });

test('all six official statuses normalize from messy model output', () => {
  assert.equal(normalizeStatus('Converted'), 'Converted');
  assert.equal(normalizeStatus('interested'), 'Interested');
  assert.equal(normalizeStatus('DEMO REQUESTED'), 'Demo Requested');
  assert.equal(normalizeStatus('follow_up_required'), 'Follow-up Required');
  assert.equal(normalizeStatus('Follow up'), 'Follow-up Required');
  assert.equal(normalizeStatus('Not  Interested'), 'Not Interested');
  assert.equal(normalizeStatus('no response'), 'No Response');
  assert.equal(normalizeStatus('Customer is angry'), null);
  assert.equal(normalizeStatus(undefined), null);
  assert.deepEqual(Object.keys(SALES_STATUSES.reduce((acc, s) => ({ ...acc, [s]: 1 }), {})), SALES_STATUSES);
  assert.equal(SALES_STATUSES.length, 6);
});

test('keyword classifier maps transcripts to the six statuses', () => {
  const cases = [
    [['I will take it, send me the invoice.'], 'Converted'],
    [['No thanks, we are not interested.'], 'Not Interested'],
    [['Can you arrange a demo for my team?'], 'Demo Requested'],
    [['Please email me a quote and call me later.'], 'Follow-up Required'],
    [['Interesting, tell me more about the integrations.'], 'Interested'],
    [['मुझे डेमो चाहिए'], 'Demo Requested'],
    [['हमें ज़रूरत नहीं है'], 'Not Interested'],
    [['मुझे खरीदना है, इनवॉइस भेजें'], 'Converted'],
  ];
  for (const [messages, expected] of cases) {
    const result = classifyFromTranscript(messages.map(customer));
    assert.equal(result.status, expected, `expected ${expected} for "${messages[0]}"`);
  }
});

test('classifier reports No Response when the customer never spoke', () => {
  assert.equal(classifyFromTranscript([]).status, 'No Response');
  assert.equal(classifyFromTranscript([assistant('Hello?')]).status, 'No Response');
});

test('summary normalization enforces the six statuses and blocks invented conversions', () => {
  const messages = [assistant('Hello'), customer('Tell me more about pricing please.')];
  const result = normalizeSummary(
    {
      summary: 'Customer asked about pricing.',
      customerRequirements: ['Understand pricing'],
      questionsAsked: ['What is the price?'],
      objections: [],
      interestLevel: 'Medium',
      interestReason: 'Asked about price.',
      nextSteps: [],
      status: 'Converted',
    },
    messages,
  );
  assert.notEqual(result.status, 'Converted', 'no purchase signal means Converted must be downgraded');
  assert.equal(result.statusSource, 'rules');
  assert.equal(result.adjusted, true);
  assert.equal(result.summary.status, result.status);

  const unknown = normalizeSummary({ status: 'something-else', summary: 'x' }, messages);
  assert.ok(SALES_STATUSES.includes(unknown.status));
  assert.equal(unknown.statusSource, 'rules');

  const noCustomer = normalizeSummary({ status: 'Converted' }, [assistant('Hello?')]);
  assert.equal(noCustomer.status, 'No Response');
  assert.equal(noCustomer.statusSource, 'no-conversation');
  assert.deepEqual(noCustomer.summary.customerRequirements, []);
});

test('summary normalization sanitizes malformed fields', () => {
  const result = normalizeSummary(
    {
      summary: 42,
      customerRequirements: 'not-an-array',
      questionsAsked: [null, { question: 'What is SSO?' }, 'Is it secure?'],
      objections: ['price'],
      interestLevel: 'Extremely high',
      nextSteps: ['Send quote'],
      status: 'Interested',
    },
    [customer('Is it secure?')],
  );
  assert.equal(typeof result.summary.summary, 'string');
  assert.deepEqual(result.summary.customerRequirements, []);
  assert.deepEqual(result.summary.questionsAsked, ['What is SSO?', 'Is it secure?']);
  assert.equal(result.summary.interestLevel, 'Medium');
  assert.equal(result.status, 'Interested');
  assert.equal(result.statusSource, 'ai');
});

test('input validators reject bad data', () => {
  assert.throws(() => assertUuid('../../etc/passwd'), /valid call id/);
  assert.throws(() => assertUuid('123'), /valid call id/);
  assert.equal(assertUuid('11111111-1111-4111-8111-111111111111'), '11111111-1111-4111-8111-111111111111');

  assert.throws(() => assertLanguage('fr'), /language must be one of/);
  assert.equal(assertLanguage('hi'), 'hi');

  assert.throws(() => assertString('', 'message', { min: 1 }), /too short/);
  assert.throws(() => assertString('x'.repeat(11), 'message', { max: 10 }), /at most 10/);
  assert.throws(() => assertString({}, 'message'), /must be text/);
  assert.equal(assertString('  hi  ', 'message'), 'hi');

  assert.throws(() => parseJsonBody('{bad json', 1024), /valid JSON/);
  assert.throws(() => parseJsonBody('[]', 1024), /JSON object/);
  assert.throws(() => parseJsonBody('{"a":1}', 3), /too large/);
  assert.deepEqual(parseJsonBody('', 1024), {});

  assert.equal(clampInt('500', 0, { min: 0, max: 100 }), 100);
  assert.equal(clampInt('abc', 7, { min: 0, max: 100 }), 7);
});

test('config selects providers and never exposes secrets', () => {
  const gemini = loadConfig({ GEMINI_API_KEY: 'AIzaTESTKEY', GEMINI_MODEL: 'gemini-2.5-flash', ALLOW_OFFLINE_DEMO: 'true' }, { projectRoot: '/tmp' });
  assert.equal(gemini.ai.provider, 'gemini');
  assert.equal(gemini.ai.gemini.authMode, 'auto');
  const described = JSON.stringify(describeAi(gemini));
  assert.ok(!described.includes('AIzaTESTKEY'), 'describeAi must not leak the API key');
  assert.equal(describeAi(gemini).configured, true);

  const autoAuth = loadConfig({ GEMINI_API_KEY: 'AQ.some-token' }, { projectRoot: '/tmp' });
  assert.equal(autoAuth.ai.gemini.authMode, 'auto', 'auth style is auto-detected at request time');
  const pinned = loadConfig({ GEMINI_API_KEY: 'AQ.some-token', GEMINI_AUTH_MODE: 'bearer' }, { projectRoot: '/tmp' });
  assert.equal(pinned.ai.gemini.authMode, 'bearer');

  const openai = loadConfig({ OPENAI_API_KEY: 'sk-test' }, { projectRoot: '/tmp' });
  assert.equal(openai.ai.provider, 'openai');

  const none = loadConfig({}, { projectRoot: '/tmp' });
  assert.equal(none.ai.provider, 'none');
  assert.equal(describeAi(none).configured, false);

  const explicit = loadConfig({ GEMINI_API_KEY: 'x', OPENAI_API_KEY: 'y', AI_PROVIDER: 'openai' }, { projectRoot: '/tmp' });
  assert.equal(explicit.ai.provider, 'openai');
});

test('storage mode is detected and reported for serverless deployments', () => {
  const local = loadConfig({ GEMINI_API_KEY: 'x', DATA_DIR: './voice-sales-bot/data' }, { projectRoot: '/app' });
  assert.equal(local.storage.ephemeral, false);
  assert.equal(local.storage.platform, 'node');

  const vercel = loadConfig({ GEMINI_API_KEY: 'x', VERCEL: '1', DATA_DIR: '/tmp/voxly-data' }, { projectRoot: '/app' });
  assert.equal(vercel.storage.ephemeral, true);
  assert.equal(vercel.storage.platform, 'serverless');

  const tmpOnly = loadConfig({ GEMINI_API_KEY: 'x', DATA_DIR: '/tmp/anything' }, { projectRoot: '/app' });
  assert.equal(tmpOnly.storage.ephemeral, true);
});

test('product knowledge base is complete and public view hides internals', () => {
  assert.ok(PRODUCTS.length >= 4);
  for (const product of PRODUCTS) {
    assert.ok(product.pricing.length >= 2);
    assert.ok(product.features.length >= 3);
    assert.ok(product.objections.length >= 1);
    assert.ok(product.policies.trial);
  }
  const publicList = publicProducts();
  assert.ok(publicList.every((product) => !('pricing' in product) && !('policies' in product)));
  assert.equal(getProduct('flowpilot').name, 'FlowPilot');
  assert.equal(getProduct('nope'), null);
});
