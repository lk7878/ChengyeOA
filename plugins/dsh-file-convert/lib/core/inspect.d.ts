import './converters/pdf-env.js';
import type { Detection, InspectResult } from './types.js';
export interface MediaProbeContext {
    ffprobePath: string;
    timeoutMs: number;
    signal?: AbortSignal;
}
/**
 * Structured file facts so an agent can decide before converting.
 * Inspect is informational: parse problems degrade to `kind: 'unknown'`
 * (or `probeUnavailable` for media) instead of failing.
 */
export declare function inspectFile(input: string, detection: Detection, bytes: number, media?: MediaProbeContext): Promise<InspectResult>;
