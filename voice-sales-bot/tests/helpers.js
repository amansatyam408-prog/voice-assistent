import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

import { createApp } from '../server.js';
import { loadConfig } from '../lib/config.js';

export const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
export const PUBLIC_DIR = path.join(REPO_ROOT, 'voice-sales-bot', 'public');

/** Build a config with an isolated temporary data directory. */
export function makeConfig(envOverrides = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'voxly-test-'));
  const env = {
    GEMINI_API_KEY: 'test-gemini-key',
    GEMINI_MODEL: 'gemini-test',
    GEMINI_FALLBACK_MODELS: '',
    AI_TIMEOUT_MS: '5000',
    AI_REQUESTS_PER_MINUTE: '600',
    ...envOverrides,
  };
  const config = loadConfig(env, { projectRoot: tmp });
  config.publicDir = PUBLIC_DIR;
  config.__tmp = tmp;
  return config;
}

export function cleanupConfig(config) {
  try {
    fs.rmSync(config.__tmp, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

export function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export function geminiTextResponse(text) {
  return jsonResponse({ candidates: [{ content: { parts: [{ text }] } }] });
}

/**
 * Mock Gemini transport. Returns realistic provider payloads and records calls.
 */
export function mockGemini({ reply = 'FlowPilot starts at $19 per user per month. How large is your team?', summary = null, failWith = null } = {}) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : {};
    const systemText = body.systemInstruction?.parts?.[0]?.text || '';
    calls.push({ url, body, systemText, headers: options.headers });

    if (typeof failWith === 'function') {
      const failure = failWith({ url, body, systemText, calls });
      if (failure) return failure;
    }
    if (failWith && typeof failWith === 'object') {
      return jsonResponse({ error: { message: failWith.message || 'provider error' } }, failWith.status || 500);
    }

    const isSummary = /sales operations analyst/i.test(systemText);
    if (isSummary) {
      return geminiTextResponse(
        JSON.stringify(
          summary || {
            summary: 'The customer asked about pricing for a 15-person team and showed interest in a trial.',
            customerRequirements: ['Automate approvals for a 15-person operations team'],
            questionsAsked: ['How much does FlowPilot cost for a team of 15?'],
            objections: ['Budget needs manager approval'],
            interestLevel: 'High',
            interestReason: 'The customer asked about pricing and a trial.',
            nextSteps: ['Send a trial link and a written quote'],
            status: 'Interested',
          },
        ),
      );
    }
    return geminiTextResponse(reply);
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

export async function withServer(config, fetchImpl, fn) {
  const app = createApp(config, { fetchImpl });
  const server = http.createServer(app.handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    return await fn({ base, app, server });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    app.store.close();
  }
}

export async function postJson(base, pathname, body) {
  const response = await fetch(`${base}${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  return { response, body: await response.json().catch(() => null) };
}

export async function getJson(base, pathname) {
  const response = await fetch(`${base}${pathname}`);
  return { response, body: await response.json().catch(() => null) };
}

export function sampleAudio(size = 2048) {
  return new Uint8Array(size).fill(7);
}
