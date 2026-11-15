import type { ConvertContext, ConvertRequest, ConvertResult, Converter, ConversionCapability } from '../types.js';
/**
 * All raster↔raster pairs plus SVG rasterization, backed by sharp/libvips
 * (prebuilt npm binaries - no system dependencies).
 */
export declare class ImageConverter implements Converter {
    readonly id = "image";
    readonly concurrency = 4;
    readonly binaryDeps: never[];
    readonly capabilities: ConversionCapability[];
    convert(req: ConvertRequest, ctx: ConvertContext): Promise<ConvertResult>;
}
