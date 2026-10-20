import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { createDatabase } from '../lib/db.js';
import { makeConfig, cleanupConfig } from './helpers.js';

function freshDb() {
  const config = makeConfig();
  const store = createDatabase({ dataDir: config.dataDir });
  return { config, store };
}

test('database creates schema, stores a call and messages in SQLite', () => {
  const { config, store } = freshDb();
  try {
    assert.ok(fs.existsSync(store.dbPath), 'SQLite file is created on disk');
    assert.ok(fs.existsSync(store.recordingsDir), 'recordings directory is created');

    const call = store.createCall({
      id: '11111111-1111-4111-8111-111111111111',
      productId: 'flowpilot',
      productName: 'FlowPilot',
      language: 'en',
      consentRecording: true,
    });
    assert.equal(call.productName, 'FlowPilot');
    assert.equal(call.consentRecording, true);
    assert.equal(call.inProgress, true);

    store.addMessage(call.id, 'assistant', 'Hello, this is Voxly.');
    store.addMessage(call.id, 'customer', 'What does FlowPilot cost?');
    const loaded = store.getCall(call.id, { withMessages: true });
    assert.equal(loaded.messages.length, 2);
    assert.equal(loaded.messageCount, 2);
    assert.equal(loaded.customerMessageCount, 1);

    const ended = store.endCall(call.id, { durationSeconds: 42, status: 'Interested' });
    assert.equal(ended.status, 'Interested');
    assert.equal(ended.durationSeconds, 42);
    assert.equal(ended.inProgress, false);
    assert.ok(ended.endedAt);
  } finally {
    store.close();
    cleanupConfig(config);
  }
});

test('call history survives a database reopen (persistence)', () => {
  const config = makeConfig();
  const id = '22222222-2222-4222-8222-222222222222';
  try {
    const first = createDatabase({ dataDir: config.dataDir });
    first.createCall({
      id,
      productId: 'clouddesk',
      productName: 'CloudDesk',
      language: 'hi',
      consentRecording: false,
    });
    first.addMessage(id, 'assistant', 'नमस्ते!');
    first.addMessage(id, 'customer', 'कीमत क्या है?');
    first.endCall(id, { durationSeconds: 30, status: 'Follow-up Required' });
    first.close();

    const second = createDatabase({ dataDir: config.dataDir });
    const loaded = second.getCall(id, { withMessages: true });
    assert.ok(loaded, 'call is still present after reopen');
    assert.equal(loaded.language, 'hi');
    assert.equal(loaded.messages.length, 2);
    assert.equal(loaded.status, 'Follow-up Required');
    second.close();
  } finally {
    cleanupConfig(config);
  }
});

test('recording metadata, summary and stats are stored and aggregated', () => {
  const { config, store } = freshDb();
  try {
    const ids = [
      '33333333-3333-4333-8333-333333333331',
      '33333333-3333-4333-8333-333333333332',
      '33333333-3333-4333-8333-333333333333',
    ];
    for (const [index, id] of ids.entries()) {
      store.createCall({
        id,
        productId: 'teamsync',
        productName: 'TeamSync',
        language: 'en',
        consentRecording: index !== 2,
      });
      store.addMessage(id, 'assistant', 'Hello');
      if (index !== 2) store.addMessage(id, 'customer', 'Tell me more');
    }
    store.setRecording(ids[0], { fileName: `${ids[0]}.webm`, mimeType: 'audio/webm', bytes: 4096 });
    store.setSummary(ids[0], {
      status: 'Converted',
      source: 'ai',
      summary: { summary: 'Customer agreed to buy.', customerRequirements: [], questionsAsked: [], objections: [], nextSteps: [], interestLevel: 'High', interestReason: 'Explicit purchase.' },
    });
    store.endCall(ids[1], { durationSeconds: 60, status: 'Demo Requested' });
    store.endCall(ids[2], { durationSeconds: 10, status: 'No Response' });

    const call = store.getCall(ids[0]);
    assert.equal(call.recording.available, true);
    assert.equal(call.recording.bytes, 4096);
    assert.match(call.recording.url, /\/api\/calls\/.+\/recording$/);
    assert.equal(call.summary.summary, 'Customer agreed to buy.');
    assert.equal(call.status, 'Converted');

    const stats = store.stats();
    assert.equal(stats.total, 3);
    assert.equal(stats.byStatus.Converted, 1);
    assert.equal(stats.byStatus['Demo Requested'], 1);
    assert.equal(stats.byStatus['No Response'], 1);
    assert.equal(stats.recorded, 1);
    assert.equal(stats.conversionRate, 33.3);
    assert.equal(stats.avgDurationSeconds, 35);

    const filtered = store.listCalls({ status: 'Demo Requested' });
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].id, ids[1]);

    const searched = store.listCalls({ search: 'tell me more' });
    assert.equal(searched.length, 2);
  } finally {
    store.close();
    cleanupConfig(config);
  }
});

test('delete removes the call and its messages (no orphans)', () => {
  const { config, store } = freshDb();
  try {
    const id = '44444444-4444-4444-8444-444444444444';
    store.createCall({ id, productId: 'insightiq', productName: 'InsightIQ', language: 'en', consentRecording: false });
    store.addMessage(id, 'assistant', 'Hi');
    store.addMessage(id, 'customer', 'Hello');
    const row = store.deleteCall(id);
    assert.equal(row.id, id);
    assert.equal(store.getCall(id), null);
    assert.equal(store.getMessages(id).length, 0);
    assert.equal(store.stats().total, 0);
  } finally {
    store.close();
    cleanupConfig(config);
  }
});

test('database directory is created if missing', () => {
  const config = makeConfig();
  try {
    const nested = path.join(config.dataDir, 'nested', 'deeper');
    const store = createDatabase({ dataDir: nested });
    assert.ok(fs.existsSync(path.join(nested, 'sales_bot.db')));
    store.close();
  } finally {
    cleanupConfig(config);
  }
});
