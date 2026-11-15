import type { BinaryDependency, Logger } from '../types.js';
/** Project-selectable cache for binaries, OCR resources and office settings. */
export declare function pluginDataDir(): string;
/** Persistent cache for downloaded external binaries. */
export declare function cacheDir(): string;
export declare function cachedBinaryPath(name: string): string;
/** Expand a path pattern segment by segment; [] when nothing matches. */
export declare function expandPattern(pattern: string): Promise<string[]>;
/**
 * Resolution order: explicit config override → system PATH → known install
 * locations (Windows soffice is rarely on PATH) → plugin cache. Every
 * candidate must pass the dependency's probe when it declares one — a config
 * override pointing at a python without pdf2docx counts as missing.
 */
export declare function resolveBinaryCached(dep: BinaryDependency, overrides: Record<string, string | undefined>, which: (command: string) => Promise<string | null>, logger: Logger): Promise<string | null>;
