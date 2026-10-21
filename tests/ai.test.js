import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  SAAS_PRODUCTS,
  generateSalesReply,
  generateCallSummary,
  getAiConfig
} from '../ai.js';

describe('AI Sales Engine & Summary Extraction Tests', () => {
  test('should verify SaaS product knowledge catalog', () => {
    assert.ok('FlowPilot' in SAAS_PRODUCTS);
    assert.ok('CloudDesk' in SAAS_PRODUCTS);
    assert.ok('TeamSync' in SAAS_PRODUCTS);
    assert.ok('Custom SaaS' in SAAS_PRODUCTS);

    const fp = SAAS_PRODUCTS.FlowPilot;
    assert.ok(fp.features.length >= 3);
    assert.ok(fp.pricing.starter.includes('$29'));
    assert.ok(fp.pricing.pro.includes('$79'));
  });

  test('should generate simulated sales reply with clear simulation notice when no key', async () => {
    const originalKey = process.env.GEMINI_API_KEY;
    try {
      process.env.GEMINI_API_KEY = '';
      const res = await generateSalesReply({
        message: 'What is the price of FlowPilot?',
        product: 'FlowPilot',
        language: 'English'
      });

      assert.ok(res.reply.length > 10);
      assert.strictEqual(res.isSimulated, true);
      assert.strictEqual(res.source, 'offline_simulation');
      assert.ok(res.notice.includes('Offline simulation mode'));
    } finally {
      process.env.GEMINI_API_KEY = originalKey;
    }
  });

  test('should generate Hindi sales reply appropriately in simulation', async () => {
    const originalKey = process.env.GEMINI_API_KEY;
    try {
      process.env.GEMINI_API_KEY = '';
      const res = await generateSalesReply({
        message: 'कीमत क्या है?',
        product: 'FlowPilot',
        language: 'Hindi'
      });

      assert.ok(res.reply.length > 5);
      assert.strictEqual(res.source, 'offline_simulation');
      assert.ok(/[\u0900-\u097F]/.test(res.reply));
    } finally {
      process.env.GEMINI_API_KEY = originalKey;
    }
  });

  test('should generate call summary containing ALL 5 required fields + classification', async () => {
    const transcript = [
      { role: 'assistant', text: 'Hi! How can FlowPilot assist your operations?' },
      { role: 'customer', text: 'We have 20 people and want to automate our manual invoicing tasks. But is it secure and compliant?' },
      { role: 'assistant', text: 'FlowPilot is SOC-2 Type II and GDPR certified with 256-bit AES encryption.' },
      { role: 'customer', text: 'What is the pricing for a team of 20? Can we schedule a demo?' }
    ];

    const summary = await generateCallSummary({
      transcript,
      product: 'FlowPilot'
    });

    // Check all 5 required fields from assignment requirements
    assert.ok(typeof summary.summary === 'string', 'Summary must be present');
    assert.ok(Array.isArray(summary.requirements), 'Requirements must be an array');
    assert.ok(Array.isArray(summary.questionsAsked), 'Questions asked must be an array');
    assert.ok(Array.isArray(summary.objections), 'Objections must be an array');
    assert.ok(typeof summary.customerInterest === 'string', 'Customer interest must be evaluated');
    assert.ok(Array.isArray(summary.nextSteps), 'Next steps must be an array');
    assert.strictEqual(summary.status, 'Demo Requested', 'Status must be accurately classified');

    // Verify questions was captured
    assert.ok(summary.questionsAsked.length >= 1);
    // Verify objections is properly extracted as an array
    assert.ok(Array.isArray(summary.objections));
  });

  test('should return empty intelligence gracefully for zero customer turns', async () => {
    const summary = await generateCallSummary({
      transcript: [{ role: 'assistant', text: 'Hello?' }],
      product: 'FlowPilot'
    });

    assert.strictEqual(summary.status, 'No Response');
    assert.strictEqual(summary.requirements.length, 0);
  });
});
