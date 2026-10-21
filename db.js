import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
const RECORDINGS_DIR = path.join(DATA_DIR, 'recordings');
const DEFAULT_DB_PATH = path.join(DATA_DIR, 'sales_bot.db');

let dbInstance = null;

export function initDb(customDbPath = null) {
  const dbPath = customDbPath || DEFAULT_DB_PATH;
  
  // Ensure directories exist
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
  }

  const db = new DatabaseSync(dbPath);

  // Enable WAL mode if on disk for high concurrency and resilience
  if (dbPath !== ':memory:') {
    try {
      db.exec('PRAGMA journal_mode = WAL;');
      db.exec('PRAGMA synchronous = NORMAL;');
    } catch {
      // WAL pragmas can be ignored if unsupported
    }
  }

  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS calls (
      id TEXT PRIMARY KEY,
      product TEXT NOT NULL,
      language TEXT NOT NULL,
      created_at TEXT NOT NULL,
      duration_seconds INTEGER NOT NULL DEFAULT 0,
      duration_formatted TEXT NOT NULL DEFAULT '00:00',
      status TEXT NOT NULL,
      transcript TEXT NOT NULL,
      summary TEXT,
      has_recording INTEGER NOT NULL DEFAULT 0,
      recording_file TEXT,
      recording_mime TEXT,
      recording_size INTEGER NOT NULL DEFAULT 0,
      consent_given INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      product TEXT NOT NULL,
      language TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      status TEXT NOT NULL DEFAULT 'active'
    );

    CREATE INDEX IF NOT EXISTS idx_calls_created_at ON calls(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_calls_status ON calls(status);
  `);

  dbInstance = db;
  return db;
}

export function getDb() {
  if (!dbInstance) {
    dbInstance = initDb();
  }
  return dbInstance;
}

export function createOrUpdateCall(callData) {
  const db = getDb();
  const {
    id,
    product = 'FlowPilot',
    language = 'English',
    createdAt = new Date().toISOString(),
    durationSeconds = 0,
    durationFormatted = '00:00',
    status = 'Interested',
    transcript = [],
    summary = null,
    hasRecording = 0,
    recordingFile = null,
    recordingMime = null,
    recordingSize = 0,
    consentGiven = 0
  } = callData;

  const existing = db.prepare('SELECT id, recording_file, recording_mime, recording_size, has_recording FROM calls WHERE id = ?').get(id);

  const finalHasRecording = existing?.has_recording || hasRecording;
  const finalRecordingFile = existing?.recording_file || recordingFile;
  const finalRecordingMime = existing?.recording_mime || recordingMime;
  const finalRecordingSize = existing?.recording_size || recordingSize;

  const stmt = db.prepare(`
    INSERT INTO calls (
      id, product, language, created_at, duration_seconds, duration_formatted,
      status, transcript, summary, has_recording, recording_file, recording_mime,
      recording_size, consent_given
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      product = excluded.product,
      language = excluded.language,
      duration_seconds = excluded.duration_seconds,
      duration_formatted = excluded.duration_formatted,
      status = excluded.status,
      transcript = excluded.transcript,
      summary = excluded.summary,
      has_recording = excluded.has_recording,
      recording_file = excluded.recording_file,
      recording_mime = excluded.recording_mime,
      recording_size = excluded.recording_size,
      consent_given = excluded.consent_given
  `);

  stmt.run(
    id,
    product,
    language,
    createdAt,
    durationSeconds,
    durationFormatted,
    status,
    typeof transcript === 'string' ? transcript : JSON.stringify(transcript),
    summary ? (typeof summary === 'string' ? summary : JSON.stringify(summary)) : null,
    finalHasRecording ? 1 : 0,
    finalRecordingFile,
    finalRecordingMime,
    finalRecordingSize,
    consentGiven ? 1 : 0
  );

  return getCall(id);
}

export function getCall(id) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM calls WHERE id = ?').get(id);
  if (!row) return null;
  return formatCallRow(row);
}

export function getAllCalls() {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM calls ORDER BY created_at DESC').all();
  return rows.map(formatCallRow);
}

function formatCallRow(row) {
  let transcript = [];
  try {
    transcript = JSON.parse(row.transcript || '[]');
  } catch {
    transcript = [];
  }

  let summary = null;
  if (row.summary) {
    try {
      summary = JSON.parse(row.summary);
    } catch {
      summary = null;
    }
  }

  return {
    id: row.id,
    product: row.product,
    language: row.language,
    date: row.created_at,
    duration: row.duration_formatted,
    durationSeconds: row.duration_seconds,
    status: row.status,
    transcript,
    summary,
    hasRecording: Boolean(row.has_recording),
    recordingFile: row.recording_file,
    recordingMime: row.recording_mime,
    recordingSize: row.recording_size,
    consentGiven: Boolean(row.consent_given)
  };
}

export function deleteCall(id) {
  const db = getDb();
  const row = db.prepare('SELECT recording_file FROM calls WHERE id = ?').get(id);
  if (row && row.recording_file) {
    const safeFilename = path.basename(row.recording_file);
    const filePath = path.join(RECORDINGS_DIR, safeFilename);
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (err) {
        console.error('Failed to remove audio file on delete:', err.message);
      }
    }
  }
  const result = db.prepare('DELETE FROM calls WHERE id = ?').run(id);
  return result.changes > 0;
}

export function saveRecording(callId, buffer, mimeType = 'audio/webm') {
  const db = getDb();
  if (!callId || typeof callId !== 'string') {
    throw new Error('Invalid call ID');
  }

  // Prevent path traversal
  const sanitizedId = callId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const ext = mimeType.includes('wav') ? '.wav' : mimeType.includes('ogg') ? '.ogg' : '.webm';
  const filename = `${sanitizedId}${ext}`;
  const filePath = path.join(RECORDINGS_DIR, filename);

  fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
  fs.writeFileSync(filePath, buffer);

  const stmt = db.prepare(`
    UPDATE calls SET
      has_recording = 1,
      recording_file = ?,
      recording_mime = ?,
      recording_size = ?
    WHERE id = ?
  `);
  stmt.run(filename, mimeType, buffer.length, callId);

  return {
    filename,
    filePath,
    mimeType,
    size: buffer.length
  };
}

export function getRecording(callId) {
  const db = getDb();
  const row = db.prepare('SELECT recording_file, recording_mime, recording_size FROM calls WHERE id = ?').get(callId);
  if (!row || !row.recording_file) return null;

  const safeFilename = path.basename(row.recording_file);
  const filePath = path.join(RECORDINGS_DIR, safeFilename);

  if (!fs.existsSync(filePath)) return null;

  return {
    filePath,
    mimeType: row.recording_mime || 'audio/webm',
    size: row.recording_size || fs.statSync(filePath).size
  };
}

// Session tracking to prevent duplicate sessions
export function startSession(sessionId, product, language) {
  const db = getDb();
  // Mark any orphaned active sessions as ended
  db.prepare("UPDATE sessions SET status = 'ended', ended_at = ? WHERE status = 'active'").run(new Date().toISOString());

  const stmt = db.prepare(`
    INSERT INTO sessions (id, product, language, started_at, status)
    VALUES (?, ?, ?, ?, 'active')
  `);
  stmt.run(sessionId, product, language, new Date().toISOString());
  return { id: sessionId, product, language, status: 'active' };
}

export function endSession(sessionId) {
  const db = getDb();
  const stmt = db.prepare(`
    UPDATE sessions SET status = 'ended', ended_at = ? WHERE id = ?
  `);
  stmt.run(new Date().toISOString(), sessionId);
}

export function getActiveSession() {
  const db = getDb();
  return db.prepare("SELECT * FROM sessions WHERE status = 'active' ORDER BY started_at DESC LIMIT 1").get();
}

export function getStats() {
  const db = getDb();
  const totalCalls = db.prepare('SELECT COUNT(*) as count FROM calls').get().count;
  const statusCounts = db.prepare('SELECT status, COUNT(*) as count FROM calls GROUP BY status').all();
  const statusMap = Object.fromEntries(statusCounts.map(s => [s.status, s.count]));

  const recordingsCount = db.prepare('SELECT COUNT(*) as count FROM calls WHERE has_recording = 1').get().count;
  const totalDuration = db.prepare('SELECT SUM(duration_seconds) as total FROM calls').get().total || 0;

  return {
    totalCalls,
    recordingsCount,
    totalDurationSeconds: totalDuration,
    avgDurationSeconds: totalCalls ? Math.round(totalDuration / totalCalls) : 0,
    statuses: {
      'Converted': statusMap['Converted'] || 0,
      'Interested': statusMap['Interested'] || 0,
      'Demo Requested': statusMap['Demo Requested'] || 0,
      'Follow-up Required': statusMap['Follow-up Required'] || 0,
      'Not Interested': statusMap['Not Interested'] || 0,
      'No Response': statusMap['No Response'] || 0
    }
  };
}
