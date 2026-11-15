/**
 * dsh-file-convert core: a DSH-independent conversion library.
 * Usable directly from tests, a CLI, or an MCP server - no harness required.
 */
export * from './types.js';
export { FORMATS, FORMAT_IDS, formatFromExtension, parseFormatArg, canonicalExtension, formatCategory } from './formats.js';
export { ConversionRouter } from './router.js';
export { detectFile, DetectError } from './detect.js';
export { resolveBinary } from './binary.js';
export { defaultOutputPath, batchOutputPath } from './paths.js';
export { isInsideAnyRoot, isInsideRoot, isSameFile, realPathBestEffort } from './utils/path-guard.js';
export { writeFileAtomic } from './utils/write-file.js';
export { ImageConverter } from './converters/image.js';
export { PdfConverter } from './converters/pdf.js';
export { DataConverter } from './converters/data.js';
export { MediaConverter, FFMPEG, FFPROBE } from './converters/media.js';
export { OfficeConverter, PdfToDocxConverter, SOFFICE, PYTHON_PDF2DOCX } from './converters/office.js';
export { GHOSTSCRIPT } from './optimizers.js';
export { TESSERACT, OCR_LANGUAGE_DATA, ocrLanguagesCached, installOcrLanguages, tessdataDir, resolveOcrEngine } from './ocr.js';
export { parsePageRange, PageRangeError } from './utils/pages.js';
export { optimizeFile } from './optimizers.js';
import { ConversionRouter } from './router.js';
import { ImageConverter } from './converters/image.js';
import { PdfConverter } from './converters/pdf.js';
import { DataConverter } from './converters/data.js';
import { MediaConverter } from './converters/media.js';
import { OfficeConverter, PdfToDocxConverter } from './converters/office.js';
import { resolveBinary } from './binary.js';
const SILENT_LOGGER = { debug() { }, info() { }, warn() { }, error() { } };
/**
 * Assemble the registry: image (sharp), pdf (pdfjs), data (yaml/csv),
 * media (ffmpeg), office (LibreOffice), pdf→docx (python pdf2docx).
 */
export function createRouter(defaults) {
    const overrides = defaults?.binaryOverrides ?? {};
    const resolve = (dep) => resolveBinary(dep, overrides, SILENT_LOGGER);
    const router = new ConversionRouter({
        quality: defaults?.quality ?? 85,
        dpi: defaults?.dpi ?? 150,
        timeoutMs: defaults?.timeoutMs ?? 120_000,
        outputRoots: defaults?.outputRoots,
        binaryOverrides: overrides,
        maxInputBytes: defaults?.maxInputBytes,
        maxPdfPages: defaults?.maxPdfPages,
        maxOutputPixels: defaults?.maxOutputPixels,
    });
    router.register(new ImageConverter());
    router.register(new PdfConverter(resolve));
    router.register(new DataConverter());
    router.register(new MediaConverter(resolve));
    router.register(new OfficeConverter(resolve));
    router.register(new PdfToDocxConverter(resolve));
    return router;
}
