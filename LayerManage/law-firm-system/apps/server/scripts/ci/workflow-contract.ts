import { parseDocument } from 'yaml';

export interface WorkflowStep {
  job: string;
  index: number;
  name?: string;
  workingDirectory?: string;
  run?: string;
}

interface ParsedWorkflow {
  root?: Record<string, unknown>;
  valid: boolean;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function parseWorkflow(source: string): ParsedWorkflow {
  const document = parseDocument(source, {
    prettyErrors: false,
    strict: true,
    uniqueKeys: true,
  });
  if (document.errors.length > 0) return { valid: false };
  const root = record(document.toJS({ mapAsMap: false }));
  return { root, valid: root !== undefined };
}

function stepsFromRoot(root: Record<string, unknown>): WorkflowStep[] {
  const jobs = record(root.jobs);
  if (!jobs) return [];
  const result: WorkflowStep[] = [];
  for (const [jobName, jobValue] of Object.entries(jobs)) {
    const job = record(jobValue);
    if (!job || !Array.isArray(job.steps)) continue;
    job.steps.forEach((stepValue, index) => {
      const step = record(stepValue);
      if (!step || typeof step.run !== 'string') return;
      result.push({
        job: jobName,
        index,
        ...(typeof step.name === 'string' ? { name: step.name } : {}),
        ...(typeof step['working-directory'] === 'string'
          ? { workingDirectory: step['working-directory'] }
          : {}),
        run: step.run,
      });
    });
  }
  return result;
}

export function extractWorkflowSteps(source: string): WorkflowStep[] {
  const parsed = parseWorkflow(source);
  return parsed.root ? stepsFromRoot(parsed.root) : [];
}

function shellCommands(run: string): string[] {
  const source = run
    .replace(/\\\r?\n\s*/g, ' ')
    .replace(/`\r?\n\s*/g, ' ');
  const commands: string[] = [];
  let current = '';
  let quote: "'" | '"' | undefined;

  const push = () => {
    const command = current.trim();
    if (command) commands.push(command);
    current = '';
  };

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      current += character;
      if (character === quote && source[index - 1] !== '\\') quote = undefined;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      current += character;
      continue;
    }
    if (character === '#') {
      while (index < source.length && source[index] !== '\n') index += 1;
      push();
      continue;
    }
    if (character === '\n' || character === ';' || character === '|' || character === '&') {
      if (source[index + 1] === character) index += 1;
      push();
      continue;
    }
    current += character;
  }
  push();
  return commands;
}

function commandTokens(command: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: "'" | '"' | undefined;
  const push = () => {
    if (current) tokens.push(current);
    current = '';
  };
  for (let index = 0; index < command.length; index += 1) {
    const character = command[index];
    if (quote) {
      if (character === quote && command[index - 1] !== '\\') quote = undefined;
      else current += character;
    } else if (character === "'" || character === '"') {
      quote = character;
    } else if (/\s/.test(character) || character === ',') {
      push();
    } else {
      current += character;
    }
  }
  push();
  return tokens;
}

function isOutputOnly(tokens: string[]): boolean {
  return ['echo', 'printf', 'write-host', 'write-output'].includes(tokens[0]?.toLowerCase());
}

const npmOptionsWithValues = new Set([
  '--cache',
  '--loglevel',
  '--prefix',
  '--userconfig',
  '--workspace',
  '-w',
]);

function skipNpmOptions(tokens: string[], start: number): number {
  let index = start;
  while (index < tokens.length && tokens[index].startsWith('-')) {
    const option = tokens[index].split('=', 1)[0].toLowerCase();
    index += npmOptionsWithValues.has(option) && !tokens[index].includes('=') ? 2 : 1;
  }
  return index;
}

const interactiveScripts = new Set(['system:bootstrap', 'super-admin:recover']);
const shells = new Set(['bash', 'sh', 'zsh']);
const powershells = new Set(['powershell', 'powershell.exe', 'pwsh', 'pwsh.exe']);

function npmInvokesInteractive(tokens: string[]): boolean {
  let executableIndex = tokens[0]?.toLowerCase() === 'env' ? 1 : 0;
  while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[executableIndex] ?? '')) executableIndex += 1;
  if (!['npm', 'npm.cmd'].includes(tokens[executableIndex]?.toLowerCase())) return false;

  let index = skipNpmOptions(tokens, executableIndex + 1);
  if (!['run', 'run-script'].includes(tokens[index]?.toLowerCase())) return false;
  index = skipNpmOptions(tokens, index + 1);
  return interactiveScripts.has(tokens[index]?.toLowerCase());
}

function startProcessCommand(tokens: string[]): string[] | undefined {
  let executable: string | undefined;
  const argumentsList: string[] = [];
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    const lower = token.toLowerCase();
    if (['-filepath', '-file'].includes(lower)) {
      executable = tokens[index + 1];
      index += 1;
      continue;
    }
    if (['-argumentlist', '-args'].includes(lower)) {
      index += 1;
      while (index < tokens.length) {
        argumentsList.push(tokens[index]);
        index += 1;
      }
      index -= 1;
      continue;
    }
    if (!token.startsWith('-') && executable === undefined) executable = token;
  }
  return executable ? [executable, ...argumentsList] : undefined;
}

function wrapperPayload(tokens: string[]): string | undefined {
  const executable = tokens[0]?.toLowerCase();
  if (shells.has(executable)) {
    const optionIndex = tokens.findIndex((token, index) => index > 0 && /^-[a-z]*c[a-z]*$/i.test(token));
    return optionIndex === -1 ? undefined : tokens.slice(optionIndex + 1).join(' ');
  }
  if (powershells.has(executable)) {
    const optionIndex = tokens.findIndex((token, index) => index > 0
      && ['-c', '-command', '-commandwithargs'].includes(token.toLowerCase()));
    return optionIndex === -1 ? undefined : tokens.slice(optionIndex + 1).join(' ');
  }
  return undefined;
}

function tokensInvokeInteractive(tokens: string[], depth: number): boolean {
  if (depth > 8 || tokens.length === 0 || isOutputOnly(tokens)) return false;
  const executable = tokens[0].toLowerCase();

  if (executable === 'command') {
    let index = 1;
    while (tokens[index]?.startsWith('-')) index += 1;
    return tokensInvokeInteractive(tokens.slice(index), depth + 1);
  }
  if (executable === 'env') {
    let index = 1;
    while (index < tokens.length) {
      const token = tokens[index];
      if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) {
        index += 1;
        continue;
      }
      if (['-u', '--unset', '-c', '--chdir'].includes(token.toLowerCase())) {
        index += 2;
        continue;
      }
      if (token.startsWith('-')) {
        index += 1;
        continue;
      }
      break;
    }
    return tokensInvokeInteractive(tokens.slice(index), depth + 1);
  }
  if (executable === 'start-process' || executable === 'start') {
    const child = startProcessCommand(tokens);
    return child ? tokensInvokeInteractive(child, depth + 1) : false;
  }

  const payload = wrapperPayload(tokens);
  if (payload !== undefined) return invokesInteractiveCommandAtDepth(payload, depth + 1);
  if (npmInvokesInteractive(tokens)) return true;
  return tokens.slice(1).some(token => interactiveScripts.has(token.toLowerCase()));
}

function invokesInteractiveCommandAtDepth(command: string, depth: number): boolean {
  if (depth > 8) return true;
  return shellCommands(command).some(part => tokensInvokeInteractive(commandTokens(part), depth));
}

function invokesInteractiveCommand(command: string): boolean {
  return invokesInteractiveCommandAtDepth(command, 0);
}

function enablesRecoveryInCommand(command: string): boolean {
  const tokens = commandTokens(command);
  if (isOutputOnly(tokens)) return false;
  const assignment = /(?:^|\s)(?:(?:export|env|set)\s+)?ALLOW_SUPER_ADMIN_RECOVERY\s*=\s*(['"]?)true\1(?:\s|$)/i;
  const powershellAssignment = /(?:^|\s)\$env:ALLOW_SUPER_ADMIN_RECOVERY\s*=\s*(['"]?)true\1(?:\s|$)/i;
  return assignment.test(command) || powershellAssignment.test(command);
}

function recoveryEnvIsSafe(value: unknown): boolean {
  return value === false || value === 'false';
}

function envEnablesRecovery(value: unknown): boolean {
  const env = record(value);
  if (!env || !Object.prototype.hasOwnProperty.call(env, 'ALLOW_SUPER_ADMIN_RECOVERY')) return false;
  return !recoveryEnvIsSafe(env.ALLOW_SUPER_ADMIN_RECOVERY);
}

function workflowEnablesRecovery(root: Record<string, unknown>): boolean {
  if (envEnablesRecovery(root.env)) return true;
  const jobs = record(root.jobs);
  if (!jobs) return false;
  return Object.values(jobs).some((jobValue) => {
    const job = record(jobValue);
    if (!job) return false;
    if (envEnablesRecovery(job.env)) return true;
    if (!Array.isArray(job.steps)) return false;
    return job.steps.some(stepValue => envEnablesRecovery(record(stepValue)?.env));
  });
}

const expectedAcceptance: ReadonlyArray<readonly [string, string | undefined]> = [
  ['npx prisma migrate deploy', 'LayerManage/law-firm-system/apps/server'],
  ['npm run db:assert-empty', 'LayerManage/law-firm-system'],
  ['npm run verify', 'LayerManage/law-firm-system'],
  ['npm run db:reset:test', 'LayerManage/law-firm-system'],
  ['npm run db:assert-empty', 'LayerManage/law-firm-system'],
  ['git diff --exit-code', undefined],
];

const dependencySecurityContractIssue =
  'CI dependency-security job must match the approved Node, install, audit, SBOM, and artifact contract';
const dependencySecuritySafetyIssue =
  'CI dependency-security job must not include repair commands, interactive commands, or database credentials';
const projectDirectory = 'LayerManage/law-firm-system';

function dependencySecurityJob(root: Record<string, unknown>): Record<string, unknown> | undefined {
  return record(record(root.jobs)?.['dependency-security']);
}

function dependencySecurityStructureIsValid(root: Record<string, unknown>): boolean {
  const job = dependencySecurityJob(root);
  if (!job || job['runs-on'] !== 'ubuntu-latest' || job.needs !== undefined || !Array.isArray(job.steps)) {
    return false;
  }
  const steps = job.steps.map(record);
  if (steps.length !== 10 || steps.some(step => !step)) return false;

  const checkout = steps[0]!;
  const setup = steps[1]!;
  const setupWith = record(setup.with);
  const cachePaths = typeof setupWith?.['cache-dependency-path'] === 'string'
    ? setupWith['cache-dependency-path'].split(/\r?\n/).map(item => item.trim()).filter(Boolean)
    : [];
  if (checkout.uses !== 'actions/checkout@v4'
    || setup.uses !== 'actions/setup-node@v4'
    || setupWith?.['node-version'] !== '22.14.0'
    || setupWith.cache !== 'npm'
    || JSON.stringify(cachePaths) !== JSON.stringify([
      `${projectDirectory}/package-lock.json`,
      `${projectDirectory}/apps/server/package-lock.json`,
      `${projectDirectory}/apps/web/package-lock.json`,
    ])) {
    return false;
  }

  const expectedRuns: ReadonlyArray<readonly [string, string, string | undefined]> = [
    ['npm ci', projectDirectory, undefined],
    ['npm ci', `${projectDirectory}/apps/server`, undefined],
    ['npm ci', `${projectDirectory}/apps/web`, undefined],
    ['npm run security:policy:validate', projectDirectory, undefined],
    ['npm run security:audit:prod', projectDirectory, undefined],
    ['npm run security:audit:all', projectDirectory, 'always()'],
    ['npm run security:sbom', projectDirectory, 'always()'],
  ];
  for (let index = 0; index < expectedRuns.length; index += 1) {
    const step = steps[index + 2]!;
    const [run, workingDirectory, condition] = expectedRuns[index];
    if (step.run !== run
      || step['working-directory'] !== workingDirectory
      || step.if !== condition
      || step.uses !== undefined) {
      return false;
    }
  }

  const upload = steps[9]!;
  const uploadWith = record(upload.with);
  return upload.uses === 'actions/upload-artifact@v4'
    && upload.if === 'always()'
    && upload.run === undefined
    && uploadWith?.name === 'dependency-security-${{ github.sha }}'
    && uploadWith.path === `${projectDirectory}/var/security`
    && uploadWith['retention-days'] === 14
    && uploadWith['if-no-files-found'] === 'error';
}

function dependencySecurityIsSafe(root: Record<string, unknown>): boolean {
  const job = dependencySecurityJob(root);
  if (!job) return true;
  const commands = Array.isArray(job.steps)
    ? job.steps.map(record).flatMap(step => typeof step?.run === 'string' ? [step.run] : [])
    : [];
  const hasRepairCommand = commands.some(command => /\bnpm(?:\.cmd)?\s+audit\s+fix\b|(?:^|\s)--force(?:\s|$)/i.test(command));
  const hasInteractiveCommand = commands.some(invokesInteractiveCommand);
  const hasCredential = /DATABASE_URL(?:_TEST)?|POSTGRES_(?:DB|USER|PASSWORD)|JWT_SECRET|APP_KEYS/i
    .test(JSON.stringify(job));
  return !hasRepairCommand && !hasInteractiveCommand && !hasCredential;
}

export function checkWorkflowContract(source: string): string[] {
  const parsed = parseWorkflow(source);
  if (!parsed.valid || !parsed.root) return ['CI workflow YAML is invalid'];

  const issues: string[] = [];
  const steps = stepsFromRoot(parsed.root);
  const acceptanceCommands = new Set(expectedAcceptance.map(([run]) => run));
  const actualAcceptance = steps
    .filter(step => step.job === 'verify' && step.run && acceptanceCommands.has(step.run))
    .map(step => [step.run, step.workingDirectory] as const);

  if (JSON.stringify(actualAcceptance) !== JSON.stringify(expectedAcceptance)) {
    issues.push(
      'CI verify job bootstrap acceptance steps must match exact commands, directories, order, and uniqueness',
    );
  }
  if (!dependencySecurityStructureIsValid(parsed.root)) {
    issues.push(dependencySecurityContractIssue);
  }
  if (!dependencySecurityIsSafe(parsed.root)) {
    issues.push(dependencySecuritySafetyIssue);
  }

  const commands = steps.flatMap(step => step.run ? shellCommands(step.run) : []);
  if (workflowEnablesRecovery(parsed.root) || commands.some(enablesRecoveryInCommand)) {
    issues.push('CI must not enable ALLOW_SUPER_ADMIN_RECOVERY');
  }
  if (commands.some(invokesInteractiveCommand)) {
    issues.push('CI must not invoke interactive bootstrap or recovery commands');
  }
  return issues;
}
