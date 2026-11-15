import { extractBingUrl, fetchHtmlWithRetry, stripTags, uniqueSources } from './common.js';
const BING_URL = 'https://www.bing.com/search';
/**
 * Parse the result blocks out of a Bing SERP. Split from the fetch so the
 * parsing — the half that broke, and the half that changes whenever Bing
 * reshapes its markup — can be tested against a captured page instead of the
 * live web.
 */
export function parseBingResults(html, maxResults) {
    const blocks = html.match(/<li class="b_algo"[\s\S]*?<\/li>/g) ?? [];
    const sources = [];
    for (const block of blocks) {
        const hrefMatch = block.match(/<a[^>]*href="(https?:\/\/[^"]+)"/);
        const titleMatch = block.match(/<h2[^>]*>[\s\S]*?<a[^>]*>(.*?)<\/a>[\s\S]*?<\/h2>/);
        const snippetMatch = block.match(/<p[^>]*>([\s\S]*?)<\/p>/);
        const url = extractBingUrl(hrefMatch?.[1]);
        if (url === null)
            continue;
        sources.push({
            url,
            ...(titleMatch ? { title: stripTags(titleMatch[1]) } : {}),
            ...(snippetMatch ? { snippet: stripTags(snippetMatch[1]) } : {}),
        });
    }
    return uniqueSources(sources, maxResults);
}
export async function searchBing(query, maxResults, options, signal) {
    const params = new URLSearchParams({ q: query, mkt: options?.bingMarket ?? 'en-US' });
    const html = await fetchHtmlWithRetry(`${BING_URL}?${params}`, signal);
    return { sources: parseBingResults(html, maxResults), truncated: false };
}
