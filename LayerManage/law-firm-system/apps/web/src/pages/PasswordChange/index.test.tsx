import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { message } from 'antd';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { useAuthStore } from '@/stores/authStore';
import { usePasswordChangeStore } from '@/stores/passwordChangeStore';
import PasswordChange from './index';

const forcePasswordChangeMock = vi.hoisted(() => vi.fn());

vi.mock('@/api/auth', () => ({
  authApi: { forcePasswordChange: forcePasswordChangeMock },
}));

function observePasswordChangeUi() {
  const exposure = { heading: false, form: false, password: false, confirmation: false };
  const scan = (node: Node) => {
    if (!(node instanceof Element)) return;
    exposure.heading ||= Array.from(node.querySelectorAll('h2')).some(
      (heading) => heading.textContent === '修改初始密码',
    ) || (node.matches('h2') && node.textContent === '修改初始密码');
    exposure.form ||= node.matches('form#password-change') || Boolean(node.querySelector('form#password-change'));
    exposure.password ||= node.matches('[aria-label="新密码"]') || Boolean(node.querySelector('[aria-label="新密码"]'));
    exposure.confirmation ||= node.matches('[aria-label="确认新密码"]') || Boolean(node.querySelector('[aria-label="确认新密码"]'));
  };
  const consume = (records: MutationRecord[]) => {
    records.forEach((record) => record.addedNodes.forEach(scan));
  };
  const observer = new MutationObserver(consume);
  observer.observe(document.body, { childList: true, subtree: true });
  return () => {
    consume(observer.takeRecords());
    observer.disconnect();
    return exposure;
  };
}

beforeEach(() => {
  forcePasswordChangeMock.mockReset();
  useAuthStore.setState({ token: null, refreshToken: null, userInfo: null, isAuthenticated: false });
  usePasswordChangeStore.getState().clear();
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/password-change']}>
      <Routes>
        <Route path="/password-change" element={<PasswordChange />} />
        <Route path="/login" element={<h1>登录页</h1>} />
      </Routes>
    </MemoryRouter>,
  );
}

function submitPasswords(password = 'Replacement-Horse-93!', confirmation = password) {
  fireEvent.change(screen.getByLabelText('新密码'), { target: { value: password } });
  fireEvent.change(screen.getByLabelText('确认新密码'), { target: { value: confirmation } });
  fireEvent.click(screen.getByRole('button', { name: '确认修改' }));
}

test('renders two accessible password controls and submits with the in-memory bearer token', async () => {
  const success = vi.spyOn(message, 'success').mockImplementation(() => ({}) as never);
  usePasswordChangeStore.getState().begin('change-token', 300);
  forcePasswordChangeMock.mockResolvedValueOnce({ code: 200, message: 'OK', data: null });

  renderPage();
  expect(screen.getByRole('heading', { name: '修改初始密码' })).toBeInTheDocument();
  expect(screen.getByLabelText('新密码')).toHaveAttribute('type', 'password');
  expect(screen.getByLabelText('确认新密码')).toHaveAttribute('type', 'password');

  submitPasswords();

  await waitFor(() => expect(forcePasswordChangeMock).toHaveBeenCalledWith(
    'change-token',
    'Replacement-Horse-93!',
    'Replacement-Horse-93!',
  ));
  expect(await screen.findByRole('heading', { name: '登录页' })).toBeInTheDocument();
  expect(success).toHaveBeenCalledWith('密码已更新，请重新登录');
  expect(usePasswordChangeStore.getState()).toMatchObject({ token: null, expiresAt: null });
  expect(useAuthStore.getState().isAuthenticated).toBe(false);
  expect(JSON.stringify({ ...window.localStorage })).not.toContain('change-token');
  expect(JSON.stringify({ ...window.sessionStorage })).not.toContain('change-token');
});

describe.each([
  ['PASSWORD_INVALID', '新密码不符合安全要求，请重新输入'],
  ['PASSWORD_REUSED', '新密码不能与初始密码相同'],
])('%s response', (code, publicMessage) => {
  test('shows stable Chinese copy without server internals', async () => {
    usePasswordChangeStore.getState().begin('change-token', 300);
    forcePasswordChangeMock.mockRejectedValueOnce({
      response: { data: { message: code, detail: 'database stack and decoded token' } },
    });

    renderPage();
    submitPasswords();

    expect(await screen.findByRole('alert')).toHaveTextContent(publicMessage);
    expect(screen.queryByText(/database stack|decoded token|PASSWORD_/)).not.toBeInTheDocument();
    expect(usePasswordChangeStore.getState().token).toBe('change-token');
  });
});

test('clears an invalid change token, shows a stable message, and returns to login', async () => {
  const error = vi.spyOn(message, 'error').mockImplementation(() => ({}) as never);
  usePasswordChangeStore.getState().begin('change-token', 300);
  forcePasswordChangeMock.mockRejectedValueOnce({
    response: { data: { message: 'TOKEN_INVALID', detail: 'signed token internals' } },
  });

  renderPage();
  submitPasswords();

  expect(await screen.findByRole('heading', { name: '登录页' })).toBeInTheDocument();
  expect(error).toHaveBeenCalledWith('登录状态已失效，请重新登录');
  expect(usePasswordChangeStore.getState()).toMatchObject({ token: null, expiresAt: null });
  expect(screen.queryByText(/TOKEN_INVALID|signed token/)).not.toBeInTheDocument();
});

test('rejects mismatched confirmation before calling the endpoint', async () => {
  usePasswordChangeStore.getState().begin('change-token', 300);
  renderPage();
  submitPasswords('Replacement-Horse-93!', 'Different-Horse-94!');

  expect(await screen.findByText('两次输入的密码不一致')).toBeInTheDocument();
  expect(forcePasswordChangeMock).not.toHaveBeenCalled();
});

test('page expiry clears memory and returns to login without calling the endpoint', async () => {
  usePasswordChangeStore.setState({ token: 'expired-token', expiresAt: Date.now() - 1 });
  const stopObserving = observePasswordChangeUi();
  const { container } = renderPage();

  expect(stopObserving()).toEqual({ heading: false, form: false, password: false, confirmation: false });
  expect(screen.queryByRole('heading', { name: '修改初始密码' })).not.toBeInTheDocument();
  expect(screen.queryByLabelText('新密码')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('确认新密码')).not.toBeInTheDocument();
  expect(container.querySelector('form#password-change')).toBeNull();
  expect(await screen.findByRole('heading', { name: '登录页' })).toBeInTheDocument();
  expect(usePasswordChangeStore.getState()).toMatchObject({ token: null, expiresAt: null });
  expect(forcePasswordChangeMock).not.toHaveBeenCalled();
});

test('a short-lived token automatically clears and redirects exactly at expiry', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-07-15T08:00:00.000Z'));
  usePasswordChangeStore.getState().begin('short-token', 1);
  renderPage();

  expect(screen.getByRole('heading', { name: '修改初始密码' })).toBeInTheDocument();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });

  expect(screen.getByRole('heading', { name: '登录页' })).toBeInTheDocument();
  expect(usePasswordChangeStore.getState()).toMatchObject({ token: null, expiresAt: null });
  expect(forcePasswordChangeMock).not.toHaveBeenCalled();
});

test('unmount cancels the scheduled expiry cleanup', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-07-15T08:00:00.000Z'));
  usePasswordChangeStore.getState().begin('short-token', 1);
  const page = renderPage();

  page.unmount();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });

  expect(usePasswordChangeStore.getState().token).toBe('short-token');
  expect(forcePasswordChangeMock).not.toHaveBeenCalled();
});

test('expiry after render but before submit clears state and never calls the endpoint', async () => {
  const error = vi.spyOn(message, 'error').mockImplementation(() => ({}) as never);
  let now = 1000;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  usePasswordChangeStore.setState({ token: 'short-token', expiresAt: 100_000 });
  renderPage();

  await act(async () => {
    fireEvent.change(screen.getByLabelText('新密码'), { target: { value: 'Replacement-Horse-93!' } });
    fireEvent.change(screen.getByLabelText('确认新密码'), { target: { value: 'Replacement-Horse-93!' } });
    await Promise.resolve();
  });
  now = 100_001;
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '确认修改' }));
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(await screen.findByRole('heading', { name: '登录页' })).toBeInTheDocument();
  expect(usePasswordChangeStore.getState()).toMatchObject({ token: null, expiresAt: null });
  expect(forcePasswordChangeMock).not.toHaveBeenCalled();
  expect(error).toHaveBeenCalledWith('登录状态已失效，请重新登录');
});

test('back to login clears both password-change memory and any normal session storage', async () => {
  usePasswordChangeStore.getState().begin('change-token', 300);
  useAuthStore.setState({
    token: 'old-access',
    refreshToken: 'old-refresh',
    userInfo: null,
    isAuthenticated: false,
  });
  window.localStorage.setItem('law_firm_token', 'old-access');
  window.localStorage.setItem('law_firm_refresh_token', 'old-refresh');

  renderPage();
  fireEvent.click(screen.getByRole('button', { name: '返回登录' }));

  expect(await screen.findByRole('heading', { name: '登录页' })).toBeInTheDocument();
  expect(usePasswordChangeStore.getState()).toMatchObject({ token: null, expiresAt: null });
  expect(useAuthStore.getState()).toMatchObject({
    token: null,
    refreshToken: null,
    userInfo: null,
    isAuthenticated: false,
  });
  expect(window.localStorage.getItem('law_firm_token')).toBeNull();
  expect(window.localStorage.getItem('law_firm_refresh_token')).toBeNull();
});
