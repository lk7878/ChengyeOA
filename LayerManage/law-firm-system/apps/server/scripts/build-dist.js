// Build distribution package
// Creates a self-contained directory with node.exe that runs without Node.js installed

const fs = require('fs');
const path = require('path');

const serverDir = path.join(__dirname, '..');
const outputDir = path.join(serverDir, '..', 'dist', 'law-firm-system-' + Date.now());

console.log('Building distribution package...');
console.log('  Output: ' + outputDir);

// Clean and create output directory
if (fs.existsSync(outputDir)) {
  fs.rmSync(outputDir, { recursive: true });
}
fs.mkdirSync(outputDir, { recursive: true });

// Copy compiled dist contents (app/, config/, app.js, public/, prisma/)
const distSrc = path.join(serverDir, 'dist');
const dirsToCopy = ['app', 'config', 'public', 'prisma'];
for (const dir of dirsToCopy) {
  const src = path.join(distSrc, dir);
  const dest = path.join(outputDir, dir);
  if (fs.existsSync(src)) {
    fs.cpSync(src, dest, { recursive: true });
    console.log('  copy: ' + dir + '/');
  }
}

// Copy app.js (boot hook)
const appJsSrc = path.join(distSrc, 'app.js');
if (fs.existsSync(appJsSrc)) {
  fs.copyFileSync(appJsSrc, path.join(outputDir, 'app.js'));
  console.log('  copy: app.js');
}

// Copy node_modules
const nmSrc = path.join(serverDir, 'node_modules');
const nmDest = path.join(outputDir, 'node_modules');
console.log('  copying node_modules/ (this may take a minute)...');
fs.cpSync(nmSrc, nmDest, { recursive: true, dereference: true });
console.log('  copy: node_modules/');

// Copy node.exe from system
const systemNode = process.execPath;
const destNode = path.join(outputDir, 'node.exe');
fs.copyFileSync(systemNode, destNode);
console.log('  copy: node.exe');

// Create package.json for Egg.js
const pkgJson = { name: 'law-firm-server', egg: { typescript: false } };
fs.writeFileSync(path.join(outputDir, 'package.json'), JSON.stringify(pkgJson, null, 2));

// Initialize database (run migration and seed)
console.log('  initializing database...');
const { execSync } = require('child_process');
const nodeExe = destNode;
const prismaCli = path.join(outputDir, 'node_modules', 'prisma', 'build', 'index.js');
const seedScript = path.join(outputDir, 'seed.js');

try {
  execSync(
    '"' + nodeExe + '" "' + prismaCli + '" migrate deploy --schema "' +
    path.join(outputDir, 'prisma', 'schema.prisma') + '"',
    { env: { ...process.env, DATABASE_URL: 'file:./law_firm.db' }, cwd: outputDir, stdio: 'pipe' }
  );
  console.log('  database migrated');
} catch (e) {
  console.log('  migration warning: ' + e.message);
}

// Create seed script for distribution
const seedContent = [
  "const { PrismaClient } = require('./node_modules/@prisma/client');",
  "const bcrypt = require('./node_modules/bcryptjs');",
  "function uuid() { return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) { var r = Math.random()*16|0, v = c=='x'?r:r&0x3|0x8; return v.toString(16); }); }",
  "async function seed() {",
  "  const prisma = new PrismaClient();",
  "  var org = await prisma.organization.create({ data: { id: uuid(), name: '总所', type: 'FIRM', sort: 1, status: 'ENABLED' } });",
  "  var pos = await prisma.position.create({ data: { id: uuid(), name: '管理员', orgId: org.id, level: 1, status: 'ENABLED' } });",
  "  await prisma.employee.create({ data: { id: uuid(), employeeNo: 'EMP001', name: '系统管理员', phone: '13800000000', type: 'ADMIN', status: 'FORMAL', entryDate: new Date(), orgId: org.id, positionId: pos.id } });",
  "  var hashedPassword = bcrypt.hashSync('123456', 10);",
  "  var user = await prisma.user.create({ data: { id: uuid(), username: 'admin', password: hashedPassword, status: 'ENABLED', employeeId: (await prisma.employee.findFirst()).id } });",
  "  var role = await prisma.role.create({ data: { id: uuid(), name: '超级管理员', type: 'SYSTEM', status: 'ENABLED', description: '系统超级管理员' } });",
  "  await prisma.userRole.create({ data: { id: uuid(), userId: user.id, roleId: role.id } });",
  "  console.log('  seed: admin/123456 created');",
  "  await prisma.$disconnect();",
  "}",
  "seed().catch(function(e) { console.error(e); process.exit(1); });",
].join('\n');
fs.writeFileSync(path.join(outputDir, 'seed.js'), seedContent);

try {
  execSync(
    '"' + nodeExe + '" "' + path.join(outputDir, 'seed.js') + '"',
    { env: { ...process.env, DATABASE_URL: 'file:./law_firm.db' }, cwd: outputDir, stdio: 'pipe' }
  );
  console.log('  database seeded');
} catch (e) {
  console.log('  seed warning: ' + e.message);
}

// Move database from prisma/ to root (Prisma resolves file: relative to schema)
const prismaDb = path.join(outputDir, 'prisma', 'law_firm.db');
const rootDb = path.join(outputDir, 'law_firm.db');
if (fs.existsSync(prismaDb)) {
  fs.copyFileSync(prismaDb, rootDb);
  console.log('  database moved to root');
}

// Create entry point (app-entry.js) for the distribution
const entryJsContent = [
  "'use strict';",
  "const path = require('path');",
  "const fs = require('fs');",
  "const { exec } = require('child_process');",
  "",
  "const baseDir = __dirname;",
  "",
  "function openBrowser(port) {",
  "  var url = 'http://localhost:' + port;",
  "  exec('start \"\" \"' + url + '\"', function() {});",
  "}",
  "",
  "async function main() {",
  "  console.log('');",
  "  console.log('╔══════════════════════════════════════════╗');",
  "  console.log('║   律所闭环管理系统 v1.0.0                ║');",
  "  console.log('╚══════════════════════════════════════════╝');",
  "  console.log('');",
  "",
  "  var dbPath = path.join(baseDir, 'law_firm.db');",
  "  process.env.DATABASE_URL = 'file:' + dbPath;",
  "  process.env.JWT_SECRET = process.env.JWT_SECRET || 'law-firm-system-prod-' + Date.now().toString(36);",
  "  process.env.JWT_EXPIRES_IN = '7d';",
  "  process.env.JWT_REFRESH_EXPIRES_IN = '30d';",
  "  process.env.NODE_ENV = 'production';",
  "",
  "  var logDir = path.join(baseDir, 'logs');",
  "  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });",
  "  process.env.LOG_DIR = logDir;",
  "",
  "  var port = process.env.PORT || 7001;",
  "",
  "  console.log('[启动] 数据库: ' + dbPath);",
  "  console.log('[启动] 端口: ' + port);",
  "  console.log('[启动] 正在启动服务器...');",
  "",
  "  var egg = require('egg');",
  "",
  "  egg.startCluster({",
  "    baseDir: baseDir,",
  "    workers: 1,",
  "    port: parseInt(port),",
  "    env: 'prod',",
  "    framework: path.join(baseDir, 'node_modules', 'egg'),",
  "  }, function() {",
  "    console.log('[启动] 服务器已启动: http://localhost:' + port);",
  "    setTimeout(function() { openBrowser(port); }, 1500);",
  "  });",
  "}",
  "",
  "main().catch(function(err) {",
  "  console.error('[错误] 启动失败:', err);",
  "  process.exit(1);",
  "});",
].join('\n');

fs.writeFileSync(path.join(outputDir, 'app-entry.js'), entryJsContent);
console.log('  create: app-entry.js');

// Create launch.bat
const launchBat = [
  '@echo off',
  'chcp 65001 >nul',
  'title 律所管理系统',
  'echo.',
  'echo ╔══════════════════════════════════════╗',
  'echo ║  律所闭环管理系统 v1.0.0            ║',
  'echo ╚══════════════════════════════════════╝',
  'echo.',
  'echo Starting server on http://localhost:7001',
  'echo.',
  '"%~dp0node.exe" "%~dp0app-entry.js"',
  'pause',
].join('\r\n');

fs.writeFileSync(path.join(outputDir, 'launch.bat'), launchBat);
console.log('  create: launch.bat');

// Calculate size
let totalSize = 0;
try {
  for (const file of fs.readdirSync(outputDir, { recursive: true })) {
    try { totalSize += fs.statSync(path.join(outputDir, file)).size; } catch (e) {}
  }
} catch (e) {}

console.log('');
console.log('Distribution built successfully!');
console.log('  Location: ' + outputDir);
console.log('  Size: ' + (totalSize / 1024 / 1024).toFixed(1) + ' MB');
console.log('');
console.log('To run: double-click launch.bat');
