import type { BinaryDependency, ConvertContext, ConvertRequest, ConvertResult, Converter, ConversionCapability } from '../types.js';
export declare const FFMPEG: BinaryDependency;
export declare const FFPROBE: BinaryDependency;
/**
 * Audio/video conversions, delegated to a locally installed FFmpeg.
 * The converter declares its dependencies; the router refuses to run (and
 * list_conversions reports what is missing) until the binaries resolve.
 */
export declare class MediaConverter implements Converter {
    private readonly resolve;
    readonly id = "media";
    readonly concurrency = 2;
    readonly binaryDeps: BinaryDependency[];
    readonly capabilities: ConversionCapability[];
    constructor(resolve: (dep: BinaryDependency) => Promise<string | null>);
    convert(req: ConvertRequest, ctx: ConvertContext): Promise<ConvertResult>;
    /** MOV→MP4: try a lossless container swap first, fall back to re-encoding. */
    private movToMp4;
    private required;
    private execOpts;
}
