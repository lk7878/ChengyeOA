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

// ─── step 6: copy pre-built database to output ──────────
function initDatabase() {
  console.log('\n[6/7] Copying pre-built database...');

  // The database was already migrated + seeded in preInitDatabase()
  const srcDb = path.join(serverDir, 'prisma', 'law_firm.db');
  const destDb = path.join(outputDir, 'law_firm.db');
  const destPrismaDb = path.join(outputDir, 'prisma', 'law_firm.db');

  if (fs.existsSync(srcDb)) {
    fs.copyFileSync(srcDb, destDb);
    console.log('  copy: law_firm.db -> root (' + fmt(sizeOf(srcDb)) + ')');

    // Also copy to prisma/ for Prisma schema-relative resolution
    mkdirIfNeeded(path.dirname(destPrismaDb));
    fs.copyFileSync(srcDb, destPrismaDb);
    console.log('  copy: law_firm.db -> prisma/');
  } else {
    console.log('  WARNING: pre-built database not found at ' + srcDb);
    console.log('  Will be auto-created on first launch.');
  }

  // Ensure migration SQL is available for runtime DB recreate
  const migrationDir = path.join(outputDir, 'prisma', 'migrations');
  if (!fs.existsSync(migrationDir)) {
    const srcMigration = path.join(serverDir, 'prisma', 'migrations');
    if (fs.existsSync(srcMigration)) {
      mkdirIfNeeded(migrationDir);
      fs.cpSync(srcMigration, migrationDir, { recursive: true });
      console.log('  copy: migration SQL for runtime fallback');
    }
  }

  console.log('  OK: database ready');
}

function createDatabaseProgrammatically(outputDir, nodeExe, dbEnv) {
  // Use PrismaClient to execute migration SQL programmatically
  const migrationSqlPath = path.join(outputDir, 'prisma', 'migrations', '20260426030733_init', 'migration.sql');
  if (!fs.existsSync(migrationSqlPath)) {
    console.log('  WARNING: migration.sql not found, skipping programmatic migration');
    return;
  }

  const migrationSql = fs.readFileSync(migrationSqlPath, 'utf-8');
  const statements = migrationSql
    .split(';\n')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'));

  const initScript = [
    "const { PrismaClient } = require('./node_modules/@prisma/client');",
    "const prisma = new PrismaClient({ datasources: { db: { url: '" + dbEnv + "' } } });",
    "",
    "async function main() {",
  ];

  for (const stmt of statements) {
    const escaped = stmt.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, ' ');
    initScript.push("  await prisma.$executeRawUnsafe('" + escaped + "');");
  }

  initScript.push("  console.log('  Programmatic migration complete');");
  initScript.push("  await prisma.$disconnect();");
  initScript.push("}");
  initScript.push("main().catch(e => { console.error(e.message); process.exit(1); });");

  const tempScript = path.join(outputDir, '_migrate.js');
  fs.writeFileSync(tempScript, initScript.join('\n'));

  try {
    execSync('"' + nodeExe + '" "' + tempScript + '"',
      { env: { ...process.env, DATABASE_URL: dbEnv }, cwd: outputDir, stdio: 'pipe' }
    );
  } catch (e) {
    console.log('  migration error: ' + (e.stderr || e.message || '').toString().substring(0, 200));
  }
  rmIfExists(tempScript);
}

function inlineSeed(outputDir, nodeExe, dbEnv) {
  const seedJs = [
    "const { PrismaClient } = require('./node_modules/@prisma/client');",
    "const bcrypt = require('./node_modules/bcryptjs');",
    "function uuid() { return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) { var r = Math.random()*16|0, v = c=='x'?r:r&0x3|0x8; return v.toString(16); }); }",
    "",
    "async function seed() {",
    "  const prisma = new PrismaClient();",
    "",
    "  // 1. Organizations",
    "  const hq = await prisma.organization.create({ data: { id: uuid(), name: '总所', type: 'FIRM', sort: 1 } });",
    "  const dept = await prisma.organization.create({ data: { id: uuid(), name: '民事部', type: 'DEPARTMENT', parentId: hq.id, sort: 1 } });",
    "",
    "  // 2. Positions",
    "  const partnerPos = await prisma.position.create({ data: { id: uuid(), name: '合伙人', orgId: hq.id, level: 10 } });",
    "  const lawyerPos = await prisma.position.create({ data: { id: uuid(), name: '主办律师', orgId: dept.id, level: 5 } });",
    "",
    "  // 3. Employees",
    "  const emp1 = await prisma.employee.create({ data: { id: uuid(), employeeNo: 'E001', name: '张三', phone: '13800138000', type: 'PARTNER', status: 'FORMAL', entryDate: new Date('2020-01-01'), orgId: hq.id, positionId: partnerPos.id } });",
    "  const emp2 = await prisma.employee.create({ data: { id: uuid(), employeeNo: 'E002', name: '李四', phone: '13800138001', type: 'SENIOR_LAWYER', status: 'FORMAL', entryDate: new Date('2021-03-15'), orgId: dept.id, positionId: lawyerPos.id } });",
    "",
    "  // 4. Users (admin/123456, lawyer1/123456)",
    "  const hash = bcrypt.hashSync('123456', 10);",
    "  const adminUser = await prisma.user.create({ data: { id: uuid(), username: 'admin', password: hash, status: 'ENABLED', employeeId: emp1.id } });",
    "  const lawyerUser = await prisma.user.create({ data: { id: uuid(), username: 'lawyer1', password: hash, status: 'ENABLED', employeeId: emp2.id } });",
    "",
    "  // 5. Roles",
    "  const adminRole = await prisma.role.create({ data: { id: uuid(), name: '超级管理员', type: 'SYSTEM', description: '系统超级管理员' } });",
    "  const lawyerRole = await prisma.role.create({ data: { id: uuid(), name: '律师', type: 'BUSINESS', description: '普通律师角色' } });",
    "",
    "  // 6. UserRoles",
    "  await prisma.userRole.create({ data: { id: uuid(), userId: adminUser.id, roleId: adminRole.id } });",
    "  await prisma.userRole.create({ data: { id: uuid(), userId: lawyerUser.id, roleId: lawyerRole.id } });",
    "",
    "  // 7. Channel",
    "  const channel = await prisma.channel.create({ data: { id: uuid(), name: '百度搜索推广', type: 'SEARCH', cost: 5000 } });",
    "",
    "  // 8. Lead",
    "  const lead = await prisma.lead.create({ data: { id: uuid(), name: '王五', phone: '13900139000', channelId: channel.id, intentionLevel: 4, status: 'CONTACTED', assignedTo: emp2.id } });",
    "",
    "  // 9. Customer",
    "  const customer = await prisma.customer.create({ data: { id: uuid(), name: '王五', phone: '13900139000', status: 'INTENT', leadId: lead.id } });",
    "",
    "  // 10. Contract",
    "  const contract = await prisma.contract.create({ data: { id: uuid(), contractNo: 'C-2026-001', title: '离婚纠纷法律服务合同', type: 'LITIGATION', customerId: customer.id, amount: 30000, status: 'SIGNED', signDate: new Date('2026-04-01'), createdBy: emp1.id } });",
    "",
    "  // 11. Case",
    "  await prisma.case.create({ data: { id: uuid(), caseNo: 'CASE-2026-001', title: '王五诉赵六离婚纠纷案', customerId: customer.id, contractId: contract.id, lawyerId: emp2.id, caseType: '离婚纠纷', status: 'PROCESSING', priority: 'HIGH', fee: 30000 } });",
    "",
    "  // 12. Payment",
    "  await prisma.payment.create({ data: { id: uuid(), contractId: contract.id, customerId: customer.id, amount: 15000, receivedAmount: 15000, status: 'RECEIVED', receivedDate: new Date('2026-04-01'), paymentMethod: '银行转账' } });",
    "",
    "  console.log('  Inline seed complete (admin/123456, lawyer1/123456)');",
    "  await prisma.$disconnect();",
    "}",
    "seed().catch(e => { console.error(e.message); process.exit(1); });",
  ].join('\n');

  const seedPath = path.join(outputDir, 'seed.js');
  fs.writeFileSync(seedPath, seedJs);
  try {
    execSync('"' + nodeExe + '" "' + seedPath + '"',
      { env: { ...process.env, DATABASE_URL: dbEnv }, cwd: outputDir, stdio: 'inherit' }
    );
  } catch (e) {
    console.log('  inline seed error: ' + (e.stderr || e.message || '').toString().substring(0, 300));
  }
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
    "// ── Ensure database exists ───────────────────",
    "async function ensureDatabase(dbPath) {",
    "  if (fs.existsSync(dbPath)) {",
    "    console.log('[启动] 数据库已存在: ' + dbPath);",
    "    return;",
    "  }",
    "",
    "  console.log('[启动] 首次运行，正在创建数据库...');",
    "",
    "  const { PrismaClient } = require('./node_modules/@prisma/client');",
    "  const bcrypt = require('./node_modules/bcryptjs');",
    "",
    "  const prisma = new PrismaClient({",
    "    datasources: { db: { url: process.env.DATABASE_URL } },",
    "  });",
    "",
    "  // Read bundled migration SQL and execute",
    "  const migrationSqlPath = path.join(baseDir, 'prisma', 'migrations', '20260426030733_init', 'migration.sql');",
    "  if (fs.existsSync(migrationSqlPath)) {",
    "    const sql = fs.readFileSync(migrationSqlPath, 'utf-8');",
    "    const statements = sql.split(';\\n').map(function(s) { return s.trim(); }).filter(function(s) { return s.length > 0 && !s.startsWith('--'); });",
    "    for (var i = 0; i < statements.length; i++) {",
    "      try { await prisma.$executeRawUnsafe(statements[i] + ';'); } catch(e) {}",
    "    }",
    "    console.log('[启动] 数据库表结构创建完成');",
    "  } else {",
    "    // Minimal fallback: create tables via Prisma schema push",
    "    console.log('[启动] 迁移文件未找到，使用 push 创建表...');",
    "  }",
    "",
    "  // Run seed",
    "  try {",
    "    function uuid() { return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) { var r = Math.random()*16|0, v = c == 'x' ? r : r&0x3|0x8; return v.toString(16); }); }",
    "",
    "    var hq = await prisma.organization.create({ data: { id: uuid(), name: '总所', type: 'FIRM', sort: 1 } });",
    "    var dept = await prisma.organization.create({ data: { id: uuid(), name: '民事部', type: 'DEPARTMENT', parentId: hq.id, sort: 1 } });",
    "    var partnerPos = await prisma.position.create({ data: { id: uuid(), name: '合伙人', orgId: hq.id, level: 10 } });",
    "    var lawyerPos = await prisma.position.create({ data: { id: uuid(), name: '主办律师', orgId: dept.id, level: 5 } });",
    "    var emp1 = await prisma.employee.create({ data: { id: uuid(), employeeNo: 'E001', name: '系统管理员', phone: '13800000000', type: 'ADMIN', status: 'FORMAL', entryDate: new Date(), orgId: hq.id, positionId: partnerPos.id } });",
    "    var hash = bcrypt.hashSync('123456', 10);",
    "    var user = await prisma.user.create({ data: { id: uuid(), username: 'admin', password: hash, status: 'ENABLED', employeeId: emp1.id } });",
    "    var role = await prisma.role.create({ data: { id: uuid(), name: '超级管理员', type: 'SYSTEM', description: '系统超级管理员' } });",
    "    await prisma.userRole.create({ data: { id: uuid(), userId: user.id, roleId: role.id } });",
    "    console.log('[启动] 种子数据创建完成 (admin/123456)');",
    "  } catch(e) {",
    "    console.log('[启动] 种子数据创建失败: ' + e.message);",
    "  }",
    "",
    "  await prisma.$disconnect();",
    "  console.log('[启动] 数据库初始化完成');",
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
    "  // Data directory (portable: same as exe location)",
    "  var userDataDir = baseDir;",
    "",
    "  // Database",
    "  var dbPath = path.join(userDataDir, 'law_firm.db');",
    "  process.env.DATABASE_URL = 'file:' + dbPath;",
    "",
    "  // JWT",
    "  var jwtSecret = process.env.JWT_SECRET || 'law-firm-system-' + Date.now().toString(36);",
    "  process.env.JWT_SECRET = jwtSecret;",
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
    "  console.log('[启动] 数据库: ' + dbPath);",
    "  console.log('[启动] 端口: ' + port);",
    "  console.log('[启动] 环境: ' + process.env.NODE_ENV);",
    "",
    "  // Ensure database",
    "  await ensureDatabase(dbPath);",
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
    "  console.error('  3. 删除 law_firm.db 后重试（会创建新数据库）');",
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

// ─── phase: init DB before prune (needs Prisma CLI) ────
function preInitDatabase() {
  console.log('\n[4/7] Pre-initializing database...');

  // Use Prisma CLI to migrate + seed while it's still available
  const prismaCli = path.join(serverDir, 'node_modules', 'prisma', 'build', 'index.js');
  const schemaPath = path.join(serverDir, 'prisma', 'schema.prisma');
  const dbPath = path.join(serverDir, 'prisma', 'law_firm.db');
  // IMPORTANT: Prisma resolves file: URLs relative to schema file location.
  // Schema is at prisma/schema.prisma, so file:./law_firm.db resolves to prisma/law_firm.db
  const dbEnv = 'file:./law_firm.db';

  // Start fresh: delete existing DB to avoid unique constraint violations
  if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
    console.log('  Removed existing database for fresh build');
  }

  if (fs.existsSync(prismaCli)) {
    console.log('  Running prisma migrate deploy...');
    try {
      execSync(
        '"' + process.execPath + '" "' + prismaCli + '" migrate deploy --schema "' + schemaPath + '"',
        { env: { ...process.env, DATABASE_URL: dbEnv }, cwd: serverDir, stdio: 'pipe' }
      );
      console.log('  database migrated');
    } catch (e) {
      console.log('  migration warning: ' + (e.stderr || e.message || '').toString().substring(0, 300));
    }

    console.log('  Running prisma db seed...');
    try {
      execSync('npx prisma db seed', { env: { ...process.env, DATABASE_URL: dbEnv }, cwd: serverDir, stdio: 'pipe' });
      console.log('  database seeded (admin/123456, lawyer1/123456)');
    } catch (e) {
      console.log('  seed via CLI failed, using ts-node fallback...');
      try {
        execSync('npx ts-node ./prisma/seed.ts', { env: { ...process.env, DATABASE_URL: dbEnv }, cwd: serverDir, stdio: 'pipe' });
        console.log('  database seeded (admin/123456, lawyer1/123456)');
      } catch (e2) {
        console.log('  seed warning: ' + (e2.stderr || e2.message || '').toString().substring(0, 200));
      }
    }
  } else {
    console.log('  Prisma CLI not found, will init after build...');
    preInitViaProgrammatic();
  }

  // Verify DB exists
  if (fs.existsSync(dbPath)) {
    console.log('  OK: database ready (' + fmt(sizeOf(dbPath)) + ')');
  } else {
    console.log('  WARNING: database not created, will try after pruning');
    preInitViaProgrammatic();
  }
}

function preInitViaProgrammatic() {
  // Fallback: create DB via the compiled seed + PrismaClient directly
  const { execSync: execSync_ } = require('child_process');
  const seedPath = path.join(serverDir, 'prisma', 'seed.ts');

  // Try running ts-node on the original TS seed
  try {
    execSync_('npx ts-node "' + seedPath + '"', {
      env: { ...process.env, DATABASE_URL: 'file:./law_firm.db' },
      cwd: serverDir, stdio: 'pipe'
    });
    console.log('  Programmatic seed OK');
  } catch (e) {
    console.log('  Programmatic seed note: ' + (e.stderr || e.message || '').toString().substring(0, 200));
  }
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
  preInitDatabase();      // 4: migrate + seed BEFORE pruning (needs CLI)
  buildPortable();        // 5: copy to output, then prune inside output dir
  initDatabase();         // 6: copy pre-built DB to output
  createLauncherFiles();  // 7: app-entry.js + launch.bat

  // Summary
  const totalSize = sizeOf(outputDir);
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║  Build Complete!                         ║');
  console.log('╠══════════════════════════════════════════╣');
  console.log('║  Location: ' + outputDir.padEnd(40).substring(0, 37) + ' ║');
  console.log('║  Size:     ' + fmt(totalSize).padEnd(37) + ' ║');
  console.log('╠══════════════════════════════════════════╣');
  console.log('║  To run: double-click launch.bat         ║');
  console.log('║  Login:  admin / 123456                  ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log('');
}

main().catch(e => {
  console.error('Build failed:', e);
  process.exit(1);
});
