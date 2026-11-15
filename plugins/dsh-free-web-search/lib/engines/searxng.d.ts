import type { SearchOptions, SearchResult } from './common.js';
export declare const SEARXNG_DEFAULT_INSTANCES: string[];
export declare function searchSearxng(query: string, maxResults: number, options?: SearchOptions, signal?: AbortSignal): Promise<SearchResult>;
