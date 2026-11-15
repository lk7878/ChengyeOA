import { type DetectOutcome } from './detect.js';
import type { ConvertResult, Converter, ConversionStatus, FormatId, InspectResult, Logger } from './types.js';
export interface RouterDefaults {
    /** Default JPEG/WebP quality (1-100). */
    quality: number;
    /** Default rasterization DPI for pdf/svg inputs. */
    dpi: number;
    /** Cooperative deadline for one conversion, in milliseconds. */
    timeoutMs: number;
    /**
     * When non-empty, EXPLICIT output paths must resolve inside one of these
     * directories (case-insensitive on Windows). Default output (next to the
     * input) is exempt. Empty = unrestricted, which is fine for a personal
     * single-user harness; set it for shared deployments.
     */
    outputRoots?: string[];
    /** Config-key overrides for external binary resolution, e.g. ffmpegPath. */
    binaryOverrides?: Record<string, string>;
    /** Inputs larger than this are refused (bytes). Default 2 GiB. */
    maxInputBytes?: number;
    /** Full-document PDF rasterization refuses to exceed this page count. Default 200. */
    maxPdfPages?: number;
    /** Rasterized pixels per page are clamped to this. Default 16 MP. */
    maxOutputPixels?: number;
}
export interface ConvertFileRequest {
    input: string;
    /** Free-text target format; aliases like 'jpeg' / '.yml' are accepted. */
    outputFormat: string;
    /** Absolute output path; defaults to next to the input file. */
    output?: string;
    overwrite?: boolean;
    quality?: number;
    dpi?: number;
    /** One-based inclusive page selection for PDF inputs, e.g. '1-3,5'. */
    pages?: string;
    /** OCR the pages instead of reading the text layer (PDF → TXT). */
    ocr?: boolean;
    /** OCR languages, '+'-separated. Default 'chi_sim+eng'. */
    ocrLang?: string;
}
export interface ConvertRunContext {
    logger: Logger;
    signal?: AbortSignal;
}
/**
 * The facade every tool talks to. Owns the capability registry, detection,
 * dependency checks, overwrite policy, and error normalization — converters
 * only see well-formed requests.
 */
export declare class ConversionRouter {
    private readonly defaults;
    private readonly converters;
    private readonly byPair;
    constructor(defaults?: RouterDefaults);
    register(converter: Converter): void;
    detect(input: string): Promise<DetectOutcome>;
    route(from: FormatId, to: FormatId): Converter | null;
    /** The full matrix with dependency availability, for list_conversions. */
    listConversions(): Promise<ConversionStatus[]>;
    /** Full pipeline: detect → route → deps → overwrite policy → convert. */
    convertFile(req: ConvertFileRequest, run: ConvertRunContext): Promise<ConvertResult>;
    inspect(input: string): Promise<InspectResult>;
}
