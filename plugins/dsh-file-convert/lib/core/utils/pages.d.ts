import type { ConvertError } from '../types.js';
export declare class PageRangeError extends Error {
    readonly error: ConvertError;
    constructor(error: ConvertError);
}
/**
 * Parse a one-based, inclusive page selection like "1-3,5,8-10" into a
 * deduplicated, ascending list of page numbers bounded by pageCount.
 * Throws PageRangeError (code: invalid_input) on malformed or out-of-range
 * selections so agents get a correction-friendly message.
 */
export declare function parsePageRange(spec: string, pageCount: number): number[];
