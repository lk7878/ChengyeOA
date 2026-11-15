/**
 * realpath the deepest EXISTING ancestor of a path and rejoin the remainder:
 * symlinks anywhere in the existing part are resolved, which is what output
 * confinement and same-file checks need (a symlink inside a root can point
 * outside, and two different-looking paths can be the same file).
 */
export declare function realPathBestEffort(p: string): Promise<string>;
/** Same file on disk, comparing real paths (symlink/case/separator aware). */
export declare function isSameFile(a: string, b: string): Promise<boolean>;
/** True when `candidate` is `root` itself or lives inside it (real paths). */
export declare function isInsideRoot(candidate: string, root: string): Promise<boolean>;
/** True when the candidate is inside at least one of the roots. */
export declare function isInsideAnyRoot(candidate: string, roots: string[] | undefined): Promise<boolean>;
