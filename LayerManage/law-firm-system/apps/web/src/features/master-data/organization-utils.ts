import type { OrganizationNode, OrganizationType } from './types';
export const organizationTypeLabels: Record<OrganizationType, string> = {
  FIRM: '总所', HQ_CENTER: '总部中心', DEPARTMENT: '部门', BRANCH: '分所', GROUP: '工作组',
};
export function flattenOrganizations(nodes: OrganizationNode[]): OrganizationNode[] {
  return nodes.flatMap(node => [node, ...flattenOrganizations(node.children)]);
}

/** Build paths from the authorized tree only, ending at each individual node. */
export function organizationNamePaths(nodes: OrganizationNode[]): Map<string, string> {
  const paths = new Map<string, string>();
  function visit(items: OrganizationNode[], ancestors: string[]) {
    for (const node of items) {
      const names = [...ancestors, node.name];
      paths.set(node.id, names.join('/'));
      visit(node.children, names);
    }
  }
  visit(nodes, []);
  return paths;
}
export function filterOrganizations(nodes: OrganizationNode[], keyword: string): OrganizationNode[] {
  const search = keyword.trim().toLocaleLowerCase();
  if (!search) return nodes;
  return nodes.flatMap(node => {
    const children = filterOrganizations(node.children, search);
    const matches = [node.name, node.code, node.manager?.name, node.manager?.employeeNo]
      .some(value => value?.toLocaleLowerCase().includes(search));
    return matches || children.length ? [{ ...node, children: matches ? node.children : children }] : [];
  });
}

export function nextOrganizationSort(nodes: OrganizationNode[]): number {
  return Math.min(2147483647, nodes.reduce((max, node) => Math.max(max, node.sort), -1) + 1);
}
