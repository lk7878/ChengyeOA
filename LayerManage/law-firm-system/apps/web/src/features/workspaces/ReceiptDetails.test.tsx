import { expect, test } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import ReceiptDetails from './ReceiptDetails';

test('receipt details preserve every payment and offer no case-side modification', async () => {
  render(
    <ReceiptDetails
      tableId="case-table"
      value={[
        {
          id: 'a',
          number: 'P001',
          amount: '10000.00',
          paidAt: '2026-01-02T02:00:00Z',
          invoiceStatus: 'ISSUED',
          invoiceNo: 'INV1',
          files: [],
        },
        {
          id: 'b',
          number: 'P002',
          amount: '5000.00',
          paidAt: '2026-03-06T02:00:00Z',
          invoiceStatus: 'NOT_ISSUED',
          files: [],
        },
        {
          id: 'c',
          number: 'P003',
          amount: '5000.00',
          paidAt: '2026-10-15T02:00:00Z',
          invoiceStatus: 'NOT_ISSUED',
          files: [],
        },
      ]}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: '3 笔收款 · 查看明细' }));
  expect(await screen.findByText('P001')).toBeTruthy();
  expect(screen.getByText('P002')).toBeTruthy();
  expect(screen.getByText('P003')).toBeTruthy();
  expect(screen.getByText('10,000.00 元')).toBeTruthy();
  expect(screen.queryByRole('button', { name: '删除' })).toBeNull();
  expect(screen.queryByRole('button', { name: '编辑' })).toBeNull();
});
