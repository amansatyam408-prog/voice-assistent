/**
 * Vercel serverless entry point.
 *
 * Vercel exposes no persistent filesystem, so storage falls back to /tmp and is
 * reported to the UI as ephemeral (`storage.persistent === false`). The app
 * keeps working for a live demo; deploy with a persistent volume (Render/Docker)
 * when call history must survive restarts.
 */
import { createApp } from '../voice-sales-bot/server.js';
import { loadConfig } from '../voice-sales-bot/lib/config.js';

process.env.DATA_DIR = process.env.DATA_DIR || '/tmp/voxly-data';
process.env.EPHEMERAL_STORAGE = process.env.EPHEMERAL_STORAGE || 'true';

const config = loadConfig(process.env, { projectRoot: process.cwd() });
const app = createApp(config);

export default function handler(req, res) {
  return app.handler(req, res);
}
