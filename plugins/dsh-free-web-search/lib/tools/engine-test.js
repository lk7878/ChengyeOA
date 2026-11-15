import { defineTool } from '@deepseek-ai/dsh-tools';
import { ALL_ENGINES } from '../constants.js';
export function createEngineTestTool(runEngineTest) {
    return defineTool({
        name: 'free_search_test',
        description: 'Test every configured web search engine and report which ones work. Use this to verify engine availability, diagnose search failures, or check whether an API key is configured.',
        parameters: {
            engines: {
                type: 'array',
                description: 'Which engines to test (default: all). Options: ' + ALL_ENGINES.join(', ') + '.',
                items: { type: 'string' },
            },
            query: {
                type: 'string',
                description: "Optional search query for the test (default: 'DeepSeek Harness').",
            },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    results: {
                        type: 'array',
                        items: {
                            type: 'object',
                            additionalProperties: false,
                            properties: {
                                engine: { type: 'string' },
                                status: { type: 'string' },
                                results: { type: 'number' },
                                error: { type: 'string' },
                                sampleTitle: { type: 'string' },
                                sampleUrl: { type: 'string' },
                            },
                        },
                    },
                },
            },
            render(_args, value) {
                const v = value;
                const lines = v.results.map((r) => {
                    if (r.status === 'ok') {
                        return `- ${r.engine}: OK (${r.results} results${r.sampleTitle ? `, e.g. "${r.sampleTitle.slice(0, 40)}"` : ''})`;
                    }
                    return `- ${r.engine}: FAIL - ${r.error}`;
                });
                return [{ type: 'text', text: `Search engine test:\n${lines.join('\n')}` }];
            },
        },
        async execute(args) {
            const engines = args.engines && args.engines.length > 0 ? args.engines : [...ALL_ENGINES];
            const results = [];
            for (const engine of engines) {
                const r = await runEngineTest(engine, args.query);
                if (r.ok) {
                    const item = { engine, status: 'ok', results: r.sources.length };
                    if (r.sources[0]?.title)
                        item.sampleTitle = String(r.sources[0].title);
                    if (r.sources[0]?.url)
                        item.sampleUrl = String(r.sources[0].url);
                    results.push(item);
                }
                else {
                    results.push({ engine, status: 'fail', error: r.error ?? 'unknown error' });
                }
            }
            return { results };
        },
    });
}
