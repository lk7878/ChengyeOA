export interface FetchedPage {
    url: string;
    title: string;
    content: string;
    truncated: boolean;
}
export declare function webFetch(url: string, maxLength?: number, signal?: AbortSignal): Promise<FetchedPage>;
