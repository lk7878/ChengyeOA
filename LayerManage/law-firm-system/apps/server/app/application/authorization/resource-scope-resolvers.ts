import { Prisma } from '@prisma/client';
import { ResourceCode } from '../../domain/authorization/authorization-types';

export const SCOPEABLE_RESOURCES = [
  'organization',
  'position',
  'employee',
  'employee_assignment',
  'employee_reporting_line',
  'professional_team',
  'professional_team_member',
  'user',
] as const satisfies readonly ResourceCode[];

export type ScopeableResourceCode = typeof SCOPEABLE_RESOURCES[number];

export interface OrganizationScopeTarget {
  path: string;
  includeDescendants: boolean;
  excludedDescendantPaths?: string[];
}

export interface ScopeResolutionInput {
  userId: string;
  evaluatedAt: Date;
  all: boolean;
  organizationTargets: OrganizationScopeTarget[];
  professionalTeamIds: string[];
  employeeIds: string[];
}

export interface ResourceWhereMap {
  organization: Prisma.OrganizationWhereInput;
  position: Prisma.PositionWhereInput;
  employee: Prisma.EmployeeWhereInput;
  employee_assignment: Prisma.EmployeeAssignmentWhereInput;
  employee_reporting_line: Prisma.EmployeeReportingLineWhereInput;
  professional_team: Prisma.ProfessionalTeamWhereInput;
  professional_team_member: Prisma.ProfessionalTeamMemberWhereInput;
  user: Prisma.UserWhereInput;
}

interface AuthorizedRecordDelegate<TWhere extends object> {
  findFirst(args: { where: TWhere; select: { id: true } }): Promise<{ id: string } | null>;
}

export interface ResourceScopeResolver<TWhere extends object> {
  resource: ScopeableResourceCode;
  buildWhere(input: ScopeResolutionInput): TWhere;
  findAuthorizedId(prisma: unknown, where: TWhere, id: string): Promise<string | null>;
}

type ResolverMap = {
  [K in ScopeableResourceCode]: ResourceScopeResolver<ResourceWhereMap[K]>;
};

const PRISMA_DELEGATE_NAMES: Record<ScopeableResourceCode, string> = {
  organization: 'organization',
  position: 'position',
  employee: 'employee',
  employee_assignment: 'employeeAssignment',
  employee_reporting_line: 'employeeReportingLine',
  professional_team: 'professionalTeam',
  professional_team_member: 'professionalTeamMember',
  user: 'user',
};

const organization = createResolver('organization', input => buildOrganizationScopeWhere(input));

export function buildOrganizationScopeWhere(input: ScopeResolutionInput): Prisma.OrganizationWhereInput {
  return combine(input, [
  ...organizationPredicates(input).map(predicate => predicate),
  ]);
}

const position = createResolver('position', input => combine(input, [
  ...organizationPredicates(input).map(organizationWhere => ({ organization: organizationWhere })),
  employeeIds(input, employeeId => ({
    assignments: { some: { ...activeAt(input.evaluatedAt), employeeId: { in: employeeId } } },
  })),
]));

const employee = createResolver('employee', input => buildEmployeeScopeWhere(input));

export function buildEmployeeScopeWhere(input: ScopeResolutionInput): Prisma.EmployeeWhereInput {
  return combine(input, [
  ...organizationPredicates(input).map(organizationWhere => ({
    assignments: { some: { ...activeAt(input.evaluatedAt), organization: organizationWhere } },
  })),
  teamIds(input, professionalTeamId => ({
    professionalTeams: {
      some: {
        ...activeAt(input.evaluatedAt),
        professionalTeamId: { in: professionalTeamId },
        professionalTeam: { status: 'ENABLED' },
      },
    },
  })),
  employeeIds(input, id => ({ id: { in: id } })),
  ]);
}

const employeeAssignment = createResolver('employee_assignment', input => combine(input, [
  ...organizationPredicates(input).map(organizationWhere => ({ organization: organizationWhere })),
  employeeIds(input, employeeId => ({ employeeId: { in: employeeId } })),
]));

const employeeReportingLine = createResolver('employee_reporting_line', input => combine(input, [
  ...organizationPredicates(input).map(organizationWhere => ({
    employee: {
      assignments: { some: { ...activeAt(input.evaluatedAt), organization: organizationWhere } },
    },
  })),
  employeeIds(input, ids => ({
    OR: [{ employeeId: { in: ids } }, { managerEmployeeId: { in: ids } }],
  })),
]));

const professionalTeam = createResolver('professional_team', input => buildProfessionalTeamScopeWhere(input));

export function buildProfessionalTeamScopeWhere(input: ScopeResolutionInput): Prisma.ProfessionalTeamWhereInput {
  return combine(input, [
  ...organizationPredicates(input).map(homeOrganization => ({ homeOrganization })),
  teamIds(input, id => ({ id: { in: id } })),
  employeeIds(input, employeeId => ({
    members: { some: { ...activeAt(input.evaluatedAt), employeeId: { in: employeeId } } },
  })),
  ]);
}

const professionalTeamMember = createResolver('professional_team_member', input => combine(input, [
  ...organizationPredicates(input).map(organizationWhere => ({
    employee: {
      assignments: { some: { ...activeAt(input.evaluatedAt), organization: organizationWhere } },
    },
  })),
  teamIds(input, professionalTeamId => ({ professionalTeamId: { in: professionalTeamId } })),
  employeeIds(input, employeeId => ({ employeeId: { in: employeeId } })),
]));

const user = createResolver('user', input => combine(input, [
  ...organizationPredicates(input).map(organizationWhere => ({
    employee: {
      assignments: { some: { ...activeAt(input.evaluatedAt), organization: organizationWhere } },
    },
  })),
  teamIds(input, professionalTeamId => ({
    employee: {
      professionalTeams: {
        some: { ...activeAt(input.evaluatedAt), professionalTeamId: { in: professionalTeamId } },
      },
    },
  })),
  employeeIds(input, employeeId => ({ employeeId: { in: employeeId } })),
]));

export const RESOURCE_SCOPE_RESOLVERS: ResolverMap = {
  organization,
  position,
  employee,
  employee_assignment: employeeAssignment,
  employee_reporting_line: employeeReportingLine,
  professional_team: professionalTeam,
  professional_team_member: professionalTeamMember,
  user,
};

function createResolver<K extends ScopeableResourceCode>(
  resource: K,
  buildWhere: (input: ScopeResolutionInput) => ResourceWhereMap[K],
): ResourceScopeResolver<ResourceWhereMap[K]> {
  return {
    resource,
    buildWhere,
    async findAuthorizedId(prisma, where, id) {
      const client = prisma as Partial<Record<string, AuthorizedRecordDelegate<ResourceWhereMap[K]>>>;
      const delegate = client[PRISMA_DELEGATE_NAMES[resource]];
      if (!delegate) return null;
      const record = await delegate.findFirst({ where: { AND: [where, { id }] }, select: { id: true } } as {
        where: ResourceWhereMap[K];
        select: { id: true };
      });
      return record?.id ?? null;
    },
  };
}

function combine<TWhere extends object>(input: ScopeResolutionInput, predicates: Array<TWhere | null>): TWhere {
  if (input.all) return {} as TWhere;
  const effective = predicates.filter((item): item is TWhere => item !== null);
  if (effective.length === 0) return { id: { in: [] } } as TWhere;
  return { OR: effective } as TWhere;
}

function organizationPredicates(input: ScopeResolutionInput): Prisma.OrganizationWhereInput[] {
  return input.organizationTargets.map(target => {
    const included: Prisma.OrganizationWhereInput = target.includeDescendants
      ? { OR: [{ path: target.path }, { path: { startsWith: `${target.path}/` } }] }
      : { path: target.path };
    const excluded = target.excludedDescendantPaths ?? [];
    if (excluded.length === 0) return included;
    return {
      AND: [
        included,
        {
          NOT: {
            OR: excluded.flatMap(path => [{ path }, { path: { startsWith: `${path}/` } }]),
          },
        },
      ],
    };
  });
}

function activeAt(evaluatedAt: Date) {
  return {
    startedAt: { lte: evaluatedAt },
    OR: [{ endedAt: null }, { endedAt: { gt: evaluatedAt } }],
  };
}

function employeeIds<T>(input: ScopeResolutionInput, build: (ids: string[]) => T): T | null {
  return input.employeeIds.length > 0 ? build(input.employeeIds) : null;
}

function teamIds<T>(input: ScopeResolutionInput, build: (ids: string[]) => T): T | null {
  return input.professionalTeamIds.length > 0 ? build(input.professionalTeamIds) : null;
}
