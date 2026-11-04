import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, test, vi } from 'vitest';
import CalendarPage from './index';
import { get, post } from '@/features/workspaces/api';
vi.mock('@/features/workspaces/api',()=>({get:vi.fn(),post:vi.fn(),patch:vi.fn(),errorMessage:()=> '日程保存失败',errorStatus:()=>422}));
afterEach(()=>{cleanup();vi.clearAllMocks();});
const setup=()=>{
  vi.mocked(get).mockImplementation(async(url)=>url.startsWith('/calendar/people')?[]:{rows:[],truncated:false});
  render(<MemoryRouter><CalendarPage/></MemoryRouter>);
};
test('day and week views offer creation without relying on month/year-only calendar',async()=>{
  setup();
  fireEvent.click(screen.getByText('周',{exact:true}));
  await waitFor(()=>expect(screen.getAllByRole('button',{name:'添加当日事项'})).toHaveLength(7));
  fireEvent.click(screen.getByText('日',{exact:true}));
  expect(screen.getAllByRole('button',{name:'添加当日事项'})).toHaveLength(1);
});
test('invalid dates prevent saving and API failures keep the form draft',async()=>{
  setup();vi.mocked(post).mockRejectedValue(new Error('offline'));
  fireEvent.click(screen.getByRole('button',{name:'新建日程'}));
  fireEvent.change(screen.getByLabelText('日程标题'),{target:{value:'庭审准备'}});
  fireEvent.change(screen.getByLabelText('开始时间'),{target:{value:'2030-01-02T10:00'}});
  fireEvent.change(screen.getByLabelText('结束时间'),{target:{value:'2030-01-02T09:00'}});
  fireEvent.click(screen.getByRole('button',{name:'保存日程'}));
  await screen.findByText('请填写标题和有效时间，结束时间必须晚于开始时间。');
  expect(post).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('结束时间'),{target:{value:'2030-01-02T11:00'}});
  fireEvent.click(screen.getByRole('button',{name:'保存日程'}));
  await screen.findByText('日程保存失败');
  expect(screen.getByLabelText('日程标题')).toHaveValue('庭审准备');
  expect(post).toHaveBeenCalledWith('/calendar/events',expect.objectContaining({title:'庭审准备',visibility:'PRIVATE',reminders:[1440,60]}),expect.any(String));
});
