import fs from 'node:fs';
import path from 'node:path';

/**
 * Minimal .env loader (no third-party dependency).
 * Real environment variables always win over the file, so deployments can
 * inject secrets without editing files on disk.
 */
export function loadEnvFile(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch {
    return {};
  }
  const out = {};
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function intFrom(value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function trimSlash(url) {
  return String(url || '').replace(/\/+$/, '');
}

export const PROJECT_ROOT = path.resolve(import.meta.dirname, '..', '..');

/**
 * Build the runtime configuration from an environment object.
 * Secrets stay inside this object; only `describeAi()` is ever sent to clients.
 */
export function loadConfig(env = process.env, { projectRoot = PROJECT_ROOT } = {}) {
  const geminiKey = (env.GEMINI_API_KEY || '').trim();
  const openaiKey = (env.OPENAI_API_KEY || '').trim();
  const requestedProvider = (env.AI_PROVIDER || 'auto').trim().toLowerCase();

  let provider = 'none';
  if (requestedProvider === 'gemini' && geminiKey) provider = 'gemini';
  else if (requestedProvider === 'openai' && openaiKey) provider = 'openai';
  else if (requestedProvider === 'auto' || !requestedProvider) {
    if (geminiKey) provider = 'gemini';
    else if (openaiKey) provider = 'openai';
  }

  // Gemini model + graceful fallbacks if the configured model is unavailable.
  const geminiModel = (env.GEMINI_MODEL || 'gemini-2.5-flash').trim();
  const fallbackModels = (env.GEMINI_FALLBACK_MODELS || 'gemini-2.5-flash,gemini-2.0-flash')
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);

  // Google accepts credentials two ways: an AI Studio key via ?key= (or the
  // x-goog-api-key header) and an OAuth access token via Authorization: Bearer.
  // Key formats are not reliable signals ("AIza...", "AQ...", "ya29..." all
  // exist), so the default "auto" tries ?key= first and falls back to Bearer on
  // 401/403. GEMINI_AUTH_MODE=key|bearer pins a single mode.
  const requestedAuth = String(env.GEMINI_AUTH_MODE || 'auto').trim().toLowerCase();
  const authMode = ['key', 'bearer'].includes(requestedAuth) ? requestedAuth : 'auto';

  const dataDir = path.resolve(projectRoot, env.DATA_DIR || path.join('voice-sales-bot', 'data'));

  // Serverless platforms (Vercel, etc.) only offer an ephemeral /tmp filesystem,
  // so the SQLite database and recordings cannot outlive a function instance.
  // This is surfaced to the UI instead of failing or pretending to persist.
  const onServerless = Boolean(env.VERCEL || env.AWS_LAMBDA_FUNCTION_NAME || env.NETLIFY);
  // Auto-detect ephemeral storage unless EPHEMERAL_STORAGE explicitly overrides it.
  const explicitEphemeral = String(env.EPHEMERAL_STORAGE ?? '').trim().toLowerCase();
  const ephemeralStorage =
    explicitEphemeral === ''
      ? dataDir.startsWith('/tmp') || onServerless
      : ['1', 'true', 'yes'].includes(explicitEphemeral);

  return {
    projectRoot,
    port: intFrom(env.PORT, 3000, { min: 1, max: 65535 }),
    host: env.HOST || '0.0.0.0',
    dataDir,
    publicDir: path.join(projectRoot, 'voice-sales-bot', 'public'),
    ai: {
      provider,
      gemini: {
        apiKey: geminiKey,
        model: geminiModel,
        fallbackModels: fallbackModels.filter((m) => m !== geminiModel),
        baseUrl: trimSlash(env.GEMINI_API_BASE_URL || 'https://generativelanguage.googleapis.com'),
        apiVersion: env.GEMINI_API_VERSION || 'v1beta',
        authMode,
        timeoutMs: intFrom(env.AI_TIMEOUT_MS, 30000, { min: 3000, max: 120000 }),
      },
      openai: {
        apiKey: openaiKey,
        model: (env.OPENAI_MODEL || 'gpt-4o-mini').trim(),
        baseUrl: trimSlash(env.OPENAI_BASE_URL || 'https://api.openai.com/v1'),
        timeoutMs: intFrom(env.AI_TIMEOUT_MS, 30000, { min: 3000, max: 120000 }),
      },
    },
    limits: {
      messageMaxLength: intFrom(env.MESSAGE_MAX_LENGTH, 2000, { min: 50, max: 8000 }),
      jsonBodyMaxBytes: intFrom(env.JSON_BODY_MAX_BYTES, 128 * 1024, { min: 1024, max: 1024 * 1024 }),
      recordingMaxBytes: intFrom(env.RECORDING_MAX_BYTES, 25 * 1024 * 1024, {
        min: 64 * 1024,
        max: 200 * 1024 * 1024,
      }),
      historyLimit: intFrom(env.HISTORY_LIMIT, 200, { min: 10, max: 1000 }),
      maxTurnsPerCall: intFrom(env.MAX_TURNS_PER_CALL, 60, { min: 5, max: 500 }),
      aiRequestsPerMinute: intFrom(env.AI_REQUESTS_PER_MINUTE, 40, { min: 5, max: 600 }),
    },
    session: {
      // An unanswered call older than this is closed automatically so a stuck
      // tab can never permanently block new calls.
      staleAfterMinutes: intFrom(env.ACTIVE_CALL_TTL_MINUTES, 30, { min: 1, max: 720 }),
    },
    adminToken: (env.ADMIN_TOKEN || '').trim(),
    storage: {
      ephemeral: ephemeralStorage,
      mode: ephemeralStorage ? 'ephemeral-disk' : 'persistent-disk',
      platform: onServerless ? 'serverless' : 'node',
    },
  };
}

/** Safe, non-secret description of the AI configuration for clients/health. */
export function describeAi(config) {
  const configured = config.ai.provider !== 'none';
  return {
    configured,
    provider: config.ai.provider,
    model:
      config.ai.provider === 'gemini'
        ? config.ai.gemini.model
        : config.ai.provider === 'openai'
          ? config.ai.openai.model
          : null,
    fallbackModels: config.ai.provider === 'gemini' ? config.ai.gemini.fallbackModels : [],
  };
}
