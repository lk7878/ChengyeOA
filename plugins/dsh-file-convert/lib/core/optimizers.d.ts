import type { BinaryDependency, ConvertContext, ConvertError, FormatId } from './types.js';
export declare const GHOSTSCRIPT: BinaryDependency;
export type OptimizeResult = {
    ok: true;
    input: string;
    output: string;
    format: FormatId;
    bytesIn: number;
    bytesOut: number;
    durationMs: number;
    /** Human-readable summary of what was applied (bitrate, quality...). */
    detail: string;
    warnings: string[];
} | {
    ok: false;
    error: ConvertError;
};
export interface BinaryResolver {
    (dep: BinaryDependency): Promise<string | null>;
}
/**
 * Shrink a file toward a target size, fully local.
 * - mp4/mov video: two-pass x264 with a bitrate computed from the target
 *   (output is always mp4; the container may change for MOV sources).
 * - jpg/webp: binary-search the largest encoder quality that fits.
 * - png: libimagequant palette search (lossy color reduction, by design).
 * GIF and PDF optimization are not supported yet (pdf planned with V0.3).
 */
export declare function optimizeFile(input: string, targetBytes: number, output: string, format: FormatId, resolve: BinaryResolver, ctx: ConvertContext): Promise<OptimizeResult>;
