import type { Detection } from './types.js';
export interface DetectOutcome {
    detection: Detection;
    warnings: string[];
}
export declare class DetectError extends Error {
    readonly error: import('./types.js').ConvertError;
    constructor(error: import('./types.js').ConvertError);
}
/**
 * Detect the format of a file. Priority: binary magic bytes (file-type) →
 * SVG content → JSON content → extension → YAML document marker. When content
 * and extension disagree, content wins and a warning is returned — users
 * rename files wrongly all the time.
 */
export declare function detectFile(input: string): Promise<DetectOutcome>;
