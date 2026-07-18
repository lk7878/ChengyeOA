import { MasterDataError } from '../../app/domain/master-data/master-data-errors';

export function hasCode(code: string): (error: unknown) => boolean {
  return error => error instanceof MasterDataError && error.code === code;
}
