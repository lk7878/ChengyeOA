import type { SearchResult } from '../engines/index.js';
interface ProviderLike {
    search(request: Record<string, unknown>, signal?: AbortSignal): Promise<SearchResult>;
}
export declare function createAdvancedSearchTool(provider: ProviderLike): import("@deepseek-ai/dsh-tools").ToolDefinition;
export {};
