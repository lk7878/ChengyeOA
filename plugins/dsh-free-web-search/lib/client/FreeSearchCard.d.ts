declare const BRIDGE_PREFIX = "/api/dsh-free-web-search-settings";
declare const NS = "free-search";
interface EngineEntry {
    id: string;
    label: string;
    badge: 'FREE' | 'API KEY';
    link: string;
}
declare const ENGINES: EngineEntry[];
interface BridgeResponse<T = unknown> {
    ok: boolean;
    value?: T;
    message?: string;
}
interface SettingsView {
    ns: string;
    value?: Record<string, unknown>;
    secrets?: Array<{
        path: string[];
        set: boolean;
    }>;
}
interface DescribeResult {
    namespaces: SettingsView[];
    writable: boolean;
}
declare function bridgeDescribe(): Promise<BridgeResponse<DescribeResult>>;
declare function bridgeMutate(payload: unknown): Promise<BridgeResponse<SettingsView>>;
export declare function FreeSearchCard(): import("react").JSX.Element | null;
export { ENGINES, bridgeDescribe, bridgeMutate, NS, BRIDGE_PREFIX };
