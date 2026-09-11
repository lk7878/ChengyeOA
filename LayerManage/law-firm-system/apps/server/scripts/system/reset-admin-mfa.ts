import 'dotenv/config';
import { adminMfaResetMain } from './system-cli';

void adminMfaResetMain().then(code => {
  process.exitCode = code;
});
