import { describe, expect, it } from 'vitest';
import { changedValues, rebaseDraft } from './editing';

describe('record conflict resolution', () => {
  it('preserves another member’s unrelated field when retrying local edits', () => {
    const before = { title: 'old', owner: 'A', tags: ['todo'] };
    const local = { ...before, title: 'mine' };
    const remote = { ...before, owner: 'B', tags: ['done'] };
    const rebased = rebaseDraft(before, local, remote);
    expect(rebased).toEqual({ title: 'mine', owner: 'B', tags: ['done'] });
    expect(changedValues(remote, rebased)).toEqual({ title: 'mine' });
  });
  it('retains an explicit clear while comparing arrays by value', () => {
    expect(changedValues({ field: 'old', tags: ['a'] }, { field: null, tags: ['a'] })).toEqual({
      field: null,
    });
  });
});
