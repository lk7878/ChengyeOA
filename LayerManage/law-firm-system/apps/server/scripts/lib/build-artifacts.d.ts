export function cleanBuildOutputs(serverRoot: string, packageOutputDir?: string): void;
export function copyBuildAssets(serverRoot: string): void;
export function findForbiddenArtifacts(directory: string): string[];
export function isForbiddenArtifact(fileName: string): boolean;
