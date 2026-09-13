// Shared wire contract: no URLs, headers, local paths, uploads or arbitrary RPC.
export const MAX_REPLY_BYTES = 128 * 1024;
export function knowledgeCall(method, input = {}) {
  const invalid = () => { throw Object.assign(new Error('不支持的知识库操作或参数'), { status: 400 }); };
  const catalog = { list: ['offset'], documents: ['ref', 'offset'], search: ['ref', 'query'], read: ['ref', 'documentId', 'startLine', 'endLine'], wiki: ['ref', 'documentId', 'offset'], compiled: ['ref', 'documentId', 'offset'] };
  const fields = Object.hasOwn(catalog, method) ? catalog[method] : undefined;
  if (!fields || !input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !fields.includes(key))) invalid();
  const args = { ...input };
  for (const key of ['ref', 'documentId', 'query']) {
    const required = key === 'ref' ? method !== 'list' : key === 'query' ? method === 'search' : ['read', 'compiled'].includes(method);
    if (args[key] === undefined && !required) continue;
    if (typeof args[key] !== 'string' || !args[key].trim() || args[key].length > (key === 'query' ? 2000 : 160)) invalid();
  }
  for (const key of ['offset', 'startLine', 'endLine']) if (args[key] !== undefined && (!Number.isSafeInteger(args[key]) || args[key] < (key === 'offset' ? 0 : 1) || args[key] > 1_000_000)) invalid();
  if (method === 'read') {
    args.startLine ??= 1; args.endLine ??= args.startLine + 199;
    if (args.endLine < args.startLine || args.endLine - args.startLine >= 200) invalid();
  }
  return { method, args };
}
export function boundedReply(value) {
  if (Buffer.byteLength(JSON.stringify(value) ?? '') > MAX_REPLY_BYTES) throw Object.assign(new Error('知识库结果过大，请缩小读取范围'), { status: 413 });
  return value;
}
