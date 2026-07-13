export function compareUnicodeCodePoints(left: string, right: string): number {
  const leftCodePoints = Array.from(left, character => character.codePointAt(0) as number);
  const rightCodePoints = Array.from(right, character => character.codePointAt(0) as number);
  const sharedLength = Math.min(leftCodePoints.length, rightCodePoints.length);

  for (let index = 0; index < sharedLength; index += 1) {
    const difference = leftCodePoints[index] - rightCodePoints[index];
    if (difference !== 0) {
      return difference;
    }
  }

  return leftCodePoints.length - rightCodePoints.length;
}
