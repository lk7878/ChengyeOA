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
