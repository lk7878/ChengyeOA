export class MasterDataError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code);
    this.name = 'MasterDataError';
  }
}
