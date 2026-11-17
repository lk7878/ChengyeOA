export interface EntryConfig { url: string | null; homeUrl: string | null; userId: string }
interface Connection {
  origin: string;
  search: string;
  config: (path: string) => Promise<EntryConfig>;
  launch: (challenge: string) => Promise<{ url: string }>;
  fetch: typeof fetch;
  replace: (url: string) => void;
}

// Both identities are checked on the server on every entry. Local storage and
// the mere presence of a subsystem cookie are never evidence of a matching user.
export async function connectSmartCase(connection: Connection) {
  const { origin, search, config, launch, fetch: request, replace } = connection;
  const query = new URLSearchParams(search), caseId = query.get('caseId');
  const settings = await config('/smart-case/config' + (caseId ? `?caseId=${encodeURIComponent(caseId)}` : ''));
  if (!settings.url) throw Error('智慧办案服务尚未配置');
  const start = new URL(settings.url);
  if (!['http:', 'https:'].includes(start.protocol)) throw Error('智慧办案入口配置无效');
  if (['127.0.0.1', 'localhost'].includes(start.hostname) &&
      !['127.0.0.1', 'localhost'].includes(new URL(origin).hostname)) throw Error('外网智慧办案入口尚未配置，请联系系统管理员');
  const finish = async (challenge: string) => {
    if (!/^[a-f0-9]{64}$/.test(challenge)) throw Error('登录校验无效，请重新从 OA 进入');
    const result = await launch(challenge), target = new URL(result.url);
    if (target.origin !== start.origin || target.pathname !== '/api/auth/oa/callback') throw Error('登录返回地址无效');
    replace(target.href);
  };
  const challenge = query.get('challenge');
  if (challenge) { await finish(challenge); return; }
  start.searchParams.set('return', origin);
  if (caseId) start.searchParams.set('caseId', caseId);

  // Different origins may prohibit credentialed fetches. Keep the established
  // top-level PKCE flow there instead of relaxing CORS or cookie protections.
  if (start.origin !== origin) { replace(start.href); return; }
  const me = await request(new URL('/api/me', start), { credentials: 'include', cache: 'no-store' });
  if (me.ok) {
    const data = await me.json();
    if (settings.userId && data.user?.oaUserId === settings.userId && settings.homeUrl) {
      const home = new URL(settings.homeUrl);
      if (home.origin !== start.origin || home.pathname !== '/wb/') throw Error('智慧办案工作台地址无效');
      if (caseId) home.searchParams.set('caseId', caseId);
      replace(home.href);
      return;
    }
  } else if (![401, 403].includes(me.status)) throw Error('智慧办案服务暂不可用，请稍后重试');

  start.searchParams.set('response', 'json');
  const prepared = await request(start, { credentials: 'include', cache: 'no-store' });
  if (!prepared.ok) throw Error('无法建立登录校验，请稍后重试');
  let nextChallenge: string;
  if (prepared.redirected) {
    // Compatibility with an already-running older service: fetch follows its
    // redirect but never mounts a second OA page or executes the returned HTML.
    const returned = new URL(prepared.url);
    if (returned.origin !== origin || returned.pathname !== '/smart-case') throw Error('登录返回地址无效');
    nextChallenge = returned.searchParams.get('challenge') || '';
    await prepared.body?.cancel();
  } else {
    const result = await prepared.json();
    nextChallenge = result.challenge;
  }
  await finish(nextChallenge);
}
