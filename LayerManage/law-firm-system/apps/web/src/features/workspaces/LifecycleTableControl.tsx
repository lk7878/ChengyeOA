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
  if (!detail || detail.table.source !== 'CUSTOM' || detail.table.inventoryKind) return null;
  if (detail.table.lifecycleKind && (detail.access.level < 3 || detail.table.lifecycleKind === 'CASE_REFUNDS'))
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
          ...(!detail.table.lifecycleKind ? [{ key: 'AFTER_SALES', label: '配置为案件售后表' }] : []),
          { key: 'CASE_REFUNDS', label: '配置为售后退费表' },
        ],
        onClick: ({ key }) =>
          Modal.confirm({
            title: '配置业务关联',
            content: '仅支持空表（回收站也不能有记录）。将配置关联选择、只读同步字段和本阶段业务字段；已有列保留。退费必须选择本工作区内有权查看、状态为“协商未果 / 需退款”的售后记录，以售后记录ID关联并回填案件和合同信息。',
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
      <Button size="small">{detail.table.lifecycleKind ? '案件 → 售后 · 调整关联' : '配置案件关联'}</Button>
    </Dropdown>
  );
}
