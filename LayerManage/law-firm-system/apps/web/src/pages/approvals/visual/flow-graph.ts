import { labels, type WorkflowSchema, type FlowNode } from './api';
const uid = () => 'n_' + crypto.randomUUID().replaceAll('-', '').slice(0, 12);
export function insertFlowNode(
  s: WorkflowSchema,
  edgeId: string,
  type: 'APPROVAL' | 'CC' | 'BRANCH',
): WorkflowSchema {
  const edge = s.edges.find((e) => e.id === edgeId);
  if (!edge) return s;
  const id = uid();
  const node: FlowNode = {
    id,
    name: labels[type],
    type,
    x: 350,
    y: 260,
    ...(['APPROVAL', 'CC'].includes(type)
      ? { rule: { type: 'USER' as const, ids: [] }, mode: 'ALL' as const }
      : {}),
  };
  const edges = s.edges.map((e) => (e.id === edgeId ? { ...e, to: id } : e));
  const nodes = [...s.nodes, node];
  if (type === 'BRANCH') {
    const reviewId = uid();
    nodes.push({
      ...node,
      id: reviewId,
      name: '条件满足时审批',
      type: 'APPROVAL',
      rule: { type: 'USER', ids: [] },
      mode: 'ALL',
      x: 600,
      y: 350,
    });
    edges.push(
      {
        id: uid(),
        from: id,
        to: reviewId,
        priority: 1,
        groups: [[{ field: s.fields[0]?.key ?? '', op: 'present' }]],
      },
      { id: uid(), from: id, to: edge.to },
      { id: uid(), from: reviewId, to: edge.to },
    );
  } else edges.push({ id: uid(), from: id, to: edge.to });
  return { ...s, nodes, edges };
}
