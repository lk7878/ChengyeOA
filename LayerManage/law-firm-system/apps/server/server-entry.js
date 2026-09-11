'use strict';

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const { loadEnvironment, loadProductionEnvironment } = require('./dist/config/env');
const { routePortableCommand } = require('./scripts/lib/portable-command');
const { resolvePackagedPrismaQueryEngineLibrary } = require('./scripts/lib/prisma-engine-path');

const isPkg = typeof process.pkg !== 'undefined';
const isDev = !isPkg && process.env.NODE_ENV !== 'production';

function getUserDataDir() {
  return isPkg ? path.dirname(process.execPath) : process.cwd();
}

function setupPackagedNodeRuntime() {
  if (!isPkg) return;
  process.execArgv = process.execArgv.filter(arg => arg !== '--no-experimental-require-module');
  const queryEngineLibrary = resolvePackagedPrismaQueryEngineLibrary(process.execPath);
  process.env.PRISMA_QUERY_ENGINE_LIBRARY = queryEngineLibrary;
}

function setupServerEnvironment() {
  setupPackagedNodeRuntime();
  if (isPkg) loadProductionEnvironment(process.env);
  else loadEnvironment(process.env);

  const logDir = path.join(getUserDataDir(), 'logs');
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
  process.env.LOG_DIR = logDir;
}

function openBrowser(port) {
  const url = `http://localhost:${port}`;
  const command = process.platform === 'win32'
    ? `start "" "${url}"`
    : process.platform === 'darwin'
      ? `open "${url}"`
      : `xdg-open "${url}"`;
  exec(command, error => {
    if (error) console.log(`Open this URL manually: ${url}`);
  });
}

async function runServer() {
  console.log('Law Firm Management System v1.0.0');
  setupServerEnvironment();
  const port = process.env.PORT || 7001;
  console.log('[Startup] Starting server...');

  const egg = require('egg');
  const appBaseDir = isDev ? __dirname : path.join(__dirname, 'dist');
  const options = {
    baseDir: appBaseDir,
    workers: 1,
    port: parseInt(port, 10),
    env: isDev ? 'local' : 'prod',
    framework: path.join(__dirname, 'node_modules', 'egg'),
  };
  egg.startCluster(options, () => {
    console.log(`[Startup] Server started: http://localhost:${port}`);
    console.log('[Startup] Press Ctrl+C to stop.');
    setTimeout(() => openBrowser(port), 1000);
  });
}

async function runDrain(argv) {
  setupPackagedNodeRuntime();
  if (isPkg) process.env.NODE_ENV = 'production';
  const { drainMain } = require('./dist/scripts/events/drain-events');
  return drainMain(argv, process.env);
}

async function runCheck(argv) {
  setupPackagedNodeRuntime();
  if (isPkg) process.env.NODE_ENV = 'production';
  const { checkEventsMain } = require('./dist/scripts/events/check-events');
  return checkEventsMain(argv, process.env);
}

async function main(argv = process.argv.slice(2)) {
  const exitCode = await routePortableCommand(argv, {
    runServer,
    runDrain,
    runCheck,
    stderr: process.stderr,
  });
  if (Number.isSafeInteger(exitCode)) process.exitCode = exitCode;
}

if (require.main === module) {
  void main().catch(() => {
    process.stderr.write('Application startup failed.\n');
    process.exitCode = 70;
  });
}

module.exports = { main, runCheck, runDrain, runServer };
