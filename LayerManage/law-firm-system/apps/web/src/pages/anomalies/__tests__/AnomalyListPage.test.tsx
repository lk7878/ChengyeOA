import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, expect, test, vi } from 'vitest';
import AnomalyListPage from '../AnomalyListPage';
import { useAnomalyStore } from '@/stores/anomaly-store';
import type { AnomalyContractView } from '@/api/anomaly';

const anomalyApiMock = vi.hoisted(() => ({
  listSignedUnpaid: vi.fn(),
  listReceivedUninvoiced: vi.fn(),
  listFirstSignNoFormal: vi.fn(),
  listPaidNoCase: vi.fn(),
}));
vi.mock('@/api/anomaly', async importOriginal => {
  const original = await importOriginal<typeof import('@/api/anomaly')>();
  return { ...original, anomalyApi: anomalyApiMock };
});

function anomalyFixture(overrides: Partial<AnomalyContractView> = {}): AnomalyContractView {
  return {
    contractId: 'contract-1',
    contractNo: 'WT2026-0001',
    contractType: 'FIRST_SIGN',
    customerId: 'customer-1',
    amount: '50000.00',
    receivedAmount: '0.00',
    status: 'SIGNED',
    signDate: '2026-07-01T00:00:00.000Z',
    effectiveDate: null,
    gapAmount: null,
    ...overrides,
  };
}

function pageOf(list: AnomalyContractView[], total = list.length) {
  return { code: 200, message: 'success', data: { list, page: 1, pageSize: 10, total } };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/anomalies']}>
      <Routes>
        <Route path="/anomalies" element={<AnomalyListPage />} />
        <Route path="/contracts/:id" element={<div>contract-detail-placeholder</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useAnomalyStore.getState().reset();
});

test('renders the default tab list with server data', async () => {
  anomalyApiMock.listSignedUnpaid.mockResolvedValue(pageOf([anomalyFixture()]));
  renderPage();

  expect(await screen.findByText('WT2026-0001')).toBeInTheDocument();
  expect(screen.getByText('50000.00')).toBeInTheDocument();
  expect(screen.getByText('首签合同')).toBeInTheDocument();
  expect(screen.getByText('已签署')).toBeInTheDocument();
  expect(anomalyApiMock.listSignedUnpaid).toHaveBeenCalledWith(expect.objectContaining({ page: 1, pageSize: 10 }));
});

test('switching tabs fetches the corresponding endpoint', async () => {
  anomalyApiMock.listSignedUnpaid.mockResolvedValue(pageOf([]));
  anomalyApiMock.listReceivedUninvoiced.mockResolvedValue(pageOf([anomalyFixture({ gapAmount: '30000.00' })]));
  renderPage();
  await screen.findByText('暂无异常合同');

  fireEvent.click(screen.getByText('已收未开票'));
  await waitFor(() => expect(anomalyApiMock.listReceivedUninvoiced).toHaveBeenCalledWith(
    expect.objectContaining({ page: 1, pageSize: 10 }),
  ));
  expect(await screen.findByText('30000.00')).toBeInTheDocument();
});

test('shows the empty state when the server returns no anomalies', async () => {
  anomalyApiMock.listSignedUnpaid.mockResolvedValue(pageOf([]));
  renderPage();

  expect(await screen.findByText('暂无异常合同')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('shows an error state when the list request fails', async () => {
  anomalyApiMock.listSignedUnpaid.mockRejectedValue(new Error('网络错误'));
  renderPage();

  expect(await screen.findByText('异常台账加载失败')).toBeInTheDocument();
  expect(screen.getByText('网络错误')).toBeInTheDocument();
});

test('clicking a row navigates to the contract detail page', async () => {
  anomalyApiMock.listSignedUnpaid.mockResolvedValue(pageOf([anomalyFixture()]));
  renderPage();

  fireEvent.click(await screen.findByText('WT2026-0001'));
  expect(await screen.findByText('contract-detail-placeholder')).toBeInTheDocument();
});

test('renders the gap amount column only for the received-uninvoiced tab', async () => {
  anomalyApiMock.listSignedUnpaid.mockResolvedValue(pageOf([anomalyFixture()]));
  anomalyApiMock.listReceivedUninvoiced.mockResolvedValue(pageOf([anomalyFixture({ gapAmount: '30000.00' })]));
  renderPage();
  await screen.findByText('WT2026-0001');

  // signed-unpaid：缺口额列渲染 '-'（gapAmount 恒 null）。
  expect(screen.getAllByText('-').length).toBeGreaterThan(0);

  fireEvent.click(screen.getByText('已收未开票'));
  expect(await screen.findByText('30000.00')).toBeInTheDocument();
});
