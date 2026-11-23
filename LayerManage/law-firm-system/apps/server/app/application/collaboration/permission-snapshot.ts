/** Authorization collections are sets: database row order must not invalidate a grid. */
export function permissionSnapshot(value: unknown): string {
  const normalize = (input: unknown): unknown => {
    if (input instanceof Date) return input.toISOString();
    if (input instanceof Set) return normalize([...input]);
    if (Array.isArray(input)) {
      const entries = input.map(item => JSON.stringify(normalize(item)));
      return [...new Set(entries)].sort().map(item => JSON.parse(item));
    }
    if (input && typeof input === 'object') return Object.fromEntries(
      Object.entries(input).filter(([, value]) => value !== undefined).sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => [key, normalize(value)]),
    );
    return input;
  };
  return JSON.stringify(normalize(value));
}
