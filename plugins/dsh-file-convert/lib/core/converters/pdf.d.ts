import './pdf-env.js';
import type { BinaryDependency, ConvertContext, ConvertRequest, ConvertResult, Converter, ConversionCapability } from '../types.js';
/**
 * PDF conversions, fully local: rasterization via pdfjs-dist + @napi-rs/canvas
 * (prebuilt npm binaries), text extraction via pdfjs-dist. No Poppler needed.
 */
export declare class PdfConverter implements Converter {
    private readonly resolve?;
    readonly id = "pdf";
    readonly concurrency = 2;
    readonly binaryDeps: never[];
    readonly capabilities: ConversionCapability[];
    /** Optional binary resolver, needed only for OCR (Tesseract). */
    constructor(resolve?: ((dep: BinaryDependency) => Promise<string | null>) | undefined);
    convert(req: ConvertRequest, ctx: ConvertContext): Promise<ConvertResult>;
    /**
     * Multi-page PDFs produce `<base>-<n>.<ext>` files named after the REAL page
     * number; converting a single page (or a one-page PDF) writes exactly `output`.
     */
    private toImages;
    private toText;
}
