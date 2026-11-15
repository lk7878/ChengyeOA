import type { BinaryDependency, ConvertContext, ConvertRequest, ConvertResult, Converter, ConversionCapability } from '../types.js';
export declare const SOFFICE: BinaryDependency;
export declare const PYTHON_PDF2DOCX: BinaryDependency;
/**
 * Office documents to PDF via LibreOffice headless. LibreOffice is a
 * single-instance application, so this converter serializes (concurrency 1)
 * and always runs against its own UserInstallation profile — a document the
 * user has open in LibreOffice GUI must never block or break a conversion.
 */
export declare class OfficeConverter implements Converter {
    private readonly resolve;
    readonly id = "office";
    readonly concurrency = 1;
    readonly binaryDeps: BinaryDependency[];
    readonly capabilities: ConversionCapability[];
    constructor(resolve: (dep: BinaryDependency) => Promise<string | null>);
    convert(req: ConvertRequest, ctx: ConvertContext): Promise<ConvertResult>;
    private required;
}
/**
 * PDF → DOCX (EXPERIMENTAL): layout reconstruction via the Python pdf2docx
 * package. Works well on text PDFs; scanned PDFs need OCR (not implemented).
 * The dependency probe checks that python can actually import pdf2docx.
 */
export declare class PdfToDocxConverter implements Converter {
    private readonly resolve;
    readonly id = "pdf-docx";
    readonly concurrency = 1;
    readonly binaryDeps: BinaryDependency[];
    readonly capabilities: ConversionCapability[];
    constructor(resolve: (dep: BinaryDependency) => Promise<string | null>);
    convert(req: ConvertRequest, ctx: ConvertContext): Promise<ConvertResult>;
}
