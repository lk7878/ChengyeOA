import 'dotenv/config';
import { recoveryMain } from './system-cli';

void recoveryMain().then(code => {
  process.exitCode = code;
});
