import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request } from 'node:https';
import { Readable } from 'node:stream';

export function publicAddress(address) {
  if (isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0)) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19)));
  }
  // Only global unicast IPv6; excludes loopback, mapped IPv4, local and multicast.
  return isIP(address) === 6 && /^[23]/i.test(address) && !address.toLowerCase().startsWith('2001:db8:');
}
export function modelUrl(input) {
  if (typeof input !== 'string' || input.length > 2048) throw new Error('请输入有效的模型Base URL');
  let url; try { url = new URL(input.trim()); } catch { throw new Error('模型Base URL格式无效'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname.includes('..')) throw new Error('模型地址须为不带账号、查询参数的HTTPS接口基础地址');
  if (url.pathname.endsWith('/chat/completions')) throw new Error('Base URL不应包含 /chat/completions');
  return url.href.replace(/\/+$/, '');
}
export async function endpointAddresses(input) {
  const url = new URL(input); const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const values = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await lookup(hostname, { all: true, verbatim: true });
  // Only deployment operators may explicitly opt into an internal model gateway.
  const allowedInternal = (process.env.CHENGYE_MODEL_ORIGINS || '').split(',').includes(url.origin);
  if (!values.length || (!allowedInternal && values.some(item => !publicAddress(item.address)))) throw new Error('模型地址不允许访问内网或本机；内部网关须由部署管理员配置');
  return values;
}
/** Pin the validated DNS result for the actual request and reject redirects. No DNS-rebinding/redirect credential leak. */
export async function modelFetch(input, init = {}) {
  const url = new URL(String(input));
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('模型请求地址无效');
  const addresses = await endpointAddresses(url.href); init.signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const headers = Object.fromEntries(new Headers(init.headers));
    const req = request(url, { method: init.method || 'GET', headers, signal: init.signal,
      lookup: (_hostname, options, callback) => options.all ? callback(null, addresses) : callback(null, addresses[0].address, addresses[0].family) }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400) { res.resume(); reject(new Error('模型接口重定向已拒绝，请使用最终Base URL')); return; }
      const responseHeaders = new Headers(); for (const [key, value] of Object.entries(res.headers)) if (value !== undefined) responseHeaders.set(key, Array.isArray(value) ? value.join(', ') : value);
      resolve(new Response(Readable.toWeb(res), { status: res.statusCode, headers: responseHeaders }));
    });
    req.setTimeout(300000, () => req.destroy(new Error('模型连接超时'))); req.once('error', reject);
    req.end(init.body);
  });
}
