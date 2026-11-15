import type { SearchResult } from './common.js';
export declare function searchAnysearch(query: string, maxResults: number, signal?: AbortSignal): Promise<SearchResult>;
