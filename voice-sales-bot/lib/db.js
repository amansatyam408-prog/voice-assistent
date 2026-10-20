import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS calls (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  started_at TEXT NOT NULL,
  last_activity_at TEXT NOT NULL,
  ended_at TEXT,
  duration_seconds INTEGER,
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  language TEXT NOT NULL,
  consent_recording INTEGER NOT NULL DEFAULT 0,
  status TEXT,
  summary_source TEXT,
  summary_json TEXT,
  summary_error TEXT,
  recording_file TEXT,
  recording_mime TEXT,
  recording_bytes INTEGER,
  message_count INTEGER NOT NULL DEFAULT 0,
  customer_message_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  call_id TEXT NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('customer', 'assistant')),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_call ON messages(call_id, id);
CREATE INDEX IF NOT EXISTS idx_calls_started ON calls(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_calls_status ON calls(status);
CREATE INDEX IF NOT EXISTS idx_calls_active ON calls(ended_at);
`;

function nowIso() {
  return new Date().toISOString();
}

function parseSummary(row) {
  if (!row?.summary_json) return null;
  try {
    return JSON.parse(row.summary_json);
  } catch {
    return null;
  }
}

/** Serialize a database row into the API representation of a call. */
export function serializeCall(row, { includeMessages = null } = {}) {
  if (!row) return null;
  const summary = parseSummary(row);
  const call = {
    id: row.id,
    createdAt: row.created_at,
    startedAt: row.started_at,
    lastActivityAt: row.last_activity_at,
    endedAt: row.ended_at || null,
    durationSeconds: row.duration_seconds ?? null,
    productId: row.product_id,
    productName: row.product_name,
    language: row.language,
    consentRecording: Boolean(row.consent_recording),
    status: row.status || null,
    summarySource: row.summary_source || null,
    summary,
    summaryError: row.summary_error || null,
    recording: row.recording_file
      ? {
          available: true,
          mimeType: row.recording_mime,
          bytes: row.recording_bytes,
          url: `/api/calls/${row.id}/recording`,
        }
      : { available: false, mimeType: null, bytes: 0, url: null },
    messageCount: row.message_count,
    customerMessageCount: row.customer_message_count,
    inProgress: !row.ended_at,
  };
  if (includeMessages) call.messages = includeMessages;
  return call;
}

export function serializeMessage(row) {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    createdAt: row.created_at,
  };
}

export function createDatabase({ dataDir, dbFileName = 'sales_bot.db' }) {
  const recordingsDir = path.join(dataDir, 'recordings');
  fs.mkdirSync(recordingsDir, { recursive: true });
  const dbPath = path.join(dataDir, dbFileName);

  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);

  const stmts = {
    insertCall: db.prepare(
      `INSERT INTO calls (id, created_at, started_at, last_activity_at, product_id, product_name, language, consent_recording)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    getCall: db.prepare('SELECT * FROM calls WHERE id = ?'),
    activeCall: db.prepare(
      'SELECT * FROM calls WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1',
    ),
    insertMessage: db.prepare(
      'INSERT INTO messages (call_id, role, content, created_at) VALUES (?, ?, ?, ?)',
    ),
    getMessages: db.prepare('SELECT * FROM messages WHERE call_id = ? ORDER BY id ASC'),
    lastMessage: db.prepare('SELECT * FROM messages WHERE call_id = ? ORDER BY id DESC LIMIT 1'),
    countMessages: db.prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN role = 'customer' THEN 1 ELSE 0 END) AS customer
       FROM messages WHERE call_id = ?`,
    ),
    touchCall: db.prepare(
      'UPDATE calls SET last_activity_at = ?, message_count = ?, customer_message_count = ? WHERE id = ?',
    ),
    endCall: db.prepare(
      `UPDATE calls SET ended_at = ?, duration_seconds = ?, status = COALESCE(?, status),
        summary_source = COALESCE(?, summary_source), summary_json = COALESCE(?, summary_json),
        summary_error = ?, last_activity_at = ?
       WHERE id = ?`,
    ),
    setSummary: db.prepare(
      `UPDATE calls SET status = ?, summary_source = ?, summary_json = ?, summary_error = ?,
        last_activity_at = ? WHERE id = ?`,
    ),
    setSummaryError: db.prepare('UPDATE calls SET summary_error = ?, last_activity_at = ? WHERE id = ?'),
    setRecording: db.prepare(
      `UPDATE calls SET recording_file = ?, recording_mime = ?, recording_bytes = ?, last_activity_at = ?
       WHERE id = ?`,
    ),
    clearRecording: db.prepare(
      'UPDATE calls SET recording_file = NULL, recording_mime = NULL, recording_bytes = NULL WHERE id = ?',
    ),
    deleteCall: db.prepare('DELETE FROM calls WHERE id = ?'),
    deleteMessages: db.prepare('DELETE FROM messages WHERE call_id = ?'),
    listCalls: db.prepare(
      `SELECT * FROM calls
       WHERE (? IS NULL OR status = ?)
       ORDER BY started_at DESC
       LIMIT ?`,
    ),
    searchCalls: db.prepare(
      `SELECT * FROM calls c
       WHERE (? IS NULL OR c.status = ?)
         AND (
           LOWER(c.product_name) LIKE ?
           OR EXISTS (SELECT 1 FROM messages m WHERE m.call_id = c.id AND LOWER(m.content) LIKE ?)
         )
       ORDER BY c.started_at DESC
       LIMIT ?`,
    ),
    stats: db.prepare(
      `SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'Converted' THEN 1 ELSE 0 END) AS converted,
        SUM(CASE WHEN status = 'Interested' THEN 1 ELSE 0 END) AS interested,
        SUM(CASE WHEN status = 'Demo Requested' THEN 1 ELSE 0 END) AS demo_requested,
        SUM(CASE WHEN status = 'Follow-up Required' THEN 1 ELSE 0 END) AS follow_up,
        SUM(CASE WHEN status = 'Not Interested' THEN 1 ELSE 0 END) AS not_interested,
        SUM(CASE WHEN status = 'No Response' THEN 1 ELSE 0 END) AS no_response,
        SUM(CASE WHEN ended_at IS NULL THEN 1 ELSE 0 END) AS in_progress,
        SUM(CASE WHEN recording_file IS NOT NULL THEN 1 ELSE 0 END) AS recorded,
        AVG(CASE WHEN duration_seconds IS NOT NULL THEN duration_seconds END) AS avg_duration
       FROM calls`,
    ),
    allCalls: db.prepare('SELECT * FROM calls ORDER BY started_at DESC'),
  };

  function recount(callId) {
    const counts = stmts.countMessages.get(callId);
    const total = Number(counts?.total || 0);
    const customer = Number(counts?.customer || 0);
    const touch = nowIso();
    stmts.touchCall.run(touch, total, customer, callId);
    return { messageCount: total, customerMessageCount: customer, lastActivityAt: touch };
  }

  return {
    db,
    dbPath,
    recordingsDir,

    createCall({ id, productId, productName, language, consentRecording }) {
      const now = nowIso();
      stmts.insertCall.run(
        id,
        now,
        now,
        now,
        productId,
        productName,
        language,
        consentRecording ? 1 : 0,
      );
      return serializeCall(stmts.getCall.get(id));
    },

    getCall(callId, { withMessages = false } = {}) {
      const row = stmts.getCall.get(callId);
      if (!row) return null;
      const messages = withMessages
        ? stmts.getMessages.all(callId).map(serializeMessage)
        : null;
      return serializeCall(row, { includeMessages: messages });
    },

    getCallRow(callId) {
      return stmts.getCall.get(callId) || null;
    },

    getActiveCall() {
      const row = stmts.activeCall.get();
      return row ? serializeCall(row) : null;
    },

    addMessage(callId, role, content) {
      const info = stmts.insertMessage.run(callId, role, content, nowIso());
      recount(callId);
      return { id: Number(info.lastInsertRowid), role, content, createdAt: nowIso() };
    },

    getMessages(callId) {
      return stmts.getMessages.all(callId).map(serializeMessage);
    },

    getLastMessage(callId) {
      const row = stmts.lastMessage.get(callId);
      return row ? serializeMessage(row) : null;
    },

    getCounts(callId) {
      const counts = stmts.countMessages.get(callId);
      return {
        messageCount: Number(counts?.total || 0),
        customerMessageCount: Number(counts?.customer || 0),
      };
    },

    touch(callId) {
      const counts = stmts.countMessages.get(callId);
      stmts.touchCall.run(
        nowIso(),
        Number(counts?.total || 0),
        Number(counts?.customer || 0),
        callId,
      );
    },

    endCall(callId, { durationSeconds, status = null, summary = null, summarySource = null, summaryError = null }) {
      const row = stmts.getCall.get(callId);
      if (!row) return null;
      const endedAt = row.ended_at || nowIso();
      const started = new Date(row.started_at).getTime();
      const computed = Math.max(0, Math.round((Date.parse(endedAt) - started) / 1000));
      // Use the client-measured duration (it measures the real call length) but
      // never report less than the server-side elapsed time, and cap at 6 hours.
      const duration = Number.isFinite(durationSeconds)
        ? Math.max(computed, Math.min(Math.round(durationSeconds), 6 * 3600))
        : computed;
      stmts.endCall.run(
        endedAt,
        duration,
        status,
        summarySource,
        summary ? JSON.stringify(summary) : null,
        summaryError,
        nowIso(),
        callId,
      );
      return serializeCall(stmts.getCall.get(callId));
    },

    setSummary(callId, { status, summary, source, error = null }) {
      stmts.setSummary.run(
        status ?? null,
        source ?? null,
        summary ? JSON.stringify(summary) : null,
        error,
        nowIso(),
        callId,
      );
      return serializeCall(stmts.getCall.get(callId));
    },

    setSummaryError(callId, message) {
      stmts.setSummaryError.run(message, nowIso(), callId);
    },

    setRecording(callId, { fileName, mimeType, bytes }) {
      stmts.setRecording.run(fileName, mimeType, bytes, nowIso(), callId);
      return serializeCall(stmts.getCall.get(callId));
    },

    clearRecording(callId) {
      stmts.clearRecording.run(callId);
    },

    deleteCall(callId) {
      const row = stmts.getCall.get(callId);
      if (!row) return null;
      stmts.deleteMessages.run(callId);
      stmts.deleteCall.run(callId);
      return row;
    },

    listCalls({ status = null, search = '', limit = 200 } = {}) {
      const rows = search
        ? stmts.searchCalls.all(status, status, `%${search.toLowerCase()}%`, `%${search.toLowerCase()}%`, limit)
        : stmts.listCalls.all(status, status, limit);
      return rows.map((row) => serializeCall(row));
    },

    allCallsForExport() {
      return stmts.allCalls.all().map((row) => {
        const call = serializeCall(row, {
          includeMessages: stmts.getMessages.all(row.id).map(serializeMessage),
        });
        return call;
      });
    },

    stats() {
      const row = stmts.stats.get() || {};
      const total = Number(row.total || 0);
      const converted = Number(row.converted || 0);
      const byStatus = {
        Converted: converted,
        Interested: Number(row.interested || 0),
        'Demo Requested': Number(row.demo_requested || 0),
        'Follow-up Required': Number(row.follow_up || 0),
        'Not Interested': Number(row.not_interested || 0),
        'No Response': Number(row.no_response || 0),
      };
      return {
        total,
        inProgress: Number(row.in_progress || 0),
        recorded: Number(row.recorded || 0),
        avgDurationSeconds: row.avg_duration ? Math.round(Number(row.avg_duration)) : 0,
        conversionRate: total ? Math.round((converted / total) * 1000) / 10 : 0,
        byStatus,
      };
    },

    close() {
      db.close();
    },
  };
}
