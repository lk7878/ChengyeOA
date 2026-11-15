import type { SearchResult, TimeRange } from './common.js';
export declare function searchExa(query: string, maxResults: number, apiKey: string, timeRange?: TimeRange, signal?: AbortSignal): Promise<SearchResult>;
export declare function searchExaMCP(query: string, maxResults: number, signal?: AbortSignal): Promise<SearchResult>;
