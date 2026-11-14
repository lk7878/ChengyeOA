import { Alert } from 'antd';
import { Link } from 'react-router';
import { entries, canOpen } from '@/features/navigation/catalog';
import { useAuthStore } from '@/stores/authStore';

export default function RetiredArchives() {
  const authorization = useAuthStore(s=>s.authorization);
  return <div className="unified-area-page"><h1>停用模块历史归档</h1>
    <Alert type="info" title="质量管理和SOP已停用。历史记录按原权限查阅，进行中的停用流程已解除待办和结案限制。"/>
    <div className="unified-app-grid">{entries.filter(e=>e.retired && !e.hidden && canOpen(e,authorization)).map(e=>
      <Link key={e.path} className="unified-app-card" to={e.path}>{e.title}历史记录</Link>)}</div>
  </div>;
}
