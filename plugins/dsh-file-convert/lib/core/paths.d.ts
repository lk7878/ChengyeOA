import type { FormatId } from './types.js';
/**
 * Default output for a single-file conversion: next to the source file, same
 * base name, canonical extension of the target format.
 */
export declare function defaultOutputPath(input: string, to: FormatId): string;
/**
 * Default output for a batch conversion: under outputDir, same base name.
 * outputDir defaults to `<inputDir>/output` and is created by the caller.
 */
export declare function batchOutputPath(outputDir: string, input: string, to: FormatId): string;
