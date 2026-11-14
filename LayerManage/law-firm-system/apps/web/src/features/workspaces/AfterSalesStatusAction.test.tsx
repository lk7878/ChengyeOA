import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import AfterSalesStatusAction from './AfterSalesStatusAction';
import type { Field, RecordRow } from './types';
afterEach(cleanup);
const status: Field = {
  id: 'status',
  name: '协商状态',
  type: 'SINGLE_SELECT',
  required: true,
  writable: true,
  archived: false,
  position: 27,
  defaultValue: 'OPEN',
  options: {
    lifecycleKey: 'status',
    choices: [
      { id: 'OPEN', name: '协商中' },
      { id: 'REFUND_REQUIRED', name: '协商未果 / 需退款' },
    ],
  },
};
const row: RecordRow = {
  id: 'r',
  tableId: 'a',
  values: { status: 'OPEN' },
  version: 5,
  createdAt: '',
  updatedAt: '',
  createdBy: 'u',
  ownerId: 'u',
  writable: true,
};
test('hidden view columns still have an authorized status action using the current record', () => {
  const onEdit = vi.fn();
  render(<AfterSalesStatusAction fields={[status]} row={row} onEdit={onEdit} />);
  fireEvent.click(screen.getByRole('button', { name: '协商状态：协商中' }));
  expect(onEdit).toHaveBeenCalledWith(status);
});
test('field and record restrictions prevent changing status; hidden fields reveal no value', () => {
  const onEdit = vi.fn();
  const view = render(
    <AfterSalesStatusAction fields={[{ ...status, writable: false }]} row={row} onEdit={onEdit} />,
  );
  expect(screen.getByRole('button')).toBeDisabled();
  view.rerender(
    <AfterSalesStatusAction fields={[status]} row={{ ...row, writable: false }} onEdit={onEdit} />,
  );
  expect(screen.getByRole('button')).toBeDisabled();
  view.rerender(<AfterSalesStatusAction fields={[]} row={row} onEdit={onEdit} />);
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  expect(onEdit).not.toHaveBeenCalled();
});
