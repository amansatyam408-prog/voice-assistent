import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import {
  initDb,
  createOrUpdateCall,
  getCall,
  getAllCalls,
  deleteCall,
  saveRecording,
  getRecording,
  startSession,
  endSession,
  getActiveSession,
  getStats
} from '../db.js';

describe('SQLite Database & Storage Unit Tests', () => {
  const testDbPath = ':memory:';

  before(() => {
    initDb(testDbPath);
  });

  test('should insert and retrieve a call with transcript and summary', () => {
    const callData = {
      id: 'test_call_001',
      product: 'FlowPilot',
      language: 'English',
      createdAt: new Date().toISOString(),
      durationSeconds: 75,
      durationFormatted: '01:15',
      status: 'Interested',
      transcript: [
        { role: 'assistant', text: 'Hi, how can I help?' },
        { role: 'customer', text: 'How much does FlowPilot cost?' }
      ],
      summary: {
        summary: 'Customer asked about pricing.',
        requirements: ['Workflow automation'],
        questionsAsked: ['How much does FlowPilot cost?'],
        objections: [],
        customerInterest: 'Interested in pricing options.',
        nextSteps: ['Share pricing plans.'],
        status: 'Interested'
      },
      hasRecording: 0,
      consentGiven: 1
    };

    const saved = createOrUpdateCall(callData);
    assert.strictEqual(saved.id, 'test_call_001');
    assert.strictEqual(saved.product, 'FlowPilot');
    assert.strictEqual(saved.status, 'Interested');
    assert.strictEqual(saved.transcript.length, 2);
    assert.strictEqual(saved.summary.questionsAsked.length, 1);
    assert.strictEqual(saved.consentGiven, true);

    const fetched = getCall('test_call_001');
    assert.deepStrictEqual(fetched.id, 'test_call_001');
    assert.strictEqual(fetched.duration, '01:15');
  });

  test('should list all calls in descending order', () => {
    createOrUpdateCall({
      id: 'test_call_002',
      product: 'CloudDesk',
      language: 'Hindi',
      createdAt: new Date(Date.now() + 1000).toISOString(),
      durationSeconds: 120,
      durationFormatted: '02:00',
      status: 'Demo Requested',
      transcript: [{ role: 'customer', text: 'डेमो देखना चाहता हूँ' }],
      consentGiven: 1
    });

    const calls = getAllCalls();
    assert.ok(calls.length >= 2);
    assert.strictEqual(calls[0].id, 'test_call_002'); // Most recent first
  });

  test('should save and retrieve binary audio recordings', () => {
    const dummyAudioBuffer = Buffer.from('RIFF....WAVEfmt ....data....test audio stream');
    const recInfo = saveRecording('test_call_001', dummyAudioBuffer, 'audio/webm');

    assert.ok(recInfo.filename.includes('test_call_001'));
    assert.strictEqual(recInfo.size, dummyAudioBuffer.length);

    const callAfter = getCall('test_call_001');
    assert.strictEqual(callAfter.hasRecording, true);
    assert.strictEqual(callAfter.recordingSize, dummyAudioBuffer.length);

    const loadedRec = getRecording('test_call_001');
    assert.ok(loadedRec !== null);
    assert.strictEqual(loadedRec.size, dummyAudioBuffer.length);
  });

  test('should delete call and its associated recording', () => {
    const deleted = deleteCall('test_call_001');
    assert.strictEqual(deleted, true);

    const check = getCall('test_call_001');
    assert.strictEqual(check, null);

    const checkRec = getRecording('test_call_001');
    assert.strictEqual(checkRec, null);
  });

  test('should track sessions and prevent duplicate active sessions', () => {
    startSession('sess_101', 'FlowPilot', 'English');
    let active = getActiveSession();
    assert.strictEqual(active.id, 'sess_101');
    assert.strictEqual(active.status, 'active');

    // Starting a new session automatically closes previous active session
    startSession('sess_102', 'CloudDesk', 'Hindi');
    active = getActiveSession();
    assert.strictEqual(active.id, 'sess_102');

    endSession('sess_102');
    active = getActiveSession();
    assert.strictEqual(active, undefined);
  });

  test('should aggregate sales stats accurately', () => {
    const stats = getStats();
    assert.ok(typeof stats.totalCalls === 'number');
    assert.ok(typeof stats.statuses === 'object');
    assert.ok('Converted' in stats.statuses);
    assert.ok('Demo Requested' in stats.statuses);
  });
});
