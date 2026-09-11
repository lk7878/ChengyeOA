import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { DatePicker, Modal } from 'antd';
import Table from './ResizableTable';
import ChineseConfig from './ChineseConfig';

const columns = [{ title: '岗位名称', dataIndex: 'name', width: 180, sorter: true }];
const data = [{ id: '1', name: '律师' }, { id: '2', name: '助理' }];
const storageKey = 'chengye:table-widths:v1:test';
afterEach(() => vi.restoreAllMocks());

test('drag persists width, does not sort, and double click restores the original width', () => {
  const onChange = vi.fn();
  const props = { columnWidthsKey: 'test', columns, dataSource: data, rowKey: 'id', onChange };
  const view = render(<Table {...props} />);
  const handle = screen.getByRole('separator', { name: '岗位名称列宽' });
  fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 180 });
  fireEvent.pointerMove(handle, { pointerId: 1, clientX: 260 });
  fireEvent.pointerUp(handle, { pointerId: 1 });
  fireEvent.click(handle);
  expect(handle).toHaveAttribute('aria-valuenow', '260');
  expect(onChange).not.toHaveBeenCalled();
  expect(JSON.parse(localStorage.getItem(storageKey)!)).toEqual({ name: 260 });
  view.unmount();
  render(<Table {...props} />);
  const restored = screen.getByRole('separator');
  expect(restored).toHaveAttribute('aria-valuenow', '260');
  fireEvent.doubleClick(restored);
  expect(restored).toHaveAttribute('aria-valuenow', '180');
  fireEvent.click(screen.getByRole('columnheader', { name: /岗位名称/ }));
  expect(onChange).toHaveBeenCalledOnce();
});

test('keyboard resize respects bounds and storage errors, and Home resets', () => {
  localStorage.setItem(storageKey, JSON.stringify({ name: 1199, ignored: 'invalid' }));
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('storage disabled'); });
  render(<Table columnWidthsKey="test" columns={columns} dataSource={data} rowKey="id" />);
  const handle = screen.getByRole('separator');
  fireEvent.keyDown(handle, { key: 'ArrowRight' });
  expect(handle).toHaveAttribute('aria-valuenow', '1200');
  fireEvent.keyDown(handle, { key: 'ArrowLeft', shiftKey: true });
  expect(handle).toHaveAttribute('aria-valuenow', '1199');
  fireEvent.keyDown(handle, { key: 'Home' });
  expect(handle).toHaveAttribute('aria-valuenow', '180');
  for (let i = 0; i < 20; i++) fireEvent.keyDown(handle, { key: 'ArrowLeft' });
  expect(handle).toHaveAttribute('aria-valuenow', '72');
});

test('invalid saved data is ignored and grouped headers only resize leaf columns', () => {
  localStorage.setItem(storageKey, JSON.stringify({ name: -1 }));
  render(<Table columnWidthsKey="test" columns={[{ title: '岗位信息', children: columns }]} dataSource={data} rowKey="id" />);
  expect(screen.getAllByRole('separator')).toHaveLength(1);
  expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '180');
});

test('selection, pagination and explicit layout isolation remain available', () => {
  const onSelect = vi.fn();
  localStorage.setItem(storageKey, JSON.stringify({ name: 300 }));
  render(<Table columnWidthsKey="other" columns={columns} dataSource={data} rowKey="id" rowSelection={{ onChange: onSelect }} pagination={{ pageSize: 1 }} />);
  expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '180');
  fireEvent.click(screen.getAllByRole('checkbox')[1]);
  expect(onSelect).toHaveBeenCalledWith(['1'], [data[0]], expect.anything());
  fireEvent.click(screen.getByTitle('2'));
  expect(screen.getByText('助理')).toBeInTheDocument();
  expect(screen.queryByText('律师')).not.toBeInTheDocument();
});

test('the application locale supplies Chinese default controls', () => {
  render(<ChineseConfig><Modal open title="本地化检查"><DatePicker /></Modal></ChineseConfig>);
  expect(screen.getByRole('button', { name: /确\s*定/ })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /取\s*消/ })).toBeInTheDocument();
  expect(screen.getByPlaceholderText('请选择日期')).toBeInTheDocument();
});
