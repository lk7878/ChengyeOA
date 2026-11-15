import type { ConvertContext, ConvertRequest, ConvertResult, Converter, ConversionCapability } from '../types.js';
/**
 * JSON / YAML / CSV share one intermediate representation (a plain JS value):
 * three readers + three writers cover every pair, including YAML↔CSV.
 */
export declare class DataConverter implements Converter {
    readonly id = "data";
    readonly concurrency = 4;
    readonly binaryDeps: never[];
    readonly capabilities: ConversionCapability[];
    convert(req: ConvertRequest, ctx: ConvertContext): Promise<ConvertResult>;
    private read;
    private write;
}
