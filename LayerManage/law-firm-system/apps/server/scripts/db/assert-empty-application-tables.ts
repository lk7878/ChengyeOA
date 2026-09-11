import { Prisma, PrismaClient } from '@prisma/client';

interface CountDelegate {
  count(): Promise<number>;
}

export interface ApplicationTableCount {
  model: string;
  count: number;
}

function delegateName(modelName: string): string {
  return `${modelName.charAt(0).toLowerCase()}${modelName.slice(1)}`;
}

export const applicationDataModelNames = Prisma.dmmf.datamodel.models
  .map(model => model.name)
  .filter(modelName => !['Permission', 'EventSubscription', 'ContractTemplate', 'ApprovalDefinition'].includes(modelName));

export async function applicationTableCounts(
  client: object,
  modelNames: readonly string[] = applicationDataModelNames,
): Promise<ApplicationTableCount[]> {
  const delegates = client as Record<string, unknown>;
  const counts: ApplicationTableCount[] = [];
  for (const model of modelNames) {
    const delegate = delegates[delegateName(model)] as CountDelegate | undefined;
    if (!delegate || typeof delegate.count !== 'function') {
      throw new Error(`Missing Prisma delegate for ${model}`);
    }
    counts.push({ model, count: await delegate.count() });
  }
  return counts;
}

export async function assertEmptyApplicationTables(
  client: object,
  modelNames?: readonly string[],
): Promise<void> {
  const counts = await applicationTableCounts(client, modelNames);
  const nonEmpty = counts.filter(item => item.count !== 0);
  if (nonEmpty.length > 0) {
    throw new Error(`Application tables are not empty: ${nonEmpty.map(item => `${item.model}=${item.count}`).join(', ')}`);
  }
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    await assertEmptyApplicationTables(prisma);
    process.stdout.write('All application tables are empty.\n');
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : 'Empty database assertion failed'}\n`);
    process.exitCode = 1;
  });
}
