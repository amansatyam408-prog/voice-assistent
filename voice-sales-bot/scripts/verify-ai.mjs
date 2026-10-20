#!/usr/bin/env node
/**
 * Live AI connectivity check.
 *
 * Run this on a machine with outbound internet access and a real API key:
 *   npm run verify:ai
 *
 * It performs two real model calls (one sales reply, one grounded summary) and
 * prints pass/fail details. It never prints the API key.
 */
import path from 'node:path';
import { loadConfig, loadEnvFile, describeAi } from '../lib/config.js';
import { getProduct } from '../lib/products.js';
import { generateReply, generateSummary } from '../lib/ai.js';

const envFile = path.resolve(import.meta.dirname, '..', '..', '.env');
const fromFile = loadEnvFile(envFile);
for (const [key, value] of Object.entries(fromFile)) {
  if (!process.env[key]) process.env[key] = value;
}

const config = loadConfig(process.env);
const ai = describeAi(config);
console.log(`Provider : ${ai.provider}`);
console.log(`Model    : ${ai.model || '—'}`);
console.log(`Fallbacks: ${ai.fallbackModels?.join(', ') || '—'}`);

if (!ai.configured) {
  console.error('\nFAIL: no AI provider configured. Set GEMINI_API_KEY or OPENAI_API_KEY in .env and retry.');
  process.exit(1);
}

const product = getProduct('flowpilot');
const transcript = [
  { role: 'assistant', content: 'Thanks for taking my call. What slows your team down today?' },
  { role: 'customer', content: 'Approvals take three days and we have 15 people. What does FlowPilot cost and can I see a demo?' },
];

let failures = 0;

try {
  const started = Date.now();
  const reply = await generateReply({
    config,
    product,
    language: 'en',
    messages: transcript,
  });
  console.log(`\n[1/2] Sales reply OK in ${Date.now() - started} ms (${reply.model})`);
  console.log(`      "${reply.text}"`);
} catch (error) {
  failures += 1;
  console.error(`\n[1/2] Sales reply FAILED: ${error.code || 'AI_ERROR'} — ${error.message}`);
}

try {
  const started = Date.now();
  const summary = await generateSummary({ config, product, language: 'en', messages: transcript });
  console.log(`\n[2/2] Summary OK in ${Date.now() - started} ms`);
  console.log(`      status: ${summary.status} (source: ${summary.statusSource})`);
  console.log(`      interest: ${summary.summary.interestLevel}`);
  console.log(`      requirements: ${summary.summary.customerRequirements.join('; ') || '—'}`);
} catch (error) {
  failures += 1;
  console.error(`\n[2/2] Summary FAILED: ${error.code || 'AI_ERROR'} — ${error.message}`);
}

if (failures) {
  console.error(`\n${failures} live AI check(s) failed.`);
  process.exit(1);
}
console.log('\nAll live AI checks passed. Your key, model and network path are working.');
