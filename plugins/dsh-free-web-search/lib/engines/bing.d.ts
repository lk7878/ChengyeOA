import type { SearchOptions, SearchResult, Source } from './common.js';
/**
 * Parse the result blocks out of a Bing SERP. Split from the fetch so the
 * parsing — the half that broke, and the half that changes whenever Bing
 * reshapes its markup — can be tested against a captured page instead of the
 * live web.
 */
export declare function parseBingResults(html: string, maxResults: number): Source[];
export declare function searchBing(query: string, maxResults: number, options?: SearchOptions, signal?: AbortSignal): Promise<SearchResult>;
