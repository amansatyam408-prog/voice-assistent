/**
 * Vercel build step: materialise the application source from the public repo.
 *
 * Why this exists: deployments for this project are triggered through the Vercel
 * API with a minimal file payload (no Git integration), so the exact source for
 * the deployable branch is downloaded at build time. Nothing is generated or
 * transpiled — the build output is byte-identical to the committed branch.
 *
 * Uses only curl + tar, which are guaranteed in Vercel's build image.
 *
 * If you connect this project to GitHub (Settings → Git), replace the build
 * command with `npm run build:noop` (or delete it) and Vercel will build straight
 * from the repository instead.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const REPO = process.env.SOURCE_REPO || 'amansatyam408-prog/voice-assistent';
const BRANCH = process.env.SOURCE_BRANCH || 'arena/f78866ee-voice-assistent';
const ARCHIVE = path.join('/tmp', 'voxly-source.tgz');
const EXTRACT = path.join('/tmp', 'voxly-source');
const ROOT = process.cwd();

const COPY_PATHS = ['api', 'voice-sales-bot'];

function run(file, args) {
  return execFileSync(file, args, { stdio: 'inherit' });
}

function log(message) {
  console.log(`[fetch-source] ${message}`);
}

const url = `https://codeload.github.com/${REPO}/tar.gz/refs/heads/${BRANCH}`;
log(`downloading ${url}`);
run('curl', ['-sSL', '--retry', '3', '--retry-delay', '2', '--fail', url, '-o', ARCHIVE]);

fs.rmSync(EXTRACT, { recursive: true, force: true });
fs.mkdirSync(EXTRACT, { recursive: true });
run('tar', ['-xzf', ARCHIVE, '-C', EXTRACT, '--strip-components=1']);

for (const relativePath of COPY_PATHS) {
  const source = path.join(EXTRACT, relativePath);
  const destination = path.join(ROOT, relativePath);
  if (!fs.existsSync(source)) {
    throw new Error(`Expected ${relativePath} in the downloaded branch but it is missing.`);
  }
  fs.rmSync(destination, { recursive: true, force: true });
  fs.cpSync(source, destination, { recursive: true });
  log(`copied ${relativePath}`);
}

// Runtime state and dependencies must never ship with a deployment.
for (const unwanted of ['voice-sales-bot/data', 'node_modules', '.git']) {
  fs.rmSync(path.join(ROOT, unwanted), { recursive: true, force: true });
}

const required = [
  'api/index.mjs',
  'voice-sales-bot/server.js',
  'voice-sales-bot/public/index.html',
  'voice-sales-bot/public/app.js',
  'voice-sales-bot/public/styles.css',
];
for (const file of required) {
  if (!fs.existsSync(path.join(ROOT, file))) {
    throw new Error(`Build output is incomplete: ${file} is missing.`);
  }
}
log('source is ready');
