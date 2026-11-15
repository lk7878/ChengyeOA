import type { BinaryDependency } from '../types.js';
export declare class DownloadError extends Error {
    readonly code: 'unsupported_platform' | 'integrity' | 'network' | 'verify_failed';
    constructor(code: 'unsupported_platform' | 'integrity' | 'network' | 'verify_failed', message: string);
}
export interface DownloadOutcome {
    path: string;
    bytes: number;
    /** First line of `<binary> -version`, e.g. "ffmpeg version 6.1.1 ...". */
    versionLine: string;
}
/**
 * Download one external binary into the plugin cache. Mirrors are tried in
 * order; the gzip is sha256-verified before decompression, and the binary is
 * proven by actually running `-version` once before success is reported.
 */
export declare function downloadBinary(dep: BinaryDependency, opts: {
    timeoutMs: number;
    signal?: AbortSignal;
    force?: boolean;
}): Promise<DownloadOutcome>;
export interface CacheManifestEntry {
    version: string;
    sha256: string;
    bytes: number;
    installedAt: string;
}
export type CacheManifest = Record<string, CacheManifestEntry>;
export declare function manifestPath(): string;
export declare function readCacheManifest(): Promise<CacheManifest>;
