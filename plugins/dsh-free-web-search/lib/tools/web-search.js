import { defineTool } from '@deepseek-ai/dsh-tools';
import { parseTimeRange } from '../engines/index.js';
import { ALL_ENGINES } from '../constants.js';
export function createAdvancedSearchTool(provider) {
    return defineTool({
        name: 'advanced_search',
        description: 'Search the web with optional time filtering. Use when the user wants results from a specific time window (e.g. "last week", "this month") or when you need to force a specific engine. Falls back across engines automatically just like web_search.',
        parameters: {
            query: {
                type: 'string',
                description: 'The search query.',
            },
            maxResults: {
                type: 'number',
                description: 'Optional result count (default 5, max 10).',
            },
            timeRange: {
                type: 'string',
                description: 'Optional time filter. Fixed tiers: day, week, month, year. Custom: relative like 12h, 3d, 2mo, 1y, or an absolute date like 2026-07-01. Exa/Keenable apply it precisely; Tavily/SearXNG/DDG map to the nearest tier.',
            },
            engine: {
                type: 'string',
                description: 'Optional specific engine to try first: ddg, ddg-lite, bing, searxng, anysearch, exa, tavily, keenable, perplexity, deepseek-official.',
            },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    provider: { type: 'string' },
                    content: { type: 'string' },
                    sources: {
                        type: 'array',
                        items: {
                            type: 'object',
                            additionalProperties: false,
                            properties: {
                                url: { type: 'string' },
                                title: { type: 'string' },
                                snippet: { type: 'string' },
                                publishedAt: { type: 'string' },
                            },
                        },
                    },
                },
            },
            render(_args, value) {
                const v = value;
                const a = _args;
                const lines = v.sources.map((s) => `- [${s.title ?? s.url}](${s.url})${s.snippet ? ` - ${s.snippet.slice(0, 120)}` : ''}${s.publishedAt ? ` (${s.publishedAt})` : ''}`);
                const text = `Search (${v.provider}${a.timeRange ? `, timeRange=${a.timeRange}` : ''}):\n${lines.join('\n') || 'No results found.'}${v.content ? `\n\n${v.content}` : ''}`;
                return [{ type: 'text', text }];
            },
        },
        async execute(args) {
            if (!args.query || !String(args.query).trim())
                throw new Error('query is required');
            const request = {
                query: args.query,
                maxResults: Math.min(args.maxResults ?? 5, 10),
            };
            if (parseTimeRange(args.timeRange) !== undefined)
                request.timeRange = args.timeRange;
            if (args.engine && ALL_ENGINES.includes(args.engine))
                request.engine = args.engine;
            const result = await provider.search(request);
            return {
                provider: result.provider ?? 'bing',
                content: typeof result.content === 'string' ? result.content : '',
                sources: (result.sources ?? []).map((s) => {
                    const source = {};
                    if (s.url)
                        source.url = s.url;
                    if (s.title)
                        source.title = String(s.title);
                    if (s.snippet)
                        source.snippet = String(s.snippet);
                    if (s.publishedAt)
                        source.publishedAt = String(s.publishedAt);
                    return source;
                }),
            };
        },
    });
}
