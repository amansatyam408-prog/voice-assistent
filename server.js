import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  generateSalesReply,
  generateCallSummary,
  guessSalesStatus,
  getAiConfig,
  SAAS_PRODUCTS,
  ALLOWED_STATUSES
} from './ai.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.json({ limit: '8mb' }));

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// ─────────────────────────────────────────────
// Health & Config
// ─────────────────────────────────────────────

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    nodeVersion: process.version
  });
});

app.get('/api/config', (req, res) => {
  const config = getAiConfig();
  res.json({ ...config, allowedStatuses: ALLOWED_STATUSES });
});

// Runtime API key injection (so user can set key from the UI)
app.post('/api/config/key', (req, res) => {
  const { provider = 'gemini', apiKey } = req.body || {};
  if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length < 8) {
    return res.status(400).json({ error: 'A valid API key string is required.' });
  }
  const cleanKey = apiKey.trim();
  if (provider === 'gemini') {
    process.env.GEMINI_API_KEY = cleanKey;
  } else if (provider === 'openai') {
    process.env.OPENAI_API_KEY = cleanKey;
  } else {
    return res.status(400).json({ error: 'Supported providers: "gemini" or "openai".' });
  }
  res.json({ success: true, message: `${provider.toUpperCase()} key registered.`, config: getAiConfig() });
});

app.get('/api/products', (req, res) => {
  res.json(SAAS_PRODUCTS);
});

// ─────────────────────────────────────────────
// AI Voice Sales Reply
// ─────────────────────────────────────────────

app.post('/api/reply', async (req, res) => {
  const { message, product = 'FlowPilot', language = 'English', history = [], customProductInfo = null } = req.body || {};

  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'Customer message is required.' });
  }
  if (message.length > 2500) {
    return res.status(400).json({ error: 'Message exceeds 2500 characters.' });
  }

  try {
    const result = await generateSalesReply({
      message: message.trim(),
      product,
      language,
      history: Array.isArray(history) ? history.slice(-10) : [],
      customProductInfo
    });
    res.json(result);
  } catch (error) {
    console.error('Error in /api/reply:', error.message);
    res.status(502).json({ error: error.message || 'Failed to generate AI response.', code: 'AI_SERVICE_ERROR' });
  }
});

// ─────────────────────────────────────────────
// AI Summary & Classification
// ─────────────────────────────────────────────

app.post('/api/summary', async (req, res) => {
  const { transcript = [], product = 'FlowPilot' } = req.body || {};
  if (!Array.isArray(transcript)) {
    return res.status(400).json({ error: 'Transcript must be an array.' });
  }
  try {
    const result = await generateCallSummary({ transcript, product });
    res.json(result);
  } catch (error) {
    console.error('Error in /api/summary:', error.message);
    res.status(502).json({ error: error.message || 'Failed to generate summary.', code: 'SUMMARY_SERVICE_ERROR' });
  }
});

app.post('/api/classify', (req, res) => {
  const { transcript = [] } = req.body || {};
  const status = guessSalesStatus(Array.isArray(transcript) ? transcript : []);
  res.json({ status });
});

// ─────────────────────────────────────────────
// NOTE: Call history & recordings are stored in
// browser localStorage on Vercel (no persistent
// server filesystem). The frontend handles all
// persistence. These stubs keep the API surface
// consistent for local dev with db.js.
// ─────────────────────────────────────────────

app.get('/api/calls', (req, res) => {
  res.json([]); // Client manages its own localStorage history
});

app.post('/api/calls', (req, res) => {
  // Accept and echo back — client stores the real data
  res.json({ ...req.body, savedAt: new Date().toISOString() });
});

app.delete('/api/calls/:id', (req, res) => {
  res.json({ success: true, id: req.params.id });
});

app.get('/api/stats', (req, res) => {
  res.json({ total: 0, byStatus: {}, note: 'Stats computed client-side on Vercel deployment.' });
});

// Fallback to index.html (SPA)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server only when run directly (not in tests / Vercel handler)
const isDirectRun = process.argv[1] &&
  path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);

let serverInstance = null;
if (isDirectRun && process.env.NODE_ENV !== 'test') {
  serverInstance = app.listen(PORT, () => {
    console.log(`\n=================================================`);
    console.log(` Voxly AI Voice Sales Bot  →  http://localhost:${PORT}`);
    const cfg = getAiConfig();
    console.log(` AI Provider: ${cfg.activeProvider.toUpperCase()} (${cfg.ready ? 'LIVE' : 'OFFLINE SIMULATION'})`);
    console.log(` Storage: localStorage (Vercel) / SQLite (local with db.js)`);
    console.log(`=================================================\n`);
  });
}

export { serverInstance };
export default app;
