import 'dotenv/config';
import { secondSuperAdminMain } from './system-cli';

void secondSuperAdminMain().then(code => {
  process.exitCode = code;
});
