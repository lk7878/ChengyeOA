import { useEffect, useState } from 'react';
import { Alert, Button, List, Pagination, Space, message } from 'antd';
import Modal from '@/components/DraggableModal';
import { errorMessage, get, post } from './api';
import type { RecordRow } from './types';

interface Operation {
  id: string;
  recordId: string;
  kind: string;
  undone: boolean;
  createdAt: string;
}
export default function RecordOperations({
  tableId,
  schemaVersion,
  selected,
  canDelete,
  disabled,
  revision,
  onChanged,
}: {
  tableId: string;
  schemaVersion: number;
  selected: RecordRow[];
  canDelete: boolean;
  disabled: boolean;
  revision: number;
  onChanged(): void;
}) {
  const [operations, setOperations] = useState<Operation[]>([]);
  const [trash, setTrash] = useState(false);
  const [trashPage, setTrashPage] = useState(1);
  const [deleted, setDeleted] = useState<{ rows: Operation[]; total: number }>({ rows: [], total: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void get<Operation[]>('/tables/' + tableId + '/record-operations')
      .then((rows) => {
        if (active) {
          setOperations(Array.isArray(rows) ? rows : []);
          setError('');
        }
      })
      .catch((e) => {
        if (active) {
          setOperations([]);
          setError(errorMessage(e));
        }
      });
    return () => {
      active = false;
    };
  }, [tableId, revision]);
  useEffect(() => {
    if (!trash) return;
    let active = true;
    void get<{ rows: Operation[]; total: number }>(
      '/tables/' + tableId + '/record-operations?trash=true&page=' + trashPage,
    )
      .then((result) => {
        if (active) setDeleted(result);
      })
      .catch((e) => {
        if (active) setError(errorMessage(e));
      });
    return () => {
      active = false;
    };
  }, [tableId, revision, trash, trashPage]);
  const reverse = async (operation: Operation, direction: 'undo' | 'redo') => {
    setBusy(true);
    try {
      await post('/tables/' + tableId + '/record-operations/' + operation.id, { direction });
      message.success(
        direction === 'redo' ? '已重做' : operation.kind === 'DELETE' ? '已恢复记录' : '已撤销',
      );
      onChanged();
    } catch (e) {
      message.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const undo = operations.find((o) => !o.undone);
  const redo = [...operations].reverse().find((o) => o.undone);
  return (
    <>
      <Button disabled={disabled || busy || !undo} onClick={() => undo && void reverse(undo, 'undo')}>
        撤销
      </Button>
      <Button disabled={disabled || busy || !redo} onClick={() => redo && void reverse(redo, 'redo')}>
        重做
      </Button>
      {canDelete && (
        <Button
          danger
          disabled={disabled || busy || !selected.length}
          onClick={() => {
            const key = crypto.randomUUID();
            Modal.confirm({
              title: `删除选中的 ${selected.length} 条记录？`,
              content: '记录将移入回收站。若任一记录不允许删除，整批操作不会生效。',
              okText: '删除',
              cancelText: '取消',
              okButtonProps: { danger: true },
              onOk: async () => {
                setBusy(true);
                try {
                  await post(
                    '/tables/' + tableId + '/records/delete-batch',
                    {
                      schemaVersion,
                      records: selected.map((row) => ({ id: row.id, version: row.version })),
                    },
                    key,
                  );
                  onChanged();
                } catch (e) {
                  message.error(errorMessage(e));
                  throw e;
                } finally {
                  setBusy(false);
                }
              },
            });
          }}
        >
          批量删除{selected.length ? ` (${selected.length})` : ''}
        </Button>
      )}
      <Button disabled={disabled || busy} onClick={() => setTrash(true)}>
        记录回收站
      </Button>
      <Modal title="记录回收站" open={trash} footer={null} onCancel={() => setTrash(false)}>
        <Alert
          type="info"
          showIcon
          title="显示本人在此表的删除操作。恢复时会重新校验权限和版本；业务流程操作请在详情中办理。"
        />
        {error && <Alert type="error" title={error} />}
        <List
          dataSource={deleted.rows}
          locale={{ emptyText: '没有可恢复的记录' }}
          renderItem={(item) => (
            <List.Item>
              <Space direction="vertical">
                <span>记录 {item.recordId}</span>
                <span>{new Date(item.createdAt).toLocaleString()}</span>
              </Space>
              <Button
                loading={busy}
                onClick={() => void reverse(item, item.kind === 'CREATE' ? 'redo' : 'undo')}
              >
                恢复
              </Button>
            </List.Item>
          )}
        />
        <Pagination
          current={trashPage}
          pageSize={20}
          total={deleted.total}
          onChange={setTrashPage}
          showSizeChanger={false}
        />
      </Modal>
    </>
  );
}
