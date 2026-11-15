export declare const FREE_SEARCH_NS: import("@deepseek-ai/dsh-settings").SettingsNamespace;
export declare const ALL_ENGINES: readonly ["ddg", "ddg-lite", "bing", "searxng", "anysearch", "exa", "tavily", "keenable", "perplexity", "deepseek-official"];
export declare const FREE_ENGINES: readonly ["ddg", "ddg-lite", "bing", "searxng", "anysearch"];
export type EngineId = (typeof ALL_ENGINES)[number];
export interface EngineTestResult {
    ok: true;
    sources: Array<{
        url: string;
        title?: string;
        snippet?: string;
    }>;
    truncated: boolean;
}
export interface EngineTestFailure {
    ok: false;
    error: string;
}
export type EngineTestFn = (engine: string, query?: string) => Promise<EngineTestResult | EngineTestFailure>;
