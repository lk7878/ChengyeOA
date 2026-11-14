import type { Field } from './types';
export function initialValues(fields: Field[], now = new Date()) {
  return Object.fromEntries(fields.filter(f => f.writable && (f.options.defaultNow || f.defaultValue != null))
    .map(f => [f.id, f.options.defaultNow ? now.toISOString() : f.defaultValue]));
}
export function changedValues(original: Record<string, unknown> | undefined, draft: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(draft).filter(
      ([id, value]) => !original || JSON.stringify(value) !== JSON.stringify(original[id]),
    ),
  );
}

export function rebaseDraft(
  original: Record<string, unknown>,
  draft: Record<string, unknown>,
  latest: Record<string, unknown>,
) {
  return { ...latest, ...changedValues(original, draft) };
}
