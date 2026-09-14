import { useEffect, useState } from 'react';
import { Alert, Button, Checkbox, Modal, Select, Space, Spin, Typography } from 'antd';
import { errorMessage, get, post } from './api';
import type { Directory, Field, Member } from './types';

type Grant = Omit<Member, 'id' | 'version'>;
interface Snapshot {
  version: number;
  policy: { restricted: boolean; grants: Grant[] };
  members: Member[];
}
export function ResourceAccess({
  baseId,
  tableId,
  directory,
  fields,
  onSaved,
}: {
  baseId: string;
  tableId?: string;
  directory: Directory;
  fields: Field[];
  onSaved: () => void;
}) {
  const [target, setTarget] = useState<string>();
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!target) return;
    let alive = true;
    get<Snapshot>(target)
      .then((value) => {
        if (alive) setSnapshot(value);
      })
      .catch((e) => {
        if (alive) setError(errorMessage(e));
      });
    return () => {
      alive = false;
    };
  }, [target]);
  const open = (url: string) => {
    setSnapshot(undefined);
    setError('');
    setTarget(url);
  };
  const name = (m: Member) =>
    (m.principalType === 'USER'
      ? directory.users
      : m.principalType === 'ORG'
        ? directory.organizations
        : directory.teams
    ).find((o) => o.id === m.principalId)?.name || m.principalId;
  const update = (member: Member, patch?: Partial<Grant>) => {
    if (!snapshot) return;
    const matches = (g: Grant) =>
      g.principalType === member.principalType && g.principalId === member.principalId;
    const existing = snapshot.policy.grants.find(matches);
    const grants = snapshot.policy.grants.filter((g) => !matches(g));
    if (patch)
      grants.push({
        principalType: member.principalType,
        principalId: member.principalId,
        role: 'READER',
        rowScope: 'ALL',
        canCreate: false,
        hiddenFields: [],
        readonlyFields: [],
        ...existing,
        ...patch,
      });
    setSnapshot({ ...snapshot, policy: { ...snapshot.policy, grants } });
  };
  return (
    <>
      <Button onClick={() => open('/bases/' + baseId + '/access')}>应用权限</Button>
      {tableId && <Button onClick={() => open('/tables/' + tableId + '/access')}>表权限</Button>}
      <Modal
        title={target?.startsWith('/tables/') ? '数据表权限' : '应用权限'}
        open={!!target}
        width={720}
        okText="保存权限"
        cancelText="取消"
        confirmLoading={saving}
        onCancel={() => setTarget(undefined)}
        okButtonProps={{ disabled: !snapshot }}
        onOk={async () => {
          if (!target || !snapshot) return;
          setSaving(true);
          setError('');
          try {
            await post(target, { version: snapshot.version, policy: snapshot.policy });
            setTarget(undefined);
            onSaved();
          } catch (e) {
            setError(errorMessage(e));
          } finally {
            setSaving(false);
          }
        }}
      >
        <Alert
          type="info"
          showIcon
          title="权限与上级取交集；禁止访问优先。工作区负责人保留管理权限。"
          description="名单仅包含工作区已有成员。启用独立名单后，未列入者无法访问；不能在这里扩大上级或 CRM 业务权限。"
        />
        {error && <Alert type="error" title={error} />}
        {!snapshot ? (
          !error && <Spin />
        ) : (
          <>
            <Checkbox
              style={{ margin: '16px 0' }}
              checked={snapshot.policy.restricted}
              onChange={(e) =>
                setSnapshot({ ...snapshot, policy: { ...snapshot.policy, restricted: e.target.checked } })
              }
            >
              启用独立授权名单
            </Checkbox>
            {snapshot.members
              .filter((m) => m.role !== 'OWNER')
              .map((member) => {
                const g = snapshot.policy.grants.find(
                  (g) => g.principalType === member.principalType && g.principalId === member.principalId,
                );
                return (
                  <div key={member.id} style={{ borderTop: '1px solid #eee', padding: '12px 0' }}>
                    <Space wrap>
                      <Typography.Text>{name(member)}</Typography.Text>
                      <Select
                        aria-label={name(member) + '权限'}
                        style={{ width: 150 }}
                        value={g?.role ?? 'INHERIT'}
                        onChange={(role) => update(member, role === 'INHERIT' ? undefined : { role })}
                        options={[
                          { value: 'INHERIT', label: snapshot.policy.restricted ? '未授权' : '继承上级' },
                          { value: 'DENY', label: '禁止访问' },
                          { value: 'READER', label: '阅读' },
                          { value: 'EDITOR', label: '编辑' },
                          { value: 'MANAGER', label: '管理' },
                        ]}
                      />
                      {g && g.role !== 'DENY' && (
                        <>
                          <Checkbox
                            checked={g.rowScope === 'SELF'}
                            onChange={(e) => update(member, { rowScope: e.target.checked ? 'SELF' : 'ALL' })}
                          >
                            仅本人记录
                          </Checkbox>
                          <Checkbox
                            checked={g.canCreate}
                            onChange={(e) => update(member, { canCreate: e.target.checked })}
                          >
                            允许建表
                          </Checkbox>
                        </>
                      )}
                    </Space>
                    {g && g.role !== 'DENY' && target?.startsWith('/tables/') && (
                      <Space wrap style={{ marginTop: 8 }}>
                        <Select
                          aria-label={name(member) + '隐藏字段'}
                          mode="multiple"
                          placeholder="隐藏字段"
                          style={{ minWidth: 230 }}
                          value={g.hiddenFields}
                          options={fields.map((f) => ({ value: f.id, label: f.name }))}
                          onChange={(hiddenFields) => update(member, { hiddenFields })}
                        />
                        <Select
                          aria-label={name(member) + '只读字段'}
                          mode="multiple"
                          placeholder="只读字段"
                          style={{ minWidth: 230 }}
                          value={g.readonlyFields}
                          options={fields.map((f) => ({ value: f.id, label: f.name }))}
                          onChange={(readonlyFields) => update(member, { readonlyFields })}
                        />
                      </Space>
                    )}
                  </div>
                );
              })}
          </>
        )}
      </Modal>
    </>
  );
}
