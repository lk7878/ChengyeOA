'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const serverDir = path.join(__dirname, '..');
const projectDir = path.join(serverDir, '..');
const webDir = path.join(projectDir, 'web');
const distDir = path.join(projectDir, 'dist');
const outputDir = path.join(distDir, 'law-firm-system');

// ─── helpers ──────────────────────────────────────────
function rmIfExists(p) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true });
}
function mkdirIfNeeded(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}
function sizeOf(p) {
  try {
    let total = 0;
    const stat = fs.statSync(p);
    if (stat.isDirectory()) {
      for (const f of fs.readdirSync(p)) {
        total += sizeOf(path.join(p, f));
      }
    } else {
      total = stat.size;
    }
    return total;
  } catch (e) { return 0; }
}
function fmt(bytes) { return (bytes / 1024 / 1024).toFixed(1) + ' MB'; }

// ─── step 1: build frontend ───────────────────────────
function buildFrontend() {
  console.log('\n[1/7] Building frontend...');
  execSync('npm run build', { cwd: webDir, stdio: 'inherit' });
  console.log('  OK: frontend built');
}

// ─── step 2: copy frontend to server/public/ ──────────
function copyFrontend() {
  console.log('\n[2/7] Copying frontend to server/public/...');
  const webDist = path.join(webDir, 'dist');
  const serverPublic = path.join(serverDir, 'public');

  if (!fs.existsSync(webDist)) {
    console.error('Error: web/dist/ not found. Frontend build may have failed.');
    process.exit(1);
  }

  rmIfExists(serverPublic);
  fs.cpSync(webDist, serverPublic, { recursive: true });
  console.log('  OK: ' + serverPublic);
}

// ─── step 3: build backend (tsc + prisma + copy) ──────
function buildBackend() {
  console.log('\n[3/7] Building backend...');

  // 3a. TypeScript compile
  console.log('  Running tsc...');
  execSync('npx tsc', { cwd: serverDir, stdio: 'inherit' });

  // 3b. Prisma generate
  console.log('  Running prisma generate...');
  execSync('npx prisma generate', { cwd: serverDir, stdio: 'inherit' });

  // 3c. Copy assets via build.js
  console.log('  Copying assets...');
  execSync('node scripts/build.js', { cwd: serverDir, stdio: 'inherit' });

  console.log('  OK: backend built');
}

// ─── step 5: build portable dir + prune in output ──────
function pruneDir(nmDir) {
  const devOnly = [
    'typescript',
    'egg-ts-helper',
    'egg-bin',
    'ts-node',
    'mocha',
    '.cache',
    'prisma',
    '@prisma/engines',
    '@prisma/engines-version',
    '@prisma/debug',
    '@prisma/fetch-engine',
    '@prisma/get-platform',
    'eslint',
    '@yao-pkg',
    'pkg',
  ];

  let deleted = 0;
  for (const pkg of devOnly) {
    const p = path.join(nmDir, pkg);
    if (fs.existsSync(p)) {
      const sz = sizeOf(p);
      rmIfExists(p);
      if (sz > 0) { console.log('  - ' + pkg + ' (' + fmt(sz) + ')'); deleted++; }
    }
  }
  return deleted;
}

function buildPortable() {
  console.log('\n[5/8] Building portable directory...');

  rmIfExists(outputDir);
  mkdirIfNeeded(outputDir);

  const distSrc = path.join(serverDir, 'dist');

  // copy compiled backend
  const dirsToCopy = ['app', 'config', 'public', 'prisma'];
  for (const dir of dirsToCopy) {
    const src = path.join(distSrc, dir);
    if (fs.existsSync(src)) {
      fs.cpSync(src, path.join(outputDir, dir), { recursive: true });
      console.log('  copy: ' + dir + '/');
    }
  }

  // copy app.js (Egg boot hook)
  for (const f of ['app.js', 'app.d.ts']) {
    const src = path.join(distSrc, f);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(outputDir, f));
      console.log('  copy: ' + f);
    }
  }

  // copy node_modules from server (preserving source)
  const nmSrc = path.join(serverDir, 'node_modules');
  const nmDest = path.join(outputDir, 'node_modules');
  console.log('  copying node_modules/ (may take a minute)...');
  fs.cpSync(nmSrc, nmDest, { recursive: true, dereference: true, verbatimSymlinks: false });
  const beforePrune = sizeOf(nmDest);
  console.log('  copied: ' + fmt(beforePrune));

  // prune dev packages IN the output (NOT in server source)
  console.log('  pruning dev packages...');
  const deletedCount = pruneDir(nmDest);
  const afterPrune = sizeOf(nmDest);
  console.log('  pruned: ' + fmt(afterPrune) + ' (saved ' + fmt(beforePrune - afterPrune) + ', ' + deletedCount + ' packages)');

  // also prune nested .cache
  function cleanCaches(dir) {
    try {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!e.isDirectory()) continue;
        const cp = path.join(dir, e.name);
        if (e.name === '.cache') { rmIfExists(cp); deletedCount++; }
        else if (path.relative(nmDest, cp).split(path.sep).length <= 2) cleanCaches(cp);
      }
    } catch (e) {}
  }
  cleanCaches(nmDest);

  // copy node.exe
  const systemNode = process.execPath;
  const destNode = path.join(outputDir, 'node.exe');
  fs.copyFileSync(systemNode, destNode);
  console.log('  copy: node.exe (' + path.basename(systemNode) + ')');

  // minimal package.json
  const pkgJson = { name: 'law-firm-server', egg: { typescript: false } };
  fs.writeFileSync(path.join(outputDir, 'package.json'), JSON.stringify(pkgJson, null, 2));
  console.log('  create: package.json');

  mkdirIfNeeded(path.join(outputDir, 'logs'));

  // verify engine
  const enginePath = path.join(nmDest, '.prisma', 'client', 'query_engine-windows.dll.node');
  if (fs.existsSync(enginePath)) {
    console.log('  verify: Prisma engine OK (' + fmt(sizeOf(enginePath)) + ')');
  } else {
    console.warn('  WARNING: Prisma query engine not found!');
  }

  console.log('  OK: portable directory ready');
}

// ─── step 7: create launcher files ─────────────────────
function createLauncherFiles() {
  console.log('\n[7/7] Creating launcher files...');

  createAppEntryJs();
  createLaunchBat();

  console.log('  OK: launcher files created');
}

function createAppEntryJs() {
  const content = [
    "'use strict';",
    "",
    "const path = require('path');",
    "const fs = require('fs');",
    "const { exec } = require('child_process');",
    "const { loadEnvironment } = require('./config/env');",
    "",
    "const baseDir = __dirname;",
    "",
    "// ── Open browser ────────────────────────────",
    "function openBrowser(port) {",
    "  const url = 'http://localhost:' + port;",
    "  exec('start \"\" \"' + url + '\"', function() {});",
    "}",
    "",
    "// ── Wait for server to be ready ──────────────",
    "function waitForServer(port, maxRetries) {",
    "  maxRetries = maxRetries || 30;",
    "  return new Promise(function(resolve, reject) {",
    "    var retries = 0;",
    "    function check() {",
    "      var req = require('http').get('http://localhost:' + port + '/api/health', function(res) {",
    "        if (res.statusCode === 200) resolve();",
    "        else if (++retries < maxRetries) setTimeout(check, 500);",
    "        else reject(new Error('Server did not become ready'));",
    "      });",
    "      req.on('error', function() {",
    "        if (++retries < maxRetries) setTimeout(check, 500);",
    "        else reject(new Error('Server did not become ready'));",
    "      });",
    "      req.end();",
    "    }",
    "    check();",
    "  });",
    "}",
    "",
    "// ── Main ──────────────────────────────────────",
    "async function main() {",
    "  console.log('');",
    "  console.log('╔══════════════════════════════════════════╗');",
    "  console.log('║   律所闭环管理系统 v1.0.0                ║');",
    "  console.log('║   Law Firm Management System            ║');",
    "  console.log('╚══════════════════════════════════════════╝');",
    "  console.log('');",
    "",
    "  loadEnvironment(process.env);",
    "",
    "  // Data directory (portable: same as exe location)",
    "  var userDataDir = baseDir;",
    "",
    "  process.env.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';",
    "  process.env.JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '30d';",
    "",
    "  // Log dir",
    "  var logDir = path.join(userDataDir, 'logs');",
    "  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });",
    "  process.env.LOG_DIR = logDir;",
    "",
    "  // Prisma auto-discovers query engine in .prisma/client/",
    "  // No need to set PRISMA_QUERY_ENGINE_LIBRARY (setting it wrong breaks things)",
    "",
    "  // Environment",
    "  process.env.NODE_ENV = process.env.NODE_ENV || 'production';",
    "",
    "  // Port",
    "  var port = parseInt(process.env.PORT || '7001');",
    "",
    "  console.log('[启动] 端口: ' + port);",
    "  console.log('[启动] 环境: ' + process.env.NODE_ENV);",
    "",
    "  // Start Egg.js",
    "  console.log('[启动] 正在启动服务器...');",
    "",
    "  var egg = require('egg');",
    "",
    "  egg.startCluster({",
    "    baseDir: baseDir,",
    "    workers: 1,",
    "    port: port,",
    "    env: process.env.NODE_ENV === 'development' ? 'local' : 'prod',",
    "    framework: path.join(baseDir, 'node_modules', 'egg'),",
    "  }, function() {",
    "    console.log('[启动] 服务器已启动: http://localhost:' + port);",
    "    console.log('[启动] 按 Ctrl+C 停止服务器');",
    "    console.log('');",
    "",
    "    // Wait for server, then open browser",
    "    waitForServer(port).then(function() {",
    "      openBrowser(port);",
    "    }).catch(function() {",
    "      setTimeout(function() { openBrowser(port); }, 3000);",
    "    });",
    "  });",
    "}",
    "",
    "main().catch(function(err) {",
    "  console.error('[错误] 启动失败:', err);",
    "  console.error('');",
    "  console.error('请尝试以下操作:');",
    "  console.error('  1. 确保端口 ' + (process.env.PORT || '7001') + ' 未被占用');",
    "  console.error('  2. 确保此目录有写入权限');",
    "  process.exit(1);",
    "});"
  ].join('\n');

  fs.writeFileSync(path.join(outputDir, 'app-entry.js'), content);
  console.log('  create: app-entry.js');
}

function createLaunchBat() {
  const bat = [
    '@echo off',
    'chcp 65001 >nul',
    'title 律所管理系统',
    'cd /d "%~dp0"',
    'echo ╔══════════════════════════════════════╗',
    'echo ║  律所闭环管理系统 v1.0.0            ║',
    'echo ║  Law Firm Management System         ║',
    'echo ╚══════════════════════════════════════╝',
    'echo.',
    'echo Starting server on http://localhost:7001',
    'echo.',
    'echo Press Ctrl+C to stop the server.',
    'echo.',
    '"%~dp0node.exe" "%~dp0app-entry.js"',
    'pause',
  ].join('\r\n');

  fs.writeFileSync(path.join(outputDir, 'launch.bat'), bat);
  console.log('  create: launch.bat');
}

// ─── Main (reordered) ──────────────────────────────────
async function main() {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║  Law Firm System - Build Package        ║');
  console.log('║  Building self-contained portable dist  ║');
  console.log('╚══════════════════════════════════════════╝');

  buildFrontend();        // 1: npm run build in web
  copyFrontend();         // 2: copy to server/public/
  buildBackend();         // 3: tsc + prisma generate + copy assets
  buildPortable();        // 4: copy to output, then prune inside output dir
  createLauncherFiles();  // 5: app-entry.js + launch.bat

  // Summary
  const totalSize = sizeOf(outputDir);
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║  Build Complete!                         ║');
  console.log('╠══════════════════════════════════════════╣');
  console.log('║  Location: ' + outputDir.padEnd(40).substring(0, 37) + ' ║');
  console.log('║  Size:     ' + fmt(totalSize).padEnd(37) + ' ║');
  console.log('╠══════════════════════════════════════════╣');
  console.log('║  To run: double-click launch.bat         ║');
  console.log('║  Database: external PostgreSQL            ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log('');
}

main().catch(e => {
  console.error('Build failed:', e);
  process.exit(1);
});
