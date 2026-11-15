export declare class SearchCache<T> {
    private map;
    buildKey(query: string, maxResults: number, timeRangeLabel: string, preferred: string): string;
    get(key: string): T | undefined;
    set(key: string, value: T, ttlMs: number): void;
}
