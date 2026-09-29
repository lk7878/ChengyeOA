export class MasterDataError extends Error {
  constructor(readonly code: string, readonly status: number, readonly errors?: { organizationDeleteBlockers?: Record<string, number>; employeeHandoverBlockers?: Record<string, number> }) {
    super(code);
    this.name = 'MasterDataError';
  }
}
