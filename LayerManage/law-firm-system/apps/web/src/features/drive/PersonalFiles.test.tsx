import { fireEvent, render, screen, waitFor, within, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { ModalProps } from 'antd';
import PersonalFiles from './PersonalFiles';
import { get, post } from '../workspaces/api';
vi.mock('../workspaces/api',()=>({get:vi.fn(),post:vi.fn(),patch:vi.fn(),errorMessage:()=> '清理失败'}));
vi.mock('@/stores/authStore',()=>({useAuthStore:()=>({userId:'owner',isSystemSuperAdmin:false})}));
// Test the confirmation state without relying on portal closing animations in jsdom.
vi.mock('@/components/DraggableModal',()=>({DragSurface:({children}:{children:ReactNode})=><>{children}</>,default:(props:ModalProps)=>props.open?<section role="dialog" aria-label={String(props.title)}>{props.children}<button onClick={props.onCancel}>{props.cancelText??'取消'}</button><button disabled={props.confirmLoading} onClick={props.onOk}>{props.okText??'确定'}</button></section>:null}));
vi.mock('./file-transfer',()=>({uploadFile:vi.fn(),downloadVersion:vi.fn()}));
const file={id:'deleted-file',name:'待删除.txt',version:4,deletedAt:'2026-11-16'};
beforeEach(()=>{vi.clearAllMocks();vi.mocked(get).mockImplementation(async(url)=>url==='/personal-files/trash'?{items:[file]}:{items:[],path:[],canUpload:false});vi.mocked(post).mockResolvedValue({ok:true});});
afterEach(cleanup);
test('permanent deletion requires explicit confirmation; cancelling does not send a request',async()=>{
 render(<PersonalFiles scope="mine"/>);
 fireEvent.click(screen.getByRole('button',{name:'回收站'}));
 const trash=await screen.findByRole('dialog',{name:'我的文件回收站'});
 fireEvent.click(within(trash).getByRole('button',{name:'彻底删除'}));
 let confirm=await screen.findByRole('dialog',{name:'确认彻底删除'});
 expect(within(confirm).getByText('原文件及全部历史版本将被永久删除，无法恢复。')).toBeInTheDocument();
 expect(post).not.toHaveBeenCalled();
 fireEvent.click(within(confirm).getByRole('button',{name:/取\s*消/}));
 await waitFor(()=>expect(confirm).not.toBeVisible());
 expect(post).not.toHaveBeenCalled();
 fireEvent.click(within(trash).getByRole('button',{name:'彻底删除'}));
 confirm=await screen.findByRole('dialog',{name:'确认彻底删除'});
 fireEvent.click(within(confirm).getByRole('button',{name:'彻底删除'}));
 await waitFor(()=>expect(post).toHaveBeenCalledWith('/personal-files/deleted-file/purge',{version:4}));
 await waitFor(()=>expect(within(trash).queryByText(file.name)).not.toBeInTheDocument());
});
test('a pending disk cleanup is retryable and cannot be restored',async()=>{
 vi.mocked(get).mockImplementation(async(url)=>url==='/personal-files/trash'?{items:[{...file,purging:true}]}:{items:[],path:[],canUpload:false});
 render(<PersonalFiles scope="mine"/>);fireEvent.click(screen.getByRole('button',{name:'回收站'}));
 const trash=await screen.findByRole('dialog',{name:'我的文件回收站'});
 expect(within(trash).getByRole('button',{name:/恢\s*复/})).toBeDisabled();
 expect(within(trash).getByRole('button',{name:'重试彻底删除'})).toBeEnabled();
});
