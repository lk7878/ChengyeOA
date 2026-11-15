import type { BinaryDependency, Logger } from './types.js';
/**
 * Resolve an external binary: plugin config override → system PATH → plugin
 * cache (populated by install_media_dependencies). No auto-install happens
 * here — downloading is an explicit, user-approved tool call.
 */
export declare function resolveBinary(dep: BinaryDependency, overrides: Record<string, string | undefined>, logger: Logger): Promise<string | null>;
