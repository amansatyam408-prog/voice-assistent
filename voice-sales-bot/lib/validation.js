import { ValidationError } from './errors.js';

export const LANGUAGES = [
  { code: 'en', label: 'English', speech: 'en-IN' },
  { code: 'hi', label: 'हिंदी (Hindi)', speech: 'hi-IN' },
];

export const SALES_STATUSES = [
  'Converted',
  'Interested',
  'Follow-up Required',
  'Not Interested',
  'Demo Requested',
  'No Response',
];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

export function assertUuid(value, field = 'id') {
  if (!isUuid(value)) throw new ValidationError(`${field} must be a valid call id`);
  return value;
}

export function assertLanguage(value) {
  if (!LANGUAGES.some((language) => language.code === value)) {
    throw new ValidationError('language must be one of: en, hi');
  }
  return value;
}

/**
 * Normalize arbitrary text to one of the six official statuses.
 * Returns null when no safe mapping exists — callers must never guess silently.
 */
export function normalizeStatus(value) {
  if (typeof value !== 'string') return null;
  const cleaned = value.trim().toLowerCase().replace(/[_\s-]+/g, ' ');
  const map = {
    converted: 'Converted',
    'closed won': 'Converted',
    won: 'Converted',
    'sale closed': 'Converted',
    interested: 'Interested',
    'follow up required': 'Follow-up Required',
    'follow up': 'Follow-up Required',
    'followup required': 'Follow-up Required',
    'needs follow up': 'Follow-up Required',
    'not interested': 'Not Interested',
    'demo requested': 'Demo Requested',
    'demo request': 'Demo Requested',
    'demo scheduled': 'Demo Requested',
    'no response': 'No Response',
    'no answer': 'No Response',
    unanswered: 'No Response',
  };
  return map[cleaned] || null;
}

export function parseJsonBody(raw, maxBytes) {
  if (raw.length > maxBytes) {
    throw new ValidationError('Request body is too large');
  }
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new ValidationError('Request body must be a JSON object');
    }
    return parsed;
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    throw new ValidationError('Request body must be valid JSON');
  }
}

export function assertString(value, field, { min = 1, max = 500, trim = true } = {}) {
  if (typeof value !== 'string') throw new ValidationError(`${field} is required and must be text`);
  const text = trim ? value.trim() : value;
  if (text.length < min) throw new ValidationError(`${field} is too short`);
  if (text.length > max) throw new ValidationError(`${field} must be at most ${max} characters`);
  return text;
}

export function clampInt(value, fallback, { min, max }) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}
