import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import Modal, { DragSurface } from './DraggableModal';
import Drawer from './DraggableDrawer';

afterEach(async () => {
  cleanup();
  await act(async () => { Modal.destroyAll(); });
  await waitFor(() => expect(document.querySelector('.ant-modal-root')).toBeNull());
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

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

test('static confirm dialogs render the same draggable surface', async () => {
  Modal.confirm({ title: '确认拖动', content: '确认弹窗内容',transitionName:'',maskTransitionName:'' });
  await waitFor(() => { expect(document.querySelector('.oa-modal-drag-surface')).toBeTruthy(); });
});

function startDrag(title: HTMLElement, surface: HTMLElement, button = 0) {
  vi.stubGlobal('PointerEvent', MouseEvent);
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { configurable: true, value: vi.fn() });
  vi.spyOn(surface, 'getBoundingClientRect').mockReturnValue({ left: 200, top: 100, right: 700, bottom: 500, width: 500, height: 400, x: 200, y: 100, toJSON() {} });
  fireEvent.pointerDown(title, { button, clientX: 250, clientY: 120 });
  fireEvent.pointerMove(surface, { clientX: 330, clientY: 160 });
  fireEvent.pointerUp(surface);
}

test('static and hook confirmation titles drag without triggering confirmation', async () => {
  const onOk = vi.fn();
  function HookConfirm() {
    const [modal, holder] = Modal.useModal();
    return <>{holder}<button onClick={() => modal.confirm({ title: '上下文确认', onOk, transitionName: '', maskTransitionName: '' })}>打开确认</button></>;
  }
  render(<HookConfirm />);
  fireEvent.click(screen.getByText('打开确认'));
  const title = await screen.findByText('上下文确认', { selector: '.ant-modal-confirm-title' });
  const surface = title.closest('.oa-modal-drag-surface') as HTMLElement;
  startDrag(title, surface);
  expect(surface.style.transform).toBe('translate(80px, 40px)');
  expect(onOk).not.toHaveBeenCalled();
  await act(async () => { Modal.info({ title: '提示窗口', content: '提示正文', transitionName: '', maskTransitionName: '' }); });
  const infoTitle = await screen.findByText('提示窗口', { selector: '.ant-modal-confirm-title' });
  const infoSurface = infoTitle.closest('.oa-modal-drag-surface') as HTMLElement;
  startDrag(infoTitle, infoSurface);
  expect(infoSurface.style.transform).toBe('translate(80px, 40px)');
});

test('drawer title dragging preserves the form; reopening resets position and header actions remain clickable', () => {
  const onAction = vi.fn();
  const props = { title: '抽屉测试', extra: <button onClick={onAction}>保存表单</button>, children: <input aria-label="抽屉内容" defaultValue="未提交内容" /> };
  const { rerender } = render(<Drawer {...props} open />);
  const title = screen.getByText('抽屉测试');
  const surface = title.closest('.oa-modal-drag-surface') as HTMLElement;
  startDrag(title, surface, 2);
  expect(surface.style.transform).toBe('');
  startDrag(title, surface);
  expect(surface.style.transform).toBe('translate(80px, 40px)');
  expect(screen.getByLabelText('抽屉内容')).toHaveValue('未提交内容');
  startDrag(screen.getByText('保存表单'), surface);
  expect(surface.style.transform).toBe('translate(80px, 40px)');
  fireEvent.click(screen.getByText('保存表单'));
  expect(onAction).toHaveBeenCalledOnce();
  rerender(<Drawer {...props} open={false} />);
  rerender(<Drawer {...props} open />);
  expect((screen.getByText('抽屉测试').closest('.oa-modal-drag-surface') as HTMLElement).style.transform).toBe('');
});

test('nested surfaces drag independently and cannot move the title outside the viewport', () => {
  render(<DragSurface><div className="ant-drawer-header">父窗口</div><DragSurface><div className="ant-modal-header">子窗口</div></DragSurface></DragSurface>);
  const outer = screen.getByText('父窗口').closest('.oa-modal-drag-surface') as HTMLElement;
  const inner = screen.getByText('子窗口').closest('.oa-modal-drag-surface') as HTMLElement;
  startDrag(screen.getByText('子窗口'), inner);
  expect(outer.style.transform).toBe('');
  expect(inner.style.transform).toBe('translate(80px, 40px)');
  vi.spyOn(outer, 'getBoundingClientRect').mockReturnValue({ left: 200, top: 100, right: 700, bottom: 500, width: 500, height: 400, x: 200, y: 100, toJSON() {} });
  fireEvent.pointerDown(screen.getByText('父窗口'), { button: 0, clientX: 250, clientY: 120 });
  fireEvent.pointerMove(outer, { clientX: -10000, clientY: -10000 });
  // The title is clamped eight pixels inside the viewport.
  expect(outer.style.transform).toBe('translate(-192px, -92px)');
  fireEvent.pointerCancel(outer);
  fireEvent.pointerMove(outer, { clientX: 500, clientY: 500 });
  expect(outer.style.transform).toBe('translate(-192px, -92px)');
});
