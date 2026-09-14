import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import Modal from './DraggableModal';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

test('title dragging moves the modal, input dragging does not, and reopening resets its position', () => {
  vi.stubGlobal('PointerEvent', MouseEvent);
  const capture = vi.fn();
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { configurable: true, value: capture });
  const { rerender } = render(<Modal title="可拖动新建窗口" open><input aria-label="业务内容" /></Modal>);
  const surface = screen.getByRole('dialog').querySelector('.oa-modal-drag-surface') as HTMLDivElement;
  expect(surface).toBeTruthy();
  vi.spyOn(surface, 'getBoundingClientRect').mockReturnValue({ left: 200, top: 100, right: 700, bottom: 500, width: 500, height: 400, x: 200, y: 100, toJSON() {} });
  fireEvent.pointerDown(screen.getByText('可拖动新建窗口'), { button: 0, clientX: 250, clientY: 120 });
  fireEvent.pointerMove(surface, { clientX: 330, clientY: 160 });
  fireEvent.pointerUp(surface);
  expect(surface.style.transform).toBe('translate(80px, 40px)');
  fireEvent.pointerDown(screen.getByLabelText('业务内容'), { button: 0, clientX: 250, clientY: 200 });
  fireEvent.pointerMove(surface, { clientX: 500, clientY: 400 });
  expect(surface.style.transform).toBe('translate(80px, 40px)');
  rerender(<Modal title="可拖动新建窗口" open={false}><input aria-label="业务内容" /></Modal>);
  rerender(<Modal title="可拖动新建窗口" open><input aria-label="业务内容" /></Modal>);
  expect((screen.getByRole('dialog').querySelector('.oa-modal-drag-surface') as HTMLDivElement).style.transform).toBe('');
});
