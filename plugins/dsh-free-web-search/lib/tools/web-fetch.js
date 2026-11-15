import { defineTool } from '@deepseek-ai/dsh-tools';
import { webFetch } from '../engines/web-fetch.js';
export function createWebFetchTool() {
    return defineTool({
        name: 'web_fetch',
        description: 'Fetch and read the content of a single web page. Returns the page text with HTML tags stripped. Use this to read articles, documentation, or any URL the user provides.',
        parameters: {
            url: {
                type: 'string',
                description: 'The URL to fetch.',
            },
            maxLength: {
                type: 'number',
                description: 'Maximum content length in characters (default 50000).',
            },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    url: { type: 'string' },
                    title: { type: 'string' },
                    content: { type: 'string' },
                    truncated: { type: 'boolean' },
                },
            },
            render(_args, value) {
                const v = value;
                const header = v.title ? `# ${v.title}\n${v.url}` : v.url;
                const suffix = v.truncated ? '\n\n[content truncated]' : '';
                return [{ type: 'text', text: `${header}\n\n${v.content}${suffix}` }];
            },
        },
        async execute(args) {
            if (!args.url?.trim())
                throw new Error('url is required');
            let url = args.url.trim();
            if (!/^https?:\/\//i.test(url))
                url = `https://${url}`;
            return webFetch(url, args.maxLength ?? 50_000);
        },
    });
}
