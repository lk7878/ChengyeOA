export interface Source {
    url: string;
    title?: string;
    snippet?: string;
    publishedAt?: string;
}
export interface SearchResult {
    sources: Source[];
    truncated: boolean;
    content?: string;
    provider?: string;
}
export type TimeRange = {
    days: number;
} | {
    after: string;
};
export interface SearchOptions {
    region?: string;
    bingMarket?: string;
    searxngInstances?: string[];
    timeRange?: TimeRange;
}
export declare const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
export declare const ACCEPT_LANG = "en-US,en;q=0.9";
export declare const TIME_RANGES: readonly ["day", "week", "month", "year"];
export type TimeRangePreset = (typeof TIME_RANGES)[number];
export declare function parseTimeRange(input: unknown): TimeRange | undefined;
export declare function approximateTimeRange(days: number): TimeRangePreset;
export declare function isoDaysAgo(days: number): string;
export declare function decodeEntities(text: string): string;
export declare function stripTags(html: string): string;
export declare function cleanSnippet(text: string | undefined): string | undefined;
/**
 * Bing serves no result URLs. Every href on a SERP is its own click tracker —
 * `https://www.bing.com/ck/a?…&u=a1<base64url of the target>&ntb=1` — and it
 * arrives with HTML entities intact. Handed to a model unchanged, the citation
 * is a `bing.com/ck/a?!&amp;&amp;…` link that answers `204` and leads nowhere.
 *
 * So: decode the entities, then unwrap `u=a1…`. Anything unexpected degrades to
 * the entity-decoded href rather than dropping the result — a tracker link that
 * at least resolves beats no source at all.
 */
export declare function extractBingUrl(href: string | undefined): string | null;
export declare function extractDdgUrl(rel: string | undefined): string | null;
export declare function uniqueSources(sources: Source[], limit: number): Source[];
export declare function fetchHtml(url: string, signal?: AbortSignal): Promise<string>;
export declare function checkDdgAntiBot(html: string): void;
export declare function fetchHtmlWithRetry(url: string, signal?: AbortSignal): Promise<string>;
