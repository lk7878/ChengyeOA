import { afterEach, expect, test, vi } from 'vitest';
import request from '@/api/request';
import { upload, download } from './api';

const originalAdapter = request.defaults.adapter;
afterEach(() => {
  request.defaults.adapter = originalAdapter;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

test('attachment upload keeps multipart bytes through the existing authenticated JSON client', async () => {
  const file = new File(['%PDF-1.4\n'], '审批材料.pdf', { type: 'application/pdf' });
  request.defaults.adapter = async (config) => {
    expect(config.url).toBe('/v1/workflows/files');
    expect(config.headers.get('Content-Type')).toMatch(/multipart\/form-data/);
    expect(config.data).toBeInstanceOf(FormData);
    expect(config.data.get('file')).toBe(file);
    return {
      status: 200,
      statusText: 'OK',
      config,
      headers: {},
      data: { code: 200, data: { id: 'file-id', name: file.name } },
    };
  };
  expect(await upload(file)).toEqual({ id: 'file-id', name: file.name });
});

test('attachment download uses the JSON envelope and preserves the original filename and content', async () => {
  vi.useFakeTimers();
  request.defaults.adapter = async (config) => {
    expect(config.url).toBe('/v1/workflows/files/file-id?instance=instance-id');
    return {
      status: 200,
      statusText: 'OK',
      config,
      headers: {},
      data: {
        code: 200,
        data: { name: '审批材料.pdf', mime: 'application/pdf', base64: btoa('%PDF-1.4\n') },
      },
    };
  };
  const create = vi.fn((blob: Blob) => {
    void blob;
    return 'blob:workflow-qa';
  });
  const revoke = vi.fn();
  vi.stubGlobal(
    'URL',
    Object.assign(class extends URL {}, { createObjectURL: create, revokeObjectURL: revoke }),
  );
  let name = '';
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    name = this.download;
  });
  await download('file-id', 'instance-id');
  expect(name).toBe('审批材料.pdf');
  expect(create).toHaveBeenCalledOnce();
  const blob = create.mock.calls[0][0] as Blob;
  expect(blob.type).toBe('application/pdf');
  expect(blob.size).toBe(9);
  await vi.runAllTimersAsync();
  expect(revoke).toHaveBeenCalledWith('blob:workflow-qa');
});
