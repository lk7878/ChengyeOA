import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, expect, test, vi } from 'vitest';
import { get } from '@/features/workspaces/api';
import { useAuthStore } from '@/stores/authStore';
import PortalHome from './PortalHome';
import PortalAdmin from './PortalAdmin';
import { blank, type Feed } from './types';
vi.mock('@/features/workspaces/api', () => ({ get: vi.fn(), authenticatedFetch: vi.fn() }));
const feed: Feed = {
  teams: [{ id: 'T', name: '办案一组', description: '法律服务' }],
  people: ['甲', '乙'].map((n) => ({
    id: n,
    name: n + '律师',
    type: 'LAWYER',
    lawyer: true,
    positions: ['律师'],
    directions: ['民事'],
    teams: ['T'],
  })),
  entries: [
    {
      ...blank,
      id: 'award',
      kind: 'HONOR',
      subject: '甲',
      date: null,
      title: '季度之星',
      period: '第一季度',
      personName: '甲律师',
      body: '优秀表现',
    },
  ],
};
beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({ authorization: null });
  vi.mocked(get).mockResolvedValue(feed);
});
test('ordinary homepage uses the roster, has selectable teams, and the lawyer carousel can pause', async () => {
  render(
    <MemoryRouter>
      <PortalHome />
    </MemoryRouter>,
  );
  expect(await screen.findByRole('heading', { name: '律师与专业团队' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: '优秀员工' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /暂\s*停/ }));
  expect(screen.getByRole('button', { name: /播\s*放/ })).toBeInTheDocument();
  fireEvent.click(screen.getByText('团队', { selector: '.ant-segmented-item-label' }));
  expect(await screen.findByText('办案一组', { selector: 'strong' })).toBeInTheDocument();
  expect(screen.queryByText('管理首页')).not.toBeInTheDocument();
});
test('opening an existing article link resolves the current published item', async () => {
  render(
    <MemoryRouter initialEntries={['/?article=award']}>
      <PortalHome />
    </MemoryRouter>,
  );
  expect(await screen.findByRole('dialog')).toHaveTextContent('优秀表现');
});
test('the maintenance page checks the super administrator role before fetching drafts', () => {
  render(
    <MemoryRouter>
      <PortalAdmin />
    </MemoryRouter>,
  );
  expect(screen.getByText('仅超级管理员可以维护首页')).toBeInTheDocument();
  expect(get).not.toHaveBeenCalled();
});
