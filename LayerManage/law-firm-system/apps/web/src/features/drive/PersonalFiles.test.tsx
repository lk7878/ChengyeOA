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
const file={id:'deleted-file',name:'待删除.txt',version:4,deletedAt:'2026-11-16'};
let trashItems:(typeof file & {purging?:boolean})[]=[];
beforeEach(()=>{vi.clearAllMocks();trashItems=[file];vi.mocked(get).mockImplementation(async(url)=>url==='/personal-files/trash'?{items:trashItems}:{items:[],path:[],canUpload:false});vi.mocked(post).mockImplementation(async(_url,body)=>{const files=(body as {files:{id:string}[]}).files;trashItems=trashItems.filter(f=>!files.some(r=>r.id===f.id));return {count:files.length,failed:[]};});});
afterEach(cleanup);
test('permanent deletion requires explicit confirmation; cancelling does not send a request',async()=>{
 render(<PersonalFiles scope="mine"/>);
 fireEvent.click(screen.getByRole('button',{name:'回收站'}));
 const trash=await screen.findByRole('dialog',{name:'我的文件回收站'});
 fireEvent.click(within(trash).getByRole('button',{name:'彻底删除'}));
 let confirm=await screen.findByRole('dialog',{name:'确认彻底删除'});
 expect(within(confirm).getByText('所选文件、文件夹的全部下级内容及历史版本将被永久删除，无法恢复。')).toBeInTheDocument();
 expect(post).not.toHaveBeenCalled();
 fireEvent.click(within(confirm).getByRole('button',{name:/取\s*消/}));
 await waitFor(()=>expect(confirm).not.toBeVisible());
 expect(post).not.toHaveBeenCalled();
 fireEvent.click(within(trash).getByRole('button',{name:'彻底删除'}));
 confirm=await screen.findByRole('dialog',{name:'确认彻底删除'});
 fireEvent.click(within(confirm).getByRole('button',{name:'彻底删除'}));
 await waitFor(()=>expect(post).toHaveBeenCalledWith('/personal-files/purge',{files:[{id:'deleted-file',version:4}]}));
 await waitFor(()=>expect(within(trash).queryByText(file.name)).not.toBeInTheDocument());
});
test('a pending disk cleanup is retryable and cannot be restored',async()=>{
 vi.mocked(get).mockImplementation(async(url)=>url==='/personal-files/trash'?{items:[{...file,purging:true}]}:{items:[],path:[],canUpload:false});
 render(<PersonalFiles scope="mine"/>);fireEvent.click(screen.getByRole('button',{name:'回收站'}));
 const trash=await screen.findByRole('dialog',{name:'我的文件回收站'});
 expect(within(trash).getByRole('button',{name:/恢\s*复/})).toBeDisabled();
 expect(within(trash).getByRole('button',{name:'重试彻底删除'})).toBeEnabled();
});

test('bulk selection submits only checked files after confirmation',async()=>{
 trashItems=[file,{...file,id:'second',name:'第二份.txt'},{...file,id:'third',name:'保留.txt'}];
 render(<PersonalFiles scope="mine"/>);fireEvent.click(screen.getByRole('button',{name:'回收站'}));
 const trash=await screen.findByRole('dialog',{name:'我的文件回收站'});
 const boxes=within(trash).getAllByRole('checkbox');fireEvent.click(boxes[1]);fireEvent.click(boxes[2]);
 fireEvent.click(within(trash).getByRole('button',{name:'彻底删除所选（2）'}));
 const confirm=await screen.findByRole('dialog',{name:'确认彻底删除'});expect(post).not.toHaveBeenCalled();
 fireEvent.click(within(confirm).getByRole('button',{name:'彻底删除'}));
 await waitFor(()=>expect(post).toHaveBeenCalledWith('/personal-files/purge',{files:[{id:file.id,version:4},{id:'second',version:4}]}));
 await waitFor(()=>expect(within(trash).getByText('保留.txt')).toBeInTheDocument());
});
test('empty trash confirms the complete refreshed list across table pages',async()=>{
 trashItems=Array.from({length:11},(_,i)=>({...file,id:'file-'+i,name:'文件'+i+'.txt'}));
 const expected=trashItems.map(({id,version})=>({id,version}));
 render(<PersonalFiles scope="mine"/>);fireEvent.click(screen.getByRole('button',{name:'回收站'}));
 const trash=await screen.findByRole('dialog',{name:'我的文件回收站'});
 fireEvent.click(within(trash).getByRole('button',{name:'清空回收站'}));
 const confirm=await screen.findByRole('dialog',{name:'确认清空回收站'});
 expect(within(confirm).getByText(/共 11 个/)).toBeInTheDocument();expect(post).not.toHaveBeenCalled();
 fireEvent.click(within(confirm).getByRole('button',{name:'确认清空回收站'}));
 await waitFor(()=>expect(post).toHaveBeenCalledWith('/personal-files/purge',{files:expected}));
 await waitFor(()=>expect(within(trash).getByRole('button',{name:'清空回收站'})).toBeDisabled());
});

test('network loss preserves checked files and a later permission denial removes them',async()=>{
  const data={items:[{id:'mine',name:'选中文件.txt',kind:'FILE',level:3,size:55}],path:[],canUpload:true};
  vi.mocked(get).mockResolvedValue(data);
  render(<PersonalFiles scope="mine"/>);
  await screen.findByText('选中文件.txt');
  fireEvent.click(screen.getAllByRole('checkbox')[1]);
  vi.mocked(get).mockRejectedValue({isAxiosError:true,code:'ERR_NETWORK'});
  fireEvent.click(screen.getByRole('button',{name:'刷新文件'}));
  await screen.findByText('清理失败');
  expect(screen.getAllByRole('checkbox')[1]).toBeChecked();
  vi.mocked(get).mockRejectedValue({isAxiosError:true,response:{status:403}});
  fireEvent.click(screen.getByRole('button',{name:'刷新文件'}));
  await waitFor(()=>expect(screen.queryByText('选中文件.txt')).toBeNull());
});


test('owned folders can be selected and deleted after confirmation; readers remain disabled',async()=>{
 const folder={id:'folder',name:'我的目录',kind:'FOLDER',level:3,version:2,size:55};
 vi.mocked(get).mockResolvedValue({items:[folder,{...folder,id:'shared',name:'只读目录',level:1}],path:[],canUpload:true});
 render(<PersonalFiles scope="mine"/>);
 const row=await screen.findByRole('row',{name:/我的目录/});
 expect(within(row).getByRole('checkbox')).toBeEnabled();
 expect(within(screen.getByRole('row',{name:/只读目录/})).getByRole('checkbox')).toBeDisabled();
 fireEvent.click(within(row).getByRole('checkbox'));
 fireEvent.click(screen.getByRole('button',{name:'刷新文件'}));
 await waitFor(()=>expect(within(row).getByRole('checkbox')).toBeChecked());
 fireEvent.click(screen.getByRole('button',{name:'删除所选（1）'}));
 const confirm=await screen.findByRole('dialog',{name:'确认删除文件或文件夹'});
 expect(post).not.toHaveBeenCalled();
 fireEvent.click(within(confirm).getByRole('button',{name:'移入回收站'}));
 await waitFor(()=>expect(post).toHaveBeenCalledWith('/personal-files/delete',{files:[{id:'folder',version:2}]}));
});
