import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import OrganizationSortSelect from './OrganizationSortSelect';
import type { OrganizationNode } from '../types';

const nodes: OrganizationNode[] = [
  { id: 'root', code: 'ROOT', name: '总所', type: 'FIRM', parentId: null, path: '/root', level: 0, sort: 1, status: 'ENABLED', version: 1, children: [] },
  { id: 'branch', code: 'BRANCH', name: '分所', type: 'BRANCH', parentId: 'root', path: '/root/branch', level: 1, sort: 2, status: 'DISABLED', version: 1, children: [] },
];
test('SPEC-003-B disables numbers held across levels including disabled organizations', async () => {
  const onChange = vi.fn();
  render(<OrganizationSortSelect nodes={nodes} onChange={onChange} />);
  fireEvent.mouseDown(screen.getByRole('combobox'));
  const occupied = await screen.findByText('1（已被总所占用）');
  expect(occupied.closest('.ant-select-item-option')).toHaveClass('ant-select-item-option-disabled');
  fireEvent.click(occupied);
  expect(onChange).not.toHaveBeenCalled();
  expect(screen.getByText('2（已被分所占用）').closest('.ant-select-item-option')).toHaveClass('ant-select-item-option-disabled');
});
test('SPEC-003-B permits the current organization number and accepts large available numbers by search', async () => {
  const onChange = vi.fn();
  render(<OrganizationSortSelect nodes={nodes} ownId="root" value={1} onChange={onChange} />);
  fireEvent.mouseDown(screen.getByRole('combobox'));
  expect(screen.queryByText('1（已被总所占用）')).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole('combobox'), { target: { value: '100000' } });
  fireEvent.click((await screen.findAllByText('100000')).at(-1)!);
  expect(onChange).toHaveBeenCalledWith(100000, expect.anything());
});
