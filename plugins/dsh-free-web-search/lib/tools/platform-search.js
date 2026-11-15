import { defineTool } from '@deepseek-ai/dsh-tools';
import { searchPlatform } from '../engines/index.js';
const PLATFORMS = {
    github: { name: 'GitHub' },
    reddit: { name: 'Reddit' },
};
export function createPlatformSearchTool(getEnabledPlatforms) {
    return defineTool({
        name: 'platform_search',
        description: 'Search a specific platform (GitHub / Reddit) for a query. Returns source URLs with titles and snippets.',
        parameters: {
            platform: {
                type: 'string',
                description: 'Platform to search: github, reddit',
            },
            query: {
                type: 'string',
                description: 'The search query.',
            },
            maxResults: {
                type: 'number',
                description: 'Optional result count (default 5, max 10).',
            },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    platform: { type: 'string' },
                    sources: {
                        type: 'array',
                        items: {
                            type: 'object',
                            additionalProperties: false,
                            properties: {
                                url: { type: 'string' },
                                title: { type: 'string' },
                                snippet: { type: 'string' },
                            },
                        },
                    },
                },
            },
            render(_args, value) {
                const v = value;
                const lines = v.sources.map((s) => `- [${s.title ?? s.url}](${s.url})${s.snippet ? ` - ${s.snippet.slice(0, 120)}` : ''}`);
                return [{ type: 'text', text: `Platform search (${v.platform}):\n${lines.join('\n') || 'No results found.'}` }];
            },
        },
        async execute(args) {
            const platform = args.platform;
            if (!PLATFORMS[platform]) {
                throw new Error(`unknown platform "${platform}" - use one of: ${Object.keys(PLATFORMS).join(', ')}`);
            }
            const enabled = getEnabledPlatforms();
            if (!enabled.includes(platform)) {
                throw new Error(`platform "${platform}" is disabled in settings`);
            }
            if (!args.query?.trim())
                throw new Error('query is required');
            const limit = Math.min(args.maxResults ?? 5, 10);
            const result = await searchPlatform(platform, args.query, limit);
            const sources = (result.sources ?? []).map((s) => {
                const source = {};
                if (s.url)
                    source.url = s.url;
                if (s.title)
                    source.title = String(s.title);
                if (s.snippet)
                    source.snippet = String(s.snippet);
                return source;
            });
            return { platform, sources };
        },
    });
}
