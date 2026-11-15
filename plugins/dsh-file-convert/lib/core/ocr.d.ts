import type { BinaryDependency, ConvertContext, Logger } from './types.js';
/**
 * Metadata for the tesseract.js language data, used in dependency errors.
 * Conversions NEVER download it implicitly: without a cached pack they fail
 * with guidance pointing at install_ocr_dependencies.
 */
export declare const OCR_LANGUAGE_DATA: BinaryDependency;
export declare const TESSERACT: BinaryDependency;
export interface OcrEngine {
    name: string;
    recognizePng(png: Buffer, lang: string, ctx: ConvertContext): Promise<string>;
}
export declare function tessdataDir(): string;
/** True when every language of the set already sits in the plugin cache. */
export declare function ocrLanguagesCached(lang: string): Promise<boolean>;
/**
 * Explicitly download the language data for `lang` by warming a worker.
 * Called only from install_ocr_dependencies (user consented).
 */
export declare function installOcrLanguages(lang: string, ctx: {
    logger: Logger;
    signal?: AbortSignal;
}): Promise<{
    files: string[];
    bytes: number;
}>;
/** Thrown by engines when the requested OCR language data is not available. */
export declare class OcrLanguageMissingError extends Error {
    readonly lang: string;
    readonly detail?: string | undefined;
    constructor(lang: string, detail?: string | undefined);
}
/**
 * Pick an OCR engine: a locally installed Tesseract CLI first (fast, uses the
 * system's trained language data), then the bundled tesseract.js as a pure-npm
 * fallback. null = nothing usable (the caller reports how to fix it).
 */
export declare function resolveOcrEngine(resolve: (dep: BinaryDependency) => Promise<string | null>, logger: Logger): Promise<OcrEngine | null>;
