import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, expect, test, vi } from 'vitest';
import { get, authenticatedFetch } from '@/features/workspaces/api';
import { useAuthStore } from '@/stores/authStore';
import PortalHome from './PortalHome';
import PortalAdmin from './PortalAdmin';
import { blank, type Feed } from './types';
vi.mock('@/features/workspaces/api', () => ({
  get: vi.fn(),
  authenticatedFetch: vi.fn(),
}));
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

test('a large lawyer directory shows five portraits, moves one at a time and searches the whole roster', async () => {
  const originalObserver = globalThis.ResizeObserver;
  globalThis.ResizeObserver = class {
    callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
    }
    observe(element: Element) {
      if (element.classList.contains('portal-lawyer-slider')) {
        this.callback(
          [
            {
              target: element,
              contentRect: { width: 800 },
            } as ResizeObserverEntry,
          ],
          this,
        );
      }
    }
    unobserve() {}
    disconnect() {}
  };
  vi.mocked(get).mockResolvedValue({
    ...feed,
    people: Array.from({ length: 100 }, (_, i) => ({
      ...feed.people[0],
      id: String(i),
      name: `律师${String(i + 1).padStart(3, '0')}`,
    })),
  });
  try {
    const { container } = render(
      <MemoryRouter>
        <PortalHome />
      </MemoryRouter>,
    );
    expect(await screen.findByText('共 100 位 · 同时展示 5 位')).toBeInTheDocument();
    const activeNames = () =>
      Array.from(container.querySelectorAll('.portal-lawyer-slider .slick-active strong')).map(
        (e) => e.textContent,
      );
    expect(activeNames()).toEqual(['律师001', '律师002', '律师003', '律师004', '律师005']);
    fireEvent.click(screen.getByRole('button', { name: '下一位' }));
    await vi.waitFor(() =>
      expect(activeNames()).toEqual(['律师002', '律师003', '律师004', '律师005', '律师006']),
    );
    fireEvent.click(screen.getByRole('button', { name: '查看全部' }));
    fireEvent.change(screen.getByRole('textbox', { name: '搜索展示资料' }), {
      target: { value: '律师100' },
    });
    expect(screen.getByText('共 1 项')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /律师100/ }));
    expect(
      screen.getAllByRole('dialog').some((e) => e.textContent?.includes('专业方向 · 民事')),
    ).toBe(true);
  } finally {
    globalThis.ResizeObserver = originalObserver;
  }
});

test('the carousel warms the next portraits without fetching the entire roster', async () => {
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:${Math.random()}`);
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  vi.mocked(authenticatedFetch).mockResolvedValue({
    ok: true,
    blob: async () => new Blob(['portrait']),
  } as Response);
  const people = Array.from({ length: 100 }, (_, i) => ({
    ...feed.people[0],
    id: `p${i}`,
    name: `照片律师${i}`,
  }));
  vi.mocked(get).mockResolvedValue({
    ...feed,
    people,
    entries: people.map((p) => ({
      ...blank,
      id: p.id,
      subject: p.id,
      kind: 'LAWYER',
      title: p.name,
      personName: p.name,
      date: null,
      image: { id: `image-${p.id}`, name: 'portrait.jpg' },
    })),
  });
  const { unmount } = render(
    <MemoryRouter>
      <PortalHome />
    </MemoryRouter>,
  );
  await screen.findByText('共 100 位 · 同时展示 1 位');
  await vi.waitFor(() => expect(authenticatedFetch).toHaveBeenCalledTimes(2));
  expect(vi.mocked(authenticatedFetch).mock.calls.map(([url]) => url)).toEqual([
    '/api/v1/portal/files/p0/image-p0?thumbnail=1',
    '/api/v1/portal/files/p1/image-p1?thumbnail=1',
  ]);
  fireEvent.click(screen.getByRole('button', { name: '下一位' }));
  await vi.waitFor(() => expect(authenticatedFetch).toHaveBeenCalledTimes(3));
  unmount();
  vi.restoreAllMocks();
});
