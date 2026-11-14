import { Button, Card, Checkbox, Input, InputNumber, Select, Space } from 'antd';
import { newNode, type SopContent, type SopNode } from './api';
export default function NodeEditor({
  value,
  onChange,
  roles,
  readOnly = false,
}: {
  value: SopContent;
  onChange: (value: SopContent) => void;
  roles: { id: string; name: string }[];
  readOnly?: boolean;
}) {
  const change = (index: number, patch: Partial<SopNode>) =>
    onChange({ ...value, nodes: value.nodes.map((node, i) => (i === index ? { ...node, ...patch } : node)) });
  const move = (index: number, offset: number) => {
    const nodes = [...value.nodes];
    [nodes[index], nodes[index + offset]] = [nodes[index + offset], nodes[index]];
    onChange({ ...value, nodes });
  };
  return (
    <Space orientation="vertical" style={{ width: '100%' }}>
      {value.nodes.map((node, index) => (
        <Card
          key={index}
          size="small"
          title={`${index + 1}. ${node.name}`}
          extra={
            !readOnly && (
              <Space>
                <Button disabled={index === 0} onClick={() => move(index, -1)}>
                  上移
                </Button>
                <Button disabled={index === value.nodes.length - 1} onClick={() => move(index, 1)}>
                  下移
                </Button>
                <Button
                  danger
                  onClick={() => onChange({ ...value, nodes: value.nodes.filter((_, i) => i !== index) })}
                >
                  删除节点
                </Button>
              </Space>
            )
          }
        >
          <Space wrap style={{ width: '100%' }}>
            <Input
              aria-label={`节点${index + 1}编码`}
              value={node.code}
              disabled={readOnly}
              onChange={(e) => change(index, { code: e.target.value })}
            />
            <Input
              aria-label={`节点${index + 1}名称`}
              value={node.name}
              disabled={readOnly}
              onChange={(e) => change(index, { name: e.target.value })}
            />
          </Space>
          <Input.TextArea
            aria-label={`节点${index + 1}说明`}
            placeholder="节点说明"
            value={node.instruction}
            disabled={readOnly}
            onChange={(e) => change(index, { instruction: e.target.value })}
          />
          <Space wrap>
            <Select
              mode="multiple"
              aria-label={`节点${index + 1}前置节点`}
              placeholder="前置节点（不选可并行）"
              style={{ minWidth: 220, maxWidth: '100%' }}
              value={node.dependsOn}
              disabled={readOnly}
              options={value.nodes
                .filter((n) => n.code !== node.code)
                .map((n) => ({ value: n.code, label: n.name }))}
              onChange={(dependsOn) => change(index, { dependsOn })}
            />
            <Checkbox
              disabled={readOnly}
              checked={node.reviewRequired}
              onChange={(e) => change(index, { reviewRequired: e.target.checked })}
            >
              完成需审核
            </Checkbox>
            <Checkbox
              disabled={readOnly}
              checked={node.closeGate}
              onChange={(e) => change(index, { closeGate: e.target.checked })}
            >
              结案前需完成
            </Checkbox>
          </Space>
          <Space wrap>
            <Select
              aria-label={`节点${index + 1}审核岗位角色`}
              placeholder="审核业务角色（可留空待分派）"
              allowClear
              style={{ minWidth: 240 }}
              disabled={readOnly}
              value={node.reviewerRoleId ?? undefined}
              options={roles.map((role) => ({ value: role.id, label: role.name }))}
              onChange={(id) => change(index, { reviewerRoleId: id ?? null })}
            />
            <label>
              提醒天数（自然日）{' '}
              <InputNumber
                aria-label={`节点${index + 1}提醒天数`}
                min={1}
                max={365}
                value={node.reminderDays}
                disabled={readOnly}
                onChange={(days) => change(index, { reminderDays: days })}
              />
            </label>
          </Space>
          {node.materials.map((material, m) => (
            <Space key={m} wrap>
              <Input
                aria-label={`节点${index + 1}材料${m + 1}编码`}
                value={material.code}
                disabled={readOnly}
                onChange={(e) =>
                  change(index, {
                    materials: node.materials.map((v, j) => (j === m ? { ...v, code: e.target.value } : v)),
                  })
                }
              />
              <Input
                aria-label={`节点${index + 1}材料${m + 1}名称`}
                value={material.name}
                disabled={readOnly}
                onChange={(e) =>
                  change(index, {
                    materials: node.materials.map((v, j) => (j === m ? { ...v, name: e.target.value } : v)),
                  })
                }
              />
              <Input
                aria-label={`节点${index + 1}材料${m + 1}说明`}
                placeholder="材料要求与模板说明"
                value={material.instruction}
                disabled={readOnly}
                onChange={(e) =>
                  change(index, {
                    materials: node.materials.map((v, j) =>
                      j === m ? { ...v, instruction: e.target.value } : v,
                    ),
                  })
                }
              />
              <Checkbox
                checked={material.required}
                disabled={readOnly}
                onChange={(e) =>
                  change(index, {
                    materials: node.materials.map((v, j) =>
                      j === m ? { ...v, required: e.target.checked } : v,
                    ),
                  })
                }
              >
                必需
              </Checkbox>
              {!readOnly && (
                <Button
                  onClick={() => change(index, { materials: node.materials.filter((_, j) => j !== m) })}
                >
                  移除材料
                </Button>
              )}
            </Space>
          ))}
          {!readOnly && (
            <Button
              disabled={node.materials.length >= 30}
              onClick={() =>
                change(index, {
                  materials: [
                    ...node.materials,
                    {
                      code: 'MAT_' + String(node.materials.length + 1).padStart(2, '0'),
                      name: '新材料',
                      instruction: '',
                      required: false,
                    },
                  ],
                })
              }
            >
              添加材料要求
            </Button>
          )}
        </Card>
      ))}
      {!readOnly && (
        <Button
          disabled={value.nodes.length >= 50}
          onClick={() => onChange({ ...value, nodes: [...value.nodes, newNode(value.nodes.length + 1)] })}
        >
          添加节点
        </Button>
      )}
    </Space>
  );
}
