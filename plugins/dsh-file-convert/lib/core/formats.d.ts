import type { FormatCategory, FormatId, FormatMeta } from './types.js';
/** Single source of truth for format metadata. */
export declare const FORMATS: Record<FormatId, FormatMeta>;
export declare const FORMAT_IDS: FormatId[];
/** Resolve a free-text format name ('JPEG', '.yml', 'webp') to a FormatId. */
export declare function parseFormatArg(value: string): FormatId | null;
/** Extension (without dot) → FormatId, e.g. 'jpeg' → 'jpg'. */
export declare function formatFromExtension(ext: string): FormatId | null;
/** Canonical output extension for a format, e.g. 'jpg' → '.jpg'. */
export declare function canonicalExtension(format: FormatId): string;
export declare function formatCategory(format: FormatId): FormatCategory;
