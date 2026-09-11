import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import ChineseConfig from '@/components/ChineseConfig';
import Table from '@/components/ResizableTable';
import PositionTable from '@/features/master-data/components/PositionTable';
import '@/features/master-data/master-data.css';

export function Harness() {
  const [selected, setSelected] = useState(0);
  const [changes, setChanges] = useState(0);
  return <ChineseConfig><main style={{ padding: 24, fontFamily: 'sans-serif', maxWidth: 1100 }}>
    <h1>岗位管理</h1><p>拖动表头右侧调整列宽，双击恢复；刷新后保留调整结果。</p>
    <PositionTable loading={false} data={[{ id: '1', code: 'DEPART001', name: '主任', categoryCode: 'DEPT_001', organizationId: 'org', level: 1, status: 'ENABLED', version: 1, activeAssignmentCount: 0 }]} onEdit={() => {}} onToggle={() => {}} onRetry={() => {}} />
    <h2>固定列、分页和选择兼容性</h2><p>已选 {selected} 项；表格变化 {changes} 次</p>
    <div style={{ width: 600 }}><Table columnWidthsKey="browser-compatibility" rowKey="id" rowSelection={{ onChange: keys => setSelected(keys.length) }} onChange={() => setChanges(value => value + 1)} pagination={{ pageSize: 1 }}
      columns={[{ title: '名称', dataIndex: 'name', width: 240, fixed: 'left', sorter: true }, { title: '职责', dataIndex: 'description', width: 500 }, { title: '操作', width: 120, fixed: 'right', render: () => <button>查看</button> }]}
      dataSource={[{ id: '1', name: '律师', description: '案件办理' }, { id: '2', name: '助理', description: '材料整理' }]} /></div>
  </main></ChineseConfig>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
