import { createHash } from 'node:crypto';

export function canonicalJson(value: unknown): string {
  return serialize(value, new Set<object>());
}

export function hashPayload(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

function serialize(value: unknown, ancestors: Set<object>): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError('Canonical JSON accepts only finite numbers');
    }
    return JSON.stringify(value);
  }
  if (typeof value !== 'object') {
    throw new TypeError('Value is not canonical JSON');
  }
  if (ancestors.has(value)) {
    throw new TypeError('Canonical JSON does not accept cyclic input');
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const items: string[] = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) {
          throw new TypeError('Canonical JSON does not accept sparse arrays');
        }
        items.push(serialize(value[index], ancestors));
      }
      return `[${items.join(',')}]`;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('Canonical JSON accepts only plain objects');
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new TypeError('Canonical JSON does not accept symbol keys');
    }

    const record = value as Record<string, unknown>;
    const members = Object.keys(record)
      .sort()
      .map(key => `${JSON.stringify(key)}:${serialize(record[key], ancestors)}`);
    return `{${members.join(',')}}`;
  } finally {
    ancestors.delete(value);
  }
}
