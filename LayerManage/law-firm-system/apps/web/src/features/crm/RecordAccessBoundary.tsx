import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Alert, Button } from 'antd';
import { useParams } from 'react-router';
import { useAuthStore } from '@/stores/authStore';
import { leadApi } from '@/api/lead';
import { customerApi } from '@/api/customer';
import { contractApi } from '@/api/contract';
import { negotiationApi } from '@/api/negotiation';
const readers = {
  lead: leadApi.detail,
  customer: customerApi.detail,
  contract: contractApi.detail,
  negotiation: negotiationApi.detail,
};
type Props = { kind: keyof typeof readers; children: ReactNode };
/** Rechecks row scope without replacing a form or advancing its captured version. */
export default function RecordAccessBoundary({ kind, children }: Props) {
  const { id } = useParams();
  const userId = useAuthStore((s) => s.userInfo?.id);
  return (
    <RecordAccess key={kind + ':' + id + ':' + userId} id={id} kind={kind}>
      {children}
    </RecordAccess>
  );
}
function RecordAccess({ kind, id, children }: Props & { id?: string }) {
  const [blocked, setBlocked] = useState(false),
    [checking, setChecking] = useState(false);
  const alive = useRef(true),
    pending = useRef(false);
  const validate = useCallback(
    async (retry = false) => {
      if (!id || pending.current) return;
      pending.current = true;
      if (retry) setChecking(true);
      try {
        await readers[kind](id);
        if (alive.current && retry) setBlocked(false);
      } catch {
        if (alive.current) setBlocked(true);
      } finally {
        pending.current = false;
        if (alive.current && retry) setChecking(false);
      }
    },
    [kind, id],
  );
  useEffect(() => {
    alive.current = true;
    const focus = () => void validate();
    const timer = window.setInterval(focus, 5000);
    window.addEventListener('focus', focus);
    return () => {
      alive.current = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', focus);
    };
  }, [validate]);
  return blocked ? (
    <div className="unified-area-page">
      <Alert
        type="error"
        title="当前记录已不可用"
        description="读取失败或记录权限已变更，请重新加载后继续。"
        action={
          <Button loading={checking} onClick={() => void validate(true)}>
            重新加载记录
          </Button>
        }
      />
    </div>
  ) : (
    children
  );
}
