import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import RowComments from './RowComments';
import { get, post, patch } from './api';
vi.mock('./api',()=>({get:vi.fn(),post:vi.fn(),patch:vi.fn(),errorMessage:()=> '没有权限或保存失败',errorStatus:(e:{status:number})=>e.status}));
afterEach(()=>{cleanup();vi.resetAllMocks();});
test('comment errors retain typed content; successful retry refreshes comments',async()=>{
  vi.mocked(get).mockResolvedValue([]);
  vi.mocked(post).mockRejectedValueOnce({status:422}).mockResolvedValueOnce({id:'comment'});
  render(<RowComments tableId="table" recordId="record"/>);
  await waitFor(()=>expect(get).toHaveBeenCalledWith('/tables/table/records/record/comments'));
  fireEvent.change(screen.getByLabelText('评论内容'),{target:{value:'需要复核的内容'}});
  fireEvent.click(screen.getByRole('button',{name:/发表评论/}));
  await screen.findByText('没有权限或保存失败');
  expect(screen.getByLabelText('评论内容')).toHaveValue('需要复核的内容');
  await waitFor(()=>expect(screen.getByLabelText('评论内容')).not.toBeDisabled());
  fireEvent.click(screen.getByRole('button',{name:/发表评论/}));
  await waitFor(()=>expect(screen.getByLabelText('评论内容')).toHaveValue(''));
  expect(post).toHaveBeenLastCalledWith('/tables/table/records/record/comments',{content:'需要复核的内容',mentions:[]},expect.any(String));
});
test('revoked record access hides comments and disables writing',async()=>{
  vi.mocked(get).mockRejectedValue({status:403});
  render(<RowComments tableId="table" recordId="record"/>);
  await screen.findByText('没有权限或保存失败');
  expect(screen.getByLabelText('评论内容')).toBeDisabled();
  expect(screen.getByRole('button',{name:'发表评论'})).toBeDisabled();
  expect(post).not.toHaveBeenCalled();expect(patch).not.toHaveBeenCalled();
});
test('plain text rendering and author controls protect other users comments',async()=>{
  vi.mocked(get).mockResolvedValue([{id:'c',author:'同事',content:'<img src=x onerror=alert(1)>',canEdit:false,
    version:1,createdAt:'2026-11-04T01:00:00Z',mentionedUsers:[]}]);
  render(<RowComments tableId="table" recordId="record"/>);
  await screen.findByText('<img src=x onerror=alert(1)>');
  expect(screen.queryByRole('button',{name:'删除评论'})).toBeNull();
  expect(screen.queryByRole('button',{name:'修改评论'})).toBeNull();
  expect(document.querySelector('article img')).toBeNull();
});
