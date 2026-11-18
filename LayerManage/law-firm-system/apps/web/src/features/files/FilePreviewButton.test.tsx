import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import FilePreviewButton from './FilePreviewButton';
import { authenticatedFetch } from '../workspaces/api';

vi.mock('../workspaces/api', () => ({ authenticatedFetch: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

test.each([
  ['html', '<h1>文件内容</h1><form><input></form><img alt="外链" src="https://example.invalid/image.png">'],
  ['markdown', '# 文件内容\n\n|项目|数量|\n|---|---|\n|材料|2|'],
])('%s opens as a read-only document in an isolated frame', async (format, sample) => {
  vi.mocked(authenticatedFetch).mockResolvedValue(new Response(sample, { headers: { 'X-OA-Preview': format } }));
  render(<FilePreviewButton name="材料" url="/api/v1/workflows/files/one?instance=two" />);
  expect(authenticatedFetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByTitle('在线预览'));
  const frame = await screen.findByTitle('材料');
  expect(authenticatedFetch).toHaveBeenCalledWith('/api/v1/workflows/files/one?instance=two&preview=1', expect.any(AbortSignal));
  expect(frame).toHaveAttribute('sandbox', '');
  expect(frame.getAttribute('srcdoc')).toContain('<h1>文件内容</h1>');
  expect(frame.getAttribute('srcdoc')).not.toContain('<form>');
  expect(frame.getAttribute('srcdoc')).not.toContain('https://example.invalid');
});
test('denied access opens an error without retrying through the administrator route', async () => {
  vi.mocked(authenticatedFetch).mockResolvedValue(new Response(null, { status: 403 }));
  render(<FilePreviewButton name="授权材料" url="/api/v1/personal-files/one/versions/2/content" />);
  fireEvent.click(screen.getByTitle('在线预览'));
  expect(await screen.findByText(/当前账号没有阅读权限/)).toBeInTheDocument();
  expect(authenticatedFetch).toHaveBeenCalledTimes(1);
});
