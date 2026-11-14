import { describe, expect, it } from 'vitest';
import { changedValues, rebaseDraft, initialValues } from './editing';
import type { Field } from './types';
it('new records receive fresh date defaults and omit read-only defaults',()=>{
  const common={name:'field',type:'DATETIME',writable:true,required:false,archived:false,position:0,defaultValue:null,options:{}};
  const fields:Field[]=[{...common,id:'date',options:{defaultNow:true}},{...common,id:'copies',type:'NUMBER',defaultValue:1},{...common,id:'review',writable:false,defaultValue:'readonly'}];
  expect(initialValues(fields,new Date('2026-10-27T00:00:00Z'))).toEqual({date:'2026-10-27T00:00:00.000Z',copies:1});
});

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
