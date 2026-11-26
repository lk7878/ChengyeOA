import { Button } from 'antd';
import type { Field, RecordRow } from './types';

/** Keep the workflow control discoverable even when the view hides the status column. */
export default function AfterSalesStatusAction({
  fields,
  row,
  disabled,
  onEdit,
}: {
  fields: Field[];
  row: RecordRow;
  disabled?: boolean;
  onEdit(field: Field): void;
}) {
  const status = fields.find((f) => f.options.lifecycleKey === 'status');
  if (!status) return null;
  const value = row.values[status.id];
  const label = status.options.choices?.find((c) => c.id === value)?.name || String(value || '未设置');
  return (
    <Button
      size="small"
      disabled={
        disabled || !status.writable || row.writable === false || row.readonlyFields?.includes(status.id)
      }
      title="将协商状态改为“协商未果 / 需退款”并保存后，系统自动生成退费待办。"
      onClick={() => onEdit(status)}
    >
      协商状态：{label}
    </Button>
  );
}
