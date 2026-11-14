import { Alert, TreeSelect } from 'antd';
import { useEffect, useState } from 'react';
import { masterDataApi } from '../api';
import type { EmployeeListItem, OrganizationNode } from '../types';

export interface SelectedEmployee { id: string; employeeNo: string; name: string; version: number }

interface EmployeeTreeNode {
  value: string;
  title: string;
  isLeaf?: boolean;
  selectable?: boolean;
  disabled?: boolean;
  children?: EmployeeTreeNode[];
  employee?: SelectedEmployee;
}

export default function EmployeeTreeSelect({ value, onChange, disabled = false, placeholder = '按组织-部门-员工选择' }: {
  value?: string | null;
  onChange?: (employee: SelectedEmployee | null) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [treeData, setTreeData] = useState<EmployeeTreeNode[]>([]);
  const [employees, setEmployees] = useState<Map<string, SelectedEmployee>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    void (async () => {
      setLoading(true);
      setError('');
      try {
        const [orgs, staff] = await Promise.all([
          masterDataApi.organizations.tree(),
          loadAllEmployees(),
        ]);
        if (!alive) return;
        const map = new Map<string, SelectedEmployee>();
        const byOrg = new Map<string, EmployeeListItem[]>();
        for (const employee of staff) {
          const orgId = employee.primaryAssignment?.organizationId;
          if (!orgId) continue;
          map.set(employee.id, { id: employee.id, employeeNo: employee.employeeNo, name: employee.name, version: employee.version });
          const bucket = byOrg.get(orgId);
          if (bucket) bucket.push(employee);
          else byOrg.set(orgId, [employee]);
        }
        setEmployees(map);
        setTreeData(orgs.data.map(org => toNode(org, byOrg)));
      } catch {
        if (alive) setError('员工数据加载失败，请重试');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const selected = value ? employees.get(value) : undefined;

  return (
    <>
      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 8 }} />}
      <TreeSelect
        value={value ?? undefined}
        loading={loading}
        disabled={disabled}
        placeholder={placeholder}
        showSearch
        treeDefaultExpandAll
        treeNodeFilterProp="title"
        treeData={treeData}
        allowClear
        onChange={(next) => onChange?.(next ? employees.get(next as string) ?? null : null)}
      />
      {selected && <div style={{ marginTop: 6, color: '#666' }}>已选：{selected.employeeNo} · {selected.name}</div>}
    </>
  );
}

async function loadAllEmployees(): Promise<EmployeeListItem[]> {
  const result: EmployeeListItem[] = [];
  let page = 1;
  for (;;) {
    const res = await masterDataApi.employees.list({ page, pageSize: 100 });
    result.push(...res.data.list);
    if (page >= res.data.pagination.totalPages) break;
    page += 1;
  }
  return result;
}

function toNode(org: OrganizationNode, byOrg: Map<string, EmployeeListItem[]>): EmployeeTreeNode {
  const children: EmployeeTreeNode[] = org.children.map(child => toNode(child, byOrg));
  const staff = byOrg.get(org.id) ?? [];
  for (const employee of staff) {
    children.push({
      value: employee.id,
      title: `${employee.employeeNo} · ${employee.name}${employee.status === 'LEAVED' ? '（已离职）' : ''}`,
      isLeaf: true,
      disabled: employee.status === 'LEAVED',
      employee: { id: employee.id, employeeNo: employee.employeeNo, name: employee.name, version: employee.version },
    });
  }
  return { value: org.id, title: `${org.name}（${org.code}）`, selectable: false, children };
}
