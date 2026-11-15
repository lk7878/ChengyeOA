import type { SearchResult } from './common.js';
export declare function searchPerplexity(query: string, maxResults: number, apiKey: string, signal?: AbortSignal): Promise<SearchResult>;
