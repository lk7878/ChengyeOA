import { modelFetch } from './model-endpoint.mjs';
import { fail } from './server-workspace.mjs';

/** Fixed public probe: no conversations, files, knowledge or configuration writes. */
export async function probeModel(connection, signal, { fetch = modelFetch, timeoutMs = 20000 } = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) controller.abort();
  const timer = setTimeout(() => controller.abort(), timeoutMs); const started = Date.now();
  let reader;
  try {
    const cancelled = new Promise((_, reject) => {
      if (controller.signal.aborted) reject(fail('连通性测试已取消或超时，请检查网络和模型地址', 408));
      else controller.signal.addEventListener('abort', () => reject(fail('连通性测试已取消或超时，请检查网络和模型地址', 408)), { once: true });
    });
    return await Promise.race([cancelled, (async () => {
      const response = await fetch(connection.baseURL + '/chat/completions', {
        method: 'POST', signal: controller.signal,
        headers: { Authorization: 'Bearer ' + connection.apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: connection.model, stream: true, max_tokens: 32,
          messages: [{ role: 'user', content: 'Connection test only. Reply OK.' }],
          tools: [{ type: 'function', function: { name: 'connection_test', description: 'Connection probe, no side effects.', parameters: { type: 'object', properties: {}, additionalProperties: false } } }],
        }),
      });
      if (!response.ok) {
        await response.body?.cancel();
        const message = { 400: '模型或接口参数不兼容，请检查模型名称及Chat Completions支持情况', 401: 'API Key无效或已过期', 403: 'API Key无权调用该模型', 404: '模型或接口不存在，请检查Base URL及模型名称', 429: '调用受限：额度不足或请求过于频繁，请检查服务商账户' }[response.status];
        throw fail(message || '模型服务暂时不可用，请稍后重试', 422);
      }
      if (!response.headers.get('content-type')?.includes('text/event-stream') || !response.body) throw fail('接口未返回兼容的流式响应，请检查Base URL或模型协议', 422);
      reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ''; let bytes = 0;
      while (true) {
        const part = await reader.read(); if (part.done) break;
        bytes += part.value.byteLength; if (bytes > 65536) throw fail('测试响应异常，请检查模型服务配置', 422);
        buffer += decoder.decode(part.value, { stream: true });
        const lines = buffer.split('\n'); buffer = lines.pop();
        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const raw = line.slice(5).trim(); if (!raw || raw === '[DONE]') continue;
          let value; try { value = JSON.parse(raw); } catch { throw fail('模型返回格式不兼容', 422); }
          if (value.error) throw fail('模型返回调用错误，请检查服务商配置与额度', 422);
          if (value.choices?.some(choice => typeof choice.delta?.content === 'string' && choice.delta.content.length > 0 || choice.delta?.tool_calls?.some(tool => tool.function?.name))) {
            return { ok: true, latencyMs: Date.now() - started, message: '连接成功：认证、模型请求和流式响应正常。配置尚未保存；完整法律任务及工具执行仍需实际验证。' };
          }
        }
      }
      throw fail('模型未返回有效内容，请检查模型名称或服务状态', 422);
    })()]);
  } catch (error) {
    if (error.status) throw error;
    if (controller.signal.aborted) throw fail('连通性测试已取消或超时，请检查网络和模型地址', 408);
    throw fail('无法连接模型服务，请检查网络、HTTPS证书及Base URL；内部网关须由部署管理员配置', 422);
  } finally {
    clearTimeout(timer); signal?.removeEventListener('abort', abort); controller.abort();
    await reader?.cancel().catch(() => {});
  }
}
