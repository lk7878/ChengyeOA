import type { IncomingMessage, ServerResponse } from 'node:http';
import { settingsNamespace } from '@deepseek-ai/dsh-settings';
import type { SearchResult, TimeRange } from '../engines/index.js';
export declare const BRIDGE_PREFIX = "/api/dsh-free-web-search-settings";
interface SettingsDescriptor {
    ns: string;
    schema: unknown;
    value: unknown;
    base?: unknown;
    user?: unknown;
    secrets?: Array<{
        path: string[];
        set: boolean;
    }>;
    revision: number;
}
interface SettingsService {
    describe(opts: {
        redactSecrets: boolean;
    }): SettingsDescriptor[];
    mutate(ns: ReturnType<typeof settingsNamespace>, ops: unknown[], expectedRevision?: number): Promise<void>;
    writable?: boolean;
}
type SearchFn = (request: Record<string, unknown>) => Promise<SearchResult>;
type TestEngineFn = (engine: string, query: string, timeRange?: TimeRange) => Promise<{
    ok: true;
    sources: Array<{
        url: string;
        title?: string;
        snippet?: string;
    }>;
    truncated: boolean;
} | {
    ok: false;
    error: string;
}>;
export interface BridgeRoute {
    kind: 'exact';
    path: string;
    handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
}
export declare function makeBridgeRoutes(settings: SettingsService, search: SearchFn, testEngine: TestEngineFn): BridgeRoute[];
export {};
