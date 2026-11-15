import Schema from '@deepseek-ai/schemastery';
export interface Config {
    /** Default JPEG/WebP quality (1-100). */
    quality: number;
    /** Default rasterization DPI for pdf/svg inputs. */
    dpi: number;
    /** Cooperative deadline for one conversion, in milliseconds. */
    timeoutMs: number;
    /** Max files examined per batch_convert run before it stops and reports. */
    batchMaxFiles: number;
    /**
     * When non-empty, explicit output paths must resolve inside one of these
     * directories. Empty (default) = unrestricted - fine on a personal machine;
     * set it when the harness is shared or exposed.
     */
    outputRoots: string[];
    /** Explicit path to the ffmpeg binary (Windows installs without PATH). */
    ffmpegPath?: string;
    /** Explicit path to the ffprobe binary (usually next to ffmpeg). */
    ffprobePath?: string;
    /** Explicit path to the LibreOffice soffice binary. */
    sofficePath?: string;
    /** Explicit path to the Ghostscript binary (gswin64c on Windows). */
    ghostscriptPath?: string;
    /** Explicit python interpreter for the pdf2docx-based PDF → DOCX conversion. */
    pythonPath?: string;
    /** Explicit tesseract binary for OCR (falls back to bundled tesseract.js). */
    tesseractPath?: string;
    /** Refuse inputs above this size (MB). */
    maxInputMb: number;
    /** Refuse full-document PDF rasterization above this page count. */
    maxPdfPages: number;
    /** Clamp rasterized pixels per page (width x height) to this budget. */
    maxOutputPixels: number;
}
export declare const Config: Schema<Config>;
