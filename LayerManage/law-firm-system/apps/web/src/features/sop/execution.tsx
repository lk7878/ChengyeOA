import { useEffect, useState } from 'react';
import { get } from '@/features/workspaces/api';
import { requestErrorMessage } from '@/api/errors';
import type { SopNode } from './api';
export const sopStates: Record<string, string> = {
  PENDING: '未开始',
  IN_PROGRESS: '办理中',
  IN_REVIEW: '审核中',
  CHANGES_REQUESTED: '待修订',
  COMPLETED: '已完成',
  SKIPPED: '已跳过',
  ACTIVE: '进行中',
  PAUSED: '已暂停',
  CANCELLED: '已取消',
};
export interface SopTask {
  id: string;
  name: string;
  status: string;
  version: number;
  dueDate: string | null;
  overdue: boolean;
  assigneeUserId: string | null;
  createdBy: string | null;
  instanceId: string;
  remark: string | null;
  completedAt: string | null;
  node: SopNode;
  instanceStatus: string;
  case: { id: string; caseNo: string; title: string } | null;
  permissions: string[];
}
export interface SopInstance {
  id: string;
  status: string;
  version: number;
  batchKey: string;
  templateName: string;
  templateNumber: number;
  case: { id: string; caseNo: string; title: string } | null;
  tasks: SopTask[];
  progress: { visible: number; completed: number };
}
export function useLiveSop<T>(url: string) {
  const [data, setData] = useState<T>(),
    [error, setError] = useState(''),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    let live = true,
      seq = 0;
    async function load() {
      const current = ++seq;
      try {
        const result = await get<T>(url);
        if (live && current === seq) {
          setData(result);
          setError('');
        }
      } catch (e) {
        if (live && current === seq) {
          const status = (e as { response?: { status?: number } })?.response?.status;
          if (status === 401 || status === 403 || status === 404) setData(undefined);
          setError(requestErrorMessage(e));
        }
      }
    }
    void load();
    const timer = window.setInterval(() => void load(), 5000),
      focus = () => void load();
    window.addEventListener('focus', focus);
    return () => {
      live = false;
      clearInterval(timer);
      window.removeEventListener('focus', focus);
    };
  }, [url, revision]);
  return { data, error, refresh: () => setRevision((n) => n + 1) };
}
