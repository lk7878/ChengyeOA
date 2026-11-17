import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import FieldInput from './FieldInput';
import { post } from './api';
import type { Field } from './types';
import { displayValue } from './display-value';
vi.mock('./api', () => ({ post: vi.fn(), get: vi.fn(), errorMessage: () => '错误' }));
const field: Field = {
  id: 'lead',
  name: '线索ID',
  type: 'RELATION',
  required: false,
  writable: true,
  queryable: true,
  position: 3,
  archived: false,
  defaultValue: null,
  options: { targetSource: 'LEADS' },
};
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
test('administrative expense dates and money use the same formats in the table and editor', () => {
  const directory = { employees: [], organizations: [], users: [], teams: [] };
  const change = vi.fn();
  const total = { ...field, type: 'FORMULA', name: '费用金额', writable: false, options: { numberFormat: 'CNY' as const } };
  expect(displayValue(total, '3703.68', directory)).toBe('3,703.68');
  const { rerender } = render(<FieldInput field={total} value="3703.68" onChange={change} directory={directory} tableId="expense" />);
  expect(screen.getByRole('textbox')).toBeDisabled();
  expect(screen.getByRole('textbox')).toHaveValue('3,703.68');
  rerender(<FieldInput field={{ ...field, type: 'CURRENCY', name: '单价', options: { numberFormat: 'CNY' } }} value="1234.56" onChange={change} directory={directory} tableId="expense" />);
  expect(screen.getByRole('spinbutton')).toHaveValue('1,234.56');
  fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '2,345.67' } });
  fireEvent.blur(screen.getByRole('spinbutton'));
  expect(change).toHaveBeenCalledWith('2345.67');
  const date = { ...field, type: 'DATETIME', name: '采购日期', options: { dateOnly: true } };
  expect(displayValue(date, '2026-10-25T16:00:00.000Z', directory)).toBe('2026/10/26');
  rerender(<FieldInput field={date} value="2026-10-25T16:00:00.000Z" onChange={change} directory={directory} tableId="expense" />);
  expect(screen.getByLabelText('采购日期')).toHaveValue('2026-10-26');
  fireEvent.change(screen.getByLabelText('采购日期'), { target: { value: '2026-10-27' } });
  expect(change).toHaveBeenCalledWith('2026-10-26T16:00:00.000Z');
});
test('seal review shows decision and reason together and respects read-only permission',()=>{
  const directory={employees:[],organizations:[],users:[],teams:[]},change=vi.fn();
  const review={...field,type:'LONG_TEXT',name:'审核意见',options:{adminReview:true}};
  const value=JSON.stringify({decision:'驳回',reason:'请补充附件'});
  expect(displayValue(review,value,directory)).toBe('驳回：请补充附件');
  const {rerender}=render(<FieldInput field={{...review,writable:false}} value={value} onChange={change} directory={directory} tableId="seal"/>);
  expect(screen.getByRole('combobox',{name:'审核结果'})).toBeDisabled();
  expect(screen.getByRole('textbox',{name:'审核原因'})).toBeDisabled();
  rerender(<FieldInput field={review} value={value} onChange={change} directory={directory} tableId="seal"/>);
  fireEvent.change(screen.getByRole('textbox',{name:'审核原因'}),{target:{value:'已核对补充附件'}});
  expect(change).toHaveBeenCalledWith(JSON.stringify({decision:'驳回',reason:'已核对补充附件'}));
});
test('administrative timestamps use Beijing minutes and meeting attachments accept PowerPoint',()=>{
  const directory={employees:[],organizations:[],users:[],teams:[]},change=vi.fn();
  const date={...field,type:'DATETIME',name:'会议时间',options:{dateMinute:true}};
  expect(displayValue(date,'2026-10-27T00:30:00.000Z',directory)).toBe('2026/10/27 08:30');
  const {rerender,container}=render(<FieldInput field={date} value="2026-10-27T00:30:00.000Z" onChange={change} directory={directory} tableId="meeting"/>);
  expect(screen.getByLabelText('会议时间')).toHaveValue('2026-10-27T08:30');
  fireEvent.change(screen.getByLabelText('会议时间'),{target:{value:'2026-10-28T09:00'}});
  expect(change).toHaveBeenCalledWith('2026-10-28T01:00:00.000Z');
  rerender(<FieldInput field={{...field,type:'FILE',name:'会议所有资料',options:{}}} value={[]} onChange={change} directory={directory} tableId="meeting"/>);
  expect(container.querySelector('input[type=file]')?.getAttribute('accept')).toContain('.pptx');
});
test('office inventory formula fields stay read-only while multiline notes and quantities remain editable', () => {
  const directory = { employees: [], organizations: [], users: [], teams: [] };
  const change = vi.fn();
  const { rerender } = render(<FieldInput field={{ ...field, type: 'FORMULA', name: '库存数量', writable: false, options: { inventoryKey: '库存数量' } }} value={12.5} onChange={change} directory={directory} tableId="stock" />);
  expect(screen.getByRole('textbox')).toBeDisabled();
  expect(screen.getByRole('textbox')).toHaveValue('12.5');
  rerender(<FieldInput field={{ ...field, type: 'LONG_TEXT', name: '备注', options: { inventoryKey: '备注' } }} value="" onChange={change} directory={directory} tableId="stock" />);
  fireEvent.change(screen.getByLabelText('备注'), { target: { value: '第一行\n第二行' } });
  expect(change).toHaveBeenCalledWith('第一行\n第二行');
  rerender(<FieldInput field={{ ...field, type: 'NUMBER', name: '盘存时数量', options: { inventoryKey: '盘存时数量' } }} value={0} onChange={change} directory={directory} tableId="take" />);
  fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '25.5' } });
  expect(change).toHaveBeenCalledWith(25.5);
});
test('office movement and receipt dates display YYYY/MM/DD in Beijing time', () => {
  for (const name of ['日期', '领取日期']) {
    const f = { ...field, type: 'DATETIME', name, options: { inventoryKey: name } };
    expect(displayValue(f, '2026-10-25T16:30:00Z', { employees: [], organizations: [], users: [], teams: [] })).toBe('2026/10/26');
  }
});
test('business link editor loads selected labels and searches canonical records on the server', async () => {
  vi.mocked(post).mockResolvedValue({ options: [{ id: 'lead-1', label: 'L001 · 客户甲' }], hasMore: false });
  const onChange = vi.fn();
  render(
    <FieldInput
      field={field}
      value={['lead-1']}
      onChange={onChange}
      directory={{ employees: [], organizations: [], users: [], teams: [] }}
      tableId="conversion"
    />,
  );
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith('/tables/conversion/fields/lead/relation-options', {
      keyword: '',
      selectedIds: ['lead-1'],
    }),
  );
  expect(await screen.findByText('L001 · 客户甲')).toBeTruthy();
  fireEvent.change(screen.getByRole('combobox'), { target: { value: '客户乙' } });
  await waitFor(() =>
    expect(post).toHaveBeenLastCalledWith('/tables/conversion/fields/lead/relation-options', {
      keyword: '客户乙',
      selectedIds: ['lead-1'],
    }),
  );
});
test('recording upload selector accepts supported audio types', () => {
  const { container } = render(
    <FieldInput
      field={{ ...field, type: 'FILE', name: '录音、附件', options: {} }}
      value={[]}
      onChange={() => {}}
      directory={{ employees: [], organizations: [], users: [], teams: [] }}
      tableId="assessment"
    />,
  );
  const accept = container.querySelector('input[type=file]')?.getAttribute('accept');
  expect(accept).toContain('.mp3');
  expect(accept).toContain('.wav');
  expect(accept).toContain('.m4a');
});

test('HR month-only dates retain their precision in grid and input; masked dates remain masked',()=>{
 const directory={employees:[],organizations:[],users:[],teams:[]},change=vi.fn();
 const date={...field,type:'DATETIME',name:'入职时间',options:{dateOnly:true,hrPartialDate:true}};
 expect(displayValue(date,'2024-06',directory)).toBe('2024/06');
 render(<FieldInput field={date} value="2024-06" onChange={change} directory={directory} tableId="hr"/>);
 expect(screen.getByLabelText('入职时间')).toHaveValue('2024-06');
 fireEvent.change(screen.getByLabelText('入职时间'),{target:{value:'2024.07'}});
 expect(change).toHaveBeenCalledWith('2024.07');
 expect(displayValue({...date,options:{dateOnly:true,hrSensitive:true}},'******',directory)).toBe('******');
});

test('prospect assignee picker uses server-scoped candidates and distinguishes cross-branch employees', async () => {
 const directory={employees:[{id:'outsider',name:'未授权人员'}],organizations:[],users:[],teams:[]};
 const change=vi.fn();
 const assignee:Field={...field,type:'USER',name:'跟进人',options:{prospectAssignee:true,choices:[{id:'member',name:'同名员工',label:'同名员工（万州分所 · user1）'}]}};
 const {rerender}=render(<FieldInput field={assignee} value={null} onChange={change} directory={directory} tableId="prospects" />);
 fireEvent.mouseDown(screen.getByRole('combobox'));
 expect(await screen.findByText('同名员工（万州分所 · user1）')).toBeInTheDocument();
 expect(screen.queryByText('未授权人员')).not.toBeInTheDocument();
 fireEvent.click(screen.getByText('同名员工（万州分所 · user1）'));
 expect(change).toHaveBeenCalledWith('member');
 rerender(<FieldInput field={{...assignee,writable:false}} value="member" onChange={change} directory={directory} tableId="prospects" />);
 expect(screen.getByRole('combobox')).toBeDisabled();
});
