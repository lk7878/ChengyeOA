import Modal from '@/components/DraggableModal';
import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Checkbox, Form, Select, Space } from 'antd';
import { errorMessage, get, post } from '../workspaces/api';
import type { Directory, Member } from '../workspaces/types';

export default function WorkspaceMembers({
  workspaceId,
  directory,
  level,
  onSaved,
}: {
  workspaceId: string;
  directory: Directory;
  level: number;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const key = useRef(crypto.randomUUID());
  const [form] = Form.useForm();
  const type = Form.useWatch('principalType', form) || 'USER';
  const principalId = Form.useWatch('principalId', form);
  const candidates =
    type === 'USER'
      ? directory.users
      : type === 'ORG'
        ? directory.organizations
        : type === 'POSITION'
          ? directory.positions || []
          : directory.teams;
  const name = (member: Member) =>
    (member.principalType === 'USER'
      ? directory.users
      : member.principalType === 'ORG'
        ? directory.organizations
        : member.principalType === 'POSITION'
          ? directory.positions || []
          : directory.teams
    ).find((v) => v.id === member.principalId)?.name || member.principalId;
  useEffect(() => {
    if (!open) return;
    let active = true;
    void get<Member[]>('/workspaces/' + workspaceId + '/members')
      .then((value) => {
        if (active) {
          setMembers(value);
          setReady(true);
        }
      })
      .catch((e) => {
        if (active) setError(errorMessage(e));
      });
    return () => {
      active = false;
    };
  }, [open, workspaceId]);
  useEffect(() => {
    const previous = members.find((m) => m.principalType === type && m.principalId === principalId);
    form.setFieldsValue(
      previous || { role: 'EDITOR', rowScope: 'SELF', canCreate: false, canManageAccess: false },
    );
    key.current = crypto.randomUUID();
  }, [members, type, principalId, form]);
  const save = async (remove = false) => {
    try {
      const values = await form.validateFields();
      const previous = members.find(
        (m) => m.principalType === values.principalType && m.principalId === values.principalId,
      );
      setBusy(true);
      setError('');
      await post(
        '/workspaces/' + workspaceId + '/members',
        {
          principalType: values.principalType,
          principalId: values.principalId,
          role: values.role,
          rowScope: values.rowScope,
          canCreate: values.canCreate,
          canManageAccess: values.canManageAccess,
          version: previous?.version,
          hiddenFields: previous?.hiddenFields || [],
          readonlyFields: previous?.readonlyFields || [],
          remove,
        },
        key.current,
      );
      setOpen(false);
      onSaved();
    } catch (e) {
      if (!(e as { errorFields?: unknown }).errorFields) setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button
        onClick={() => {
          setReady(false);
          setError('');
          setMembers([]);
          form.resetFields();
          key.current = crypto.randomUUID();
          setOpen(true);
        }}
      >
        工作区成员
      </Button>
      <Modal
        title="工作区成员与岗位权限"
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => void save()}
        okText="保存成员"
        cancelText="取消"
        confirmLoading={busy}
        okButtonProps={{ disabled: !ready }}
      >
        <Alert
          type="info"
          title="成员默认仅看本人录入；岗位负责人可查看授权范围内全部记录。文件夹、应用和表会进一步限制权限。"
        />
        {error && <Alert type="error" title={error} />}
        <Form
          form={form}
          layout="vertical"
          initialValues={{
            principalType: 'USER',
            role: 'EDITOR',
            rowScope: 'SELF',
            canCreate: false,
            canManageAccess: false,
          }}
          onValuesChange={(changed) => {
            key.current = crypto.randomUUID();
            if ('principalType' in changed) form.setFieldValue('principalId', undefined);
            if ('role' in changed)
              form.setFieldValue('rowScope', changed.role === 'MANAGER' ? 'ALL' : 'SELF');
          }}
        >
          <Form.Item name="principalType" label="成员类型">
            <Select
              options={[
                { value: 'USER', label: '成员' },
                { value: 'ORG', label: '部门' },
                { value: 'TEAM', label: '团队' },
                { value: 'POSITION', label: '岗位（跟随有效任职）' },
              ]}
            />
          </Form.Item>
          <Form.Item name="principalId" label="授权对象" rules={[{ required: true }]}>
            <Select
              showSearch
              optionFilterProp="label"
              options={candidates
                .filter((v) => !members.some((m) => m.principalId === v.id && m.role === 'OWNER'))
                .map((v) => ({ value: v.id, label: v.name }))}
            />
          </Form.Item>
          <Form.Item name="role" label="角色">
            <Select
              options={[
                { value: 'READER', label: '阅读' },
                { value: 'EDITOR', label: '编辑' },
                { value: 'MANAGER', label: '管理' },
              ]}
            />
          </Form.Item>
          <Form.Item name="rowScope" label="记录范围">
            <Select
              options={[
                { value: 'SELF', label: '仅本人录入' },
                { value: 'ALL', label: '授权范围全部记录' },
              ]}
            />
          </Form.Item>
          <Form.Item name="canCreate" valuePropName="checked">
            <Checkbox>允许创建数据表</Checkbox>
          </Form.Item>
          <Form.Item name="canManageAccess" valuePropName="checked">
            <Checkbox disabled={level < 4}>允许管理授权（管理角色、全部记录且无字段限制）</Checkbox>
          </Form.Item>
        </Form>
        <Space wrap>
          {members.map((m) => (
            <Button key={m.id} disabled={m.role === 'OWNER'} onClick={() => form.setFieldsValue(m)}>
              {name(m)} · {m.role}
            </Button>
          ))}
        </Space>
        {members.some(
          (m) => m.principalType === type && m.principalId === principalId && m.role !== 'OWNER',
        ) && (
          <Button danger disabled={busy || !ready} onClick={() => void save(true)}>
            移除当前授权
          </Button>
        )}
      </Modal>
    </>
  );
}
