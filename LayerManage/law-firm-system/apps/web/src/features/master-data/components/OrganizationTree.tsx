import { ApartmentOutlined, CaretDownOutlined, CaretRightOutlined } from '@ant-design/icons';
import { Tag } from 'antd';
import type { OrganizationNode } from '../types';

export default function OrganizationTree({ nodes, selectedId, onSelect, collapsedIds, onToggle, forceExpanded = false }: {
  nodes: OrganizationNode[]; selectedId?: string; onSelect: (node: OrganizationNode) => void;
  collapsedIds: ReadonlySet<string>; onToggle: (id: string) => void; forceExpanded?: boolean;
}) {
  return <ul className="md-org-tree">{nodes.map(node => {
    const expanded = forceExpanded || !collapsedIds.has(node.id);
    return <li key={node.id}>
      <div className="md-org-tree-row">
        {node.children.length ? <button className="md-org-toggle" type="button" aria-label={(expanded ? '收起' : '展开') + node.name + '的下级组织'}
          aria-expanded={expanded} disabled={forceExpanded} onClick={() => onToggle(node.id)}>
          {expanded ? <CaretDownOutlined /> : <CaretRightOutlined />}
        </button> : <span className="md-org-toggle-spacer" />}
        <button type="button" className={selectedId === node.id ? 'md-org-select is-selected' : 'md-org-select'} onClick={() => onSelect(node)}>
          <ApartmentOutlined /><span>{node.name}</span><Tag>{node.code}</Tag>
        </button>
      </div>
      {node.children.length > 0 && expanded && <OrganizationTree nodes={node.children} selectedId={selectedId} onSelect={onSelect} collapsedIds={collapsedIds} onToggle={onToggle} forceExpanded={forceExpanded} />}
    </li>;
  })}</ul>;
}
