import { readFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { homedir } from 'node:os';

/** Local configuration is never taken from an OA page or a deep link. */
export function dataDirectory(env = process.env) {
  const value = env.CHENGYE_DESKTOP_HOME || join(env.LOCALAPPDATA || homedir(), 'ChengyeOA', 'desktop');
  if (!isAbsolute(value)) throw new Error('CHENGYE_DESKTOP_HOME 必须是绝对路径');
  return resolve(value);
}

export function validateOaUrl(value) {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash ||
      !(url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) {
    throw new Error('OA 地址须为 HTTPS；本地开发允许回环 HTTP，不能含凭据、查询参数或片段');
  }
  return url.href;
}

export async function readConfig(home) {
  const config = JSON.parse(await readFile(join(home, 'desktop.json'), 'utf8'));
  if (config.schema !== 1 || !isAbsolute(config.nodePath || '') || !isAbsolute(config.vendorPath || '')) {
    throw new Error('桌面配置无效，请重新运行 desktop:setup');
  }
  return { ...config, oaUrl: validateOaUrl(config.oaUrl) };
}

export function isTrustedBridgeCall(event, contents, origin) {
  try {
    return event.sender === contents && event.senderFrame === contents.mainFrame &&
      new URL(event.senderFrame.url).origin === origin;
  } catch { return false; } // A destroyed frame is never authorized.
}

export function navigation(target, origin) {
  try {
    const url = new URL(target);
    if (url.username || url.password) return 'deny';
    if (!['https:', 'http:'].includes(url.protocol)) return 'deny';
    return url.origin === origin ? 'allow' : 'external';
  } catch { return 'deny'; }
}

/** Do not inherit cloud credentials or application overrides into the local agent. */
export function hostEnvironment(home) {
  const env = {};
  for (const key of ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'HOME', 'LOCALAPPDATA', 'APPDATA', 'COMSPEC', 'NODE_EXTRA_CA_CERTS']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return { ...env, DSH_HOME: join(home, 'harness'), NO_COLOR: '1', DSH_TELEMETRY_DISABLED: '1', DSH_TELEMETRY_MODE: 'DISABLED' };
}
