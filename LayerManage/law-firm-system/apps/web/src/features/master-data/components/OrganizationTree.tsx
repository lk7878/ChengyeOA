import { ApartmentOutlined } from '@ant-design/icons';
import { Tag } from 'antd';
import type { OrganizationNode } from '../types';

export default function OrganizationTree({ nodes, selectedId, onSelect }: { nodes: OrganizationNode[]; selectedId?: string; onSelect: (node: OrganizationNode) => void }) {
  return <ul className="md-org-tree">{nodes.map(node => <li key={node.id}>
    <button type="button" className={selectedId === node.id ? 'is-selected' : ''} onClick={() => onSelect(node)}>
      <ApartmentOutlined /><span>{node.name}</span><Tag>{node.code}</Tag>
    </button>
    {node.children.length > 0 && <OrganizationTree nodes={node.children} selectedId={selectedId} onSelect={onSelect} />}
  </li>)}</ul>;
}
