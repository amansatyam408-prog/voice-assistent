/**
 * Vercel build step: materialise the application source from the public Git repo.
 *
 * Why this exists: the Vercel project is created from this workspace branch, and
 * the deployment is triggered with a small file payload rather than a Git
 * integration. This script performs a shallow clone of the deployable branch and
 * copies the runtime tree (api/ + voice-sales-bot/) into the build root so the
 * function bundler can see it.
 *
 * The result is byte-identical to the committed branch — nothing is generated or
 * transpiled. If you connect the Vercel project to GitHub (Project → Settings →
 * Git), delete `buildCommand` from vercel.json; the normal Git flow then applies.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const REPO = process.env.SOURCE_REPO || 'https://github.com/amansatyam408-prog/voice-assistent.git';
const BRANCH = process.env.SOURCE_BRANCH || 'arena/f78866ee-voice-assistent';
const TARGET = process.env.SOURCE_DIR || '/tmp/voxly-source';
const ROOT = process.cwd();

const COPY_PATHS = ['api', 'voice-sales-bot'];

function log(message) {
  console.log(`[fetch-source] ${message}`);
}

function run(command, args) {
  return execFileSync(command, args, { stdio: 'inherit' });
}

log(`cloning ${REPO} (branch ${BRANCH})`);
fs.rmSync(TARGET, { recursive: true, force: true });
run('git', ['clone', '--depth', '1', '--single-branch', '--branch', BRANCH, REPO, TARGET]);

for (const relativePath of COPY_PATHS) {
  const source = path.join(TARGET, relativePath);
  const destination = path.join(ROOT, relativePath);
  if (!fs.existsSync(source)) {
    throw new Error(`Expected ${relativePath} in the cloned branch but it is missing.`);
  }
  fs.rmSync(destination, { recursive: true, force: true });
  fs.cpSync(source, destination, { recursive: true });
  log(`copied ${relativePath}`);
}

// Drop runtime state that must never ship with a deployment.
for (const runtimeDir of ['voice-sales-bot/data', 'node_modules', '.git']) {
  fs.rmSync(path.join(ROOT, runtimeDir), { recursive: true, force: true });
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
