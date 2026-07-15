import 'dotenv/config';
import { bootstrapMain } from './system-cli';

void bootstrapMain().then(code => {
  process.exitCode = code;
});
