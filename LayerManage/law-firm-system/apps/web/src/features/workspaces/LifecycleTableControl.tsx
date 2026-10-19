import { Button, Dropdown, Tag, message } from 'antd';
import Modal from '@/components/DraggableModal';
import { post, errorMessage } from './api';
import type { TableDetail } from './types';
export default function LifecycleTableControl({
  detail,
  onChanged,
}: {
  detail?: TableDetail;
  onChanged(): void;
}) {
  if (!detail || detail.table.source !== 'CUSTOM') return null;
  if (detail.table.lifecycleKind)
    return (
      <Tag color="blue">
        {detail.table.lifecycleKind === 'AFTER_SALES' ? '案件 → 售后' : '售后 → 退费'} · 基础信息实时同步
      </Tag>
    );
  if (detail.access.level < 3) return null;
  return (
    <Dropdown
      menu={{
        items: [
          { key: 'AFTER_SALES', label: '配置为案件售后表' },
          { key: 'CASE_REFUNDS', label: '配置为售后退费表' },
        ],
        onClick: ({ key }) =>
          Modal.confirm({
            title: '配置业务关联',
            content: '仅支持尚未录入记录的表。将新增关联选择、只读同步字段和本阶段业务字段；已有列保留。',
            onOk: async () => {
              try {
                await post('/tables/' + detail.table.id + '/lifecycle', {
                  kind: key,
                  schemaVersion: detail.table.schemaVersion,
                });
                onChanged();
              } catch (error) {
                message.error(errorMessage(error));
                throw error;
              }
            },
          }),
      }}
    >
      <Button size="small">配置案件关联</Button>
    </Dropdown>
  );
}
