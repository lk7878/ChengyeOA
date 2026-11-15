import type { SearchOptions, SearchResult } from './common.js';
export declare function searchDdgHtml(query: string, maxResults: number, options?: SearchOptions, signal?: AbortSignal): Promise<SearchResult>;
export declare function searchDdgLite(query: string, maxResults: number, options?: SearchOptions, signal?: AbortSignal): Promise<SearchResult>;
