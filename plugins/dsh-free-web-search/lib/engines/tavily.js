import { approximateTimeRange, uniqueSources } from './common.js';
const TAVILY_URL = 'https://api.tavily.com/search';
export async function searchTavily(query, maxResults, apiKey, timeRange, signal) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort);
    let response;
    try {
        const body = {
            query,
            max_results: Math.min(maxResults, 20),
            search_depth: 'basic',
        };
        if (timeRange && 'days' in timeRange) {
            body.time_range = approximateTimeRange(timeRange.days);
        }
        response = await fetch(TAVILY_URL, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                accept: 'application/json',
                ...(apiKey ? { authorization: `Bearer ${apiKey}` } : { 'x-tavily-access-mode': 'keyless' }),
            },
            body: JSON.stringify(body),
            signal: controller.signal,
            redirect: 'error',
        });
    }
    catch (error) {
        if (signal?.aborted)
            throw error;
        throw new Error(`Tavily request failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
    }
    if (!response.ok) {
        const detail = await response.text().catch(() => '');
        if (response.status === 401) {
            throw new Error('Tavily API key is invalid (HTTP 401) - update it in Settings > Plugins > Free Web Search');
        }
        throw new Error(`Tavily API error (HTTP ${response.status}): ${detail.slice(0, 200)}`);
    }
    const data = (await response.json());
    const sources = (data.results ?? [])
        .filter((r) => r.url)
        .map((r) => ({
        url: r.url,
        ...(r.title ? { title: String(r.title) } : {}),
        ...(r.content ? { snippet: String(r.content).slice(0, 300) } : {}),
    }));
    return { sources: uniqueSources(sources, maxResults), truncated: false };
}
