export interface ExecOptions {
    /** Hard deadline in milliseconds; the child is killed when it fires. */
    timeoutMs: number;
    /** Cooperative cancellation from the harness (agent abort). */
    signal?: AbortSignal;
    /** Max stderr bytes kept for diagnostics. */
    maxStderrBytes?: number;
}
export interface ExecOutcome {
    code: number;
    stdout: string;
    stderr: string;
}
export declare class ExecError extends Error {
    readonly code: 'timeout' | 'cancelled' | 'failed';
    readonly stderr?: string | undefined;
    constructor(code: 'timeout' | 'cancelled' | 'failed', message: string, stderr?: string | undefined);
}
/**
 * Run an external tool, collecting stderr. Hardened for ffmpeg-style long
 * jobs: no shell (array args), timeout kill, cooperative abort, capped
 * stderr, hidden console window on Windows.
 */
export declare function execTool(command: string, args: string[], opts: ExecOptions): Promise<ExecOutcome>;
/** ffprobe wrapper: one JSON document about the file's format and streams. */
export declare function probeMedia(ffprobePath: string, input: string, timeoutMs: number, signal?: AbortSignal): Promise<MediaProbe | null>;
export interface MediaProbe {
    format?: {
        duration?: string;
    };
    streams?: Array<{
        codec_type?: string;
        codec_name?: string;
        width?: number;
        height?: number;
        r_frame_rate?: string;
    }>;
}
