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
    } else if (/\s/.test(character)) {
      push();
    } else {
      current += character;
    }
  }
  push();
  return tokens;
}

function isOutputOnly(tokens: string[]): boolean {
  return ['echo', 'printf', 'write-output'].includes(tokens[0]?.toLowerCase());
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

function invokesInteractiveCommand(command: string): boolean {
  const tokens = commandTokens(command);
  let executableIndex = tokens[0]?.toLowerCase() === 'env' ? 1 : 0;
  while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[executableIndex] ?? '')) executableIndex += 1;
  if (!['npm', 'npm.cmd'].includes(tokens[executableIndex]?.toLowerCase())) return false;

  let index = skipNpmOptions(tokens, executableIndex + 1);
  if (!['run', 'run-script'].includes(tokens[index]?.toLowerCase())) return false;
  index = skipNpmOptions(tokens, index + 1);
  return ['system:bootstrap', 'super-admin:recover'].includes(tokens[index]?.toLowerCase());
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

  const commands = steps.flatMap(step => step.run ? shellCommands(step.run) : []);
  if (workflowEnablesRecovery(parsed.root) || commands.some(enablesRecoveryInCommand)) {
    issues.push('CI must not enable ALLOW_SUPER_ADMIN_RECOVERY');
  }
  if (commands.some(invokesInteractiveCommand)) {
    issues.push('CI must not invoke interactive bootstrap or recovery commands');
  }
  return issues;
}
