/** Forks and delegated tasks retain the identity of their original case conversation. */
export async function sessionRoot(header, readHeader) {
  const seen = new Set();
  while (header?.parentSession) {
    if (seen.has(header.id) || seen.size >= 128) throw new Error('办案会话来源异常，请新建会话');
    seen.add(header.id);
    header = await readHeader(header.parentSession);
  }
  if (!header?.id) throw new Error('无法确认办案会话来源，请新建会话');
  return String(header.id);
}
