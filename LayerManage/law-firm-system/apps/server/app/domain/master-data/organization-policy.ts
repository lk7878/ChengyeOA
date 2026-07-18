import { OrganizationType } from '../../application/master-data/master-data-types';

const ALLOWED_PARENTS: Record<OrganizationType, ReadonlySet<OrganizationType>> = {
  FIRM: new Set(),
  HQ_CENTER: new Set(['FIRM']),
  BRANCH: new Set(['FIRM']),
  DEPARTMENT: new Set(['FIRM', 'HQ_CENTER', 'BRANCH']),
  GROUP: new Set(['DEPARTMENT', 'BRANCH']),
};

export function canParent(parent: OrganizationType, child: OrganizationType): boolean {
  return ALLOWED_PARENTS[child].has(parent);
}

export function isDescendantPath(candidate: string, ancestor: string): boolean {
  return candidate.startsWith(`${ancestor}/`);
}

export function rebasePath(oldRoot: string, descendant: string, newRoot: string): string {
  return `${newRoot}${descendant.slice(oldRoot.length)}`;
}
