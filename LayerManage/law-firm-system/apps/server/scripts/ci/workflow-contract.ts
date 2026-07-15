export interface WorkflowStep {
  job: string;
  index: number;
  name?: string;
  workingDirectory?: string;
  run?: string;
}

function indentation(line: string): number {
  return line.match(/^ */)?.[0].length ?? 0;
}

function stripYamlComment(value: string): string {
  let quote: "'" | '"' | undefined;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      if (character === quote && value[index - 1] !== '\\') quote = undefined;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
    } else if (character === '#' && (index === 0 || /\s/.test(value[index - 1]))) {
      return value.slice(0, index).trimEnd();
    }
  }
  return value.trimEnd();
}

function scalar(value: string): string {
  const active = stripYamlComment(value).trim();
  if (active.length >= 2) {
    const first = active[0];
    const last = active.at(-1);
    if ((first === "'" && last === "'") || (first === '"' && last === '"')) {
      return active.slice(1, -1);
    }
  }
  return active;
}

function foldedBlock(lines: string[], literal: boolean): string {
  while (lines.at(-1)?.trim() === '') lines.pop();
  const nonEmptyIndents = lines
    .filter(line => line.trim() !== '')
    .map(indentation);
  const blockIndent = nonEmptyIndents.length === 0 ? 0 : Math.min(...nonEmptyIndents);
  const content = lines.map(line => line.trim() === '' ? '' : line.slice(blockIndent));
  if (literal) return content.join('\n').trimEnd();

  const paragraphs: string[] = [];
  let paragraph: string[] = [];
  for (const line of content) {
    if (line === '') {
      if (paragraph.length > 0) {
        paragraphs.push(paragraph.join(' '));
        paragraph = [];
      }
    } else {
      paragraph.push(line);
    }
  }
  if (paragraph.length > 0) paragraphs.push(paragraph.join(' '));
  return paragraphs.join('\n\n').trimEnd();
}

function assignStepField(step: WorkflowStep, key: string, value: string): void {
  if (key === 'name') step.name = scalar(value);
  if (key === 'working-directory') step.workingDirectory = scalar(value);
  if (key === 'run') step.run = scalar(value);
}

function consumeBlock(
  lines: string[],
  startIndex: number,
  keyIndent: number,
  indicator: string,
): { value: string; lastIndex: number } {
  const blockLines: string[] = [];
  let blockIndex = startIndex + 1;
  while (blockIndex < lines.length) {
    const blockLine = lines[blockIndex];
    if (blockLine.trim() !== '' && indentation(blockLine) <= keyIndent) break;
    blockLines.push(blockLine);
    blockIndex += 1;
  }
  return {
    value: foldedBlock(blockLines, indicator.trim().startsWith('|')),
    lastIndex: blockIndex - 1,
  };
}

export function extractWorkflowSteps(source: string): WorkflowStep[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const steps: WorkflowStep[] = [];
  let inJobs = false;
  let inSteps = false;
  let job: string | undefined;
  let currentStep: WorkflowStep | undefined;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const active = stripYamlComment(line);
    if (active.trim() === '') continue;
    const indent = indentation(line);

    if (indent === 0) {
      inJobs = active.trim() === 'jobs:';
      inSteps = false;
      job = undefined;
      currentStep = undefined;
      continue;
    }
    if (!inJobs) continue;

    const jobMatch = indent === 2 ? active.match(/^\s{2}([A-Za-z0-9_-]+):\s*$/) : null;
    if (jobMatch) {
      job = jobMatch[1];
      inSteps = false;
      currentStep = undefined;
      continue;
    }
    if (!job) continue;
    if (indent === 4 && active.trim() === 'steps:') {
      inSteps = true;
      currentStep = undefined;
      continue;
    }
    if (!inSteps) continue;

    const stepMatch = indent === 6 ? active.match(/^\s{6}-(?:\s+(.*))?$/) : null;
    if (stepMatch) {
      currentStep = { job, index: steps.length };
      steps.push(currentStep);
      const inlineField = stepMatch[1]?.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
      if (inlineField?.[1] === 'run' && /^[>|][+-]?(?:\d+)?$/.test(inlineField[2].trim())) {
        const block = consumeBlock(lines, index, indent, inlineField[2]);
        currentStep.run = block.value;
        index = block.lastIndex;
      } else if (inlineField) {
        assignStepField(currentStep, inlineField[1], inlineField[2]);
      }
      continue;
    }
    if (!currentStep || indent !== 8) continue;

    const field = active.match(/^\s{8}([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!field) continue;
    const [, key, value] = field;
    if (key === 'run' && /^[>|][+-]?(?:\d+)?$/.test(value.trim())) {
      const block = consumeBlock(lines, index, indent, value);
      currentStep.run = block.value;
      index = block.lastIndex;
    } else {
      assignStepField(currentStep, key, value);
    }
  }

  return steps;
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
    if (character === '\n' || character === ';'
      || (character === '&' && source[index + 1] === '&')
      || (character === '|' && source[index + 1] === '|')) {
      if ((character === '&' || character === '|') && source[index + 1] === character) index += 1;
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

function invokesInteractiveCommand(command: string): boolean {
  const tokens = commandTokens(command);
  let executableIndex = tokens[0]?.toLowerCase() === 'env' ? 1 : 0;
  while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[executableIndex] ?? '')) executableIndex += 1;
  if (!['npm', 'npm.cmd'].includes(tokens[executableIndex]?.toLowerCase())) return false;
  const runIndex = tokens.findIndex((token, index) => index > executableIndex && token.toLowerCase() === 'run');
  return runIndex !== -1
    && ['system:bootstrap', 'super-admin:recover'].includes(tokens[runIndex + 1]?.toLowerCase());
}

function enablesRecoveryInCommand(command: string): boolean {
  const tokens = commandTokens(command);
  if (isOutputOnly(tokens)) return false;
  const assignment = /(?:^|\s)(?:(?:export|env|set)\s+)?ALLOW_SUPER_ADMIN_RECOVERY\s*=\s*(['"]?)true\1(?:\s|$)/i;
  const powershellAssignment = /(?:^|\s)\$env:ALLOW_SUPER_ADMIN_RECOVERY\s*=\s*(['"]?)true\1(?:\s|$)/i;
  return assignment.test(command) || powershellAssignment.test(command);
}

function enablesRecoveryInYaml(source: string): boolean {
  return source.replace(/\r\n/g, '\n').split('\n').some((line) => {
    const active = stripYamlComment(line);
    const match = active.match(/^\s*ALLOW_SUPER_ADMIN_RECOVERY\s*:\s*(.*?)\s*$/i);
    return match ? scalar(match[1]).toLowerCase() === 'true' : false;
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
  const issues: string[] = [];
  const steps = extractWorkflowSteps(source);
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
  if (enablesRecoveryInYaml(source) || commands.some(enablesRecoveryInCommand)) {
    issues.push('CI must not enable ALLOW_SUPER_ADMIN_RECOVERY');
  }
  if (commands.some(invokesInteractiveCommand)) {
    issues.push('CI must not invoke interactive bootstrap or recovery commands');
  }
  return issues;
}
