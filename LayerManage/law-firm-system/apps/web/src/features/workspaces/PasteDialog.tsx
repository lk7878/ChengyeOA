import Modal from '@/components/DraggableModal';
import { useState } from 'react';
import { Alert, Button, Input, Space, Table } from 'antd';
import { errorMessage, post } from './api';
import { preparePaste, type PasteSnapshot } from './clipboard';
import { displayValue } from './display-value';

export default function PasteDialog({
  snapshot,
  initialText,
  onClose,
  onSaved,
}: {
  snapshot: PasteSnapshot;
  initialText: string;
  onClose(): void;
  onSaved(): void;
}) {
  const [source, setSource] = useState(initialText);
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [attempted, setAttempted] = useState(false);
  let records: ReturnType<typeof preparePaste> = [],
    invalid = '';
  try {
    records = preparePaste(source, snapshot);
  } catch (e) {
    invalid = (e as Error).message;
  }
  const save = async () => {
    setBusy(true);
    setAttempted(true);
    setError('');
    try {
      await post(
        '/tables/' + snapshot.tableId + '/records/batch',
        { schemaVersion: snapshot.schemaVersion, records },
        key,
      );
      onSaved();
    } catch (e) {
      const details = (e as { response?: { data?: { errors?: { row?: number; fieldId?: string } } } })
        .response?.data?.errors;
      const field = snapshot.fields.find((f) => f.id === details?.fieldId);
      setError(
        (details?.row ? `第 ${details.row} 行${field ? ' / ' + field.name : ''}：` : '') + errorMessage(e),
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="批量粘贴"
      open
      width={760}
      mask={{ closable: false }}
      keyboard={!busy}
      closable={!busy}
      onCancel={onClose}
      footer={
        <Space>
          <Button disabled={busy} onClick={onClose}>
            关闭
          </Button>
          <Button type="primary" loading={busy} disabled={!!invalid} onClick={() => void save()}>
            提交 {records.length} 行
          </Button>
        </Space>
      }
    >
      <p>从选中单元格开始，按当前展开的记录与列顺序粘贴。目标和版本已固定；任一行失败，整批不会写入。</p>
      <Input.TextArea
        aria-label="粘贴表格内容"
        value={source}
        rows={5}
        disabled={busy}
        readOnly={attempted}
        placeholder="在此粘贴 Excel 或飞书复制的单元格"
        onChange={(e) => {
          setSource(e.target.value);
          setKey(crypto.randomUUID());
          setError('');
        }}
      />
      {invalid && <Alert type="warning" title={invalid} />}
      {error && (
        <Alert
          type="error"
          title={error}
          description="草稿已保留。网络重试会使用同一提交标识；版本或字段变化时，请复制内容，关闭窗口后重新选择范围并核对。"
        />
      )}
      {!!records.length && (
        <>
          <p>
            {records.length} 行 · {Object.keys(records[0].values).length} 列 · 新增{' '}
            {records.filter((r) => !r.id).length} 行（预览前 20 行）
          </p>
          <Table
            size="small"
            rowKey="index"
            pagination={false}
            scroll={{ x: 600, y: 250 }}
            dataSource={records.slice(0, 20).map((r, index) => ({ ...r, index }))}
            columns={[
              {
                title: '目标',
                width: 90,
                render: (_, row) => `${row.index + 1}${row.id ? '（已有）' : '（新增）'}`,
              },
              ...snapshot.fields
                .filter((f) => Object.hasOwn(records[0].values, f.id))
                .map((f) => ({
                  title: f.name,
                  width: 160,
                  render: (_: unknown, row: (typeof records)[number]) =>
                    displayValue(f, row.values[f.id], snapshot.directory),
                })),
            ]}
          />
        </>
      )}
    </Modal>
  );
}
