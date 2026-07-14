'use strict';

const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const { loadEnvironment, loadProductionEnvironment } = require('./dist/config/env');

// 判断是否在 pkg 打包环境中运行
const isPkg = typeof process.pkg !== 'undefined';
const isDev = !isPkg && process.env.NODE_ENV !== 'production';

// 获取可执行文件所在目录（用于数据库文件等可写数据）
function getUserDataDir() {
  if (isPkg) {
    return path.dirname(process.execPath);
  }
  return process.cwd();
}

// 设置环境变量
function setupEnv() {
  const userDataDir = getUserDataDir();
  if (isPkg) loadProductionEnvironment(process.env);
  else loadEnvironment(process.env);

  // 设置日志目录
  const logDir = path.join(userDataDir, 'logs');
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
  process.env.LOG_DIR = logDir;

  // Prisma 引擎路径处理（pkg 环境下需要特殊处理）
  if (isPkg) {
    // pkg 将 assets 解压到临时目录，需要设置 PRISMA_QUERY_ENGINE_LIBRARY
    const snapshotDir = path.dirname(process.execPath);
    // pkg 解压 .prisma 到 snapshot 文件系统，但原生 .node 需要绝对路径
    // Prisma 5.x 需要这个环境变量来定位 query engine
    const possibleEnginePaths = [
      path.join(snapshotDir, 'node_modules', '.prisma', 'client'),
      path.join(__dirname, 'node_modules', '.prisma', 'client'),
    ];
    for (const enginePath of possibleEnginePaths) {
      if (fs.existsSync(enginePath)) {
        process.env.PRISMA_QUERY_ENGINE_LIBRARY = enginePath;
        break;
      }
    }
  }
}

// 打开浏览器
function openBrowser(port) {
  const url = `http://localhost:${port}`;
  const platform = process.platform;
  let cmd;
  if (platform === 'win32') {
    cmd = `start "" "${url}"`;
  } else if (platform === 'darwin') {
    cmd = `open "${url}"`;
  } else {
    cmd = `xdg-open "${url}"`;
  }
  exec(cmd, (err) => {
    if (err) {
      console.log(`请手动打开浏览器访问: ${url}`);
    }
  });
}

// 主启动函数
async function main() {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║   律所闭环管理系统 v1.0.0                ║');
  console.log('║   Law Firm Management System            ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log('');

  // 设置环境变量
  setupEnv();

  const port = process.env.PORT || 7001;

  // 启动 Egg.js 应用
  console.log(`[启动] 正在启动服务器...`);

  const egg = require('egg');

  // Egg.js 启动配置
  // compiled TS output is in dist/, but node_modules is at root level
  const appBaseDir = isDev ? __dirname : path.join(__dirname, 'dist');
  const options = {
    baseDir: appBaseDir,
    workers: 1,
    port: parseInt(port),
    env: isDev ? 'local' : 'prod',
    framework: path.join(__dirname, 'node_modules', 'egg'),
  };

  egg.startCluster(options, () => {
    console.log(`[启动] 服务器已启动: http://localhost:${port}`);
    console.log(`[启动] 按 Ctrl+C 停止服务器`);
    console.log('');

    // 延迟打开浏览器，等待服务就绪
    setTimeout(() => {
      openBrowser(port);
    }, 1000);
  });
}

main().catch((err) => {
  console.error('[错误] 启动失败:', err);
  process.exit(1);
});
