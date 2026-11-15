import type { SearchResult, TimeRange } from './common.js';
export declare function searchKeenableREST(query: string, maxResults: number, apiKey: string, timeRange?: TimeRange, signal?: AbortSignal): Promise<SearchResult>;
export declare function searchKeenableMCP(query: string, maxResults: number, timeRange?: TimeRange, signal?: AbortSignal): Promise<SearchResult>;
export declare function searchKeenable(query: string, maxResults: number, apiKey: string | undefined, timeRange?: TimeRange, signal?: AbortSignal): Promise<SearchResult>;
