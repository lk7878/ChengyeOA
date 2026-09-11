import { Input, Tabs } from 'antd';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { useAuthStore } from '@/stores/authStore';
import PaymentListPage from '../payments/PaymentListPage';
import InvoiceListPage from '../invoices/InvoiceListPage';
import RefundListPage from '../refunds/RefundListPage';

export default function FinanceWorkspace() {
  const [params, setParams] = useSearchParams();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const hasPermission = useAuthStore(s => s.hasPermission);
  const caseNo = params.get('caseNo') || undefined;
  const items = [
    ...(hasPermission('menu.payment') ? [{ key: '/payments', label: '收款管理', children: <PaymentListPage caseNo={caseNo} /> }] : []),
    ...(hasPermission('menu.invoice') ? [{ key: '/invoices', label: '开票管理', children: <InvoiceListPage caseNo={caseNo} /> }] : []),
    ...(hasPermission('menu.refund') ? [{ key: '/refunds', label: '退款减免', children: <RefundListPage caseNo={caseNo} /> }] : []),
  ];
  return <div><h2>财务管理</h2><p>按案件编号关联收款、开票和退款减免。未立案合同显示“待关联案件”，立案后自动关联。</p>
    <Input.Search key={caseNo || ''} aria-label="案件编号查询" placeholder="输入完整案件编号查询" defaultValue={caseNo} allowClear enterButton="按案件查询" style={{ maxWidth: 500, marginBottom: 16 }} onSearch={value => setParams(value.trim() ? { caseNo: value.trim() } : {})} />
    <Tabs activeKey={items.some(i => i.key === pathname) ? pathname : items[0]?.key} destroyOnHidden onChange={path => navigate(path + (caseNo ? '?caseNo=' + encodeURIComponent(caseNo) : ''))} items={items} />
  </div>;
}
