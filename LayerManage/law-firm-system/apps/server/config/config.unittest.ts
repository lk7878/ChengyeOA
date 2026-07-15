import 'dotenv/config';
import { EggAppConfig, PowerPartial } from 'egg';

export function selectTestDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.DATABASE_URL_TEST ?? '';
  const url = new URL(raw);
  if (url.protocol !== 'postgresql:' || !url.pathname.slice(1).endsWith('_test')) {
    throw new Error('Egg unit tests require DATABASE_URL_TEST ending in _test');
  }
  return url.toString();
}

export default () => {
  process.env.DATABASE_URL = selectTestDatabaseUrl();
  return {} as PowerPartial<EggAppConfig>;
};
