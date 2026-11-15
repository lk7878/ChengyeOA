import type { SearchResult } from './common.js';
export declare const PLATFORMS: Record<string, {
    name: string;
}>;
export declare function searchGithub(query: string, maxResults: number, signal?: AbortSignal): Promise<SearchResult>;
export declare function searchReddit(query: string, maxResults: number, signal?: AbortSignal): Promise<SearchResult>;
export declare function searchPlatform(platform: string, query: string, maxResults: number, signal?: AbortSignal): Promise<SearchResult>;
