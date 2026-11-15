import type { SearchResult, TimeRange } from './common.js';
export declare function searchTavily(query: string, maxResults: number, apiKey: string | undefined, timeRange?: TimeRange, signal?: AbortSignal): Promise<SearchResult>;
