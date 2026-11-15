import type { ConvertResult, ConversionStatus, InspectResult } from './core/index.js';
export declare function formatBytes(n: number): string;
export declare function formatDuration(ms: number): string;
export declare function formatConvertResult(result: ConvertResult): string;
export declare function formatFailure(error: {
    code: string;
    message: string;
    detail?: string;
    hint?: string;
}): string;
export declare function formatInspect(inspect: InspectResult): string;
export declare function formatConversionList(statuses: ConversionStatus[]): string;
export declare function formatBatchSummary(summary: BatchSummary): string;
export interface BatchSummary {
    inputDir: string;
    outputDir?: string;
    outputFormat: string;
    converted: string[];
    skipped: string[];
    failed: string[];
    /** Anything the user must know beyond the counts (e.g. truncation at the limit). */
    notes: string[];
}
