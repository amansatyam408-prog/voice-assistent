import { test, describe } from 'node:test';
import assert from 'node:assert';
import { guessSalesStatus, ALLOWED_STATUSES } from '../ai.js';

describe('Sales Classification & Status Mapping Tests', () => {
  test('should verify all 6 required statuses exist in allowed list', () => {
    const required = [
      'Converted',
      'Interested',
      'Follow-up Required',
      'Not Interested',
      'Demo Requested',
      'No Response'
    ];
    for (const r of required) {
      assert.ok(ALLOWED_STATUSES.includes(r), `Status ${r} must be allowed`);
    }
  });

  test('should classify empty transcript as "No Response"', () => {
    assert.strictEqual(guessSalesStatus([]), 'No Response');
    assert.strictEqual(guessSalesStatus([{ role: 'assistant', text: 'Hello!' }]), 'No Response');
  });

  test('should classify purchase confirmation as "Converted"', () => {
    const transcript = [
      { role: 'assistant', text: 'FlowPilot starts at $29/mo.' },
      { role: 'customer', text: 'Sounds great! I want to buy now, where do I sign up?' }
    ];
    assert.strictEqual(guessSalesStatus(transcript), 'Converted');

    const transcript2 = [
      { role: 'customer', text: "Let's do it, please send the contract." }
    ];
    assert.strictEqual(guessSalesStatus(transcript2), 'Converted');
  });

  test('should classify demo inquiry as "Demo Requested"', () => {
    const transcript = [
      { role: 'customer', text: 'Can someone show me a live demo tomorrow afternoon?' }
    ];
    assert.strictEqual(guessSalesStatus(transcript), 'Demo Requested');

    const transcript2 = [
      { role: 'customer', text: 'I would like a product walkthrough for my engineering team.' }
    ];
    assert.strictEqual(guessSalesStatus(transcript2), 'Demo Requested');
  });

  test('should classify deferral/contact request as "Follow-up Required"', () => {
    const transcript = [
      { role: 'customer', text: 'Please send me an email with the pricing sheet and call me back next week.' }
    ];
    assert.strictEqual(guessSalesStatus(transcript), 'Follow-up Required');

    const transcript2 = [
      { role: 'customer', text: 'I need to check with my boss first, follow up tomorrow.' }
    ];
    assert.strictEqual(guessSalesStatus(transcript2), 'Follow-up Required');
  });

  test('should classify rejection as "Not Interested"', () => {
    const transcript = [
      { role: 'customer', text: 'No thanks, we don’t need this right now. Please stop calling.' }
    ];
    assert.strictEqual(guessSalesStatus(transcript), 'Not Interested');

    const transcript2 = [
      { role: 'customer', text: 'I am not interested at all.' }
    ];
    assert.strictEqual(guessSalesStatus(transcript2), 'Not Interested');
  });

  test('should classify inquisitive questions as "Interested"', () => {
    const transcript = [
      { role: 'assistant', text: 'How can I help?' },
      { role: 'customer', text: 'Does FlowPilot integrate with Slack and Salesforce?' }
    ];
    assert.strictEqual(guessSalesStatus(transcript), 'Interested');
  });
});
