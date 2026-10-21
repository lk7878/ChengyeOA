import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import LifecycleSelect from './LifecycleSelect';
import FieldInput from './FieldInput';
import { get } from './api';
import type { Field } from './types';
vi.mock('./api', () => ({ get: vi.fn(), post: vi.fn(), authenticatedFetch: vi.fn(), errorMessage: () => '关联记录不可访问' }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
test('upstream selector searches server scope and pages instead of truncating choices', async () => {
  vi.mocked(get).mockResolvedValue({ rows: [{ id: 'case1', label: 'HT-001 · 案件甲' }], hasMore: true });
  render(<LifecycleSelect tableId="t" value="case1" onChange={vi.fn()} />);
  await screen.findByText('HT-001 · 案件甲');
  expect(get).toHaveBeenCalledWith('/tables/t/lifecycle-choices?keyword=&page=1');
  fireEvent.click(screen.getByRole('button', { name: '加载更多关联项' }));
  await waitFor(() => expect(get).toHaveBeenCalledWith('/tables/t/lifecycle-choices?keyword=&page=2'));
  fireEvent.change(screen.getByRole('combobox'), { target: { value: '合同甲' } });
  await waitFor(() =>
    expect(get).toHaveBeenCalledWith(
      '/tables/t/lifecycle-choices?keyword=' + encodeURIComponent('合同甲') + '&page=1',
    ),
  );
});
test('upstream permission failures stay visible; synchronized fields cannot be edited', async () => {
  vi.mocked(get).mockRejectedValue(new Error('denied'));
  const { unmount } = render(<LifecycleSelect tableId="t" value={null} onChange={vi.fn()} />);
  await screen.findByText('关联记录不可访问');
  unmount();
  const field: Field = {
    id: 'f',
    name: '合同金额（同步）',
    type: 'CURRENCY',
    required: false,
    writable: false,
    archived: false,
    position: 0,
    defaultValue: null,
    options: { lifecycleKey: 'contractAmount' },
  };
  render(
    <FieldInput
      field={field}
      value="1200.00"
      disabled
      onChange={vi.fn()}
      tableId="t"
      directory={{ organizations: [], employees: [], teams: [], users: [] }}
    />,
  );
  expect(screen.getByDisplayValue('1,200.00')).toBeDisabled();
});

test('refund choices explain ineligible after-sales and become selectable after an explicit refresh', async () => {
  const onChange=vi.fn(), onPreview=vi.fn();
  vi.mocked(get).mockResolvedValueOnce({sourceKind:'AFTER_SALES',rows:[{id:'after',label:'HT-001',disabled:true,disabledReason:'协商中：请先标记为需退款。'}],hasMore:false});
  render(<LifecycleSelect tableId="refund" value={null} onChange={onChange} onPreview={onPreview} />);
  await screen.findByText(/在售后管理表的行操作中/);
  fireEvent.mouseDown(screen.getByRole('combobox'));
  const reason=await screen.findByText('协商中：请先标记为需退款。');
  expect(reason.closest('.ant-select-item-option')).toHaveClass('ant-select-item-option-disabled');
  fireEvent.click(reason);
  expect(onChange).not.toHaveBeenCalled();
  vi.mocked(get).mockResolvedValueOnce({sourceKind:'AFTER_SALES',rows:[{id:'after',label:'HT-001',disabled:false,preview:{customerName:'客户甲',feeTotalLookup:'3000'}}],hasMore:false});
  await waitFor(()=>expect(screen.getByRole('button',{name:'刷新关联项'})).toBeEnabled());
  fireEvent.click(screen.getByRole('button',{name:'刷新关联项'}));
  await waitFor(()=>expect(screen.queryByText('协商中：请先标记为需退款。')).not.toBeInTheDocument());
  await waitFor(()=>expect(get).toHaveBeenCalledTimes(2));
  await waitFor(()=>expect(screen.getByRole('button',{name:'刷新关联项'})).toBeEnabled());
  fireEvent.mouseDown(screen.getByRole('combobox'));
  fireEvent.click(await screen.findByText('HT-001'));
  expect(onChange).toHaveBeenCalledWith('after');
  expect(onPreview).toHaveBeenCalledWith({customerName:'客户甲',feeTotalLookup:'3000'});
});


test('read-only refund receipt lookup keeps attachment preview available without upload controls', async()=>{
  vi.mocked(get).mockResolvedValue({name:'退款凭证.pdf',mimeType:'application/pdf'});
  const field:Field={id:'receipt',name:'退款凭证',type:'FILE',required:false,writable:false,archived:false,position:0,defaultValue:null,options:{lifecycleKey:'refundReceiptLookup'}};
  render(<FieldInput field={field} value={['receipt-file']} disabled onChange={vi.fn()} tableId="refund-table" directory={{organizations:[],employees:[],teams:[],users:[]}} />);
  expect(await screen.findByRole('button',{name:'退款凭证.pdf'})).toBeEnabled();
  expect(get).toHaveBeenCalledWith('/tables/refund-table/files/receipt-file?metadata=true');
  expect(screen.queryByText('上传附件')).not.toBeInTheDocument();
});
