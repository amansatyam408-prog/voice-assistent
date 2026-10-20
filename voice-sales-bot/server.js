import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

import { AppError, NotFoundError, ConflictError, ValidationError, AIError } from './lib/errors.js';
import { describeAi, loadConfig, loadEnvFile } from './lib/config.js';
import { getProduct, publicProducts } from './lib/products.js';
import { createDatabase } from './lib/db.js';
import { generateReply, generateSummary, classifyFromTranscript } from './lib/ai.js';
import {
  LANGUAGES,
  SALES_STATUSES,
  assertLanguage,
  assertString,
  assertUuid,
  clampInt,
  parseJsonBody,
} from './lib/validation.js';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};

const RECORDING_EXTENSIONS = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'video/webm': 'webm',
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Robots-Tag': 'noindex, nofollow',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "media-src 'self' blob:",
    "connect-src 'self'",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; '),
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function sendError(res, error) {
  const isAppError = error instanceof AppError;
  const status = isAppError ? error.status : 500;
  const expose = isAppError ? error.expose : false;
  const payload = {
    error: {
      code: isAppError ? error.code : 'INTERNAL_ERROR',
      message: expose ? error.message : 'An unexpected server error occurred.',
      ...(isAppError && error.details ? { details: error.details } : {}),
      ...(isAppError && error.providerStatus ? { providerStatus: error.providerStatus } : {}),
    },
  };
  if (status >= 500) {
    // Server-side diagnostics without leaking request bodies or secrets.
    console.error(`[error] ${payload.error.code}: ${error?.message}`);
  }
  sendJson(res, status, payload);
}

async function readBody(req, maxBytes) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) {
      throw new ValidationError(`Request body exceeds the ${Math.round(maxBytes / 1024)} KB limit`);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length) return forwarded.split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}

function createRateLimiter({ limit, windowMs = 60_000 }) {
  const hits = new Map();
  return function check(key) {
    const now = Date.now();
    const list = (hits.get(key) || []).filter((time) => now - time < windowMs);
    if (list.length >= limit) {
      hits.set(key, list);
      return false;
    }
    list.push(now);
    hits.set(key, list);
    if (hits.size > 5000) {
      for (const [entryKey, times] of hits) {
        if (!times.some((time) => now - time < windowMs)) hits.delete(entryKey);
      }
    }
    return true;
  };
}

function enabledLanguages() {
  return LANGUAGES;
}

export function createApp(config, { fetchImpl = globalThis.fetch } = {}) {
  const store = createDatabase({ dataDir: config.dataDir });
  const aiLimiter = createRateLimiter({ limit: config.limits.aiRequestsPerMinute });

  function requireAiKey() {
    if (config.ai.provider === 'none') {
      throw new AIError(
        'No AI provider is configured on the server. Add GEMINI_API_KEY (or OPENAI_API_KEY) to the environment and restart.',
        { code: 'AI_NOT_CONFIGURED', httpStatus: 503 },
      );
    }
  }

  function closeStaleCall() {
    const active = store.getActiveCall();
    if (!active) return;
    const ageMs = Date.now() - Date.parse(active.startedAt);
    if (ageMs > config.session.staleAfterMinutes * 60_000) {
      const counts = store.getCounts(active.id);
      const messages = store.getMessages(active.id);
      const status = counts.customerMessageCount ? classifyFromTranscript(messages).status : 'No Response';
      store.endCall(active.id, { status });
      console.warn(`[session] closed stale call ${active.id} after ${Math.round(ageMs / 60000)} minutes`);
    }
  }

  function getActiveOrThrow(callId) {
    const row = store.getCallRow(callId);
    if (!row) throw new NotFoundError('Call not found');
    if (row.ended_at) throw new ConflictError('This call has already ended. Start a new call to continue.');
    return row;
  }

  async function generateGreeting(call, language, product) {
    const result = await generateReply({
      config,
      product,
      language,
      messages: [],
      fetchImpl,
    });
    const text = result.text;
    const message = store.addMessage(call.id, 'assistant', text);
    return { message, model: result.model, provider: result.provider };
  }

  async function summarizeCall(callId) {
    const row = store.getCallRow(callId);
    if (!row) throw new NotFoundError('Call not found');
    const product = getProduct(row.product_id);
    if (!product) throw new AppError('The product for this call is no longer available', { status: 409, code: 'PRODUCT_MISSING' });
    const messages = store.getMessages(callId);

    try {
      requireAiKey();
      const result = await generateSummary({
        config,
        product,
        language: row.language,
        messages,
        fetchImpl,
      });
      const updated = store.setSummary(callId, {
        status: result.status,
        summary: { ...result.summary, classificationSource: result.statusSource, generatedAt: new Date().toISOString(), model: result.model || null },
        source: result.statusSource,
        error: null,
      });
      if (result.adjusted) {
        console.warn(`[summary] downgraded "Converted" to "${result.status}" for call ${callId}: no purchase signal found`);
      }
      return updated;
    } catch (error) {
      if (error instanceof AIError) {
        store.setSummaryError(callId, `${error.code}: ${error.message}`);
        // Keep a deterministic, transcript-derived status so history is never blank.
        const fallback =
          store.getCounts(callId).customerMessageCount === 0
            ? 'No Response'
            : classifyFromTranscript(messages).status;
        store.setSummary(callId, {
          status: fallback,
          summary: null,
          source: 'rules',
          error: `${error.code}: ${error.message}`,
        });
      }
      throw error;
    }
  }

  async function handleApi(req, res, url) {
    const { pathname } = url;
    const method = req.method || 'GET';

    // ---------------- health & config ----------------
    if (pathname === '/api/health' && method === 'GET') {
      return sendJson(res, 200, {
        ok: true,
        status: 'healthy',
        time: new Date().toISOString(),
        uptimeSeconds: Math.round(process.uptime()),
        ai: describeAi(config),
        storage: {
          type: 'sqlite',
          persistent: !config.storage.ephemeral,
          mode: config.storage.mode,
          platform: config.storage.platform,
        },
      });
    }

    if (pathname === '/api/config' && method === 'GET') {
      return sendJson(res, 200, {
        app: { name: 'Voxly', version: '2.0.0' },
        ai: describeAi(config),
        products: publicProducts(),
        languages: enabledLanguages(),
        salesStatuses: SALES_STATUSES,
        storage: {
          type: 'sqlite',
          persistent: !config.storage.ephemeral,
          mode: config.storage.mode,
          platform: config.storage.platform,
        },
        limits: {
          messageMaxLength: config.limits.messageMaxLength,
          recordingMaxBytes: config.limits.recordingMaxBytes,
          historyLimit: config.limits.historyLimit,
        },
        activeCall: store.getActiveCall(),
      });
    }

    // ---------------- calls collection ----------------
    if (pathname === '/api/calls' && method === 'GET') {
      const statusParam = url.searchParams.get('status');
      let status = null;
      if (statusParam && statusParam !== 'all') {
        if (!SALES_STATUSES.includes(statusParam)) throw new ValidationError('Unknown status filter');
        status = statusParam;
      }
      const search = (url.searchParams.get('search') || '').slice(0, 120);
      const limit = clampInt(url.searchParams.get('limit'), config.limits.historyLimit, {
        min: 1,
        max: config.limits.historyLimit,
      });
      const calls = store.listCalls({ status, search, limit });
      return sendJson(res, 200, { calls, count: calls.length, stats: store.stats() });
    }

    if (pathname === '/api/calls' && method === 'POST') {
      const raw = await readBody(req, config.limits.jsonBodyMaxBytes);
      const body = parseJsonBody(raw.toString('utf8'), config.limits.jsonBodyMaxBytes);
      const product = getProduct(body.productId);
      if (!product) throw new ValidationError('Unknown productId');
      const language = assertLanguage(body.language || 'en');
      const consentRecording = body.consentRecording === true;
      if (body.consentRecording !== undefined && typeof body.consentRecording !== 'boolean') {
        throw new ValidationError('consentRecording must be a boolean');
      }

      closeStaleCall();
      const active = store.getActiveCall();
      if (active) {
        throw new ConflictError('A call is already in progress. End it before starting a new one.', {
          activeCallId: active.id,
          startedAt: active.startedAt,
        });
      }
      requireAiKey();

      const id = crypto.randomUUID();
      const call = store.createCall({
        id,
        productId: product.id,
        productName: product.name,
        language,
        consentRecording,
      });

      try {
        const greeting = await generateGreeting(call, language, product);
        return sendJson(res, 201, {
          call: store.getCall(id, { withMessages: true }),
          greeting: greeting.message,
          ai: { provider: greeting.provider, model: greeting.model },
        });
      } catch (error) {
        return sendJson(res, 201, {
          call: store.getCall(id, { withMessages: true }),
          greeting: null,
          greetingError: {
            code: error.code || 'AI_ERROR',
            message: error.message,
          },
          ai: describeAi(config),
        });
      }
    }

    if (pathname === '/api/calls/active' && method === 'GET') {
      closeStaleCall();
      return sendJson(res, 200, { call: store.getActiveCall() });
    }

    if (pathname === '/api/stats' && method === 'GET') {
      return sendJson(res, 200, { stats: store.stats() });
    }

    if (pathname === '/api/export' && method === 'GET') {
      if (config.adminToken) {
        const token = req.headers['x-admin-token'];
        if (typeof token !== 'string' || token !== config.adminToken) {
          throw new AppError('Admin token required', { status: 401, code: 'UNAUTHORIZED' });
        }
      }
      const calls = store.allCallsForExport();
      return sendJson(res, 200, {
        exportedAt: new Date().toISOString(),
        app: 'Voxly',
        count: calls.length,
        calls,
      });
    }

    // ---------------- single call ----------------
    const callMatch = pathname.match(/^\/api\/calls\/([^/]+)$/);
    if (callMatch && (method === 'GET' || method === 'DELETE')) {
      const callId = assertUuid(decodeURIComponent(callMatch[1]), 'call id');
      const row = store.getCallRow(callId);
      if (!row) throw new NotFoundError('Call not found');

      if (method === 'GET') {
        return sendJson(res, 200, { call: store.getCall(callId, { withMessages: true }) });
      }

      if (config.adminToken) {
        const token = req.headers['x-admin-token'];
        if (typeof token !== 'string' || token !== config.adminToken) {
          throw new AppError('Admin token required', { status: 401, code: 'UNAUTHORIZED' });
        }
      }
      const deleted = store.deleteCall(callId);
      if (deleted.recording_file) {
        await fsp.rm(path.join(store.recordingsDir, path.basename(deleted.recording_file)), { force: true });
      }
      return sendJson(res, 200, { deleted: true, id: callId });
    }

    const greetingMatch = pathname.match(/^\/api\/calls\/([^/]+)\/greeting$/);
    if (greetingMatch && method === 'POST') {
      const callId = assertUuid(decodeURIComponent(greetingMatch[1]), 'call id');
      const row = getActiveOrThrow(callId);
      if (store.getCounts(callId).messageCount > 0) {
        throw new ConflictError('This call already has messages; a new greeting cannot be generated.');
      }
      requireAiKey();
      const product = getProduct(row.product_id);
      const greeting = await generateGreeting(store.getCall(callId), row.language, product);
      return sendJson(res, 200, {
        call: store.getCall(callId, { withMessages: true }),
        greeting: greeting.message,
      });
    }

    const replyMatch = pathname.match(/^\/api\/calls\/([^/]+)\/reply$/);
    if (replyMatch && method === 'POST') {
      const callId = assertUuid(decodeURIComponent(replyMatch[1]), 'call id');
      const row = getActiveOrThrow(callId);
      const raw = await readBody(req, config.limits.jsonBodyMaxBytes);
      const body = parseJsonBody(raw.toString('utf8'), config.limits.jsonBodyMaxBytes);
      const message = assertString(body.message, 'message', {
        min: 1,
        max: config.limits.messageMaxLength,
      });

      if (store.getCounts(callId).messageCount >= config.limits.maxTurnsPerCall * 2) {
        throw new ConflictError('This call has reached the maximum number of turns. End the call to continue.');
      }
      if (!aiLimiter(clientIp(req))) {
        throw new AppError('Too many AI requests. Please wait a moment and try again.', {
          status: 429,
          code: 'RATE_LIMITED',
        });
      }
      requireAiKey();

      const product = getProduct(row.product_id);
      if (!product) throw new ConflictError('The product for this call is no longer available');

      const customerMessage = store.addMessage(callId, 'customer', message);
      const history = store.getMessages(callId);

      try {
        const result = await generateReply({
          config,
          product,
          language: row.language,
          messages: history,
          fetchImpl,
        });
        const assistantMessage = store.addMessage(callId, 'assistant', result.text);
        return sendJson(res, 200, {
          customerMessage,
          assistantMessage,
          ai: { provider: result.provider, model: result.model },
        });
      } catch (error) {
        // The customer turn is kept in the transcript even if the model failed,
        // so nothing the customer said is lost. The UI shows the real error.
        return sendJson(res, error.status || 502, {
          customerMessage,
          assistantMessage: null,
          error: {
            code: error.code || 'AI_ERROR',
            message: error.message,
            retryable: error.code !== 'AI_NOT_CONFIGURED' && error.code !== 'AI_AUTH_ERROR',
          },
        });
      }
    }

    const retryMatch = pathname.match(/^\/api\/calls\/([^/]+)\/retry$/);
    if (retryMatch && method === 'POST') {
      const callId = assertUuid(decodeURIComponent(retryMatch[1]), 'call id');
      const row = getActiveOrThrow(callId);
      const last = store.getLastMessage(callId);
      if (!last || last.role !== 'customer') {
        throw new ConflictError('There is no unanswered customer message to retry.');
      }
      if (!aiLimiter(clientIp(req))) {
        throw new AppError('Too many AI requests. Please wait a moment and try again.', {
          status: 429,
          code: 'RATE_LIMITED',
        });
      }
      requireAiKey();
      const product = getProduct(row.product_id);
      if (!product) throw new ConflictError('The product for this call is no longer available');

      const result = await generateReply({
        config,
        product,
        language: row.language,
        messages: store.getMessages(callId),
        fetchImpl,
      });
      const assistantMessage = store.addMessage(callId, 'assistant', result.text);
      return sendJson(res, 200, {
        assistantMessage,
        ai: { provider: result.provider, model: result.model },
      });
    }

    const endMatch = pathname.match(/^\/api\/calls\/([^/]+)\/end$/);
    if (endMatch && method === 'POST') {
      const callId = assertUuid(decodeURIComponent(endMatch[1]), 'call id');
      const row = store.getCallRow(callId);
      if (!row) throw new NotFoundError('Call not found');
      if (row.ended_at) {
        const existing = store.getCall(callId, { withMessages: true });
        return sendJson(res, 200, { call: existing, alreadyEnded: true });
      }
      const raw = await readBody(req, config.limits.jsonBodyMaxBytes);
      const body = parseJsonBody(raw.toString('utf8'), config.limits.jsonBodyMaxBytes);
      const durationSeconds = clampInt(body.durationSeconds, 0, { min: 0, max: 60 * 60 * 6 });
      const counts = store.getCounts(callId);
      const messages = store.getMessages(callId);
      const initialStatus = counts.customerMessageCount === 0 ? 'No Response' : classifyFromTranscript(messages).status;

      store.endCall(callId, { durationSeconds, status: initialStatus });

      let call = store.getCall(callId, { withMessages: true });
      let summaryError = null;
      try {
        call = await summarizeCall(callId);
        call = store.getCall(callId, { withMessages: true });
      } catch (error) {
        summaryError = { code: error.code || 'AI_ERROR', message: error.message };
        call = store.getCall(callId, { withMessages: true });
      }
      return sendJson(res, 200, { call, summaryError });
    }

    const summaryMatch = pathname.match(/^\/api\/calls\/([^/]+)\/summary$/);
    if (summaryMatch && method === 'POST') {
      const callId = assertUuid(decodeURIComponent(summaryMatch[1]), 'call id');
      const row = store.getCallRow(callId);
      if (!row) throw new NotFoundError('Call not found');
      if (!row.ended_at) throw new ConflictError('End the call before generating a summary.');
      if (!aiLimiter(clientIp(req))) {
        throw new AppError('Too many AI requests. Please wait a moment and try again.', {
          status: 429,
          code: 'RATE_LIMITED',
        });
      }
      const call = await summarizeCall(callId);
      return sendJson(res, 200, { call });
    }

    const recordingMatch = pathname.match(/^\/api\/calls\/([^/]+)\/recording$/);
    if (recordingMatch) {
      const callId = assertUuid(decodeURIComponent(recordingMatch[1]), 'call id');
      const row = store.getCallRow(callId);
      if (!row) throw new NotFoundError('Call not found');

      if (method === 'POST') {
        if (!row.consent_recording) {
          throw new ConflictError('Recording consent was not given for this call, so audio cannot be stored.');
        }
        const contentType = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
        if (!contentType.startsWith('audio/') && contentType !== 'video/webm') {
          throw new AppError(`Unsupported recording content type: ${contentType || 'none'}`, {
            status: 415,
            code: 'UNSUPPORTED_MEDIA_TYPE',
          });
        }
        const buffer = await readBody(req, config.limits.recordingMaxBytes);
        if (buffer.length < 512) throw new ValidationError('Recording is empty or too small to store');
        const ext = RECORDING_EXTENSIONS[contentType] || 'webm';
        const fileName = `${callId}.${ext}`;
        const target = path.join(store.recordingsDir, fileName);
        const temp = path.join(store.recordingsDir, `.${fileName}.tmp`);
        await fsp.writeFile(temp, buffer);
        await fsp.rename(temp, target);
        if (row.recording_file && row.recording_file !== fileName) {
          await fsp.rm(path.join(store.recordingsDir, path.basename(row.recording_file)), { force: true });
        }
        const call = store.setRecording(callId, { fileName, mimeType: contentType, bytes: buffer.length });
        return sendJson(res, 201, {
          call,
          recording: { bytes: buffer.length, mimeType: contentType, url: `/api/calls/${callId}/recording` },
        });
      }

      if (method === 'GET' || method === 'HEAD') {
        if (!row.recording_file) throw new NotFoundError('No recording stored for this call');
        const filePath = path.join(store.recordingsDir, path.basename(row.recording_file));
        let stat;
        try {
          stat = await fsp.stat(filePath);
        } catch {
          throw new NotFoundError('Recording file is missing from storage');
        }
        const total = stat.size;
        const headers = {
          ...SECURITY_HEADERS,
          'Content-Type': row.recording_mime || 'audio/webm',
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'no-store',
          'Content-Disposition': `inline; filename="voxly-call-${callId}.${path.extname(filePath).slice(1)}"`,
        };
        const range = req.headers.range;
        if (range) {
          const match = /^bytes=(\d*)-(\d*)$/.exec(String(range).trim());
          if (!match || (match[1] === '' && match[2] === '')) {
            res.writeHead(416, { ...SECURITY_HEADERS, 'Content-Range': `bytes */${total}` });
            return res.end();
          }
          let start;
          let end;
          if (match[1] === '') {
            const suffix = Number(match[2]);
            start = Math.max(0, total - suffix);
            end = total - 1;
          } else {
            start = Number(match[1]);
            end = match[2] === '' ? total - 1 : Math.min(Number(match[2]), total - 1);
          }
          if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= total) {
            res.writeHead(416, { ...SECURITY_HEADERS, 'Content-Range': `bytes */${total}` });
            return res.end();
          }
          res.writeHead(206, {
            ...headers,
            'Content-Range': `bytes ${start}-${end}/${total}`,
            'Content-Length': end - start + 1,
          });
          if (method === 'HEAD') return res.end();
          return fs.createReadStream(filePath, { start, end }).pipe(res);
        }
        res.writeHead(200, { ...headers, 'Content-Length': total });
        if (method === 'HEAD') return res.end();
        return fs.createReadStream(filePath).pipe(res);
      }

      throw new AppError('Method not allowed', { status: 405, code: 'METHOD_NOT_ALLOWED' });
    }

    throw new NotFoundError('API route not found');
  }

  async function serveStatic(req, res, url) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      throw new AppError('Method not allowed', { status: 405, code: 'METHOD_NOT_ALLOWED' });
    }
    let pathname;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      throw new ValidationError('Malformed URL');
    }
    if (pathname === '/') pathname = '/index.html';
    const resolved = path.resolve(config.publicDir, `.${pathname}`);
    const publicRoot = path.resolve(config.publicDir);
    if (resolved !== publicRoot && !resolved.startsWith(publicRoot + path.sep)) {
      throw new NotFoundError('File not found');
    }
    let filePath = resolved;
    try {
      const stat = await fsp.stat(filePath);
      if (stat.isDirectory()) filePath = path.join(filePath, 'index.html');
    } catch {
      // SPA fallback for extension-less paths.
      if (path.extname(pathname)) throw new NotFoundError('File not found');
      filePath = path.join(publicRoot, 'index.html');
    }
    let content;
    try {
      content = await fsp.readFile(filePath);
    } catch {
      throw new NotFoundError('File not found');
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'Content-Length': content.length,
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300',
    });
    if (req.method === 'HEAD') return res.end();
    return res.end(content);
  }

  async function handler(req, res) {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    try {
      if (url.pathname.startsWith('/api/')) {
        await handleApi(req, res, url);
        return;
      }
      await serveStatic(req, res, url);
    } catch (error) {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      if (error instanceof AIError) {
        console.error(`[ai] ${error.code}: ${error.message}`);
      }
      sendError(res, error);
    }
  }

  return { handler, store, config, summarizeCall };
}

export function startServer({ config = loadConfig(process.env), fetchImpl } = {}) {
  const app = createApp(config, { fetchImpl });
  const server = http.createServer(app.handler);
  server.requestTimeout = 120_000;
  server.headersTimeout = 65_000;

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, () => {
      const ai = describeAi(config);
      console.log(`Voxly AI Voice Sales Bot listening on http://${config.host}:${config.port}`);
      console.log(`Storage: ${app.store.dbPath}`);
      console.log(
        config.storage.ephemeral
          ? 'Storage: EPHEMERAL (serverless /tmp) — call history resets when the instance recycles.'
          : 'Storage: persistent disk',
      );
      if (ai.configured) {
        console.log(`AI provider: ${ai.provider} (model: ${ai.model})`);
      } else {
        console.warn('AI provider: NOT CONFIGURED — chat and summaries will return a clear configuration error.');
      }
      resolve({ server, app });
    });
  });
}

// Only auto-start when executed directly (tests import createApp instead).
const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename);

if (isDirectRun) {
  const envFile = loadEnvFile(path.join(path.dirname(import.meta.filename), '..', '.env'));
  for (const [key, value] of Object.entries(envFile)) {
    if (process.env[key] === undefined || process.env[key] === '') process.env[key] = value;
  }
  const config = loadConfig(process.env);
  startServer({ config }).catch((error) => {
    console.error(`Failed to start server: ${error.message}`);
    process.exit(1);
  });

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      console.log(`\nReceived ${signal}, shutting down.`);
      process.exit(0);
    });
  }
}
